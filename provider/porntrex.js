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
    let current = url;

    for (let i = 0; i < 4; i++) {
      const res = await fetch(current, {
        method: "HEAD",
        redirect: "manual",
        headers: {
          'User-Agent': 'Mozilla/5.0',
          'Referer': this.baseUrl,
          'Origin': this.baseUrl
        }
      });

      const location = res.headers.get("location");

      if (!location) {
        // fallback: some CDNs block HEAD → try GET once
        if (i === 0) {
          const getRes = await fetch(current, { method: "GET" });
          return getRes.url;
        }
        break;
      }

      current = location.startsWith('http')
        ? location
        : new URL(location, current).href;

      logger.debug(`REDIRECT → ${current}`);
    }

    return current;

  } catch (err) {
    logger.error("Resolve failed:", err);
    return url;
  }
}

  // kept (not used here anymore)
  async extractHlsStreams(masterUrl) {
    try {
      const res = await fetch(masterUrl);
      const text = await res.text();

      const lines = text.split('\n');
      const streams = [];

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        if (line.startsWith('#EXT-X-STREAM-INF')) {
          const resolutionMatch = line.match(/RESOLUTION=\d+x(\d+)/);
          const height = resolutionMatch ? resolutionMatch[1] : 'auto';

          const nextLine = lines[i + 1];

          if (nextLine && !nextLine.startsWith('#')) {
            let streamUrl = nextLine.trim();

            if (!streamUrl.startsWith('http')) {
              const base = masterUrl.substring(0, masterUrl.lastIndexOf('/') + 1);
              streamUrl = base + streamUrl;
            }

            streams.push({
              url: streamUrl,
              name: `${height}p`,
              type: Provider.TYPE,
              headers: {
                Referer: this.baseUrl,
                Origin: this.baseUrl,
                'User-Agent': 'Mozilla/5.0',
              },
            });
          }
        }
      }

      return streams;

    } catch (err) {
      logger.error("HLS parse failed:", err);
      return [];
    }
  }

  async parseVideoPage({ id, html }) {

const getQuality = (url) => {
  const match = url.match(/(\d{3,4})p/);
  if (match) return parseInt(match[1]);

  // fallback using bitrate hints
  if (url.includes('4k') || url.includes('2160')) return 2160;
  if (url.includes('1080')) return 1080;
  if (url.includes('720')) return 720;

  return 0;
};

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
   🎯 PRIMARY: DIRECT MP4
========================= */
const videoUrlMatch = embedHtml.match(/video_url:\s*'([^']+)'/);

if (videoUrlMatch && videoUrlMatch[1]) {
  let videoUrl = videoUrlMatch[1];

  if (videoUrl.startsWith("//")) {
    videoUrl = "https:" + videoUrl;
  }

  logger.debug(`MP4 FOUND: ${videoUrl}`);

  const final = await this.resolveStream(videoUrl);

  return {
    metaResponse: new meta.MetaResponse(id, "movie", title, {
      description: title,
      background: poster
    }),
    videoPageUrl: final,
    behaviorHints: {
      notWebReady: true,
      headers: {
        Referer: this.baseUrl,
        Origin: this.baseUrl,
        'User-Agent': 'Mozilla/5.0'
      }
    }
  };
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

  logger.debug(`HLS FOUND: ${hlsUrl}`);

  return {
    metaResponse: new meta.MetaResponse(id, "movie", title, {
      description: title,
      background: poster
    }),
    videoPageUrl: hlsUrl,
    behaviorHints: {
      notWebReady: true,
      headers: {
        Referer: this.baseUrl,
        Origin: this.baseUrl,
        'User-Agent': 'Mozilla/5.0'
      }
    }
  };
}
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

    // 🔥 FILTER BAD URLs
    if (
      url.includes('/video/') ||
      url.includes('embed') ||
      url.endsWith('.jpg')
    ) {
      logger.debug(`SKIPPED FAKE: ${url}`);
      return;
    }

    rawUrls.push(url);
  }
});

const resolved = await Promise.all(
  rawUrls.map(url => this.resolveStream(url))
);

const valid = resolved.filter(Boolean);

if (valid.length) {
  const best = valid.sort((a, b) => getQuality(b) - getQuality(a))[0];

  return {
    metaResponse: new meta.MetaResponse(id, "movie", title, {
      description: title,
      background: poster
    }),
    videoPageUrl: best,
    behaviorHints: {
      notWebReady: true,
      headers: {
        Referer: this.baseUrl,
        Origin: this.baseUrl,
        'User-Agent': 'Mozilla/5.0'
      }
    }
  };
}

/* =========================
   ⚡ RESOLVE STREAMS
========================= */
const resolvedUrls = await Promise.all(
  rawUrls.map(url => this.resolveStream(url))
);

let streams = [];

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
      name: 'mp4',
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
    streams.sort((a, b) => getQuality(b.url) - getQuality(a.url));

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
  videoPageUrl: streams[0]?.url,
behaviorHints: {
  notWebReady: true,
  headers: {
    Referer: this.baseUrl,
    Origin: this.baseUrl,
    'User-Agent': 'Mozilla/5.0'
  }
}
};
  }

}

module.exports = PorntrexProvider.create;