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
  return `page/${page}/`;
}

  getCatalogMetas(html) {
    const metas = [];
    const $ = load(html);

    $('div.video-item').each((index, element) => {
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

    if (this.metas[id]) {
      logger.debug({ id }, 'Porntrex cache hit');
      return this.metas[id];
    }

    // METHOD 1 : FLASHVARS

    let match =
      html.match(/flashvars\s*[:=]\s*(\{[\s\S]*?(video_alt_url|video_url)[\s\S]*?\})/i) ||
      html.match(/flashvars\s*[:=]\s*(\{[\s\S]*?\})\s*,\s*\w+/i);

    if (match) {
      try {

        const cleaned = this.fixLooseJson(
          match[1].replace(/;$/, '').trim()
        );

        const data = JSON.parse(cleaned);
        
        let videoPageUrl =
  data.video_url_hd ||
  data.video_alt_url ||
  data.video_alt_url2 ||
  data.video_url ||
  null;
  
if (videoPageUrl && videoPageUrl.startsWith('//')) {
  videoPageUrl = 'https:' + videoPageUrl;
}

        const {
          video_title,
          video_categories,
          preview_url
        } = data;

        const metaResponse = new meta.MetaResponse(
          id,
          'movie',
          video_title || 'Porntrex Video',
          {
            genres: video_categories ? video_categories.split(',') : [],
            background: preview_url
              ? (preview_url.startsWith('http') ? preview_url : 'https:' + preview_url)
              : null,
            description: video_title || 'Porntrex Video'
          }
        );

        const result = {
  metaResponse,
  videoPageUrl
};

        this.metas[id] = result;

        return result;

      } catch (e) {
        logger.error({ e }, 'Porntrex flashvars parse error');
      }
    }

    // METHOD 2 : AJAX PLAYER API

const idMatch = id.match(/video\/(\d+)/i);

if (!idMatch) {
  logger.warn('Porntrex: video id not found');
  return {
    metaResponse: new meta.MetaResponse(
      id,
      'movie',
      'Porntrex Video',
      { description: 'Porntrex Video' }
    )
  };
}

const videoId = idMatch[1];

const ajaxUrl = `${this.baseUrl}ajax/video-player/${videoId}`;

logger.debug({ ajaxUrl }, 'Porntrex loading ajax player');

let ajaxData = await this.fetchJson(ajaxUrl);

let videoPageUrl = null;

if (ajaxData) {

  videoPageUrl =
    ajaxData.video_url_hd ||
    ajaxData.video_url ||
    ajaxData.video_alt_url ||
    ajaxData.video_alt_url2 ||
    null;

  if (videoPageUrl && videoPageUrl.startsWith('//')) {
    videoPageUrl = 'https:' + videoPageUrl;
  }
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