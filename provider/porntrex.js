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

  async parseVideoPage({ id, html }) {

  const videoIdMatch = id.match(/\d+/);

  if (!videoIdMatch) {
    logger.warn("Porntrex: invalid video id");
    return null;
  }

  const videoId = videoIdMatch[0];
  const embedUrl = `${this.baseUrl}embed/${videoId}`;

  const embedHtml = await this.fetchHtml(embedUrl);

  let playlistUrl = null;

const playlistMatch =
  embedHtml.match(/["']((?:https?:)?\/\/[^"' ]+\.m3u8[^"' ]*)["']/i);

if (playlistMatch) {
  let rawUrl = playlistMatch[1];

  // handle protocol-relative URLs
  if (rawUrl.startsWith("//")) {
    rawUrl = "https:" + rawUrl;
  }

  playlistUrl = this.cleanUrl(rawUrl);
  logger.info("Porntrex playlist found: " + playlistUrl);
} else {
  logger.warn("Porntrex: No playlist found in embed");
}

  const $ = load(html);

  const title =
    $('meta[property="og:title"]').attr("content") ||
    $("title").text().replace(/\s*-\s*Porntrex/i, "").trim() ||
    "Porntrex Video";

  const description =
    $('meta[name="description"]').attr("content") || title;

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
  videoPageUrl: playlistUrl
};
}

}

module.exports = PorntrexProvider.create;