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

    $('div.video-holder').each((i, el) => {

      const $a = $(el).find('a').first();
      const href = $a.attr('href');

      if (!href) return;

      const videoPageUrl = href.startsWith('http')
        ? href
        : this.baseUrl.replace(/\/$/, '') + href;

      const $img = $a.find('img');

      const poster =
        $img.attr('data-src') ||
        $img.attr('data-original') ||
        $img.attr('src');

      const title =
        $img.attr('alt') ||
        $a.attr('title');

      if (!title) return;

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

    const videoIdMatch = id.match(/video\/(\d+)/i);

    if (!videoIdMatch) {
      logger.warn("Porntrex: invalid video id");
      return null;
    }

    const videoId = videoIdMatch[1];
    const embedUrl = `${this.baseUrl}embed/${videoId}`;

    const embedHtml = await this.fetchHtml(embedUrl);

    // FIX 4 — Debug embed preview
    logger.debug({
      embedPreview: embedHtml.substring(0, 400)
    }, "Porntrex embed preview");

    // Extract streams
    const streams = [
      ...embedHtml.matchAll(/file\s*:\s*["']([^"']+)["']/g),
      ...embedHtml.matchAll(/src\s*:\s*["']([^"']+)["']/g)
    ];

    if (!streams.length) {
      const fallback = embedHtml.match(/https?:\/\/[^\s"'<>]+\.mp4[^\s"'<>]*/i);
      if (fallback) {
        streams.push([null, fallback[0]]);
      }
    }

    let videoPageUrl = null;

    if (streams.length) {
      const urls = streams.map(s => s[1]);

      urls.sort((a, b) => {
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
      videoPageUrl
    };
  }

}

module.exports = PorntrexProvider.create;