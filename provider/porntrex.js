const { load } = require('cheerio');
const logger = require('../logger');
const { meta } = require('../model');
const Provider = require('./provider');

class PorntrexProvider extends Provider {

  constructor() {
    super('https://porntrex.com/', 'porntrex');
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

  // ✅ FIXED PAGINATION
  handlePagination(url, { extra: { skip } }) {
    const page = this.page(skip);
    return `${url.replace(/\/$/, '')}/page/${page}/`;
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

  async parseVideoPage({ id }) {

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
    const patterns = [
      /video_alt_url:\s*'([^']+)'/,
      /video_alt_url2:\s*'([^']+)'/,
      /video_alt_url3:\s*'([^']+)'/,
      /video_alt_url4:\s*'([^']+)'/,
      /video_alt_url5:\s*'([^']+)'/,
    ];

    const qualityMap = ['240p', '360p', '480p', '720p', '1080p'];

    let streams = [];

    patterns.forEach((regex, index) => {
      const match = embedHtml.match(regex);

      if (match && match[1]) {
        let url = match[1];

        if (url.startsWith("//")) {
          url = "https:" + url;
        }

        streams.push({
          url,
          name: qualityMap[index],
          type: Provider.TYPE,
          headers: {
            Referer: this.baseUrl,
            Origin: this.baseUrl,
            'User-Agent': 'Mozilla/5.0',
          }
        });
      }
    });

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
       🎯 SORT BEST → WORST
    ========================= */
    streams.reverse();

    if (!streams.length) {
      logger.error("Porntrex: no valid streams found");
      return null;
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