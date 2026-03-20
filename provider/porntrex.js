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

  handleSearch({ extra: { search: keyword } }) {
    return `${this.baseUrl}search/${encodeURIComponent(keyword)}/`;
  }

  handleGenre(args) {
    return this.handleSearch({ ...args, extra: { search: args.extra.genre } });
  }

  handlePagination(url, { extra: { skip } }) {
    const page = this.page(skip);
    return `${url}page/${page}/`;
  }

  getCatalogMetas(html) {
  const metas = [];
  const $ = load(html);

  $('div.video-holder, div.video-item, div.thumb, div.item, div.video').each((i, el) => {

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
      $img.attr('data-lazy-src') ||
      $img.attr('src');

    if (poster && poster.startsWith('//')) {
      poster = 'https:' + poster;
    }

    const title =
      $img.attr('alt') ||
      $a.attr('title') ||
      $a.text().trim();

    if (!title) return;

    metas.push(
      new meta.MetaPreview(
        videoPageUrl,
        'movie',
        title,
        poster
      )
    );

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

          // handle relative URLs
          if (!streamUrl.startsWith('http')) {
            const base = masterUrl.substring(0, masterUrl.lastIndexOf('/') + 1);
            streamUrl = base + streamUrl;
          }

          streams.push({
            url: streamUrl,
            name: `${height}p`,
            type: Provider.TYPE,
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
     🔥 COLLECT ALL STREAM URLS
  ========================= */
  const urls = [];

  const patterns = [
    /video_url:\s*'([^']+)'/,
    /video_alt_url:\s*'([^']+)'/,
    /video_alt_url2:\s*'([^']+)'/,
    /video_alt_url3:\s*'([^']+)'/,
    /video_alt_url4:\s*'([^']+)'/,
    /video_alt_url5:\s*'([^']+)'/,
  ];

  for (const regex of patterns) {
    const match = embedHtml.match(regex);
    if (match && match[1]) {
      let url = match[1];

      if (url.startsWith("//")) {
        url = "https:" + url;
      }

      urls.push(url);
    }
  }

  if (!urls.length) {
    logger.error("Porntrex: no video URLs found");
    return null;
  }

  /* =========================
   ⚡ RESOLVE IN PARALLEL
========================= */
const resolvedUrls = await Promise.all(
  urls.map(url => this.resolveStream(url))
);

/* =========================
   ⚡ BUILD STREAMS
========================= */
let streams = [];

for (const resolved of resolvedUrls) {

  if (!resolved) continue;

  if (resolved.includes('.m3u8')) {
    const hlsStreams = await this.extractHlsStreams(resolved);
    streams.push(...hlsStreams);
  } else {
    streams.push({
      url: resolved,
      name: 'mp4',
      type: Provider.TYPE,
    });
  }
}

/* =========================
   🧹 REMOVE DUPLICATES
========================= */
const seen = new Set();

streams = streams.filter(s => {
  if (seen.has(s.url)) return false;
  seen.add(s.url);
  return true;
});

/* =========================
   🎯 SORT BY QUALITY
========================= */
streams.sort((a, b) => {
  const getQ = s => parseInt(s.name) || 0;
  return getQ(b) - getQ(a);
});

  /* fallback */
  if (!streams.length) {
    streams = urls.map(url => ({
      url,
      name: 'auto',
      type: Provider.TYPE,
    }));
  }

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