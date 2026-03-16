const { load } = require('cheerio');
const logger = require('../logger');
const { meta } = require('../model');
const Provider = require('./provider');

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

    let jsonString = looseJsonString
      .trim()
      .replace(/^"(.*)"$/, '$1');

    jsonString = jsonString.replace(/'/g, '"');
    jsonString = jsonString.replace(/([a-zA-Z0-9_]+)\s*:/g, '"$1":');
    jsonString = jsonString.replace(/:\s*'([^']*)'/g, ': "$1"');

    return jsonString;
  }

  async parseVideoPage({ id, html }) {

    const videoIdMatch = id.match(/video\/(\d+)/i);

    if (!videoIdMatch) {
      logger.warn("Porntrex: invalid video id");
      return null;
    }

    const videoId = videoIdMatch[1];
    const embedUrl = `${this.baseUrl}embed/${videoId}`;

    const embedHtml = await this.fetchHtml(embedUrl);

    // Extract playlist URL
const playlistMatch =
  embedHtml.match(/"(https?:\\\/\\\/[^"]+\.m3u8[^"]*)"/i) ||
  embedHtml.match(/file\s*:\s*"(https?:\\\/\\\/[^"]+\.m3u8[^"]*)"/i);

// Debug
logger.debug({
  embedPreview: embedHtml.substring(0, 400),
  foundM3U8: playlistMatch?.[0]
}, "Porntrex embed preview");

let streams = [];

let playlistUrl = null;

if (playlistMatch) {

  playlistUrl = playlistMatch[1] || playlistMatch[0];

  playlistUrl = playlistUrl
    .replace(/\\\//g, "/")
    .replace(/"/g, "")
    .trim();

playlistUrl = this.cleanUrl(playlistUrl);

logger.debug("Porntrex playlist URL: " + playlistUrl);

  try {

    const playlist = await this.fetchHtml(playlistUrl);

    const lines = playlist.split("\n");

let foundVariants = false;

for (let i = 0; i < lines.length; i++) {

  if (lines[i].includes("#EXT-X-STREAM-INF")) {

    foundVariants = true;

    const resolutionMatch = lines[i].match(/RESOLUTION=\d+x(\d+)/);

    const quality = resolutionMatch
      ? resolutionMatch[1] + "p"
      : "HD";

    const streamPath = lines[i + 1]?.trim();

    if (!streamPath) continue;

    let streamUrl;

    if (streamPath.startsWith("http")) {
      streamUrl = streamPath;
    } else {
      const base = playlistUrl.substring(0, playlistUrl.lastIndexOf("/") + 1);
      streamUrl = base + streamPath;
    }

    streams.push({
      name: "Porntrex",
      title: quality,
      url: streamUrl,
      behaviorHints: { notWebReady: true }
    });

  }

}

// if playlist had no variants, use the playlist itself
if (!foundVariants) {
  streams.push({
    name: "Porntrex",
    title: "Auto",
    url: playlistUrl,
    behaviorHints: { notWebReady: true }
  });
}

} catch (e) {
    logger.warn("Porntrex playlist parse failed", e);
  }
}

streams.sort((a, b) => {
  const qa = parseInt(a.title.replace("p","")) || 0;
  const qb = parseInt(b.title.replace("p","")) || 0;
  return qb - qa;
});

// fallback MP4 detection
if (!streams.length) {

  const fallback = embedHtml.match(/https?:\/\/[^\s"'<>]+\.mp4[^\s"'<>]*/i);

  if (fallback) {
    streams.push({
      name: "Porntrex",
      title: "HD",
      url: this.cleanUrl(fallback[0])
    });
  }

}
    const $ = load(html);

    const title =
      $('meta[property="og:title"]').attr("content") ||
      $("title").text().replace(/\s*-\s*Porntrex/i, "").trim() ||
      "Porntrex Video";

    const description =
      $('meta[name="description"]').attr("content") || title;

    // FIX 3 — Poster normalization
    let poster = $('meta[property="og:image"]').attr("content") || null;

    if (poster && poster.startsWith("//")) {
      poster = "https:" + poster;
    }

    return {
  metaResponse: new meta.MetaResponse(
    id,
    "movie",
    title,
    {
      description,
      background: poster
    }
  ),
  videoPageUrl: playlistUrl || null
};
  }

}

module.exports = PorntrexProvider.create;