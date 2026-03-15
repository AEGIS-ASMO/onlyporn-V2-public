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

    $('div.video-item, div.thumb, div.item, div.video').each((index, element) => {
      const $e = $(element);
      const $a = $e.children('a');

      const videoPageUrlRaw = $a.attr('href');

let videoPageUrl = videoPageUrlRaw;

if (videoPageUrl && !videoPageUrl.startsWith('http')) {
  videoPageUrl = this.baseUrl.replace(/\/$/, '') + videoPageUrl;
}
      const $img = $a.children('img');

      const poster =
  $img.attr('data-src') ||
  $img.attr('data-original') ||
  $img.attr('data-lazy-src') ||
  $img.attr('src');

      const title = $img.attr('alt');

      if (!videoPageUrl || !title) return;

      metas.push(
        new meta.MetaPreview(
          videoPageUrl,
          'movie',
          title,
          poster?.startsWith('http') ? poster : 'https:' + poster
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

  const videoIdMatch = id.match(/video\/(\d+)/);

  if (!videoIdMatch) {
    logger.warn("Porntrex: invalid video id");
    return null;
  }

  const videoId = videoIdMatch[1];
  const embedUrl = `${this.baseUrl}embed/${videoId}`;

  const embedHtml = await this.fetchHtml(embedUrl);

  // Extract streams
  const streams = [...embedHtml.matchAll(/file\s*:\s*["']([^"']+)["']/g)];

  let videoPageUrl = null;

  if (streams.length) {
    const urls = streams.map(s => s[1]);

    // pick highest quality
    urls.sort((a,b)=>{
      const qa = parseInt(a.match(/(\d{3,4})p/)?.[1] || 0);
      const qb = parseInt(b.match(/(\d{3,4})p/)?.[1] || 0);
      return qb - qa;
    });

    videoPageUrl = urls[0];

    if (videoPageUrl.startsWith("//")) {
      videoPageUrl = "https:" + videoPageUrl;
    }

    videoPageUrl = this.cleanUrl(videoPageUrl);
  }

  const $ = load(html);

  const title =
    $('meta[property="og:title"]').attr("content") ||
    $("title").text().replace(/\s*-\s*Porntrex/i,"").trim() ||
    "Porntrex Video";

  const description =
    $('meta[name="description"]').attr("content") || title;

  const poster =
    $('meta[property="og:image"]').attr("content") || null;

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
    videoPageUrl
  };
}

module.exports = PorntrexProvider.create;