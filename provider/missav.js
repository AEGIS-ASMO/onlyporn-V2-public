const { load } = require('cheerio');
const logger = require('../logger');
const { meta } = require('../model');
const Provider = require('./provider');

const pathMappings = {
  'Uncensored leak': '/dm548/en/uncensored-leak',
  'Most viewed today': '/dm228/en/today-hot',
  'Weekly hot': '/dm146/en/weekly-hot',
  'Monthly hot': '/dm177/en/monthly-hot',
};

// 🔥 Modern headers (important for MissAV)
const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
  Referer: 'https://missav.ws',
  Origin: 'https://missav.ws',
};

class MissavProvider extends Provider {

  constructor() {
    super('https://missav.ws', 'missav', 10);
    this.dataset = {};
    this.metas = {};
  }

  static create() {
    return new MissavProvider();
  }

  getInitialUrl() {
    return this.baseUrl + '/dm515/en/new';
  }

  handleSearch({ extra: { search: keyword } }) {
    return `${this.baseUrl}/search/${keyword}/`;
  }

  handleGenre({ extra: { genre } }) {
    const path = pathMappings[genre];
    return this.baseUrl + path;
  }

  handlePagination(url, { extra: { skip } }) {
    const prefix = url.includes('?') ? '&' : '?';
    return `${prefix}page=${this.page(skip)}`;
  }

  // =========================
  // 🔥 CATALOG PARSER (UPDATED)
  // =========================
  getCatalogMetas(html) {
    const metadatas = [];
    const $ = load(html);

    $('a[href*="/en/"]').each((_, el) => {
      const href = $(el).attr('href');
      const title = $(el).text().trim();
      const poster =
        $(el).find('img').attr('data-src') ||
        $(el).find('img').attr('src');

      if (!href || !title) return;

      metadatas.push(
        new meta.MetaPreview(
          href.replace(this.baseUrl, ''),
          'movie',
          title,
          poster
        )
      );
    });

    return metadatas;
  }

  async getMetadata(args) {
    return super.getMetadata(args)
      .then(meta => meta.metaResponse);
  }

  // =========================
  // 🔥 VIDEO PAGE PARSER (MAJOR UPGRADE)
  // =========================
  parseVideoPage({ id, html }) {
    const $ = load(html);

    // ---- META ----
    const metaMap = {};
    $('meta').each((_, e) => {
      const attribs = e.attribs;
      metaMap[attribs.name || attribs.property] = attribs.content;
    });

    let streams = [];

    // =========================
    // 1. 🔥 DIRECT M3U8 (NEW)
    // =========================
    const m3u8Matches = html.match(/https?:\/\/[^"' ]+\.m3u8[^"' ]*/g);
    if (m3u8Matches) {
      streams.push(...m3u8Matches.map(url => ({
        url,
        name: 'HLS'
      })));
    }

    // =========================
    // 2. 🔥 MP4 FALLBACK
    // =========================
    const mp4Matches = html.match(/https?:\/\/[^"' ]+\.mp4[^"' ]*/g);
    if (mp4Matches) {
      streams.push(...mp4Matches.map(url => ({
        url,
        name: 'MP4'
      })));
    }

    // =========================
    // 3. 🔥 IFRAME EXTRACTION
    // =========================
    const iframe = $('iframe').attr('src');
    if (iframe) {
      streams.push({
        url: iframe,
        name: 'iframe',
        isExternal: true
      });
    }

    // =========================
    // 4. 🔥 JSON PLAYER DATA
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
            name: 'JSON'
          });
        }
      } catch (e) {
        logger.warn('MissAV JSON parse failed');
      }
    }

    // =========================
    // 5. 🔥 LEGACY SURRIT (YOUR OLD METHOD)
    // =========================
    try {
      const regex = /urls:\s*\[(.*?)\]/;
      const match = html.match(regex);

      if (match && match[1]) {
        const text = match[1].split(',')[1];
        const leftPat = 'sixyik.com\\/';
        const left = text.indexOf(leftPat);

        if (left !== -1) {
          const uuid = text
            .substring(left + leftPat.length)
            .replace('\\/seek\\/_1.jpg"', '');

          const legacyUrl = `https://surrit.com/${uuid}/playlist.m3u8`;

          streams.push({
            url: legacyUrl,
            name: 'Legacy HLS'
          });
        }
      }
    } catch (e) {
      logger.warn('Legacy extraction failed');
    }

    // =========================
    // 6. 🔥 LAST RESORT SCAN
    // =========================
    if (streams.length === 0) {
      const fallback = html.match(/https?:\/\/[^"' ]+/g) || [];

      fallback.forEach(url => {
        if (url.includes('.m3u8') || url.includes('.mp4')) {
          streams.push({
            url,
            name: 'Fallback'
          });
        }
      });
    }

    // =========================
    // 🧹 REMOVE DUPLICATES
    // =========================
    const seen = new Set();
    streams = streams.filter(s => {
      if (seen.has(s.url)) return false;
      seen.add(s.url);
      return true;
    });

    // =========================
    // 🎬 META RESPONSE
    // =========================
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

  // =========================
  // 🔥 STREAM TRANSFORM (UPDATED)
  // =========================
  transformStream(url, stream) {
    if (stream.isExternal) return stream;

    // Fix relative HLS segments
    if (stream.url.includes('playlist.m3u8')) {
      return {
        ...stream,
        url: stream.url,
      };
    }

    return stream;
  }
}

module.exports = MissavProvider.create;