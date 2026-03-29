require('dotenv').config();
const { load } = require('cheerio');
const logger = require('../logger');
const { meta } = require('../model');
const Provider = require('./provider');
const htmlCache = new Map();
const inFlight = new Map();
const HTML_TTL = 1000 * 60 * 5;

const sortByMappings = {
  'Latest': 'latest',
  'Trending': 'trending',
  'Views': 'views',
  'Rating': 'rating',
  'Orgasmic': 'orgasmic',
};

class SxyprnProvider extends Provider {
  constructor() {
    super('https://www.sxyprn.com', 'sxyprn', 20);
  }

  static create() {
    return new SxyprnProvider();
  }

  async fetchHtml(url) {
    if (inFlight.has(url)) return inFlight.get(url);

    const promise = (async () => {
      const cached = htmlCache.get(url);

      if (cached && Date.now() - cached.time < HTML_TTL) {
        return cached.data;
      }

      const html = await super.fetchHtml(url);

      htmlCache.set(url, {
        data: html,
        time: Date.now()
      });

      return html;
    })();

    inFlight.set(url, promise);

    try {
      return await promise;
    } finally {
      inFlight.delete(url);
    }
  }

  getInitialUrl() {
    return `${this.baseUrl}/blog/all/0.html?sm=latest`;
  }

  handleSearch({ extra: { search: keyword } }) {
    return `${this.baseUrl}/blog/all/0.html?search=${encodeURIComponent(keyword)}`;
  }

  handleGenre({ extra: { genre } }) {
    if (!genre) return this.getInitialUrl();

    let [category, sortBy] = genre.split('(');

    category = category.trim().replace(/\s+/g, '-');
    sortBy = sortByMappings[(sortBy || '').replace(')', '')] || 'latest';

    return `${this.baseUrl}/${category}.html?sm=${sortBy}`;
  }

  handlePagination(url, { extra: { skip } }) {
    const page = this.page(skip);

    if (!page || page === '1') return url;

    try {
      const u = new URL(url);
      const offset = (page - 1) * 20;
      u.pathname = u.pathname.replace(/\/\d+\.html$/, `/${offset}.html`);
      return u.toString();
    } catch (e) {
      return url;
    }
  }

  getCatalogMetas(html) {
    const metadataList = [];
    const $ = load(html);

    $('div.post_el_small').each((_, element) => {
      const $e = $(element);

      const title = $e.find('.post_text').text().trim();

      const img = $e.find('img').first();

      let poster =
        img.attr('data-src') ||
        img.attr('data-original') ||
        img.attr('src');

      if (poster && poster.startsWith('//')) {
        poster = 'https:' + poster;
      }

      const path = $e.find('.js-pop').attr('href');
      if (!path) return;

      const videoPageUrl = this.baseUrl + path;

      metadataList.push(
        new meta.MetaPreview(
          videoPageUrl,
          'movie',
          title,
          poster,
          { videoPageUrl }
        )
      );
    });

    return metadataList;
  }

  async getMetadata(args) {
    logger.debug({ args }, 'getMetadata');
    const { id } = args;
    return this.fetchHtml(id).then((html) =>
      this.parseVideoPage({ id, html })
    );
  }

  /* =========================
     🔥 NEW: REAL STREAM FETCH
  ========================= */
  async fetchRealStream(id) {
    try {
      const pidMatch = id.match(/post\/([a-z0-9]+)\.html/i);
      if (!pidMatch) return null;

      const pid = pidMatch[1];

      const body = new URLSearchParams({
        pid,
        aid: '5f3950a938042',
        ut: Math.floor(Date.now() / 1000),
        cipid: Math.random().toString(36).substring(2)
      });

      const res = await fetch(`${this.baseUrl}/php/cjs.php`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'X-Requested-With': 'XMLHttpRequest',
          'Referer': id,
          'User-Agent': 'Mozilla/5.0'
        },
        body: body.toString()
      });

      const text = await res.text();

      const match = text.match(/https?:\/\/[^"]+\.mp4/);

      if (match) return match[0];

    } catch (err) {
      logger.warn('Sxyprn fetchRealStream failed');
    }

    return null;
  }

  /* =========================
     🔥 PARSE PAGE (light)
  ========================= */
  parseVideoPage({ id, html }) {
    const $ = load(html);

    const metaMap = {};
    $('meta').each((_, e) => {
      const a = e.attribs;
      metaMap[a.name || a.property] = a.content;
    });

    let poster = metaMap['og:image'];
    if (poster && poster.startsWith('//')) {
      poster = 'https:' + poster;
    }

    const description = metaMap['og:description'];

    return new meta.MetaResponse(
      id,
      Provider.TYPE,
      metaMap['og:title'],
      {
        description,
        poster,
        background: poster,
        videoPageUrl: null // 🔥 don't trust old extractor
      }
    );
  }

  /* =========================
     🔥 STREAMS (REAL FIX)
  ========================= */
  async getStreams(meta) {

    let streamUrl = meta.videoPageUrl;

    // ✅ MAIN: API fetch
    if (!streamUrl) {
      streamUrl = await this.fetchRealStream(meta.id);
    }

    // ❌ if still nothing → fail cleanly
    if (!streamUrl) {
      throw new Error('No stream found');
    }

    return {
      streams: [
        {
          type: Provider.TYPE,
          url: streamUrl,
          headers: {
            Referer: meta.id, // 🔥 CRITICAL
            Origin: this.baseUrl,
            'User-Agent': 'Mozilla/5.0'
          },
          name: 'Sxyprn HD',
        },
      ],
    };
  }
}

module.exports = SxyprnProvider.create;