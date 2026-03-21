const { load } = require('cheerio');
const logger = require('../logger');
const { meta } = require('../model');
const Provider = require('./provider');
const fetch = require("node-fetch");
const getQuality = (url) => {
  if (!url) return 0;

  const match = url.match(/(\d{3,4})(p|P)?/);
  if (match) return parseInt(match[1]);

  if (url.includes('2160') || url.includes('4k')) return 2160;
  if (url.includes('1440')) return 1440;
  if (url.includes('1080')) return 1080;
  if (url.includes('720')) return 720;
  if (url.includes('480')) return 480;
  if (url.includes('360')) return 360;

  return 0;
};

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

  async resolveStream(url, options = {}) {
  try {
    let current = url;

    for (let i = 0; i < 4; i++) {
      const res = await fetch(current, {
        method: "GET",
        redirect: "manual", // 🔥 important
        headers: {
          'User-Agent': 'Mozilla/5.0',
          'Referer': this.baseUrl,
          'Origin': this.baseUrl,
          ...(options.headers || {}) // ✅ allow custom headers
        }
      });

      const location = res.headers.get("location");

      if (!location) {
        return current;
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
      const res = await fetch(masterUrl, {
  headers: {
    Referer: this.baseUrl,
    Origin: this.baseUrl,
    'User-Agent': 'Mozilla/5.0'
  }
});
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
  const videoIdMatch = id.match(/\d+/);
  if (!videoIdMatch) return null;

  const videoId = videoIdMatch[0];
  const embedUrl = `${this.baseUrl}embed/${videoId}`;
  const embedHtml = await this.fetchHtml(embedUrl);

  logger.debug(`EMBED HTML LENGTH: ${embedHtml.length}`);

  // Video title & poster
  const titleMatch = embedHtml.match(/video_title:\s*'([^']+)'/);
  const previewMatch = embedHtml.match(/preview_url:\s*'([^']+)'/);

  const title = titleMatch ? titleMatch[1] : "Porntrex Video";

  let poster = previewMatch ? previewMatch[1] : null;
  if (poster && poster.startsWith("//")) poster = "https:" + poster;

  // 🔥 MP4 direct extraction
const fileMatches = embedHtml.match(/\/get_file\/[^']+\.mp4[^']*/g) || [];

// 🔥 fallback alt URLs
const altMatches = [
  ...embedHtml.matchAll(/video_alt_url\d*:\s*'([^']+)'/g)
].map(m => m[1]);

let rawUrls = [...fileMatches, ...altMatches].map(url => {
  if (url.startsWith("//")) return "https:" + url;
  if (!url.startsWith("http")) {
    return this.baseUrl.replace(/\/$/, '') + url;
  }
  return url;
});

  if (!rawUrls.length) {
    logger.error("Porntrex: no candidate streams found");
    return null;
  }

  // Resolve each URL respecting signed CDN headers
  const resolvedUrls = await Promise.all(
    rawUrls.map(url => this.resolveStream(url, {
      headers: {
        Referer: this.baseUrl,
        Origin: this.baseUrl,
        'User-Agent': 'Mozilla/5.0',
        Cookie: 'kt_tcookie=1; confirmed=true'
      }
    }).catch(() => null))
  );

  const validUrls = resolvedUrls.filter(Boolean);
  if (!validUrls.length) return null;

  // Prepare final streams
  let streams = await Promise.all(validUrls.map(async url => {
    if (url.includes('.m3u8')) {
      // HLS variant
      return await this.extractHlsStreams(url);
    }
    // MP4 variant
    const q = getQuality(url);

return [{
  url,
  name: q ? `${q}p` : "MP4",
  title: q ? `${q}p` : "Unknown",
  type: Provider.TYPE,
  behaviorHints: {
    notWebReady: true,
    headers: {
      Referer: this.baseUrl,
      Origin: this.baseUrl,
      'User-Agent': 'Mozilla/5.0',
      Cookie: 'kt_tcookie=1; confirmed=true'
    }
  }
}];
  }));

  streams = streams.flat();

  // Deduplicate by URL
  const seen = new Set();
  streams = streams.filter(s => {
    const u = s.url;
    if (seen.has(u)) return false;
    seen.add(u);
    return true;
  });

  // Sort: HLS first, then MP4 by descending quality
  streams.sort((a, b) => {
    const aIsHls = a.url.includes('.m3u8');
    const bIsHls = b.url.includes('.m3u8');
    if (aIsHls && !bIsHls) return -1;
    if (!aIsHls && bIsHls) return 1;
    return getQuality(b.url) - getQuality(a.url);
  });

  if (!streams.length) return null;

  return {
    metaResponse: new meta.MetaResponse(id, "movie", title, {
      description: title,
      background: poster
    }),
    streams
  };
}
}

module.exports = PorntrexProvider.create;