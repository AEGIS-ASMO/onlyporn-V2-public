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

    return streams;
  }

  return [];
}

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

 async parseVideoPage({ id, html }) {

  // ---- METHOD 1 : OLD FLASHVARS ----
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
        preview_url,
        video_alt_url5,
        video_alt_url4,
        video_alt_url3,
        video_alt_url2,
        video_alt_url,
        video_alt_url5_text,
        video_alt_url4_text,
        video_alt_url3_text,
        video_alt_url2_text,
        video_alt_url_text
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
          description: video_title
        }
      );

      return {
        metaResponse,
        video_alt_url5,
        video_alt_url4,
        video_alt_url3,
        video_alt_url2,
        video_alt_url,
        video_alt_url5_text,
        video_alt_url4_text,
        video_alt_url3_text,
        video_alt_url2_text,
        video_alt_url_text
      };

    } catch (e) {
      logger.error({ e }, 'Porntrex flashvars parse error');
    }
  }

  // ---- METHOD 2 : EMBED PLAYER ----

const idMatch = id.match(/video\/(\d+)/);

if (!idMatch) {
  logger.warn('Porntrex: video id not found');
  return {};
}

const videoId = idMatch[1];

const embedUrl = `https://www.porntrex.com/embed/${videoId}`;

logger.debug({ embedUrl }, 'Porntrex loading embed');

const embedHtml = await this.fetchHtml(embedUrl);

const jsonMatch =
  embedHtml.match(/flashvars\s*[:=]\s*(\{[\s\S]*?\})/i);

if (!jsonMatch) {
  logger.warn('Porntrex: player json not found');
  return {};
}

let data;

try {
  const cleaned = this.fixLooseJson(jsonMatch[1]);
  data = JSON.parse(cleaned);
} catch (e) {
  logger.error({ e }, 'Porntrex embed JSON parse error');
  return {};
}

const {
  video_alt_url5,
  video_alt_url4,
  video_alt_url3,
  video_alt_url2,
  video_alt_url,
  video_alt_url5_text,
  video_alt_url4_text,
  video_alt_url3_text,
  video_alt_url2_text,
  video_alt_url_text
} = data;

const title =
  html.match(/<title>(.*?)<\/title>/i)?.[1]?.replace(' - Porntrex', '') ||
  'Porntrex Video';

const metaResponse = new meta.MetaResponse(
  id,
  'movie',
  title,
  {
    description: title,
    poster: html.match(/poster="([^"]+)"/)?.[1]
  }
);

return {
  metaResponse,
  video_alt_url5,
  video_alt_url4,
  video_alt_url3,
  video_alt_url2,
  video_alt_url,
  video_alt_url5_text,
  video_alt_url4_text,
  video_alt_url3_text,
  video_alt_url2_text,
  video_alt_url_text
};
}

}

module.exports = PorntrexProvider.create;