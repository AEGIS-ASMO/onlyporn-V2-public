const { load } = require('cheerio');
const logger = require('../logger');
const { meta } = require('../model');
const Provider = require('./provider');

const pathMappings = {
  'Uncensored leak': '/dm628/en/uncensored-leak',
  'Most viewed today': '/dm291/en/today-hot',
  'Weekly hot': '/dm169/en/weekly-hot',
  'Monthly hot': '/dm263/en/monthly-hot',
  'New releases': '/dm590/en/release',
};

class MissavProvider extends Provider {

  constructor() {
    super('https://missav.ws', 'missav', 10);
  }

  static create() {
    return new MissavProvider();
  }

  getInitialUrl() {
    return `${this.baseUrl}/dm428/en/new?sort=published_at`;
  }

  handleSearch({ extra: { search: keyword } }) {
    return `${this.baseUrl}/search/${keyword}/`;
  }

  handleGenre({ extra: { genre } }) {
    return this.baseUrl + pathMappings[genre];
  }

  handlePagination(url, { extra: { skip } }) {
    const prefix = url.includes('?') ? '&' : '?';
    return `${url}${prefix}page=${this.page(skip)}`;
  }

  getCatalogMetas(html) {
    const $ = load(html);
    const metadatas = [];

    $('div.thumbnail.group').each((_, el) => {
      const poster = $(el).find('img').attr('data-src');
      const title = $(el).find('a').last().text().trim();
      const href = $(el).find('a').attr('href');

      if (href) {
        metadatas.push(new meta.MetaPreview(
          href,
          'movie',
          title,
          poster
        ));
      }
    });

    return metadatas;
  }

  async getMetadata(args) {
    return super.getMetadata(args).then(m => m.metaResponse);
  }

  /**
   * 🔥 Extract packed JS and unpack it
   */
  unpackEval(packed) {
    try {
      // Basic Dean Edwards unpacker
      const evalMatch = packed.match(/eval\(function\(p,a,c,k,e,d\).*?\)\)/s);
      if (!evalMatch) return null;

      const fn = new Function(`return ${evalMatch[0]}`); // safe enough here
      return fn();
    } catch (e) {
      logger.error('Unpack failed:', e);
      return null;
    }
  }

  /**
   * 🔥 Extract m3u8 from unpacked or raw HTML
   */
  extractM3U8(html) {
    // direct match first (sometimes present)
    let match = html.match(/https?:\/\/[^"' ]+\.m3u8[^"' ]*/);
    if (match) return match[0];

    // try unpacking eval
    const unpacked = this.unpackEval(html);
    if (unpacked) {
      match = unpacked.match(/https?:\/\/[^"' ]+\.m3u8[^"' ]*/);
      if (match) return match[0];
    }

    return null;
  }

  parseVideoPage({ id, html }) {
    const $ = load(html);

    // meta extraction
    const metaMap = {};
    $('meta').each((_, el) => {
      const a = el.attribs;
      metaMap[a.name || a.property] = a.content;
    });

    // 🔥 NEW: extract stream properly
    const m3u8 = this.extractM3U8(html);

    if (!m3u8) {
      logger.error('No stream found for:', id);
    }

    const metaResponse = new meta.MetaResponse(
      id,
      Provider.TYPE,
      metaMap['og:title'],
      {
        background: metaMap['og:image'],
        description: metaMap['og:description'] || metaMap['og:title'],
        genres: (metaMap['keywords'] || '').split(','),
      }
    );

    return {
      metaResponse,
      videoPageUrl: m3u8,
    };
  }

  /**
   * 🔥 CRITICAL: add headers for HLS playback
   */
  transformStream(url, stream) {
    return {
      ...stream,
      url,
      headers: {
        Referer: 'https://missav.ws/',
        Origin: 'https://missav.ws',
        'User-Agent': 'Mozilla/5.0',
      },
    };
  }
}

module.exports = MissavProvider.create;