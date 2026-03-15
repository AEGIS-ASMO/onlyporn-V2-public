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

    $('div.video-item, div.thumb, div.item, div.video').each((index, element) => {
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
  $img.attr('data-lazy-src') ||
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

// METHOD : PLAYER CONFIG

if (!videoPageUrl) {

  const playerMatch = embedHtml.match(/sources\s*:\s*(\[[\s\S]*?\])/i);

  if (playerMatch) {
    try {

      const sources = JSON.parse(
        playerMatch[1]
          .replace(/file:/g,'"file":')
          .replace(/label:/g,'"label":')
          .replace(/'/g,'"')
      );

      if (Array.isArray(sources)) {

        const best = sources.sort((a,b)=>{
          const qa = parseInt(a.label) || 0;
          const qb = parseInt(b.label) || 0;
          return qb-qa;
        })[0];

        if (best?.file) {

          videoPageUrl = best.file.startsWith('//')
            ? 'https:' + best.file
            : best.file;

          videoPageUrl = this.cleanUrl(videoPageUrl);

          logger.info({ videoPageUrl }, 'Porntrex player config stream');
        }

      }

    } catch(e){
      logger.error(e,'player config parse error');
    }
  }
}

// METHOD 4 : DIRECT STREAM REGEX
if (!videoPageUrl) {

  const streamMatch = embedHtml.match(/https?:\/\/[^\s"'<>]+\.(m3u8|mp4)[^\s"'<>]*/gi);

  if (streamMatch && streamMatch.length) {

    const best = streamMatch.sort((a, b) => {
      const qa = parseInt(a.match(/(\d{3,4})p/)?.[1] || 0);
      const qb = parseInt(b.match(/(\d{3,4})p/)?.[1] || 0);
      return qb - qa;
    })[0];

    videoPageUrl = best;
videoPageUrl = this.cleanUrl(videoPageUrl);

    if (videoPageUrl.startsWith('//')) {
      videoPageUrl = 'https:' + videoPageUrl;
    }

    logger.info({ videoPageUrl }, 'Porntrex extracted stream');
  }
}

// METHOD 5 : SOURCE TAG
let source = null;

if (!videoPageUrl) {

  source = embedHtml.match(/<source[^>]+src=["']([^"']+\.mp4[^"']*)["']/i);

  if (source) {

    let src = source[1];

    if (src.startsWith('//')) {
      src = 'https:' + src;
    } else if (!src.startsWith('http')) {
      src = this.baseUrl.replace(/\/$/, '') + src;
    }

    videoPageUrl = this.cleanUrl(src);

    logger.info({ videoPageUrl }, 'Porntrex source tag stream');
  }
}

// METHOD 6 : M3U8 STREAM
if (!videoPageUrl) {

  const m3u8Match = embedHtml.match(/https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*/i);

  if (m3u8Match) {

    videoPageUrl = this.cleanUrl(m3u8Match[0]);

    if (videoPageUrl.startsWith('//')) {
      videoPageUrl = 'https:' + videoPageUrl;
    }
  }
}

if (!videoPageUrl && source) {
  let src = source[1];

  if (src.startsWith('//')) {
    src = 'https:' + src;
  } else if (!src.startsWith('http')) {
    src = this.baseUrl.replace(/\/$/, '') + src;
  }

  videoPageUrl = this.cleanUrl(src);
}

// Try to extract player JSON
let jsonMatch = null;

if (!videoPageUrl) {
  jsonMatch = embedHtml.match(/(\{[\s\S]*?(video_alt_url|video_url)[\s\S]*?\})/);
}

    if (videoPageUrl) {

  logger.info({ videoPageUrl }, 'Porntrex final stream');
  logger.debug('Porntrex using stream fallback');

  const $ = load(html);

  const title =
    $('meta[property="og:title"]').attr('content') ||
    $('title').text().replace(/\s*-\s*Porntrex/i, '').trim() ||
    'Porntrex Video';

  const description =
    $('meta[name="description"]').attr('content') || title;

  const poster =
    $('meta[property="og:image"]').attr('content') || null;

  return {
  metaResponse: new meta.MetaResponse(
    id,
    'movie',
    title,
    { description, background: poster }
  ),
  videoPageUrl
};
}
    let data = null;

if (jsonMatch) {
  try {
    const cleaned = this.fixLooseJson(jsonMatch[0]);
    data = JSON.parse(cleaned);

    videoPageUrl =
      data.video_url_hd ||
      data.video_alt_url ||
      data.video_url ||
      videoPageUrl;

  } catch (e) {
    logger.error({ e }, 'Porntrex embed JSON parse error');
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
    background: poster
  }
);

if (videoPageUrl) {
  videoPageUrl = this.cleanUrl(videoPageUrl);
}

    const result = {
  metaResponse,
  videoPageUrl
};

    this.metas[id] = result;
if (!videoPageUrl) {
  logger.warn('Porntrex: no stream extracted');
}

    return result;
  }
}

module.exports = PorntrexProvider.create;