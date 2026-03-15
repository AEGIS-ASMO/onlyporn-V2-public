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
  return `${page}/`;
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

let videoPageUrl = null;

const streamMatch = embedHtml.match(/https?:\/\/[^"'\\]+?\.(m3u8|mp4)[^"'\\]*/gi);

if (streamMatch && streamMatch.length) {

  const best = streamMatch.sort((a, b) => {
    const qa = parseInt(a.match(/(\d{3,4})p/)?.[1] || 0);
    const qb = parseInt(b.match(/(\d{3,4})p/)?.[1] || 0);
    return qb - qa;
  })[0];

  videoPageUrl = best;

  logger.info({ videoPageUrl }, 'Porntrex extracted stream');
}

logger.debug(embedHtml.substring(0, 1000), 'Porntrex embed HTML');

const source = embedHtml.match(/<source[^>]+src="([^"]+\.mp4[^"]*)"/i);

if (source) {
  const src = source[1];

  if (src.startsWith('http')) {
    videoPageUrl = src;
  } else if (src.startsWith('//')) {
    videoPageUrl = 'https:' + src;
  } else {
    videoPageUrl = 'https://porntrex.com' + src;
  }
}

const m3u8Match = embedHtml.match(/https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*/i);

if (!videoPageUrl && m3u8Match) {
  videoPageUrl = m3u8Match[0];
}

// Try to extract player JSON
const jsonMatch = embedHtml.match(/(\{[\s\S]*?(video_alt_url|video_url)[\s\S]*?\})/);

    if (!jsonMatch && videoPageUrl) {
  logger.debug('Porntrex using MP4 fallback');

  return {
    metaResponse: new meta.MetaResponse(
      id,
      'movie',
      'Porntrex Video',
      { description: 'Porntrex Video' }
    ),
    videoPageUrl
  };
}

if (!jsonMatch) {
  logger.warn('Porntrex JSON not found');

  return {
    metaResponse: new meta.MetaResponse(
      id,
      'movie',
      'Porntrex Video',
      { description: 'Porntrex Video' }
    ),
    videoPageUrl
  };
}
    let data;

    try {
      const cleaned = this.fixLooseJson(jsonMatch[0]);
      data = JSON.parse(cleaned);
    } catch (e) {
      logger.error({ e }, 'Porntrex embed JSON parse error');
      return {
        metaResponse: new meta.MetaResponse(
          id,
          'movie',
          'Porntrex Video',
          { description: 'Porntrex Video' }
        )
      };
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