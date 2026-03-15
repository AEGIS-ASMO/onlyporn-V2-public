const { load } = require('cheerio');
const Provider = require('./provider');
const { meta } = require('../model');

class PorntrexProvider extends Provider {

  constructor() {
    super('https://porntrex.com/', 'porntrex');
  }

  static create() {
    return new PorntrexProvider();
  }

  /* -------------------- CATALOG -------------------- */

  getCatalogMetas(html) {

    const $ = load(html);
    const metas = [];

    $('.video-item, .thumb').each((_, el) => {

      const a = $(el).find('a').first();
      const img = $(el).find('img').first();

      const href = a.attr('href');
      if (!href) return;

      const idMatch = href.match(/video\/(\d+)/);
      if (!idMatch) return;

      const id = idMatch[1];

      const title =
        img.attr('alt') ||
        a.attr('title') ||
        'Porntrex Video';

      const poster =
        img.attr('data-src') ||
        img.attr('src');

      metas.push(
        new meta.MetaPreview(
          `porntrex:${id}`,
          'movie',
          title,
          poster
        )
      );

    });

    return metas;
  }

  /* -------------------- META + STREAM SOURCE -------------------- */

  async parseVideoPage({ id }) {

    const videoId = id.split(':')[1];

    const pageUrl = `${this.baseUrl}video/${videoId}`;
    const embedUrl = `${this.baseUrl}embed/${videoId}`;

    const html = await this.fetchHtml(pageUrl);
    const embed = await this.fetchHtml(embedUrl);

    const $ = load(html);

    const title =
      $('meta[property="og:title"]').attr('content') ||
      'Porntrex Video';

    const poster =
      $('meta[property="og:image"]').attr('content');

    let videoPageUrl = null;

    /* -------- HLS playlist -------- */

    const m3u8 = embed.match(/https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*/);

    if (m3u8) {
      videoPageUrl = m3u8[0];
    }

    /* -------- fallback MP4 -------- */

    if (!videoPageUrl) {
      const mp4 = embed.match(/https?:\/\/[^\s"'<>]+\.mp4[^\s"'<>]*/);
      if (mp4) videoPageUrl = mp4[0];
    }

    return {
      metaResponse: new meta.MetaResponse(
        id,
        'movie',
        title,
        {
          background: poster,
          poster
        }
      ),
      videoPageUrl
    };

  }

}

module.exports = PorntrexProvider.create;