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

  async parseVideoPage({ id, html }) {

// Prevent re-parsing direct stream URLs
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

  const match = embedHtml.match(/video_url:\s*'([^']+)'/);

  if (!match) {
    logger.error("Porntrex: video_url not found");
    return null;
  }

  let videoUrl = match[1];

  if (videoUrl.startsWith("//")) {
    videoUrl = "https:" + videoUrl;
  }

  const $ = load(html);

  const title = titleMatch ? titleMatch[1] : "Porntrex Video";

let poster = previewMatch ? previewMatch[1] : null;

if (poster && poster.startsWith("//")) {
  poster = "https:" + poster;
}

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
  videoPageUrl: finalStream
};
}

}

module.exports = PorntrexProvider.create;