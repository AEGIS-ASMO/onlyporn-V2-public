require('dotenv').config();

const { load } = require('cheerio');
const logger = require('../logger');
const { meta } = require('../model');
const Provider = require('./provider');

const axios = require('axios');
const { wrapper } = require('axios-cookiejar-support');
const { CookieJar } = require('tough-cookie');

const jar = new CookieJar();
const client = wrapper(axios.create({ jar }));

const DEFAULT_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
  'Accept':
    'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Connection': 'keep-alive',
  'Upgrade-Insecure-Requests': '1',
};

const sortByMappings = {
  'Latest': 'latest',
  'Trending': 'trending',
  'Views': 'views',
  'Orgasmic': 'orgasmic',
};

class SxyprnProvider extends Provider {

  constructor() {
    super('https://www.sxyprn.com', 'sxyprn', 25);
  }

  static create() {
    return new SxyprnProvider();
  }

  // ----------------------------------
  // Utility: Safe HTTP fetch (Cloudflare-safe)
  // ----------------------------------
  

async safeFetch(url, extraHeaders = {}) {
  try {
    const res = await client.get(url, {
      headers: {
        ...DEFAULT_HEADERS,
        ...extraHeaders,
        Referer: this.baseUrl,
        Origin: this.baseUrl,
      },
      timeout: 15000,
      validateStatus: () => true,
    });

if (typeof res.data === 'string') {
      if (res.data.includes('cf-browser-verification') || res.data.includes('Just a moment')) {
        logger.error("🚫 CLOUDFLARE BLOCKED PAGE");
      }
    }

    return res.data;
  } catch (err) {
    logger.error({ url, err }, 'safeFetch failed');
    return null;
  }
}

  // ----------------------------------
  // Extract HLS from JWPlayer script
  // ----------------------------------
  extractJWPlayer(html) {
  const $ = load(html);

  const scripts = $('script')
    .map((_, el) => $(el).html())
    .get()
    .join('\n');

  if (!scripts) return null;

  // 🔥 Case 1: sources array
  let match = scripts.match(/sources:\s*\[\s*{[^}]*file:\s*"(https?:\/\/[^"]+)"/);
  if (match) return match[1];

  // 🔥 Case 2: direct file
  match = scripts.match(/file:\s*"(https?:\/\/[^"]+)"/);
  if (match) return match[1];

  // 🔥 Case 3: video_url pattern
match = scripts.match(/video_url:\s*"(https?:\/\/[^"]+)"/);
if (match) return match[1];

  return null;
}

extractHTMLVideo(html) {
  const $ = load(html);

  let src =
    $('video').attr('src') ||
    $('video source').attr('src');

  if (src && src.startsWith('//')) {
    src = 'https:' + src;
  }

  return src || null;
}

extractIframe(html) {
  const $ = load(html);
  let src = $('iframe').attr('src');

  if (!src) return null;

  if (src.startsWith('//')) {
    src = 'https:' + src;
  }

  // ✅ NEW: handle relative paths
  if (src.startsWith('/')) {
    src = this.baseUrl + src;
  }

  return src;
}

  // ----------------------------------
  // Resolve external hosts (EXTENSIBLE)
  // ----------------------------------
  async resolveExternal(url) {

    try {

      // ---- LULUSTREAM / LULUVDO ----
      if (url.includes('luluvdo') || url.includes('lulustream')) {

        const html = await this.safeFetch(url, {
  Referer: this.baseUrl,
  Origin: this.baseUrl,
});

        if (!html) return null;

        // Try JWPlayer
        const stream = this.extractJWPlayer(html);
        if (stream) return stream;

        // Try deeper iframe
        const iframe = this.extractIframe(html);
        if (iframe && iframe !== url) {
          return await this.resolveExternal(iframe);
        }
      }

      // ---- MIXDROP (future ready) ----
      if (url.includes('mixdrop')) {
        const html = await this.safeFetch(url);
        const match = html?.match(/MDCore\.wurl="([^"]+)"/);
        if (match) return match[1];
      }

      // ---- STREAMTAPE (future ready) ----
      if (url.includes('streamtape')) {
        const html = await this.safeFetch(url);
        const match = html?.match(/robotlink'\)\.innerHTML = '(.*?)'/);
        if (match) return `https:${match[1]}`;
      }

    } catch (err) {
      logger.error({ url, err }, 'resolveExternal failed');
    }

    return null;
  }

  // ----------------------------------
  // Catalog
  // ----------------------------------
  getCatalogMetas(html) {

    const metadataList = [];
    const $ = load(html);

    $('.post_el_small, .thumb').each((_, element) => {

      const $e = $(element);

      const title =
        $e.find('.post_text').text().trim() ||
        $e.find('img').attr('alt');

      let poster =
        $e.find('img').attr('data-src') ||
        $e.find('img').attr('data-original') ||
        $e.find('img').attr('src');

      if (poster && !poster.startsWith('http')) {
        poster = 'https:' + poster;
      }

      const path =
        $e.find('a.js-pop').attr('href') ||
        $e.find('a').first().attr('href');

      if (!path) return;

      const videoPageUrl = path.startsWith('http')
        ? path
        : this.baseUrl + path;

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

    return metadataList;
  }

  // ----------------------------------
  // Metadata
  // ----------------------------------
  async getMetadata({ id }) {

    logger.debug({ id }, 'getMetadata');

    const html = await this.safeFetch(id);
    if (!html) return null;

    return this.parseVideoPage({ id, html });
  }

  // ----------------------------------
  // MAIN PARSER
  // ----------------------------------
  async parseVideoPage({ id, html }) {

    const $ = load(html);

    const title = $('meta[property="og:title"]').attr('content');

    let poster = $('meta[property="og:image"]').attr('content');
    if (poster?.startsWith('//')) poster = 'https:' + poster;

    const description = $('meta[property="og:description"]').attr('content');

    let videoUrl = null;

    // -----------------------------
    // 1. trafficdeposit
    // -----------------------------
    const mgfs = $('#player_el').attr('data-mgfs');
    const thumb = poster || '';

    const hashMatch = thumb.match(/\/img\/([^/]+)\//);
    const hash = hashMatch ? hashMatch[1] : null;

    if (mgfs && hash) {
      const cdnMatch = thumb.match(/\/\/(b\d+)\.trafficdeposit/);
      const cdn = cdnMatch ? cdnMatch[1] : 'b1';

      videoUrl = `https://${cdn}.trafficdeposit.com/hls/${hash}/${mgfs}/master.m3u8`;
    }

    // 2. JWPlayer
if (!videoUrl) {
  videoUrl = this.extractJWPlayer(html);
}

// 🔥 3. HTML5 video fallback (NEW)
if (!videoUrl) {
  videoUrl = this.extractHTMLVideo(html);
}

    // -----------------------------
    // 3. iframe → external resolve
    // -----------------------------
    if (!videoUrl) {
      const iframe = this.extractIframe(html);

      if (iframe) {
        videoUrl = await this.resolveExternal(iframe);
      }
    }

    // -----------------------------
    // Normalize
    // -----------------------------
    if (videoUrl?.startsWith('//')) {
      videoUrl = 'https:' + videoUrl;
    }

logger.info({ videoUrl }, "EXTRACTED URL");
logger.info({
  jw: !!this.extractJWPlayer(html),
  html5: !!this.extractHTMLVideo(html),
  iframe: !!this.extractIframe(html),
}, "PARSER STATUS");

    return new meta.MetaResponse(
      id,
      Provider.TYPE,
      title,
      {
        description,
        poster,
        background: poster,
        videoPageUrl: videoUrl,
      },
    );
  }

  // ----------------------------------
  // Streams (TOKEN + HEADERS SAFE)
  // ----------------------------------
  async getStreams(meta) {

  if (!meta.id) {
    return { streams: [] };
  }

  // 🔥 REFRESH PAGE EVERY TIME (token fix)
  const html = await this.safeFetch(meta.id);
  if (!html) return { streams: [] };

  const refreshed = await this.parseVideoPage({
    id: meta.id,
    html
  });

  const url = refreshed?.videoPageUrl;

  if (!url) {
    logger.error("No stream after refresh");
    return { streams: [] };
  }

  const getReferer = (u) => {
    try {
      const parsed = new URL(u);
      return `${parsed.protocol}//${parsed.hostname}/`;
    } catch {
      return this.baseUrl;
    }
  };

  const referer = getReferer(url);
  const isHls = url.includes('.m3u8');

  logger.info({ url, referer }, "FINAL STREAM");

  return {
    streams: [
      {
        name: "OnlyPorn Ultra",
        title: "Auto Refreshed Stream",

        url,
        type: isHls ? "hls" : undefined,

        behaviorHints: {
          notWebReady: false,

          proxyHeaders: {
            request: {
              Referer: referer,
              Origin: referer,
              'User-Agent': DEFAULT_HEADERS['User-Agent'],
              'Accept': '*/*',
            }
          }
        }
      }
    ]
  };
}
}

module.exports = SxyprnProvider.create;