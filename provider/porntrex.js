const { load } = require('cheerio');
const logger = require('../logger');
const { meta } = require('../model');
const Provider = require('./provider');

class PorntrexProvider extends Provider {

  constructor() {
    super('https://porntrex.com/', 'porntrex');
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
    return `${url.replace(/\/$/, '')}/${page}/`;
  }

  getCatalogMetas(html) {

    const metas = [];
    const $ = load(html);

    $('div.video-item').each((index, element) => {

      const $e = $(element);
      const $a = $e.children('a');

      const videoPageUrl = $a.attr('href');

      const $img = $a.children('img');

      const poster =
        $img.attr('data-src') ||
        $img.attr('data-original') ||
        $img.attr('src');

      const title = $img.attr('alt');

      if (!videoPageUrl || !title) return;

      metas.push(
        new meta.MetaPreview(
          videoPageUrl,
          Provider.TYPE,
          title,
          poster?.startsWith('http') ? poster : 'https:' + poster
        )
      );

    });

    return metas;
  }

  async parseVideoPage({ id, html }) {

    if (this.metas[id]) {
      logger.debug({ id }, 'Porntrex cache hit');
      return this.metas[id];
    }

    const $ = load(html);

    const title =
      $('meta[property="og:title"]').attr('content') ||
      $('title').text().replace(/\s*-\s*Porntrex/i, '').trim() ||
      'Porntrex Video';

    const description =
      $('meta[name="description"]').attr('content') || title;

    const poster =
      $('meta[property="og:image"]').attr('content') || null;

    const metaResponse = new meta.MetaResponse(
      id,
      Provider.TYPE,
      title,
      {
        description,
        poster
      }
    );

    // METHOD 1 — direct mp4 in page
    let videoPageUrl = null;

    const mp4Match = html.match(/<source[^>]+src="([^"]+\.mp4[^"]*)"/i);

    if (mp4Match) {
      videoPageUrl = mp4Match[1].startsWith('http')
        ? mp4Match[1]
        : 'https:' + mp4Match[1];
    }

    // METHOD 2 — embed player
    if (!videoPageUrl) {

      const idMatch = id.match(/video\/(\d+)/i);

      if (idMatch) {

        const embedUrl = `${this.baseUrl}embed/${idMatch[1]}`;

        logger.debug({ embedUrl }, 'Porntrex loading embed');

        const embedHtml = await this.fetchHtml(embedUrl);

        const embedMatch =
          embedHtml.match(/<source[^>]+src="([^"]+\.mp4[^"]*)"/i) ||
          embedHtml.match(/(https:[^"]+\.m3u8[^"]*)/i);

        if (embedMatch) {
          videoPageUrl = embedMatch[1];
        }

      }

    }

    const result = { metaResponse, videoPageUrl };

    this.metas[id] = result;

    return result;
  }
}

module.exports = PorntrexProvider.create;