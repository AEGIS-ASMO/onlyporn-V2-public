const { load } = require('cheerio');
const logger = require('../logger');
const { meta } = require('../model');
const Provider = require('./provider');

const metaCache = new Map();
const META_TTL = 1000 * 60 * 10;

/* =========================
   ✅ ADDED: delay + retry
========================= */
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function fetchWithRetry(instance, url, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      return await instance(url);
    } catch (err) {
      if (err.response?.status === 429) {
        logger.warn(`429 hit, retrying (${i + 1})...`);
        await delay(2000 * (i + 1) + Math.random() * 1000);
      } else {
        throw err;
      }
    }
  }
  throw new Error('Max retries reached');
}

const pathMappings = {
  'Best (Daily)': '/best/daily',
  'Best (Weekly)': '/best/weekly',
  'Best (Monthly)': '/best/monthly',
};

class XhamsterProvider extends Provider {

  constructor() {
    super('https://xhamster.com', 'xhamster', 45);
  }

  static create() {
    return new XhamsterProvider();
  }

  async fetchHtml(url) {
    return fetchWithRetry(
      (u) => super.fetchHtml(u, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
          'Accept-Language': 'en-US,en;q=0.9',
        }
      }),
      url
    );
  }

  getInitialUrl(catalogId) {
    let url = this.baseUrl;
    if (catalogId.includes('4k')) url += '/4k';
    return url + '/newest';
  }

  handleSearch({ extra: { search: keyword } }) {
    return `${this.baseUrl}/search/${encodeURIComponent(keyword)}/`;
  }

  handleGenre({ id, extra: { genre } }) {
    if (pathMappings[genre]) {
      let path = '';
      if (id.includes('4k')) path += '/4k';
      path += pathMappings[genre];
      return this.baseUrl + path;
    }
    if (genre) {
      const slug = genre
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/&/g, '')
        .replace(/[^a-z0-9-]/g, '');
      return `${this.baseUrl}/categories/${slug}`;
    }
    return this.getInitialUrl(id);
  }

  handlePagination(url, { extra: { skip } }) {
    const page = this.page(skip);
    if (!page || page === '1') return url;
    try {
      const u = new URL(url);
      let pathname = u.pathname.replace(/\/$/, '');
      pathname = pathname.replace(/\/\d+$/, '');
      u.pathname = `${pathname}/${page}/`;
      return u.toString();
    } catch (e) {
      return `${url.replace(/\/$/, '')}/${page}/`;
    }
  }

  /* =========================
     ✅ NEW: fetchCatalogPage helper
  ========================= */
  async fetchCatalogPage(url, seen, fetchedPages) {
    if (fetchedPages.has(url)) return [];
    fetchedPages.add(url);

    logger.info(`fetching url ${url}`);
    const html = await this.fetchHtml(url);
    return this.getCatalogMetas(html, seen);
  }

  /* =========================
     ✅ MODIFIED: getCatalogMetas
  ========================= */
  getCatalogMetas(html, seen) {
    if (!html || html.length < 1000) return [];

    const metadataList = [];
    seen ||= new Set();

    const match = html.match(/window\.initials\s*=\s*(\{.*?\});/s);

    if (match) {
      try {
        const json = JSON.parse(match[1]);
        const videos = json?.layoutPage?.videoListProps?.videoThumbProps || [];

        for (const v of videos) {
          if (!v?.pageURL || !v?.title || !v?.thumbURL) continue;
          if (seen.has(v.pageURL)) continue;
          seen.add(v.pageURL);

          metadataList.push(
            new meta.MetaPreview(
              v.pageURL,
              'movie',
              v.title,
              v.imageURL || v.thumbURL,
              { videoPageUrl: v.pageURL }
            )
          );

          if (metadataList.length >= this.limit) break;
        }

        if (metadataList.length >= this.limit / 2) return metadataList;
      } catch (e) {
        logger.error('JSON parse failed', e);
      }
    }

    // DOM fallback
    const $ = load(html);
    $('.thumb-list__item, .video-thumb, .thumb-list__item--video, .thumb-list__item--premium')
      .each((_, element) => {
        if (metadataList.length >= this.limit) return false;

        const $e = $(element);
        const $a = $e.find('a').first();
        let videoPageUrl = $a.attr('href');
        if (!videoPageUrl) return;
        if (videoPageUrl.includes('/ff/out') || videoPageUrl.includes('/moments/')) return;
        if (!videoPageUrl.startsWith('http')) videoPageUrl = this.baseUrl + videoPageUrl;
        if (seen.has(videoPageUrl)) return;
        seen.add(videoPageUrl);

        const $img = $a.find('img').first();
        let poster =
          $img.attr('data-src') ||
          $img.attr('data-original') ||
          $img.attr('data-preview') ||
          $img.attr('src');
        if (poster && !poster.startsWith('http')) poster = this.baseUrl + poster;

        const title = $img.attr('alt') || $a.attr('title');
        if (!title) return;

        metadataList.push(
          new meta.MetaPreview(
            videoPageUrl,
            'movie',
            title,
            poster,
            { videoPageUrl }
          )
        );
      });

    return metadataList;
  }

  /* =========================
     ✅ NEW: fetch full catalog with all pages
  ========================= */
  async fetchFullCatalog(baseUrl) {
    const seen = new Set();
    const fetchedPages = new Set();
    let allVideos = [];
    let page = 1;

    while (allVideos.length < this.limit) {
      const pageUrl = this.handlePagination(baseUrl, { extra: { skip: page } });
      const metas = await this.fetchCatalogPage(pageUrl, seen, fetchedPages);
      if (metas.length === 0) break;

      allVideos = allVideos.concat(metas);
      page++;
    }

    return allVideos.slice(0, this.limit);
  }

  async getMetadata(args) {
    let { id } = args;
    if (!id.startsWith('http')) id = this.baseUrl + id;

    const cached = metaCache.get(id);
    if (cached && Date.now() - cached.time < META_TTL) return cached.data;

    const html = await this.fetchHtml(id);
    const data = this.parseVideoPage({ id, html });

    metaCache.set(id, { data, time: Date.now() });
    return data;
  }

  parseVideoPage({ id, html }) {
    let match = html.match(/window\.initials\s*=\s*(\{.*?\});/) ||
                html.match(/window\.initials\s*=\s*JSON\.parse\("(.+?)"\)/);
    if (!match) return {};

    let json;
    try {
      if (match[1].startsWith('{')) json = JSON.parse(match[1]);
      else json = JSON.parse(match[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\'));
    } catch (err) {
      logger.error(err);
      return {};
    }

    const title = json?.videoEntity?.title || json?.videoModel?.title;
    const description = json?.videoModel?.description || title;
    const poster = json?.videoModel?.thumbURL;

    let streamUrl = null;
    const sources = json?.xplayerSettings?.sources || {};
    if (sources?.hls?.h264?.url) streamUrl = sources.hls.h264.url;
    else if (sources?.hls?.av1?.url) streamUrl = sources.hls.av1.url;
    else if (sources?.mp4?.high?.url) streamUrl = sources.mp4.high.url;
    else if (sources?.mp4?.medium?.url) streamUrl = sources.mp4.medium.url;
    if (streamUrl && !streamUrl.startsWith('http')) streamUrl = null;

    const tags = json?.videoTagsListProps?.tags?.map(t => t.name).slice(0, 20) || [];
    if (!streamUrl) logger.warn("xHamster: no stream URL found");

    return new meta.MetaResponse(
      id,
      Provider.TYPE,
      title,
      { videoPageUrl: streamUrl, description, poster, background: poster, genres: tags }
    );
  }

  transformStream(url, stream) {
    return {
      ...stream,
      url: url.replace('_TPL_.av1.mp4.m3u8', '').replace('_TPL_.h264.mp4.m3u8', '') + stream.url,
      headers: {
        Referer: 'https://xhamster.com/',
        Origin: 'https://xhamster.com',
        'User-Agent': 'Mozilla/5.0',
      },
    };
  }
}

module.exports = XhamsterProvider.create;