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

  handleGenre(args) {
    return this.handleSearch({ ...args, extra: { search: args.extra.genre } });
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

  // kept (not used here anymore)
  async resolveStream(url) {
    try {
      const res = await fetch(url, {
        method: "HEAD",
        redirect: "manual"
      });

      const location = res.headers.get("location");

      if (location) {
        logger.debug("Resolved stream redirect:", location);
        return location;
      }

      return url;
    } catch (err) {
      logger.error("Porntrex redirect resolve failed:", err);
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

    if (id.includes("get_file")) {
      return { videoPageUrl: id };
    }

    const videoIdMatch = id.match(/\d+/);
    if (!videoIdMatch) return null;

    const videoId = videoIdMatch[0];

    const embedUrl = `${this.baseUrl}embed/${videoId}`;
    const embedHtml = await this.fetchHtml(embedUrl);

    const titleMatch = embedHtml.match(/video_title:\s*'([^']+)'/);
    const previewMatch = embedHtml.match(/preview_url:\s*'([^']+)'/);

    const title = titleMatch ? titleMatch[1] : "Porntrex Video";

    let poster = previewMatch ? previewMatch[1] : null;
    if (poster && poster.startsWith("//")) {
      poster = "https:" + poster;
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

let streams = [];

streamKeys.forEach(key => {
  const urlMatch = embedHtml.match(new RegExp(`${key}:\\s*'([^']+)'`));
  const labelMatch = embedHtml.match(new RegExp(`${key}_text:\\s*'([^']+)'`));

  if (urlMatch && urlMatch[1]) {
    let url = urlMatch[1];

    if (url.startsWith("//")) {
  url = "https:" + url;
} else if (!url.startsWith("http")) {
  url = this.baseUrl.replace(/\/$/, '') + url;
}

    streams.push({
      url,
      name: labelMatch ? labelMatch[1] : key,
      type: Provider.TYPE,
      headers: {
        Referer: this.baseUrl,
        Origin: this.baseUrl,
        'User-Agent': 'Mozilla/5.0',
      }
    });
  }
});

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