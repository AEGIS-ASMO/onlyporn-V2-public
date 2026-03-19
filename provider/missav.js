const { load } = require('cheerio');
const logger = require('../logger');
const { meta } = require('../model');
const Provider = require('./provider');

// 🚀 SIMPLE CACHE (same idea as spankbang)
const hlsCache = new Map();
const CACHE_TTL = 1000 * 60 * 10;

// =========================
// 🔥 PATHS
// =========================
const pathMappings = {
  'Uncensored leak': '/dm628/en/uncensored-leak',
  'Most viewed today': '/dm291/en/today-hot',
  'Weekly hot': '/dm169/en/weekly-hot',
  'Monthly hot': '/dm263/en/monthly-hot',
};

// =========================
// 🔥 REAL BROWSER HEADERS
// =========================
const HEADERS = {
  'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'accept-language': 'en-US,en;q=0.9',
  'cache-control': 'no-cache',
  'pragma': 'no-cache',
  'upgrade-insecure-requests': '1',
  'referer': 'https://missav.ai/',
  'origin': 'https://missav.ai',
  'cookie': 'age_verified=1; hasVisited=1;',
  'sec-fetch-site': 'same-origin',
  'sec-fetch-mode': 'navigate',
  'sec-fetch-user': '?1',
  'sec-fetch-dest': 'document',
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36',
};

class MissavProvider extends Provider {

  constructor() {
    super('https://missav.ai', 'missav', 10);
    console.log('[MissAV] Provider initialized with domain:', this.baseUrl);
  }

  static create() {
    return new MissavProvider();
  }

  // =========================
  // ✅ FETCH (SPANKBANG STYLE)
  // =========================
  async fetchHtml(url) {
    logger.info({ url }, '[MissAV] fetching');

    try {
      const res = await fetch(url, { headers: HEADERS });
      const html = await res.text();

      // 🚫 Cloudflare detection
      if (
        html.includes('cf-chl') ||
        html.includes('Just a moment') ||
        html.includes('Attention Required')
      ) {
        console.log('🚫 CLOUDFLARE BLOCKED');

        // retry once with slight variation
        const retry = await fetch(url + '?_=' + Date.now(), {
          headers: HEADERS,
        });
        return await retry.text();
      }

      return html;
    } catch (err) {
      logger.error(err);
      return '';
    }
  }

  getInitialUrl() {
    return this.baseUrl + '/dm223/en';
  }

  handleSearch({ extra: { search: keyword } }) {
    return `${this.baseUrl}/search/${encodeURIComponent(keyword)}/`;
  }

  handleGenre({ extra: { genre } }) {
    return this.baseUrl + (pathMappings[genre] || '/dm223/en');
  }

  handlePagination(url, { extra: { skip } }) {
    const page = this.page(skip);
    return `${url}?page=${page}`;
  }

  // =========================
  // 🔥 CATALOG
  // =========================
  getCatalogMetas(html) {
    const $ = load(html);
    const list = [];
    const seen = new Set();

    $('a[href*="/en/"]').each((i, el) => {
      const href = $(el).attr('href');
      const title = $(el).text().trim();

      if (!href || !title || seen.has(href)) return;
      seen.add(href);

      const poster =
        $(el).find('img').attr('data-src') ||
        $(el).find('img').attr('src');

      list.push(
        new meta.MetaPreview(
          href,
          'movie',
          title,
          poster,
          { videoPageUrl: href }
        )
      );
    });

    console.log('[MissAV] Catalog count:', list.length);
    return list;
  }

  async getMetadata(args) {
    const html = await this.fetchHtml(args.id);
    return this.parseVideoPage({ id: args.id, html }).metaResponse;
  }

  // =========================
  // 🔥 VIDEO PARSER
  // =========================
  async parseVideoPage({ id, html }) {
    const $ = load(html);

    const title =
      $('meta[property="og:title"]').attr('content') || 'MissAV';
    const poster =
      $('meta[property="og:image"]').attr('content');

    const description =
      $('meta[property="og:description"]').attr('content') || title;

    let streams = [];

    // =========================
    // 1. DIRECT M3U8
    // =========================
    const m3u8 = html.match(/https?:\/\/[^"' ]+\.m3u8[^"' ]*/g);
    if (m3u8) {
      streams.push(
        ...m3u8.map(url => ({
          url,
          name: 'HLS',
          type: Provider.TYPE,
          headers: {
            referer: 'https://missav.ai/',
            origin: 'https://missav.ai',
            'user-agent': HEADERS['user-agent'],
          },
        }))
      );
    }

    // =========================
    // 2. MP4
    // =========================
    const mp4 = html.match(/https?:\/\/[^"' ]+\.mp4[^"' ]*/g);
    if (mp4) {
      streams.push(
        ...mp4.map(url => ({
          url,
          name: 'MP4',
          type: Provider.TYPE,
        }))
      );
    }

    // =========================
    // 3. JSON DATA
    // =========================
    const jsonMatch = html.match(/window\.__DATA__\s*=\s*(\{.*?\});/);
    if (jsonMatch) {
      try {
        const json = JSON.parse(jsonMatch[1]);

        const videoUrl =
          json?.video?.hls ||
          json?.video?.mp4 ||
          json?.stream;

        if (videoUrl) {
          streams.push({
            url: videoUrl,
            name: 'JSON',
            type: Provider.TYPE,
          });
        }
      } catch {}
    }

    // =========================
    // 4. LEGACY (important)
    // =========================
    try {
      const match = html.match(/urls:\s*\[(.*?)\]/);
      if (match && match[1]) {
        const text = match[1];
        const uuidMatch = text.match(/sixyik\.com\\\/([^\\/]+)/);

        if (uuidMatch) {
          const uuid = uuidMatch[1];
          const legacy = `https://surrit.com/${uuid}/playlist.m3u8`;

          streams.push({
            url: legacy,
            name: 'Legacy',
            type: Provider.TYPE,
          });
        }
      }
    } catch {}

    // =========================
    // 5. FALLBACK SCAN
    // =========================
    if (!streams.length) {
      const fallback = html.match(/https?:\/\/[^"' ]+/g) || [];

      fallback.forEach(url => {
        if (url.includes('.m3u8') || url.includes('.mp4')) {
          streams.push({
            url,
            name: 'Fallback',
            type: Provider.TYPE,
          });
        }
      });
    }

    // =========================
    // REMOVE DUPES
    // =========================
    const seen = new Set();
    streams = streams.filter(s => {
      if (seen.has(s.url)) return false;
      seen.add(s.url);
      return true;
    });

    console.log('[MissAV] Streams found:', streams.length);

    return new meta.MetaResponse(id, 'movie', title, {
      streams,
      poster,
      background: poster,
      description,
    });
  }

  transformStream(url, stream) {
    return stream;
  }
}

module.exports = MissavProvider.create;