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
          poster?.startsWith('http') ? poster : 'https:' + poster
        )
      );
    });

    return metas;
  }

  async getStreams(meta) {

    if (!meta) return { streams: [] };
    if (!meta.metaResponse && !meta.id) {
      logger.warn('Porntrex invalid meta object');
      return { streams: [] };
    }

    const id = meta.metaResponse?.id || meta.id;

    const data = this.dataset[id];

    if (!data) {
      logger.warn({ id }, 'Porntrex streams dataset missing');
      return { streams: [] };
    }

    const qualities = Object.keys(data)
      .filter(k =>
        (k.startsWith('video_alt_url') || k.startsWith('video_url')) &&
        !k.endsWith('_text')
      )
      .sort()
      .reverse();

    const streams = qualities
      .filter(key => data[key])
      .map(key => ({
        url: data[key].startsWith('http')
          ? data[key]
          : 'https:' + data[key],
        name: data[key + '_text'] || key,
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

    if (this.dataset[id]) {
      logger.debug({ id }, 'Porntrex dataset cache hit');
      return this.metas[id];
    }

    // METHOD 1 : FLASHVARS

    let match =
      html.match(/flashvars\s*[:=]\s*(\{[\s\S]*?video_alt_url[\s\S]*?\})/i) ||
      html.match(/flashvars\s*[:=]\s*(\{[\s\S]*?\})\s*,\s*\w+/i);

    if (match) {
      try {

        const cleaned = this.fixLooseJson(
          match[1].replace(/;$/, '').trim()
        );

        const data = JSON.parse(cleaned);

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

        // ✅ FIX: extract video stream
        const videoPageUrl =
          data.video_alt_url1 ||
          data.video_url ||
          null;

        this.dataset[id] = data;

        const result = { metaResponse, videoPageUrl }; // ✅ FIX

        this.metas[id] = result;

        return result;

      } catch (e) {
        logger.error({ e }, 'Porntrex flashvars parse error');
      }
    }

    // METHOD 2 : EMBED PLAYER

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

    const embedUrl = `${this.baseUrl}embed/${videoId}`;

    logger.debug({ embedUrl }, 'Porntrex loading embed');

    const embedHtml = await this.fetchHtml(embedUrl);

    logger.debug(embedHtml.substring(0, 1000), 'Porntrex embed HTML');

    // ✅ FIX: extract mp4 source
    const sourceMatch = embedHtml.match(/<source[^>]+src="([^"]+\.mp4[^"]*)"/i);

    let videoPageUrl = null;

    if (sourceMatch) {
      videoPageUrl = sourceMatch[1].startsWith('http')
        ? sourceMatch[1]
        : 'https:' + sourceMatch[1];
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

    const result = { metaResponse, videoPageUrl }; // ✅ FIX

    this.metas[id] = result;

    return result;
  }
}

module.exports = PorntrexProvider.create;