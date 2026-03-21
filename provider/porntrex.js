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

getSegmentFromUrl(url) {
  const match = url.match(/porntrex\.com\/([^\/]+)/);
  return match ? match[1] : '';
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
  const page = this.page(skip);

  // each page = 24 videos
  const from = (page - 1) * 24;

if (url.includes('/search/')) {
  const keywordMatch = url.match(/search\/([^\/]+)/);
  const keyword = keywordMatch ? keywordMatch[1] : '';
  return `${this.baseUrl}search/${keyword}/?mode=async&function=get_block&block_id=list_videos_common_videos_list&from=${from}`;
}

if (url.includes('/categories/')) {
  return `${url}?mode=async&function=get_block&block_id=list_videos_common_videos_list_category&from=${from}`;
}

  const segment = this.getSegmentFromUrl(url);

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

    const videoPageUrl = href.startsWith('http')
      ? href
      : this.baseUrl.replace(/\/$/, '') + href;

    const $img = $a.find('img');

    let poster =
      $img.attr('data-src') ||
      $img.attr('data-original') ||
      $img.attr('src');

    if (poster && poster.startsWith('//')) {
      poster = 'https:' + poster;
    }

    const title =
      $img.attr('alt') ||
      $a.attr('title');

    if (!title) return;

    metas.push(new meta.MetaPreview(
      videoPageUrl,
      'movie',
      title,
      poster
    ));
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
  try {
    let currentUrl = url;

    for (let i = 0; i < 3; i++) {
      const res = await fetch(currentUrl, {
        method: "GET",
        redirect: "manual",
        headers: {
          'User-Agent': 'Mozilla/5.0',
          'Referer': this.baseUrl,
          'Origin': this.baseUrl
        }
      });

      const location = res.headers.get("location");

      if (!location) break;

      currentUrl = location.startsWith('http')
        ? location
        : new URL(location, currentUrl).href;

      logger.debug(`REDIRECT → ${currentUrl}`);
    }

    return currentUrl;

  } catch (err) {
    logger.error("Resolve failed:", err);
    return url;
  }
}
  async extractHlsStreams(masterUrl) {
  try {
    const res = await fetch(masterUrl, {
  headers: {
    Referer: this.baseUrl,
    Origin: this.baseUrl,
    'User-Agent': 'Mozilla/5.0',
  }
});

    const text = await res.text();
    const lines = text.split('\n');

    const streams = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (line.startsWith('#EXT-X-STREAM-INF')) {

        const resMatch = line.match(/RESOLUTION=\d+x(\d+)/);
        let height = resMatch ? parseInt(resMatch[1]) : 0;

// 🔥 fallback using bandwidth (for 4K detection)
const bandwidthMatch = line.match(/BANDWIDTH=(\d+)/);
if (!height && bandwidthMatch) {
  const bw = parseInt(bandwidthMatch[1]);

  if (bw > 8000000) height = 2160;
  else if (bw > 5000000) height = 1080;
  else if (bw > 2500000) height = 720;
  else if (bw > 1000000) height = 480;
}

        let streamUrl = lines[i + 1];
        if (!streamUrl) continue;

        if (!streamUrl.startsWith('http')) {
          const base = masterUrl.substring(0, masterUrl.lastIndexOf('/') + 1);
          streamUrl = base + streamUrl;
        }

        streams.push({
          url: streamUrl.trim(),
          name: height ? `${height}p` : 'auto',
          type: Provider.TYPE,
          behaviorHints: {
            notWebReady: true,
            headers: {
              Referer: this.baseUrl,
              Origin: this.baseUrl,
              'User-Agent': 'Mozilla/5.0',
            }
          }
        });
      }
    }

    // 🔥 fallback if no variants (single HLS)
    if (!streams.length && masterUrl.includes('.m3u8')) {
      streams.push({
        url: masterUrl,
        name: 'auto',
        type: Provider.TYPE,
        behaviorHints: {
          notWebReady: true,
          headers: {
            Referer: this.baseUrl,
            Origin: this.baseUrl,
            'User-Agent': 'Mozilla/5.0',
          }
        }
      });
    }

    return streams;

  } catch (err) {
    logger.error("HLS parse failed:", err);
    return [];
  }
}

  async parseVideoPage({ id, html }) {

    const videoIdMatch = id.match(/\d+/);
    if (!videoIdMatch) return null;

    const videoId = videoIdMatch[0];

    const embedUrl = `${this.baseUrl}embed/${videoId}`;
    const embedHtml = await this.fetchHtml(embedUrl);

console.log("========== EMBED HTML START ==========");
console.log(embedHtml);
console.log("========== EMBED HTML END ==========");

logger.debug(`EMBED HTML LENGTH: ${embedHtml.length}`);
logger.debug(`CHECK hls_url: ${embedHtml.includes('hls_url')}`);
logger.debug(`CHECK alt_url: ${embedHtml.includes('video_alt_url')}`);

    const titleMatch = embedHtml.match(/video_title:\s*'([^']+)'/);
    const previewMatch = embedHtml.match(/preview_url:\s*'([^']+)'/);

    const title = titleMatch ? titleMatch[1] : "Porntrex Video";

    let poster = previewMatch ? previewMatch[1] : null;
    if (poster && poster.startsWith("//")) {
      poster = "https:" + poster;
    }
/* =========================
   🔥 PRIORITY: HLS STREAM
========================= */
const hlsMatch = embedHtml.match(/hls_url:\s*'([^']+)'/);

if (hlsMatch && hlsMatch[1]) {
  let hlsUrl = hlsMatch[1];

  if (hlsUrl.startsWith("//")) {
    hlsUrl = "https:" + hlsUrl;
  }
console.log(hlsUrl);

  logger.debug(`HLS MASTER FOUND: ${hlsUrl}`);

  const hlsStreams = await this.extractHlsStreams(hlsUrl);

  if (hlsStreams.length) {
  logger.debug(`USING HLS STREAMS`);

  return {
  metaResponse: new meta.MetaResponse(
    id,
    "movie",
    title,
    {
      description: title,
      background: poster
    }
  ),
  streams: hlsStreams
};
}
}

/* =========================
   🎯 PRIMARY: DIRECT MP4
========================= */
const videoUrlMatch = embedHtml.match(/video_url:\s*'([^']+)'/);

if (videoUrlMatch && videoUrlMatch[1]) {
  let videoUrl = videoUrlMatch[1];

  if (videoUrl.startsWith("//")) {
    videoUrl = "https:" + videoUrl;
  }

  logger.debug(`DIRECT VIDEO FOUND: ${videoUrl}`);

  const finalStream = await this.resolveStream(videoUrl);

return {
  metaResponse: new meta.MetaResponse(
    id,
    "movie",
    title,
    {
      description: title,
      background: poster
    }
  ),
  streams: [{
    url: finalStream,
    name: 'auto',
    type: Provider.TYPE,
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
}




    /* =========================
       ✅ ONLY ALT URLS (REAL STREAMS)
    ========================= */
    const streamKeys = [
  'video_alt_url',
  'video_alt_url2',
  'video_alt_url3',
  'video_alt_url4',
  'video_alt_url5',
];

let rawUrls = [];

streamKeys.forEach(key => {
  const match = embedHtml.match(new RegExp(`${key}:\\s*'([^']+)'`));

  if (match && match[1]) {
  let url = match[1];

  if (url.startsWith("//")) {
    url = "https:" + url;
  } else if (!url.startsWith("http")) {
    url = this.baseUrl.replace(/\/$/, '') + url;
  }

  // 🔥 FILTER FAKE ALT URLS HERE
  if (url.includes('/video/')) {
    logger.debug(`SKIPPING FAKE ALT URL: ${url}`);
    return;
  }

  logger.debug(`RAW STREAM [${key}]: ${url}`);
  rawUrls.push(url);
}
});

if (!rawUrls.length) {
  logger.error("Porntrex: no raw URLs found");
  return null;
}

/* =========================
   ⚡ RESOLVE STREAMS
========================= */
const resolvedUrls = await Promise.all(
  rawUrls.map(url => this.resolveStream(url))
);

let streams = [];
const getQuality = (url) => {
  const match = url.match(/(\d{3,4})p/);
  return match ? match[1] + 'p' : 'auto';
};

for (const resolved of resolvedUrls) {

  logger.debug(`RESOLVED STREAM: ${resolved}`);

  if (!resolved) continue;



  // 🔥 HLS SUPPORT
  if (resolved.includes('.m3u8')) {
    logger.debug(`HLS DETECTED: ${resolved}`);

    const hlsStreams = await this.extractHlsStreams(resolved);

    logger.debug(`HLS STREAM COUNT: ${hlsStreams.length}`);


    streams.push(...hlsStreams);

  } else {
    streams.push({
      url: resolved,    
    name: getQuality(resolved),
      type: Provider.TYPE,
      headers: {
        Referer: this.baseUrl,
        Origin: this.baseUrl,
        'User-Agent': 'Mozilla/5.0',
      }
    });
  }
}

    if (!streams.length) {
      logger.error("Porntrex: no working streams found");
      return null;
    }

    // remove duplicates
    const seen = new Set();
    streams = streams.filter(s => {
      if (seen.has(s.url)) return false;
      seen.add(s.url);
      return true;
    });

    // sort best → worst
    streams.sort((a, b) => {
  const getQ = s => parseInt(s.name) || 0;
  return getQ(b) - getQ(a);
});

    return {
  metaResponse: new meta.MetaResponse(
    id,
    "movie",
    title,
    {
      description: title,
      background: poster
    }
  ),
  streams
};
  }

}

module.exports = PorntrexProvider.create;