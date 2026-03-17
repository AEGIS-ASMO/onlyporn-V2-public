require('dotenv').config();

const { load } = require('cheerio');
const logger = require('../logger');
const { meta } = require('../model');
const Provider = require('./provider');

const axios = require('axios');

const DEFAULT_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
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
      const res = await axios.get(url, {
        headers: {
          ...DEFAULT_HEADERS,
          ...extraHeaders,
        },
        timeout: 15000,
        validateStatus: () => true,
      });

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

    const script = $('script')
      .filter((_, el) => $(el).html()?.includes('jwplayer'))
      .first()
      .html();

    if (!script) return null;

    const match = script.match(/file:\s*"(https?:\/\/[^"]+\.m3u8[^"]*)"/);

    return match ? match[1] : null;
  }

  // ----------------------------------
  // Extract iframe src
  // ----------------------------------
  extractIframe(html) {
    const $ = load(html);
    return $('iframe').attr('src') || null;
  }

  // ----------------------------------
  // Resolve external hosts (EXTENSIBLE)
  // ----------------------------------
  async resolveExternal(url) {

    try {

      // ---- LULUSTREAM / LULUVDO ----
      if (url.includes('luluvdo') || url.includes('lulustream')) {

        const html = await this.safeFetch(url);

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

    // -----------------------------
    // 2. JWPlayer direct
    // -----------------------------
    if (!videoUrl) {
      videoUrl = this.extractJWPlayer(html);
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

    if (!meta.videoPageUrl) {
      return { streams: [] };
    }

    return {
      streams: [
        {
          name: "OnlyPorn Auto",
          title: "Universal Stream",
          url: meta.videoPageUrl,

          behaviorHints: {
            notWebReady: false,

            proxyHeaders: {
              request: {
                Referer: this.baseUrl,
                Origin: this.baseUrl,
                'User-Agent': DEFAULT_HEADERS['User-Agent'],
              }
            }
          }
        }
      ]
    };
  }
}

module.exports = SxyprnProvider.create;