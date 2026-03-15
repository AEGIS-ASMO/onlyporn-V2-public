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

  handleSearch({ extra: { search } }) {
    return `${this.baseUrl}search/${encodeURIComponent(search)}/`;
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

    $('div.video-item').each((i, el) => {

      const $el = $(el);
      const a = $el.find('a').first();

      let url = a.attr('href');
      if (url && !url.startsWith('http')) {
        url = this.baseUrl.replace(/\/$/, '') + url;
      }

      const img = a.find('img');

      const poster =
        img.attr('data-src') ||
        img.attr('data-original') ||
        img.attr('src');

      const title = img.attr('alt');

      if (!url || !title) return;

      metas.push(
        new meta.MetaPreview(
          url,
          'movie',
          title,
          poster && poster.startsWith('//') ? 'https:' + poster : poster
        )
      );
    });

    return metas;
  }

  async parseVideoPage({ id, html }) {

    if (this.metas[id]) {
      return this.metas[id];
    }

    const $ = load(html);

    const title =
      $('meta[property="og:title"]').attr('content') ||
      $('title').text().replace(/\s*-\s*Porntrex/i, '').trim();

    const description =
      $('meta[name="description"]').attr('content') || title;

    const poster =
      $('meta[property="og:image"]').attr('content');

    // ---- EXTRACT FLASHVARS ----

    const flashvarsMatch =
      html.match(/var\s+flashvars\s*=\s*(\{[\s\S]*?\});/i) ||
      html.match(/flashvars\s*[:=]\s*(\{[\s\S]*?\})/i);

    let videoPageUrl = null;

    if (flashvarsMatch) {

      try {

        let json = flashvarsMatch[1]
          .replace(/(\w+):/g, '"$1":')
          .replace(/'/g, '"');

        const data = JSON.parse(json);

        videoPageUrl =
          data.video_url_hd ||
          data.video_alt_url ||
          data.video_alt_url2 ||
          data.video_url ||
          null;

        if (videoPageUrl && videoPageUrl.startsWith('//')) {
          videoPageUrl = 'https:' + videoPageUrl;
        }

      } catch (e) {
        logger.error({ e }, 'Porntrex flashvars parse error');
      }
    }

    // ---- FALLBACK: STREAM REGEX ----

    if (!videoPageUrl) {

      const match = html.match(/https?:\/\/[^"'<>]+?\.(m3u8|mp4)/i);

      if (match) {
        videoPageUrl = match[0];
      }
    }

    const metaResponse = new meta.MetaResponse(
      id,
      'movie',
      title,
      {
        description,
        poster
      }
    );

    const result = {
      metaResponse,
      videoPageUrl
    };

    this.metas[id] = result;

    return result;
  }
}

module.exports = PorntrexProvider.create;