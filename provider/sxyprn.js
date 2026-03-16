require('dotenv').config();

const axios = require('axios');
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

    return this.fetchHtml(id)
      .then(html => this.parseVideoPage({ id, html }));
  }

  parseVideoPage({ id, html }) {

    const $ = load(html);

    const title =
      $('meta[property="og:title"]').attr('content');

    const poster =
      'https:' + $('meta[property="og:image"]').attr('content');

    const description =
      $('meta[property="og:description"]').attr('content');

    let embedUrl = null;

    // look for iframe embeds
    $('iframe').each((i, el) => {
      const src = $(el).attr('src');
      if (src && src.includes('luluvdo')) {
        embedUrl = src;
      }
    });

    return new meta.MetaResponse(
      id,
      Provider.TYPE,
      title,
      {
        description,
        poster,
        background: poster,
        videoPageUrl: embedUrl || id,
      },
    );
  }

  /*
  ----------------------------------------------------
  LULUSTREAM RESOLVER
  ----------------------------------------------------
  */

  async resolveLuluStream(url) {

    try {

      logger.debug({ url }, 'Resolving LuluStream');

      const res = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0',
          'Referer': url
        }
      });

      const html = res.data;

      const match = html.match(/file:"(https?:\/\/[^"]+\.m3u8[^"]*)"/);

      if (match) {
        return match[1];
      }

      return null;

    } catch (err) {

      logger.error(err, 'LuluStream resolver failed');
      return null;

    }
  }

  /*
  ----------------------------------------------------
  STREAM FETCHER
  ----------------------------------------------------
  */

  async getStreams(meta) {

    if (!meta.videoPageUrl) {
      return { streams: [] };
    }

    let streamUrl = null;

    try {

      const embedUrl = meta.videoPageUrl;

      // resolve lulustream
      if (embedUrl.includes('luluvdo') || embedUrl.includes('lulustream')) {

        streamUrl = await this.resolveLuluStream(embedUrl);

      }

      // fallback direct mp4 detection
      if (!streamUrl) {

        const res = await axios.get(embedUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0'
          }
        });

        const html = res.data;

        const mp4 = html.match(/https?:\/\/[^"]+\.mp4/);

        if (mp4) {
          streamUrl = mp4[0];
        }

      }

    } catch (err) {

      logger.error(err, 'Stream resolver failed');

    }

    if (!streamUrl) {
      return { streams: [] };
    }

    return {
      streams: [
        {
          type: Provider.TYPE,
          url: streamUrl,
          name: 'Sxyprn HD',
        },
      ],
    };
  }
}

module.exports = SxyprnProvider.create;