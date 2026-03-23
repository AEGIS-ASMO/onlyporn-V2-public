const { load } = require('cheerio');
const logger = require('../logger');
const { meta } = require('../model');
const Provider = require('./provider');

const metaCache = new Map();
const META_TTL = 1000 * 60 * 10;
const htmlCache = new Map();
const inFlight = new Map();
const HTML_TTL = 1000 * 60 * 5; // 5 min

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
    super('https://xhamster.com', 'xhamster', 60);
  }

  static create() {
    return new XhamsterProvider();
  }

  /* =========================
     ✅ OVERRIDE fetchHtml ONLY
  ========================= */
  async fetchHtml(url) {

  // ✅ prevent duplicate parallel fetches
  if (inFlight.has(url)) {
    return inFlight.get(url);
  }

  const promise = (async () => {
    const cached = htmlCache.get(url);

    if (cached && Date.now() - cached.time < HTML_TTL) {
      return cached.data;
    }

    const html = await fetchWithRetry(
  (u) => super.fetchHtml(u, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9',
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
    if (!page || page === '1') return url.replace(/\/1\/?$/, '/');

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
     ✅ IMPROVED: full batch fetch + dedupe
  ========================= */
  async fetchCatalog(baseUrl, genreName) {
  const globalSeen = new Set();
  const allVideos = [];
  let page = 1;
  const maxPages = 10;

  // ✅ Convert genre name to URL slug automatically
  const categorySlug = genreName
    ? genreName
        .toLowerCase()
        .replace(/\s+/g, '-')   // spaces → dash
        .replace(/&/g, '')      // remove &
        .replace(/[^a-z0-9-]/g, '') // remove other invalid chars
    : null;

  while (allVideos.length < this.limit && page <= maxPages) {
    let pageUrl;

    // 1️⃣ Attempt API fetch for category if slug exists
    if (categorySlug) {
      pageUrl = `https://xhamster.com/api/video-category/${categorySlug}?page=${page}&perPage=40`;

      try {
        const res = await fetchWithRetry(
          (u) => super.fetchHtml(u, { headers: { 'User-Agent': 'Mozilla/5.0' } }),
          pageUrl
        );

        const json = JSON.parse(res);

        if (!json?.videos?.length) throw new Error('API empty, fallback to HTML');

        // Map API videos to MetaPreview objects
        for (const v of json.videos) {
          if (!globalSeen.has(v.pageURL)) {
            allVideos.push(
              new meta.MetaPreview(
                v.pageURL,
                'movie',
                v.title,
                v.thumbURL,
                { videoPageUrl: v.pageURL }
              )
            );
            globalSeen.add(v.pageURL);
          }
        }

        page++;
        continue; // go to next API page
      } catch (err) {
        logger.warn(`API fetch failed for ${categorySlug}: ${err.message}`);
        // fallback to HTML below
      }
    }

    // 2️⃣ HTML fallback (for first page or API failure)
    pageUrl = `${this.baseUrl}/categories/${categorySlug || ''}/${page}/`;
    const html = await this.fetchHtml(pageUrl);
    const metas = this.getCatalogMetas(html, globalSeen);

    if (!metas.length && page > 1) break; // stop if no more videos

    allVideos.push(...metas);

    page++;
    await delay(300 + Math.random() * 200);
  }

  return allVideos.slice(0, this.limit);
}

  /* =========================
     ✅ MODIFIED: accept external seen
  ========================= */
  getCatalogMetas(html, seen = new Set()) {
  if (!html || html.length < 1000) return [];
  logger.warn(`HTML length: ${html.length}`);

  const metadataList = [];

  // JSON parsing
  const match = html.match(/window\.initials\s*=\s*(\{.*?\});/s);
  if (match) {
    try {
      const json = JSON.parse(match[1]);
      const videos = [];

// main list
if (json?.layoutPage?.videoListProps?.videoThumbProps) {
  videos.push(...json.layoutPage.videoListProps.videoThumbProps);
}

// 🔥 additional rails (THIS is what you're missing)
let rails = [];

if (Array.isArray(json?.layoutPage?.sections)) {
  rails = json.layoutPage.sections;
} else if (json?.layoutPage?.content) {
  rails = Object.values(json.layoutPage.content);
}

for (const section of rails) {
  if (!section || typeof section !== 'object') continue;

  const items =
    section.videoListProps?.videoThumbProps ||
    section.videoThumbProps ||
    section.videos;

  if (Array.isArray(items)) {
    videos.push(...items);
  }
}
      logger.warn(`videos in JSON: ${videos.length}`);

      for (const v of videos) {
        if (!v?.pageURL || !v?.title) continue;
        if (seen.has(v.pageURL)) continue;

// only mark AFTER pushing
metadataList.push(
  new meta.MetaPreview(
    v.pageURL,
    'movie',
    v.title,
    v.imageURL || v.thumbURL || v.poster || v.previewImageURL,
    { videoPageUrl: v.pageURL }
  )
);

seen.add(v.pageURL);
if (metadataList.length >= 100) break;
      
      }
    } catch (e) {
      logger.error('JSON parse failed', e);
    }
  }

  // DOM fallback
  const $ = load(html);
  $('.thumb-list__item, .video-thumb, .thumb-list__item--video, .thumb-list__item--premium')
    .each((_, element) => {
      if (metadataList.length >= 200) return false;

      const $e = $(element);
      const $a = $e.find('a').first();
      let videoPageUrl = $a.attr('href');
      if (!videoPageUrl) return;
      if (videoPageUrl.includes('/ff/out') || videoPageUrl.includes('/moments/')) return;
      if (!videoPageUrl.startsWith('http')) videoPageUrl = this.baseUrl + videoPageUrl;
      if (seen.has(videoPageUrl)) return;
      seen.add(videoPageUrl);

      const $img = $a.find('img').first();
      let poster = $img.attr('data-src') || $img.attr('data-original') || $img.attr('data-preview') || $img.attr('src');
      if (poster && !poster.startsWith('http')) poster = this.baseUrl + poster;

      const title = $img.attr('alt') || $a.attr('title');
      if (!title) return;

logger.warn(`unique videos collected: ${metadataList.length}`);

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

  async getMetadata(args) {
    logger.debug({ args }, 'getMetadata');

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
    let match = html.match(/window\.initials\s*=\s*(\{.*?\});/) || html.match(/window\.initials\s*=\s*JSON\.parse\("(.+?)"\)/);
    if (!match) return {};

    let json;
    try {
      if (match[1].startsWith('{')) {
        json = JSON.parse(match[1]);
      } else {
        const decoded = match[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\');
        json = JSON.parse(decoded);
      }
    } catch (err) {
      logger.error(err);
      return {};
    }

    const title = json?.videoEntity?.title || json?.videoModel?.title;
    const description = json?.videoModel?.description || title;
    const poster = json?.videoModel?.thumbURL;

    let streamUrl = null;
const sources = json?.xplayerSettings?.sources || {};

// Prefer HLS first
if (sources?.hls?.av1?.url) {
  streamUrl = sources.hls.av1.url;
} else if (sources?.hls?.h264?.url) {
  streamUrl = sources.hls.h264.url;
} else if (sources?.mp4?.high?.url) {
  streamUrl = sources.mp4.high.url;
} else if (sources?.mp4?.medium?.url) {
  streamUrl = sources.mp4.medium.url;
}

// Clean xHamster-specific suffixes if present
if (streamUrl && !streamUrl.startsWith('http')) streamUrl = null;
if (streamUrl) streamUrl = streamUrl.replace(/\.\d{3,4}[ab]/g, '');

const tags = json?.videoTagsListProps?.tags?.map(t => t.name).slice(0, 20) || [];

if (!streamUrl) logger.warn("xHamster: no stream URL found");

    return new meta.MetaResponse(
      id,
      Provider.TYPE,
      title,
      {
        videoPageUrl: streamUrl,
        description,
        poster,
        background: poster,
        genres: tags,
      },
    );
  }

  transformStream(url, stream) {
  return {
    ...stream,
    url: url, // ✅ DO NOT MODIFY
    headers: {
      Referer: 'https://xhamster.com/',
      Origin: 'https://xhamster.com',
      'User-Agent': 'Mozilla/5.0',
    },
  };
}
}

module.exports = XhamsterProvider.create;