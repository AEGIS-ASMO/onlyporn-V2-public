const { load } = require('cheerio');
const logger = require('../logger');
const { meta } = require('../model');
const Provider = require('./provider');

const pathMappings = {
  'Uncensored leak': '/dm628/en/uncensored-leak',
  'Most viewed today': '/dm291/en/today-hot',
  'Weekly hot': '/dm169/en/weekly-hot',
  'Monthly hot': '/dm263/en/monthly-hot',
};

// 🔥 Modern headers
const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
  Referer: 'https://missav.ws',
  Origin: 'https://missav.ws',
};

class MissavProvider extends Provider {

  constructor() {
  super('https://missav.ai', 'missav', 10); // 🔥 SWITCH DOMAIN
  console.log('[MissAV] Provider initialized with domain:', this.baseUrl);
}

  static create() {
    return new MissavProvider();
  }

  // ✅ UPDATED HOME
  getInitialUrl() {
    const url = this.baseUrl + '/dm223/en';
    console.log('[MissAV] Initial URL:', url);
    return url;
  }

  handleSearch({ extra: { search: keyword } }) {
    const url = `${this.baseUrl}/search/${keyword}/`;
    console.log('[MissAV] Search URL:', url);
    return url;
  }

  handleGenre({ extra: { genre } }) {
    const path = pathMappings[genre];
    const url = this.baseUrl + path;
    console.log('[MissAV] Genre:', genre, '→', url);
    return url;
  }

  handlePagination(url, { extra: { skip } }) {
    const prefix = url.includes('?') ? '&' : '?';
    const paginated = `${prefix}page=${this.page(skip)}`;
    console.log('[MissAV] Pagination:', paginated);
    return paginated;
  }

  // =========================
  // 🔥 CATALOG PARSER
  // =========================
  getCatalogMetas(html) {
    console.log('[MissAV] Parsing catalog...');
    const metadatas = [];
    const $ = load(html);

    $('a[href*="/en/"]').each((i, el) => {
      const href = $(el).attr('href');
      const title = $(el).text().trim();
      const poster =
        $(el).find('img').attr('data-src') ||
        $(el).find('img').attr('src');

      if (!href || !title) return;

      console.log('[MissAV] Found item:', title);

      metadatas.push(
        new meta.MetaPreview(
          href.replace(this.baseUrl, ''),
          'movie',
          title,
          poster
        )
      );
    });

    console.log('[MissAV] Total metas:', metadatas.length);
    return metadatas;
  }

  async getMetadata(args) {
    console.log('[MissAV] Fetching metadata for:', args.id);
    return super.getMetadata(args)
      .then(meta => meta.metaResponse);
  }

  // =========================
  // 🔥 VIDEO PAGE PARSER
  // =========================
  parseVideoPage({ id, html }) {
    console.log('\n[MissAV] ===========================');
    console.log('[MissAV] Parsing video:', id);

    const $ = load(html);

    const metaMap = {};
    $('meta').each((_, e) => {
      const attribs = e.attribs;
      metaMap[attribs.name || attribs.property] = attribs.content;
    });

    console.log('[MissAV] Title:', metaMap['og:title']);

    let streams = [];

    // =========================
    // 1. M3U8
    // =========================
    const m3u8Matches = html.match(/https?:\/\/[^"' ]+\.m3u8[^"' ]*/g);
    if (m3u8Matches) {
      console.log('[MissAV] M3U8 found:', m3u8Matches.length);
      streams.push(...m3u8Matches.map(url => ({
        url,
        name: 'HLS'
      })));
    } else {
      console.log('[MissAV] No M3U8 found');
    }

    // =========================
    // 2. MP4
    // =========================
    const mp4Matches = html.match(/https?:\/\/[^"' ]+\.mp4[^"' ]*/g);
    if (mp4Matches) {
      console.log('[MissAV] MP4 found:', mp4Matches.length);
      streams.push(...mp4Matches.map(url => ({
        url,
        name: 'MP4'
      })));
    } else {
      console.log('[MissAV] No MP4 found');
    }

    // =========================
    // 3. IFRAME
    // =========================
    const iframe = $('iframe').attr('src');
    if (iframe) {
      console.log('[MissAV] Iframe found:', iframe);
      streams.push({
        url: iframe,
        name: 'iframe',
        isExternal: true
      });
    } else {
      console.log('[MissAV] No iframe found');
    }

    // =========================
    // 4. JSON
    // =========================
    const jsonMatch = html.match(/window\.__DATA__\s*=\s*(\{.*?\});/);
    if (jsonMatch) {
      console.log('[MissAV] JSON data found');
      try {
        const json = JSON.parse(jsonMatch[1]);
        const videoUrl =
          json?.video?.hls ||
          json?.video?.mp4 ||
          json?.stream;

        if (videoUrl) {
          console.log('[MissAV] JSON stream:', videoUrl);
          streams.push({
            url: videoUrl,
            name: 'JSON'
          });
        }
      } catch (e) {
        console.log('[MissAV] JSON parse error');
      }
    } else {
      console.log('[MissAV] No JSON player data');
    }

    // =========================
    // 5. LEGACY
    // =========================
    try {
      const regex = /urls:\s*\[(.*?)\]/;
      const match = html.match(regex);

      if (match && match[1]) {
        console.log('[MissAV] Legacy pattern found');

        const text = match[1].split(',')[1];
        const leftPat = 'sixyik.com\\/';
        const left = text.indexOf(leftPat);

        if (left !== -1) {
          const uuid = text
            .substring(left + leftPat.length)
            .replace('\\/seek\\/_1.jpg"', '');

          const legacyUrl = `https://surrit.com/${uuid}/playlist.m3u8`;

          console.log('[MissAV] Legacy stream:', legacyUrl);

          streams.push({
            url: legacyUrl,
            name: 'Legacy HLS'
          });
        }
      }
    } catch (e) {
      console.log('[MissAV] Legacy extraction failed');
    }

    // =========================
    // 6. FALLBACK
    // =========================
    if (streams.length === 0) {
      console.log('[MissAV] Running fallback scan...');

      const fallback = html.match(/https?:\/\/[^"' ]+/g) || [];

      fallback.forEach(url => {
        if (url.includes('.m3u8') || url.includes('.mp4')) {
          console.log('[MissAV] Fallback stream:', url);
          streams.push({
            url,
            name: 'Fallback'
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

    console.log('[MissAV] Final streams count:', streams.length);

    const metaResponse = new meta.MetaResponse(
      id,
      Provider.TYPE,
      metaMap['og:title'],
      {
        background: metaMap['og:image'],
        description:
          metaMap['og:description'] || metaMap['og:title'],
        genres: metaMap['keywords']
          ? metaMap['keywords'].split(',')
          : [],
      }
    );

    return {
      metaResponse,
      streams,
    };
  }

  transformStream(url, stream) {
    console.log('[MissAV] Transforming stream:', stream.url);

    if (stream.isExternal) return stream;

    return stream;
  }
}

module.exports = MissavProvider.create;