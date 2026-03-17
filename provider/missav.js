const { load } = require('cheerio');
const logger = require('../logger');
const { meta } = require('../model');
const Provider = require('./provider');
const axios = require('axios');
const { wrapper } = require('axios-cookiejar-support');
const { CookieJar } = require('tough-cookie');

const client = wrapper(axios.create({
  jar: new CookieJar(),
  withCredentials: true,
}));

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

async fetchHtml(url) {
 console.log('MISSAV fetchHtml:', url);
  try {

    await client.get(this.baseUrl, {
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0',
      }
    });

    const res = await client.get(url, {
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://missav.ws/',
      },
      validateStatus: () => true,
    });

    const html = res.data;

    // 🔥 Detect Cloudflare block page
    if (
      html.includes('Just a moment') ||
      html.includes('cf-browser-verification')
    ) {
      throw new Error('Cloudflare blocked');
    }

    return html;

  } catch (e) {
  console.error('MISSAV FULL ERROR:', e); // 🔥 full error
  throw e; // 🔥 DO NOT swallow
}
}

  async getCatalog({ id, extra }) {
    let url = id || this.getInitialUrl();

    if (extra?.skip) {
      url = this.handlePagination(url, { extra });
    }

    const html = await this.fetchHtml(url);

    if (!html) {
      logger.error('Catalog fetch failed');
      return [];
    }

    return this.getCatalogMetas(html);
  }

  async search({ extra }) {
    const url = this.handleSearch({ extra });

    const html = await this.fetchHtml(url);

    if (!html) return [];

    return this.getCatalogMetas(html);
  }

  static create() {
    return new MissavProvider();
  }

  getInitialUrl() {
    return `${this.baseUrl}/dm590/en/release`;
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
      const poster =
        $(el).find('img').attr('data-src') ||
        $(el).find('img').attr('src');

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

  async getMetadata({ id }) {
    const url = id.startsWith('http') ? id : this.baseUrl + id;

    const html = await this.fetchHtml(url);

    if (!html) {
      throw new Error('Failed to fetch video page');
    }

    return this.parseVideoPage({ id, html }).metaResponse;
  }

  unpackEval(packed) {
    try {
      const evalMatch = packed.match(/eval\(function\(p,a,c,k,e,d\).*?\)\)/s);
      if (!evalMatch) return null;

      const fn = new Function(`return ${evalMatch[0]}`);
      return fn();
    } catch (e) {
      logger.error('Unpack failed:', e);
      return null;
    }
  }

  extractM3U8(html) {
    let match = html.match(/https?:\/\/[^"' ]+\.m3u8[^"' ]*/);
    if (match) return match[0];

    const unpacked = this.unpackEval(html);
    if (unpacked) {
      match = unpacked.match(/https?:\/\/[^"' ]+\.m3u8[^"' ]*/);
      if (match) return match[0];
    }

    return null;
  }

  parseVideoPage({ id, html }) {
    const $ = load(html);

    const metaMap = {};
    $('meta').each((_, el) => {
      const a = el.attribs;
      metaMap[a.name || a.property] = a.content;
    });

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