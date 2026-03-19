const { load } = require('cheerio');
const logger = require('../logger');
const { meta } = require('../model');
const Provider = require('./provider');

// 🚀 SIMPLE MEMORY CACHE (PUT HERE)
const hlsCache = new Map();
const CACHE_TTL = 1000 * 60 * 10; // 10 minutes

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

      const html = await response.text();

      if (html.includes('SpankBang contains adult content')) {
        logger.warn('⚠️ Blocked by age/cookie wall');
      }

      return html;
    } catch (error) {
      logger.error(error);
      return '';
    }
  }

  handleGenre({ extra }) {
    const { genre, quality } = extra;

    const [keyword, order] = (genre || '').split('(');

    let url;

    if (order) {
      url = this.handleSearch({
        extra: { search: keyword.trim() },
      });

      const u = new URL(url);
      u.searchParams.set('o', order.replace(')', '').toLowerCase());
      url = u.toString();
    } else {
      const path = pathMappings[keyword] || pathMappings.New;
      url = `${this.baseUrl}${path}`;
    }

    if (quality) {
      const qualityMap = {
        '4k': 'uhd',
        '1080p': 'fhd',
        '720p': 'hd',
      };

      const q = qualityMap[quality];

      if (q) {
        const u = new URL(url);
        u.searchParams.set('q', q);
        url = u.toString();
      }
    }

    logger.info({ finalUrl: url }, 'catalog URL');

    return url;
  }

  handlePagination(url, { extra: { skip } }) {
    const page = this.page(skip);

    const u = new URL(url);
    u.searchParams.set('page', page);

    return u.toString();
  }

  getCatalogMetas(html) {

    const metadataList = [];
    const $ = load(html);

    const items = $('[data-id], .video-item, .video-list-item');

    items.each((index, element) => {

      const $e = $(element);

      const link = $e.find('a').attr('href');
      const img = $e.find('img');

      let poster =
        img.attr('data-src') ||
        img.attr('src') ||
        img.attr('data-preview');

      // 🔥 Upgrade thumbnail quality
      if (poster) {
  poster = poster
    .replace('/small/', '/large/')
    .replace('/medium/', '/large/')
    .replace('/thumbs/', '/thumbs/large/');

  // try HD only if known pattern
  if (/\/large\//.test(poster)) {
    poster = poster.replace('/large/', '/large_hd/');
  }
}

      const title =
        img.attr('alt') ||
        $e.find('.n').text() ||
        $e.find('a').attr('title');

      if (!link || !title) return;

      const videoPageUrl = this.baseUrl + link;

      metadataList.push(
        new meta.MetaPreview(
          videoPageUrl,
          'movie',
          title,
          poster,
          { videoPageUrl },
        ),
      );
    });

    logger.debug({ count: metadataList.length }, 'catalog items parsed');

    return metadataList;
  }

  async getMetadata(args) {

    logger.debug({ args }, 'getMetadata');

    const { id } = args;

    return this.fetchHtml(id)
      .then(html => this.parseVideoPage({ id, html }))
      .catch((error) => {
        logger.error({ error, args }, 'getMetadata error');
        throw error;
      });
  }

  // 🔥 NOW ASYNC
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

    const regex = /stream_data\s*=\s*(\{[^;]+\})/;
    const match = scripts.match(regex);

    let streams = [];

    // ✅ Original method (kept)
    if (match) {
      try {
        let jsonString = match[1];
        jsonString = jsonString.replace(/(\w+):/g, '"$1":');

        const streamsData = JSON.parse(jsonString);

        streams = Object.entries(streamsData).map(([quality, url]) => ({
          name: quality,
          url,
          type: Provider.TYPE,
        }));

      } catch (e) {
        logger.warn({ error: e }, '⚠️ Failed to parse stream_data');
      }
    }

    // 🚀 ULTRA OPTIMIZED HLS PARSER
if (!streams.length) {
  const m3u8Match = scripts.match(/https?:\/\/[^"' ]+\.m3u8[^"' ]*/);

  if (m3u8Match) {
    const masterUrl = m3u8Match[0];

    try {
// 🔥 FORCE 4K DISCOVERY
const idMatch = masterUrl.match(/\/(\d+)-/);

if (idMatch) {
  const videoId = idMatch[1];

  const base = masterUrl.split('/hls/')[0] + '/hls/';
  const pathParts = masterUrl.split('/hls/')[1].split('/');

  // rebuild path like: 1/6/
  const folderPath = pathParts.slice(0, 2).join('/');

  const forced4kUrl = `${base}${folderPath}/${videoId}-4k.mp4/index-v1-a1.m3u8`;

  try {
    const res = await fetch(forced4kUrl, { method: 'HEAD' });

    if (res.ok) {
      console.log('🔥 4K FOUND:', forced4kUrl);

      streams.unshift({
        name: '2160p 4K',
        url: forced4kUrl,
        type: Provider.TYPE,
      });
    }
  } catch (err) {
    console.log('❌ No 4K stream');
  }
}

      // ⚡ CACHE HIT
      if (hlsCache.has(masterUrl)) {
        const cached = hlsCache.get(masterUrl);

        if (Date.now() - cached.time < CACHE_TTL) {
          console.log('⚡ CACHE HIT');
          streams = cached.streams;
        }
      }

      if (!streams.length) {

        console.log('🌐 FETCHING PLAYLIST:', masterUrl);

        const res = await fetch(masterUrl);
        const text = await res.text();

        const lines = text.split('\n');
        const variants = [];

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];

          if (line.includes('#EXT-X-STREAM-INF')) {

            const resolutionMatch = line.match(/RESOLUTION=\d+x(\d+)/);
            const height = resolutionMatch ? parseInt(resolutionMatch[1]) : 0;

            const bandwidthMatch = line.match(/BANDWIDTH=(\d+)/);
            const bitrate = bandwidthMatch ? parseInt(bandwidthMatch[1]) : 0;

            let codec = /hev1|hvc1/i.test(line) ? 'HEVC' : 'AVC';

            let isHDR = /VIDEO-RANGE=PQ|VIDEO-RANGE=HLG|hdr/i.test(line);
            let isDV = /dvhe|dvh1|dolby/i.test(line);

            const nextLine = lines[i + 1];

            if (nextLine) {
              let streamUrl = new URL(nextLine, masterUrl).toString();

              if (/hdr|hlg/i.test(streamUrl)) isHDR = true;
              if (/dv|dolby/i.test(streamUrl)) {
                isDV = true;
                isHDR = true;
              }

              // 🚨 FAKE 4K DETECTION
              let realHeight = height;

// 🔥 Detect hidden 4K via bitrate
if (bitrate > 12000000 && height === 1080) {
  realHeight = 2160;
}

// 🔥 Detect via URL
if (/2160|4k/i.test(streamUrl)) {
  realHeight = 2160;
}
              

              let name = realHeight ? `${realHeight}p` : 'Auto';

              if (isDV) name += ' DV';
              else if (isHDR) name += ' HDR';

              name += ` ${codec}`;

              if (bitrate) {
                const mbps = (bitrate / 1000000).toFixed(1);
                name += ` ${mbps}Mbps`;
              }

              variants.push({
                name,
                url: streamUrl,
                type: Provider.TYPE,
                height: realHeight,
                bitrate,
                isHDR,
                isDV,
                codec,
              });
            }
          }
        }

        // 🧠 SMART SORT
        variants.sort((a, b) => {
          if (b.height !== a.height) return b.height - a.height;
          if (b.isDV !== a.isDV) return b.isDV - a.isDV;
          if (b.isHDR !== a.isHDR) return b.isHDR - a.isHDR;
          if (b.codec !== a.codec) return b.codec === 'HEVC' ? 1 : -1;
          return b.bitrate - a.bitrate;
        });

        // 🎯 OPTION: BEST STREAM ONLY
        const BEST_ONLY = false;

        streams = BEST_ONLY
          ? [((variants[0]) && {
              name: '🔥 Best Quality',
              url: variants[0].url,
              type: Provider.TYPE,
            })].filter(Boolean)
          : variants.map(({ height, bitrate, isHDR, isDV, codec, ...rest }) => rest);

        // 💾 SAVE CACHE
        hlsCache.set(masterUrl, {
          streams,
          time: Date.now(),
        });

        console.log('✅ STREAMS READY:', streams);
      }

    } catch (err) {
      logger.warn({ err }, '⚠️ HLS parsing failed');
    }
  }
}

    // 🔥 SMART MP4 EXTRACTION (WITH 4K DETECTION)
if (!streams.length) {
  const urls = scripts.match(/https?:\/\/[^"' ]+\.mp4[^"' ]*/g);

  if (urls && urls.length) {

    const variants = urls.map(u => {
      let quality = 'mp4';

      if (u.includes('2160') || u.includes('4k')) quality = '2160p';
      else if (u.includes('1080')) quality = '1080p';
      else if (u.includes('720')) quality = '720p';

      return {
        name: `📦 ${quality}`,
        url: u,
        type: Provider.TYPE,
      };
    });

    // sort best first
    variants.sort((a, b) => {
      const getQ = q => parseInt(q.match(/\d+/)) || 0;
      return getQ(b.name) - getQ(a.name);
    });

    streams = variants;

    console.log('🎯 MP4 STREAMS:', streams);
  }
}

    if (!streams.length) {
      logger.warn('⚠️ No streams found');
      return {};
    }

    return new meta.MetaResponse(
      url,
      'movie',
      title,
      {
        streams,
        poster,
        background: poster,
        description,
      },
    );
  }
}

module.exports = SpankbangProvider.create;