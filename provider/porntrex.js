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
    if (segment) {
      return `${this.baseUrl}${segment}/`;
    }
    return this.baseUrl;
  }

  getSegment(catalogId) {
    return catalogId.substring(this.getName().length + 1);
  }

  handleSearch({ id, extra: { search: keyword } }) {
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
          'movie',
          title,
          poster?.startsWith('http') ? poster : 'https:' + poster,
        ),
      );
    });

    return metas;
  }

  async getMetadata(args) {
    return super.getMetadata(args)
      .then(meta => meta.metaResponse);
  }

  async getStreams(meta) {
    if (meta) {

      const qualities = [
        'video_alt_url5',
        'video_alt_url4',
        'video_alt_url3',
        'video_alt_url2',
        'video_alt_url',
      ];

      const streams = qualities
        .filter(key => meta.hasOwnProperty(key) && meta[key])
        .map(key => ({
  url: meta[key].startsWith('http')
    ? meta[key]
    : 'https:' + meta[key],
  name: meta[key + '_text'],
  type: Provider.TYPE,
  behaviorHints: {
    notWebReady: true,
    headers: {
      referer: 'https://porntrex.com/'
    }
  }
}));

      logger.debug({ streams }, 'streams %d', streams.length);

      return { streams };
    }

    return Promise.resolve({ streams: [] });
  }

  fixLooseJson(looseJsonString) {

    let jsonString = looseJsonString
      .trim()
      .replace(/^"(.*)"$/, '$1');

    jsonString = jsonString.replace(/'/g, '"');

    jsonString = jsonString.replace(/(\w+)\s*:/g, '"$1":');

    jsonString = jsonString.replace(/:\s*'([^']*)'/g, ': "$1"');

    return jsonString;
  }

  parseVideoPage({ id, html }) {

  const match = html.match(/flashvars\s*:\s*(\{[\s\S]*?\})\s*\}/i);

  if (!match) {
    logger.warn('Porntrex: flashvars not found');
    return {};
  }

  try {

    const cleaned = this.fixLooseJson(match[1]);

    const data = JSON.parse(cleaned);

    const metaResponse = new meta.MetaResponse(
      id,
      'movie',
      data.video_title || 'Porntrex Video',
      {
        genres: data.video_categories
          ? data.video_categories.split(',')
          : [],
        background: data.preview_url?.startsWith('http')
          ? data.preview_url
          : 'https:' + data.preview_url,
        description: data.video_title
      }
    );

    return {
      metaResponse,
      video_alt_url5: data.video_alt_url5 || data.video_url,
      video_alt_url4: data.video_alt_url4,
      video_alt_url3: data.video_alt_url3,
      video_alt_url2: data.video_alt_url2,
      video_alt_url: data.video_alt_url,
      video_alt_url5_text: data.video_alt_url5_text || data.video_url_text,
      video_alt_url4_text: data.video_alt_url4_text,
      video_alt_url3_text: data.video_alt_url3_text,
      video_alt_url2_text: data.video_alt_url2_text,
      video_alt_url_text: data.video_alt_url_text
    };

  } catch (e) {
    logger.error({ e }, 'Porntrex parse error');
    return {};
  }
}

}

module.exports = PorntrexProvider.create;