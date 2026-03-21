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

  handleGenre({ extra: { genre } }) {
    const slug = genre
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9\-]/g, '');
    return `${this.baseUrl}categories/${slug}/`;
  }

  handlePagination(url, { extra: { skip } }) {
    const page = this.page(skip);
    const from = (page - 1) * 24;

    if (url.includes('/search/')) {
      const keywordMatch = url.match(/search\/([^\/]+)/);
      const keyword = keywordMatch ? keywordMatch[1] : '';
      return `${this.baseUrl}search/${keyword}/?mode=async&function=get_block&block_id=list_videos_common_videos_list&from=${from}`;
    }

    if (url.includes('/categories/')) {
      return `${url}?mode=async&function=get_block&block_id=list_videos_common_videos_list_category&from=${from}`;
    }

    // default sorted catalog
    const segment = url.match(/porntrex\.com\/([^\/]+)/)?.[1] || '';
    const sortMap = {
      'latest-updates': 'post_date',
      'most-popular': 'video_viewed',
      'top-rated': 'rating',
      'longest': 'duration',
      'most-commented': 'most_commented',
      'most-favourited': 'most_favourited'
    };
    const sort = sortMap[segment] || 'post_date';

    return `${this.baseUrl}?mode=async&function=get_block&block_id=list_videos_common_videos_list&sort_by=${sort}&from=${from}`;
  }

  getCatalogMetas(html) {
    const metas = [];
    const $ = load(html);

    $('div.video-item').each((i, el) => {
      const $a = $(el).find('a').first();
      const href = $a.attr('href');
      if (!href || !href.includes('/video/')) return;

      const videoPageUrl = href.startsWith('http') ? href : this.baseUrl.replace(/\/$/, '') + href;
      const $img = $a.find('img');

      let poster = $img.attr('data-src') || $img.attr('data-original') || $img.attr('src');
      if (poster && poster.startsWith('//')) poster = 'https:' + poster;

      const title = $img.attr('alt') || $a.attr('title');
      if (!title) {
        logger.warn(`Porntrex: video without title found at ${videoPageUrl}`);
        return;
      }

      metas.push(new meta.MetaPreview(videoPageUrl, 'movie', title, poster));
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
        redirect: "manual",
        headers: {
          'User-Agent': 'Mozilla/5.0',
          'Referer': this.baseUrl,
          'Origin': this.baseUrl
        }
      });

      const location = res.headers.get("location");
      if (location) {
        logger.debug(`REDIRECT RESOLVED: ${location}`);
        return location;
      }

      return url;
    } catch (err) {
      logger.warn("Porntrex: failed to resolve stream, using original URL", err);
      return url;
    }
  }

  async parseVideoPage({ id }) {
    const videoIdMatch = id.match(/\d+/);
    if (!videoIdMatch) {
      logger.warn(`Porntrex: invalid video id "${id}"`);
      return null;
    }

    const videoId = videoIdMatch[0];
    const embedUrl = `${this.baseUrl}embed/${videoId}`;
    const embedHtml = await this.fetchHtml(embedUrl);

    logger.debug(`EMBED HTML LENGTH: ${embedHtml.length}`);

    const titleMatch = embedHtml.match(/video_title:\s*'([^']+)'/);
    const previewMatch = embedHtml.match(/preview_url:\s*'([^']+)'/);
    const videoMatch = embedHtml.match(/video_url:\s*'([^']+)'/);

    if (!videoMatch) {
      logger.warn(`Porntrex: video_url not found for ${videoId}`);
      return null;
    }

    let videoUrl = videoMatch[1];
    if (videoUrl.startsWith("//")) videoUrl = "https:" + videoUrl;

    let poster = previewMatch ? previewMatch[1] : null;
    if (poster && poster.startsWith("//")) poster = "https:" + poster;

    const finalStream = await this.resolveStream(videoUrl);

    return {
      metaResponse: new meta.MetaResponse(
        id,
        "movie",
        titleMatch ? titleMatch[1] : "Porntrex Video",
        { description: titleMatch ? titleMatch[1] : "Porntrex Video", background: poster }
      ),
      videoPageUrl: finalStream,
      behaviorHints: {
        notWebReady: true,
        headers: {
          Referer: this.baseUrl,
          Origin: this.baseUrl,
          'User-Agent': 'Mozilla/5.0'
        }
      }
    };
  }
}

module.exports = PorntrexProvider.create;