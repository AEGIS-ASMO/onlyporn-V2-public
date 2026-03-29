const { load } = require('cheerio');  
const logger = require('../logger');  
const { meta } = require('../model');  
const Provider = require('./provider');  

const metaCache = new Map();  
const META_TTL = 1000 * 60 * 10;  

const htmlCache = new Map();  
const inFlight = new Map();  
const HTML_TTL = 1000 * 60 * 5;  

// ✅ NEW: catalog cache
const catalogCache = new Map();
const CATALOG_TTL = 1000 * 60 * 3;

/* =========================  
   delay + retry  
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

  async fetchHtml(url) {  
    if (inFlight.has(url)) return inFlight.get(url);  

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
     🚀 FIXED: fast + cached + fallback  
  ========================= */  
  async fetchCatalog(baseUrl, genreName) {

  const cacheKey = `${baseUrl}-${genreName}`;
  const cached = catalogCache.get(cacheKey);

  if (cached && Date.now() - cached.time < CATALOG_TTL) {
    return cached.data;
  }

  const globalSeen = new Set();
  let allVideos = [];

  /* =========================
     🔥 STEP 1: HTML FIRST (MAIN FIX)
  ========================= */

  try {
    const html = await this.fetchHtml(baseUrl);
    const htmlVideos = this.getCatalogMetas(html, globalSeen);

    logger.warn(`HTML videos: ${htmlVideos.length}`);

    allVideos.push(...htmlVideos);
  } catch (err) {
    logger.warn(`HTML fetch failed: ${err.message}`);
  }

  /* =========================
     🔥 STEP 2: PAGINATE HTML
  ========================= */

  let page = 2;
  const maxHtmlPages = 5;

  while (allVideos.length < this.limit && page <= maxHtmlPages) {
    try {
      const pageUrl = `${baseUrl.replace(/\/$/, '')}/${page}/`;
      const html = await this.fetchHtml(pageUrl);

      const moreVideos = this.getCatalogMetas(html, globalSeen);

      if (!moreVideos.length) break;

      allVideos.push(...moreVideos);

      logger.warn(`HTML page ${page}: ${moreVideos.length}`);

      page++;
    } catch (err) {
      logger.warn(`HTML page ${page} failed`);
      break;
    }
  }

  /* =========================
     ⚡ STEP 3: API BACKFILL (OPTIONAL)
  ========================= */

  if (allVideos.length < this.limit && genreName) {

    const categorySlug = genreName
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/&/g, '')
      .replace(/[^a-z0-9-]/g, '');

    const size = 60;
    const MAX_CONCURRENT = 2;

    for (let i = 0; i < 5; i += MAX_CONCURRENT) {

      const batch = [];

      for (let j = 0; j < MAX_CONCURRENT; j++) {
        const offset = (i + j) * size;

        const apiUrl = `https://xhamster.com/api/v4/videos?category=${categorySlug}&from=${offset}&size=${size}`;

        batch.push(
          fetch(apiUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0',
              'Accept': 'application/json',
              'Referer': baseUrl
            }
          })
          .then(res => res.ok ? res.json() : null)
          .catch(() => null)
        );
      }

      const results = await Promise.all(batch);

      for (const json of results) {
        const videos = json?.videos || [];

        for (const v of videos) {
          const url = v.url || v.pageURL;

          if (!url || !v.title) continue;
          if (globalSeen.has(url)) continue;

          allVideos.push(
            new meta.MetaPreview(
              url,
              'movie',
              v.title,
              v.thumb || v.thumbURL,
              { videoPageUrl: url }
            )
          );

          globalSeen.add(url);

          if (allVideos.length >= this.limit) break;
        }
      }

      if (allVideos.length >= this.limit) break;
    }
  }

  const finalData = allVideos.slice(0, this.limit);

  catalogCache.set(cacheKey, {
    data: finalData,
    time: Date.now()
  });

  return finalData;
}  

  /* unchanged below */

  getCatalogMetas(html, seen = new Set()) {  
    if (!html || html.length < 1000) return [];  
    logger.warn(`HTML length: ${html.length}`);  

    const metadataList = [];  

    const match = html.match(/window\.initials\s*=\s*(\{.*?\});/s);  
    if (match) {  
      try {  
        const json = JSON.parse(match[1]);  
        const videos = [];

/* =========================
   🔥 RECURSIVE JSON SCAN
========================= */

function extractVideos(obj) {
  if (!obj || typeof obj !== 'object') return;

  // ✅ detect video arrays
  if (Array.isArray(obj)) {
    for (const item of obj) {
      extractVideos(item);
    }
    return;
  }

  // 🔥 KEY DETECTION (CRITICAL)
  if (
    obj.pageURL &&
    obj.title &&
    (obj.imageURL || obj.thumbURL || obj.previewImageURL)
  ) {
    videos.push(obj);
  }

  // traverse deeper
  for (const key in obj) {
    extractVideos(obj[key]);
  }
}

extractVideos(json);

logger.warn(`videos extracted (deep): ${videos.length}`);  

          

        for (const v of videos) {  
          if (!v?.pageURL || !v?.title) continue;  
          if (seen.has(v.pageURL)) continue;  

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
        }  
      } catch (e) {  
        logger.error('JSON parse failed', e);  
      }  
    }  

    const $ = load(html);  
    $('.thumb-list__item, .video-thumb, .thumb-list__item--video, .thumb-list__item--premium')  
      .each((_, element) => {  

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

    if (sources?.hls?.av1?.url) streamUrl = sources.hls.av1.url;  
    else if (sources?.hls?.h264?.url) streamUrl = sources.hls.h264.url;  
    else if (sources?.mp4?.high?.url) streamUrl = sources.mp4.high.url;  
    else if (sources?.mp4?.medium?.url) streamUrl = sources.mp4.medium.url;  

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
      url: url,  
      headers: {  
        Referer: 'https://xhamster.com/',  
        Origin: 'https://xhamster.com',  
        'User-Agent': 'Mozilla/5.0',  
      },  
    };  
  }  
}  

module.exports = XhamsterProvider.create;