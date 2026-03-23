const { load } = require('cheerio');
const logger = require('../logger');
const { meta } = require('../model');
const Provider = require('./provider');
const fetch = require("node-fetch");

class PorntrexProvider extends Provider {

  constructor() {
    super('https://porntrex.com/', 'porntrex');
    this.dataset = {};
    this.metas = {};
    this.videoCache = new Map(); // 🧠 cache parsed video pages
this.videoCacheTTL = 1000 * 60 * 5; // 5 min
    this.streamCache = new Map(); // 🎥 cache resolved streams
this.streamCacheTTL = 1000 * 60 * 10; // 10 min
this.streamPending = new Map();
this.videoPending = new Map();
  }

  static create() {
    return new PorntrexProvider();
  }

  getInitialUrl(catalogId) {
    const segment = this.getSegment(catalogId);
    if (segment) return `${this.baseUrl}${segment}/`;
    return this.baseUrl;
  }

  getSegment(catalogId) {
    return catalogId.substring(this.getName().length + 1);
  }

  handleSearch({ extra: { search: keyword } }) {
    return `${this.baseUrl}search/${encodeURIComponent(keyword)}/`;
  }

  handleGenre({ extra: { genre } }) {
    const slug = genre
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9\-]/g, '');
    return `${this.baseUrl}categories/${slug}/`;
  }

  handlePagination(url, { extra: { skip } }) {
    const page = parseInt(this.page(skip)) || 1;
const from = (page - 1) * 24;

    if (url.includes('/search/')) {
      const keywordMatch = url.match(/search\/([^\/]+)/);
      const keyword = keywordMatch ? keywordMatch[1] : '';
      return `${this.baseUrl}search/${keyword}/?mode=async&function=get_block&block_id=list_videos_common_videos_list&from=${from}`;
    }

    if (url.includes('/categories/')) {
      return `${url}?mode=async&function=get_block&block_id=list_videos_common_videos_list_category&from=${from}`;
    }

    // default sorted catalog
    const segment = url.match(/porntrex\.com\/([^\/]+)/)?.[1] || '';
    const sortMap = {
      'latest-updates': 'post_date',
      'most-popular': 'video_viewed',
      'top-rated': 'rating',
      'longest': 'duration',
      'most-commented': 'most_commented',
      'most-favourited': 'most_favourited'
    };
    const sort = sortMap[segment] || 'post_date';

    return `${this.baseUrl}?mode=async&function=get_block&block_id=list_videos_common_videos_list&sort_by=${sort}&from=${from}`;
  }

  getCatalogMetas(html) {
    const metas = [];
    const $ = load(html);

    $('div.video-item').each((i, el) => {
      const $a = $(el).find('a').first();
      const href = $a.attr('href');
      if (!href || !href.includes('/video/')) return;

      const videoPageUrl = href.startsWith('http') ? href : this.baseUrl.replace(/\/$/, '') + href;
      const $img = $a.find('img');

      let poster = $img.attr('data-src') || $img.attr('data-original') || $img.attr('src');
      if (poster && poster.startsWith('//')) poster = 'https:' + poster;

      const title = $img.attr('alt') || $a.attr('title');
      if (!title) {
        logger.warn(`Porntrex: video without title found at ${videoPageUrl}`);
        return;
      }

      metas.push(new meta.MetaPreview(videoPageUrl, 'movie', title, poster));
    });

    return metas;
  }

  fixLooseJson(looseJsonString) {
    let jsonString = looseJsonString.trim().replace(/^"(.*)"$/, '$1');
    jsonString = jsonString.replace(/'/g, '"');
    jsonString = jsonString.replace(/(\w+)\s*:/g, '"$1":');
    jsonString = jsonString.replace(/:\s*'([^']*)'/g, ': "$1"');
    return jsonString;
  }

  async resolveStream(url) {

  // ✅ CACHE HIT
  const cached = this.streamCache.get(url);
  if (cached && (Date.now() - cached.time < this.streamCacheTTL)) {
    logger.debug(`Porntrex: stream cache hit for ${url}`);
    return cached.data;
  }

  // 🔁 PREVENT DUPLICATE HEAD REQUESTS
if (this.streamPending.has(url)) {
  return this.streamPending.get(url);
}

const request = (async () => {
  try {
    const res = await fetch(url, {
      method: "HEAD",
      redirect: "manual",
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Referer': this.baseUrl,
        'Origin': this.baseUrl
      }
    });

    const location = res.headers.get("location");
    const finalUrl = location || url;

    this.streamCache.set(url, {
      data: finalUrl,
      time: Date.now()
    });

    return finalUrl;

  } catch (err) {
    logger.warn("Porntrex: failed to resolve stream", err);
    return url;
  } finally {
    this.streamPending.delete(url);
  }
})();

this.streamPending.set(url, request);

return request;
}

  async parseVideoPage({ id }) {

  // ✅ CACHE HIT
  const cached = this.videoCache.get(id);
  if (cached && (Date.now() - cached.time < this.videoCacheTTL)) {
    logger.debug(`Porntrex: video cache hit for ${id}`);
    return cached.data;
  }

  // 🔁 PREVENT DUPLICATE PARSE
  if (this.videoPending.has(id)) {
    return this.videoPending.get(id);
  }

  const request = (async () => {

    const videoIdMatch = id.match(/\d+/);
    if (!videoIdMatch) {
      logger.warn(`Porntrex: invalid video id "${id}"`);
      return null;
    }

    const videoId = videoIdMatch[0];
    const embedUrl = `${this.baseUrl}embed/${videoId}`;

    const embedHtml = await this.fetchHtml(embedUrl);

    const titleMatch = embedHtml.match(/video_title:\s*'([^']+)'/);
    const previewMatch = embedHtml.match(/preview_url:\s*'([^']+)'/);
    const videoMatch = embedHtml.match(/video_url:\s*'([^']+)'/);

    if (!videoMatch) {
      logger.warn(`Porntrex: video_url not found for ${videoId}`);
      return null;
    }

    let videoUrl = videoMatch[1];
    if (videoUrl.startsWith("//")) videoUrl = "https:" + videoUrl;

    let poster = previewMatch ? previewMatch[1] : null;
    if (poster && poster.startsWith("//")) poster = "https:" + poster;

    // ✅ SINGLE STREAM ONLY (REAL BEHAVIOR)
    const finalUrl = await this.resolveStream(videoUrl);

    const result = {
      metaResponse: new meta.MetaResponse(
        id,
        "movie",
        titleMatch ? titleMatch[1] : "Porntrex Video",
        {
          description: titleMatch ? titleMatch[1] : "Porntrex Video",
          background: poster
        }
      ),

      streams: [{
        title: "Auto",
        url: finalUrl,
        behaviorHints: {
          notWebReady: true,
          headers: {
            Referer: this.baseUrl,
            Origin: this.baseUrl,
            'User-Agent': 'Mozilla/5.0'
          }
        }
      }]
    };

    // ✅ CACHE
    this.videoCache.set(id, {
      data: result,
      time: Date.now()
    });

    return result;

  })();

  this.videoPending.set(id, request);

  try {
    return await request;
  } finally {
    this.videoPending.delete(id);
  }
}
}

module.exports = PorntrexProvider.create;