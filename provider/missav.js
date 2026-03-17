const { load } = require('cheerio');
const axios = require('axios');
const logger = require('../logger');
const { meta } = require('../model');
const Provider = require('./provider');

const BASE_URL = 'https://missav.ws';

class MissavProvider extends Provider {

  constructor() {
    super(BASE_URL, 'missav', 10);
  }

  static create() {
    return new MissavProvider();
  }

  // ✅ FIXED: correct working route
  getInitialUrl() {
    return `${BASE_URL}/dm223/en`;
  }

  handleSearch({ extra: { search: keyword } }) {
    return `${BASE_URL}/search/${encodeURIComponent(keyword)}`;
  }

  handlePagination() {
    // ❌ pagination not real → return same URL
    return '';
  }

  // ✅ IMPORTANT: custom fetch with headers (Cloudflare bypass attempt)
  async fetchHtml(url) {
    try {
      const res = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
          'Referer': BASE_URL,
          'Origin': BASE_URL,
          'Accept-Language': 'en-US,en;q=0.9',
        },
      });

      return res.data;
    } catch (err) {
      logger.error('MissAV fetch failed', err.message);
      return '';
    }
  }

  // ✅ FIXED: new parser based on your dump structure
  getCatalogMetas(html) {
    const $ = load(html);
    const metas = [];

    $('a[href*="/en/"]').each((_, el) => {
      const href = $(el).attr('href');

      // skip non-video links
      if (!href || !href.includes('/en/') || href.includes('/dm')) return;

      const img = $(el).find('img');
      const poster = img.attr('data-src') || img.attr('src');
      const title = img.attr('alt') || $(el).text().trim();

      if (href && poster && title) {
        metas.push(new meta.MetaPreview(
          href.startsWith('http') ? href : BASE_URL + href,
          'movie',
          title,
          poster
        ));
      }
    });

    return metas;
  }

  async getMetadata({ id }) {
    const html = await this.fetchHtml(id);
    return this.parseVideoPage({ id, html }).metaResponse;
  }

  // ⚠️ BEST-EFFORT stream extraction (new logic)
  parseVideoPage({ id, html }) {
    const $ = load(html);

    const title = $('meta[property="og:title"]').attr('content');
    const image = $('meta[property="og:image"]').attr('content');
    const desc = $('meta[property="og:description"]').attr('content');

    // ✅ NEW: try to find m3u8 directly
    let videoPageUrl = '';

    const m3u8Match = html.match(/https?:\/\/[^"' ]+\.m3u8[^"' ]*/);

    if (m3u8Match) {
      videoPageUrl = m3u8Match[0];
    }

    return {
      metaResponse: new meta.MetaResponse(
        id,
        Provider.TYPE,
        title,
        {
          background: image,
          description: desc || title,
          genres: [],
        }
      ),
      videoPageUrl,
    };
  }

  transformStream(url, stream) {
    return stream;
  }
}

module.exports = MissavProvider.create;