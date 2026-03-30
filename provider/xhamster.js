const { load } = require('cheerio');
const logger = require('../logger');
const { meta } = require('../model');
const Provider = require('./provider');

/* =========================
   CACHE + STATE
========================= */
const metaCache = new Map();
const htmlCache = new Map();
const inFlight = new Map();
const catalogCache = new Map();

const META_TTL = 1000 * 60 * 10;
const HTML_TTL = 1000 * 60 * 5;
const CATALOG_TTL = 1000 * 60 * 3;

/* =========================
   HELPERS
========================= */
const delay = (ms) => new Promise(res => setTimeout(res, ms));

const normalizeUrl = (base, url) => {
  if (!url) return url;
  return url.startsWith('http') ? url : base + url;
};

async function fetchWithRetry(fn, url, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn(url);
    } catch (err) {
      if (err.response?.status === 429) {
        logger.warn(`429 retry ${i + 1}`);
        await delay(1000 * (i + 1));
      } else {
        throw err;
      }
    }
  }
  throw new Error('Max retries reached');
}

/* =========================
   PROVIDER
========================= */
class XhamsterProvider extends Provider {
  constructor() {
    super('https://xhamster.com', 'xhamster', 40);
  }

  static create() {
    return new XhamsterProvider();
  }

  /* =========================
     HTML FETCH (CACHED)
  ========================= */
  async fetchHtml(url) {
    if (inFlight.has(url)) return inFlight.get(url);

    const promise = (async () => {
      const cached = htmlCache.get(url);
      if (cached && Date.now() - cached.time < HTML_TTL) {
        return cached.data;
      }

      const html = await fetchWithRetry(
        (u) =>
          super.fetchHtml(u, {
            headers: {
              'User-Agent': 'Mozilla/5.0',
              'Accept': 'text/html',
              'Referer': 'https://xhamster.com/',
              'Cookie': 'x_content_preference_index=straight; parental-control=yes'
            }
          }),
        url
      );

      htmlCache.set(url, { data: html, time: Date.now() });
      return html;
    })();

    inFlight.set(url, promise);

    try {
      return await promise;
    } finally {
      inFlight.delete(url);
    }
  }

  /* =========================
     CATALOG URLS
  ========================= */
  getInitialUrl(id) {
    let url = this.baseUrl;
    if (id.includes('4k')) url += '/4k';
    return url + '/newest';
  }

  handleSearch({ extra: { search } }) {
    return `${this.baseUrl}/search/${encodeURIComponent(search)}/`;
  }

  handleGenre({ id, extra: { genre } }) {
    if (!genre) return this.getInitialUrl(id);

    const slug = genre
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/&/g, '')
      .replace(/[^a-z0-9-]/g, '');

    if (id.includes('4k')) return `${this.baseUrl}/4k${slug}`;
    return `${this.baseUrl}/categories/${slug}`;
  }

  /* =========================
     CATALOG FETCH
  ========================= */
  async fetchCatalog(baseUrl, genreName) {
    const cacheKey = `${baseUrl}-${genreName}`;
    const cached = catalogCache.get(cacheKey);

    if (cached && Date.now() - cached.time < CATALOG_TTL) {
      return cached.data;
    }

    const seen = new Set();
    let allVideos = [];

    try {
      const html = await this.fetchHtml(baseUrl);
      allVideos.push(...this.getCatalogMetas(html, seen));
    } catch (err) {
      logger.warn('HTML fetch failed');
    }

    let page = 2;
    while (allVideos.length < this.limit && page <= 5) {
      try {
        const url = `${baseUrl.replace(/\/$/, '')}/${page}/`;
        const html = await this.fetchHtml(url);

        const videos = this.getCatalogMetas(html, seen);
        if (!videos.length) break;

        allVideos.push(...videos);
        page++;
      } catch {
        break;
      }
    }

    catalogCache.set(cacheKey, {
      data: allVideos.slice(0, this.limit),
      time: Date.now()
    });

    return allVideos.slice(0, this.limit);
  }

  /* =========================
     METAS EXTRACTION
  ========================= */
  getCatalogMetas(html, seen = new Set()) {
    if (!html || html.length < 1000) return [];

    const results = [];

    const $ = load(html);

    $('.thumb-list__item, .video-thumb').each((_, el) => {
      const $a = $(el).find('a').first();
      let url = $a.attr('href');

      if (!url) return;
      if (url.includes('/ff/out') || url.includes('/moments/')) return;

      url = normalizeUrl(this.baseUrl, url);
      if (seen.has(url)) return;
      seen.add(url);

      const $img = $a.find('img').first();

      let poster =
        $img.attr('data-src') ||
        $img.attr('data-original') ||
        $img.attr('src');

      poster = normalizeUrl(this.baseUrl, poster);

      const title = $img.attr('alt') || $a.attr('title');
      if (!title) return;

      results.push(
        new meta.MetaPreview(url, 'movie', title, poster, {
          videoPageUrl: url
        })
      );
    });

    return results;
  }

  /* =========================
     METADATA
  ========================= */
  async getMetadata({ id }) {
    if (!id.startsWith('http')) id = this.baseUrl + id;

    const cached = metaCache.get(id);
    if (cached && Date.now() - cached.time < META_TTL) return cached.data;

    const html = await this.fetchHtml(id);
    const data = this.parseVideoPage({ id, html });

    metaCache.set(id, { data, time: Date.now() });
    return data;
  }

  /* =========================
     STREAM PARSING
  ========================= */
  parseVideoPage({ id, html }) {
    const match =
      html.match(/window\.initials\s*=\s*(\{.*?\});/s) ||
      html.match(/JSON\.parse\("(.+?)"\)/);

    if (!match) return {};

    let json;
    try {
      json = JSON.parse(match[1]);
    } catch {
      return {};
    }

    const title = json?.videoEntity?.title || json?.videoModel?.title;
    const description = json?.videoModel?.description || title;
    const poster = json?.videoModel?.thumbURL;

    const sources = json?.xplayerSettings?.sources || {};

    let streamUrl =
      sources?.hls?.av1?.url ||
      sources?.hls?.h264?.url ||
      sources?.mp4?.high?.url ||
      sources?.mp4?.medium?.url ||
      null;

    if (streamUrl && !streamUrl.startsWith('http')) streamUrl = null;

    if (streamUrl) {
      streamUrl = streamUrl.replace(/\.\d{3,4}[ab]/g, '');
    }

    const tags =
      json?.videoTagsListProps?.tags?.map(t => t.name).slice(0, 20) || [];

    if (!streamUrl) {
      logger.warn('No stream found:', id);
    }

    return new meta.MetaResponse(id, Provider.TYPE, title, {
      videoPageUrl: id,
      description,
      poster,
      background: poster,
      genres: tags,
      streamUrl
    });
  }

  /* =========================
     STREAM TRANSFORM
  ========================= */
  transformStream(url, stream) {
    return {
      ...stream,
      url,
      headers: {
        Referer: 'https://xhamster.com/',
        Origin: 'https://xhamster.com',
        'User-Agent': 'Mozilla/5.0'
      }
    };
  }
}

module.exports = XhamsterProvider.create;