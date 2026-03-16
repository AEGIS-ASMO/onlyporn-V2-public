require('dotenv').config();

const { load } = require('cheerio');
const logger = require('../logger');
const { meta } = require('../model');
const Provider = require('./provider');

const sortByMappings = {
  'Latest': 'latest',
  'Trending': 'trending',
  'Views': 'views',
  'Orgasmic': 'orgasmic',
};

/* ---------------- HELPERS ---------------- */

function digitSum(str) {
  return String(str)
    .replace(/\D/g, '')
    .split('')
    .reduce((a, b) => a + Number(b), 0);
}

function decryptSxyprnPath(path) {
  try {

    const parts = path.split('/');

    if (parts.length < 8) return null;

    const c = parseInt(parts[5]);
    const a = digitSum(parts[6]);
    const b = digitSum(parts[7]);

    parts[5] = String(c - (a + b));

    return 'https://www.sxyprn.com' + parts.join('/');

  } catch (e) {
    logger.error(e, 'Sxyprn decrypt failed');
    return null;
  }
}

/* ---------------- PROVIDER ---------------- */

class SxyprnProvider extends Provider {

  constructor() {
    super('https://www.sxyprn.com', 'sxyprn', 25);
  }

  static create() {
    return new SxyprnProvider();
  }

  getInitialUrl() {
    return this.baseUrl;
  }

  handleSearch({ extra: { search: keyword } }) {
    return `${this.baseUrl}/${encodeURIComponent(keyword)}.html`;
  }

  handleGenre({ extra: { genre } }) {

    if (genre.includes('/cat')) {
      return `${this.baseUrl}${genre}`;
    }

    let [category, sortBy] = genre.split('(');

    category = category.trim().replace(/\s+/g, '-');

    sortBy = sortByMappings[(sortBy || '').replace(')', '')] || 'latest';

    return `${this.baseUrl}/${category}.html?sm=${sortBy}`;
  }

  handlePagination(url, { extra: { skip } }) {

    const page = this.page(skip);

    if (url.includes('?')) {
      return `${url}&page=${page}`;
    }

    return `${url}?page=${page}`;
  }

  getCatalogMetas(html) {

    const metadataList = [];

    const $ = load(html);

    $('.post_el_small, .thumb').each((_, element) => {

      const $e = $(element);

      const title =
        $e.find('.post_text').text().trim() ||
        $e.find('img').attr('alt');

      const img = $e.find('img').first();

      const poster =
        img.attr('data-src') ||
        img.attr('data-original') ||
        img.attr('src');

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
          poster?.startsWith('http') ? poster : 'https:' + poster,
          { videoPageUrl },
        ),
      );
    });

    return metadataList;
  }

  async getMetadata(args) {

    logger.debug({ args }, 'getMetadata');

    const { id } = args;

    const html = await this.fetchHtml(id);

    return this.parseVideoPage({ id, html });
  }

  parseVideoPage({ id, html }) {

    const $ = load(html);

    const title =
      $('meta[property="og:title"]').attr('content');

    const poster =
      'https:' + $('meta[property="og:image"]').attr('content');

    const description =
      $('meta[property="og:description"]').attr('content');

    let videoUrl = null;

    /* ---------- METHOD 1: normal video tag ---------- */

    const videoTag = $('video source').attr('src');

    if (videoTag) {
      videoUrl = videoTag.startsWith('http')
        ? videoTag
        : 'https:' + videoTag;
    }

    /* ---------- METHOD 2: scripts ---------- */

    if (!videoUrl) {

      const scripts = $('script')
        .map((i, el) => $(el).html())
        .get()
        .join('\n');

      const match = scripts.match(/(https?:\/\/[^"]+\.mp4)/);

      if (match) videoUrl = match[1];
    }

    /* ---------- METHOD 3: Sxyprn CDN decrypt ---------- */

    if (!videoUrl) {

      const vidsnfo = $("span.vidsnfo").text();

      if (vidsnfo) {

        const buffer = vidsnfo.split(':');

        if (buffer.length > 1) {

          const encodedPath = buffer[1].trim();

          videoUrl = decryptSxyprnPath(encodedPath);
        }
      }
    }

    logger.debug({ videoUrl }, 'Sxyprn final video');

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

  async getStreams(meta) {

    if (!meta.videoPageUrl) {
      return { streams: [] };
    }

    return {
      streams: [
        {
          type: Provider.TYPE,
          url: meta.videoPageUrl,
          name: 'OnlyPorn HD',
        },
      ],
    };
  }
}

module.exports = SxyprnProvider.create;