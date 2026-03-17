require('dotenv').config();

const { load } = require('cheerio');
const logger = require('../logger');
const { meta } = require('../model');
const Provider = require('./provider');

const DEFAULT_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
  'Accept':
    'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Connection': 'keep-alive',
};

class SxyprnProvider extends Provider {

  constructor() {
    super('https://www.sxyprn.com', 'sxyprn', 25);
  }

  static create() {
    return new SxyprnProvider();
  }

  // ----------------------------------
  // Helpers
  // ----------------------------------

  isBlocked(html) {
    if (!html) return true;
    return (
      html.includes('cf-browser') ||
      html.includes('Just a moment') ||
      html.includes('cf-ray')
    );
  }

  extractJWPlayer(html) {
    const $ = load(html);

    const scripts = $('script')
      .map((_, el) => $(el).html())
      .get()
      .join('\n');

    if (!scripts) return null;

    let match = scripts.match(/sources:\s*\[\s*{[^}]*file:\s*"(https?:\/\/[^"]+)"/);
    if (match) return match[1];

    match = scripts.match(/file:\s*["'](https?:\/\/[^"']+)["']/);
    if (match) return match[1];

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

  // ✅ FIX 1: Skip ad iframes
  extractIframe(html) {
    const $ = load(html);

    let iframe = null;

    $('iframe').each((_, el) => {
      const src = $(el).attr('src');
      if (!src) return;

      // 🚫 block ads
      if (
        src.includes('adtng') ||
        src.includes('ads') ||
        src.includes('promo')
      ) {
        return;
      }

      iframe = src;
      return false; // break loop
    });

    if (!iframe) return null;

    if (iframe.startsWith('//')) iframe = 'https:' + iframe;
    if (iframe.startsWith('/')) iframe = this.baseUrl + iframe;

    return iframe;
  }

  // ----------------------------------
  // External resolvers
  // ----------------------------------

  async resolveExternal(url) {
    try {

      const html = await this.fetchHtml(url);
      if (this.isBlocked(html)) return null;

      let stream = this.extractJWPlayer(html);
      if (stream) return stream;

      stream = this.extractHTMLVideo(html);
      if (stream) return stream;

      const iframe = this.extractIframe(html);
      if (iframe && iframe !== url) {
        return await this.resolveExternal(iframe);
      }

      if (url.includes('mixdrop')) {
        const match = html?.match(/MDCore\.wurl="([^"]+)"/);
        if (match) return match[1];
      }

      if (url.includes('streamtape')) {
        const match = html?.match(/robotlink'\)\.innerHTML = '(.*?)'/);
        if (match) return `https:${match[1]}`;
      }

    } catch (err) {
      logger.error({ url, err }, 'resolveExternal failed');
    }

    return null;
  }

  // ----------------------------------
  // Metadata
  // ----------------------------------

  async getMetadata({ id }) {
    const html = await this.fetchHtml(id);

    if (this.isBlocked(html)) {
      logger.error("🚫 Cloudflare blocked main page");
      return null;
    }

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

    // ✅ FIX 2: trafficdeposit FIRST (primary source)
    const mgfs = $('#player_el').attr('data-mgfs');
    const thumb = poster || '';

    const hashMatch = thumb.match(/\/img\/([^/]+)\//);
    const hash = hashMatch ? hashMatch[1] : null;

    logger.info({
      hasMGFS: !!mgfs,
      poster
    }, "TRAFFICDEPOSIT CHECK"); // ✅ DEBUG

    if (mgfs && hash) {
      const cdnMatch = thumb.match(/\/\/(b\d+)\.trafficdeposit/);
      const cdn = cdnMatch ? cdnMatch[1] : 'b1';

      videoUrl = `https://${cdn}.trafficdeposit.com/hls/${hash}/${mgfs}/master.m3u8`;
    }

    // 2. JWPlayer
    if (!videoUrl) {
      videoUrl = this.extractJWPlayer(html);
    }

    // 3. HTML5
    if (!videoUrl) {
      videoUrl = this.extractHTMLVideo(html);
    }

    // 4. JSON fallback
    if (!videoUrl) {
      const match = html.match(/"file":"(https:[^"]+\.m3u8[^"]*)"/);
      if (match) {
        videoUrl = match[1].replace(/\\u0026/g, '&');
      }
    }

    // ✅ FIX 3: EMBED as fallback + safe 404 handling
    if (!videoUrl) {
      const idMatch = id.match(/post\/([^.]+)/);

      if (idMatch) {
        const embedUrl = `${this.baseUrl}/embed/${idMatch[1]}`;

        logger.info({ embedUrl }, "TRYING EMBED");

        let embedHtml = '';

        try {
          embedHtml = await this.fetchHtml(embedUrl);
        } catch (e) {
          logger.warn("Embed failed (404 expected)");
        }

        if (embedHtml && !this.isBlocked(embedHtml)) {
          videoUrl =
            this.extractJWPlayer(embedHtml) ||
            this.extractHTMLVideo(embedHtml);
        }
      }
    }

    // 6. iframe
    if (!videoUrl) {
      const iframe = this.extractIframe(html);
      if (iframe) {
        videoUrl = await this.resolveExternal(iframe);
      }
    }

    if (videoUrl?.startsWith('//')) {
      videoUrl = 'https:' + videoUrl;
    }

    logger.info({ videoUrl }, "FINAL EXTRACTED");

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
  // Streams
  // ----------------------------------

  async getStreams(meta) {

    if (!meta.videoPageUrl) {
      return { streams: [] };
    }

    const url = meta.videoPageUrl;
    const isHls = url.includes('.m3u8');

    return {
      streams: [
        {
          name: "OnlyPorn Ultra",
          title: "Direct Stream",
          url,
          type: isHls ? "hls" : undefined,
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