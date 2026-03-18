const { load } = require('cheerio');
const logger = require('../logger');
const { meta } = require('../model');
const Provider = require('./provider');

// 🚀 CACHE
const hlsCache = new Map();
const CACHE_TTL = 1000 * 60 * 10;

const pathMappings = {
  'Trending': '/trending_videos/',
  'New': '/new_videos/',
  'Popular': '/most_popular/',
  'Upcoming': '/upcoming/',
};

class SpankbangProvider extends Provider {

  constructor() {
    super('https://spankbang.com', 'spankbang', 80);
  }

  static create() {
    return new SpankbangProvider();
  }

  getInitialUrl() {
    return this.baseUrl + pathMappings.Trending;
  }

  handleSearch({ extra: { search: keyword } }) {
    return `${this.baseUrl}/s/${encodeURIComponent(keyword)}/`;
  }

  async fetchHtml(url) {
    logger.info({ url }, 'fetching url');

    try {
      const response = await fetch(url, {
        headers: {
          'accept': 'text/html',
          'accept-language': 'en-US,en;q=0.9',
          'referer': 'https://spankbang.com/',
          'user-agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36',
        },
      });

      return await response.text();
    } catch (error) {
      logger.error(error);
      return '';
    }
  }

  // ✅ FIXED GENRE HANDLING
  handleGenre({ extra }) {

  const { genre, sort, quality } = extra;

  let url;

  const qualityMap = {
    '4k': 'uhd',
    '1080p': 'fhd',
    '720p': 'hd',
  };

  const q = qualityMap[quality];

  // 🎯 CASE 1: GLOBAL (no category, only quality + sort)
  if (!genre || genre === 'All' || ['4k', '1080p', '720p'].includes(genre)) {

    const path = pathMappings[
      sort ? sort.charAt(0).toUpperCase() + sort.slice(1) : 'Trending'
    ] || pathMappings.Trending;

    url = `${this.baseUrl}${path}`;

    if (q) {
      const u = new URL(url);
      u.searchParams.set('q', q);
      url = u.toString();
    }

  } else {

    // 🎯 CASE 2: CATEGORY BASED (milf, teen, etc.)
    url = `${this.baseUrl}/s/${encodeURIComponent(genre)}/`;

    const u = new URL(url);

    if (q) {
      u.searchParams.set('q', q);
    }

    const sortMap = {
  'trending': '',
  'popular': 'views',
  'new': 'new',
  'featured': 'featured'
};

if (sort) {
  const mapped = sortMap[sort.toLowerCase()];
  if (mapped) {
    u.searchParams.set('o', mapped);
  }
}

    url = u.toString();
  }

// 🔥 FORCE REFRESH (prevents identical ordering / caching)
const finalUrl = new URL(url);
finalUrl.searchParams.set('_', Date.now());

url = finalUrl.toString();

  console.log('✅ FINAL GENRE URL:', url);

  return url;
}

  handlePagination(url, { extra: { skip } }) {
    const page = this.page(skip);
    const u = new URL(url);
    u.searchParams.set('page', page);
    return u.toString();
  }

  // ✅ FIXED THUMBNAILS
  getCatalogMetas(html) {
    const metadataList = [];
    const $ = load(html);

    const items = $('[data-id], .video-item, .video-list-item');

    const seen = new Set();

items.each((index, element) => {
  const $e = $(element);

  const link = $e.find('a').attr('href');

  if (!link || seen.has(link)) return;
  seen.add(link);

  const img = $e.find('img');

      let poster =
        img.attr('data-src') ||
        img.attr('data-preview') ||
        img.attr('src');

      // 🔥 SRCSET (BEST QUALITY)
      const srcset = img.attr('data-srcset') || img.attr('srcset');
      if (srcset) {
        const parts = srcset.split(',');
        const best = parts[parts.length - 1]?.trim().split(' ')[0];
        if (best) poster = best;
      }

      // 🔥 FORCE HIGH RES
      if (poster) {
        poster = poster
          .replace(/\/small\//, '/large/')
          .replace(/\/medium\//, '/large/')
          .replace(/\/thumbs\//, '/thumbs/large/');
      }

      const title =
        img.attr('alt') ||
        $e.find('.n').text() ||
        $e.find('a').attr('title');

      if (!link || !title) return;

      metadataList.push(
        new meta.MetaPreview(
          this.baseUrl + link,
          'movie',
          title,
          poster,
          { videoPageUrl: this.baseUrl + link },
        ),
      );
    });

    return metadataList;
  }

  async getMetadata(args) {
    const { id } = args;

    return this.fetchHtml(id)
      .then(html => this.parseVideoPage({ id, html }))
      .catch((error) => {
        logger.error({ error, args }, 'getMetadata error');
        throw error;
      });
  }

  // 🚀 FINAL OPTIMIZED STREAM PARSER
  async parseVideoPage({ html }) {

    const $ = load(html);

    const url = $('meta[property="og:url"]').attr('content');
    const title = $('meta[property="og:title"]').attr('content');
    const poster = $('meta[property="og:image"]').attr('content');

    const description =
      $('meta[property="og:description"]').attr('content') || title;

    const scripts = $('script')
      .map((i, el) => $(el).html())
      .get()
      .join('\n');

    let streams = [];

    // 🔥 HLS PARSER WITH CACHE
    const m3u8Match = scripts.match(/https?:\/\/[^"' ]+\.m3u8[^"' ]*/);

    if (m3u8Match) {
      const masterUrl = m3u8Match[0];

      try {

        if (hlsCache.has(masterUrl)) {
          const cached = hlsCache.get(masterUrl);
          if (Date.now() - cached.time < CACHE_TTL) {
            console.log('⚡ CACHE HIT');
            streams = cached.streams;
          }
        }

        if (!streams.length) {

          const res = await fetch(masterUrl);
          const text = await res.text();

          const lines = text.split('\n');
          const variants = [];

          for (let i = 0; i < lines.length; i++) {
            const line = lines[i];

            if (line.includes('#EXT-X-STREAM-INF')) {

              const height = parseInt(line.match(/RESOLUTION=\d+x(\d+)/)?.[1] || 0);
              const bitrate = parseInt(line.match(/BANDWIDTH=(\d+)/)?.[1] || 0);

              let codec = /hev1|hvc1/i.test(line) ? 'HEVC' : 'AVC';
              let isHDR = /VIDEO-RANGE=PQ|VIDEO-RANGE=HLG|hdr/i.test(line);
              let isDV = /dvhe|dvh1|dolby/i.test(line);

              const next = lines[i + 1];
              if (!next) continue;

              let streamUrl = new URL(next, masterUrl).toString();

              if (height >= 2000 && bitrate < 8000000) {
                continue; // 🚫 skip fake 4K
              }

              let name = `${height || 'Auto'}p`;

              if (isDV) name += ' DV';
              else if (isHDR) name += ' HDR';

              name += ` ${codec}`;

              variants.push({
                name,
                url: streamUrl,
                type: Provider.TYPE,
                height,
                bitrate,
                isHDR,
                isDV
              });
            }
          }

          variants.sort((a, b) => b.height - a.height || b.bitrate - a.bitrate);

          streams = variants.map(v => {
  let name = `${v.height}p`;

  if (v.isDV) name += ' DV';
  else if (v.isHDR) name += ' HDR';

  name += ` ${v.bitrate > 15000000 ? 'High' : ''}`;

  return {
    name,
    url: v.url,
    type: 'hls'
  };
});

          hlsCache.set(masterUrl, {
            streams,
            time: Date.now()
          });

          console.log('✅ STREAM READY:', streams);
        }

      } catch (e) {
        logger.warn({ e }, 'HLS failed');
      }
    }

    // 🔥 MP4 fallback
    if (!streams.length) {
      const urls = scripts.match(/https?:\/\/[^"' ]+\.mp4[^"' ]*/g);

      if (urls) {
        streams = urls.map(u => ({
          name: 'mp4',
          url: u,
          type: Provider.TYPE
        }));
      }
    }

    if (!streams.length) return {};

    return new meta.MetaResponse(url, 'movie', title, {
      streams,
      poster,
      background: poster,
      description,
    });
  }
}

module.exports = SpankbangProvider.create;