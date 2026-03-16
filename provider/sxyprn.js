require('dotenv').config();

const { load } = require('cheerio');
const logger = require('../logger');
const { meta } = require('../model');
const Provider = require('./provider');

const sortByMappings = {
  Latest: 'latest',
  Trending: 'trending',
  Views: 'views',
  Orgasmic: 'orgasmic',
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

    if (url.startsWith(this.baseUrl)) {
      url = url.replace(this.baseUrl, '');
    }

    if (!url.startsWith('/')) {
      url = '/' + url;
    }

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
          Provider.TYPE,
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

    let externalUrl = null;

    const ext = $('a.extlink[href]').first().attr('href');

    if (ext) externalUrl = ext;

    if (!externalUrl) {
      const textarea = $('textarea.PostEditTA').text();
      const match = textarea.match(/https?:\/\/[^\s]+/);
      if (match) externalUrl = match[0];
    }

    logger.debug({ externalUrl }, 'Sxyprn external host');

    return new meta.MetaResponse(
      id,
      Provider.TYPE,
      title,
      {
        description,
        poster,
        background: poster,
        videoPageUrl: externalUrl,
      },
    );
  }

  async getStreams(meta) {

    if (!meta.videoPageUrl) {
      return { streams: [] };
    }

    let url = meta.videoPageUrl;

    try {

      /* ---------------- LULUSTREAM ---------------- */

      if (url.includes('luluvdo') || url.includes('lulustream')) {

        const idMatch = url.match(/\/([a-z0-9]+)$/i);

        if (idMatch) {

          const embedUrl = `https://luluvdo.com/e/${idMatch[1]}`;

          const html = await this.fetchHtml(embedUrl);

          const match = html.match(/file:\s*"([^"]+\.mp4[^"]*)"/);

          if (match) {

            return {
              streams: [{
                type: Provider.TYPE,
                url: match[1],
                name: 'Lulustream',
              }],
            };

          }
        }
      }

      /* ---------------- STREAMTAPE ---------------- */

      if (url.includes('streamtape')) {

        const html = await this.fetchHtml(url);

        const match = html.match(/robotlink'\)\.innerHTML = '(.*)'/);

        if (match) {

          const video = 'https:' + match[1].split("'")[0];

          return {
            streams: [{
              type: Provider.TYPE,
              url: video,
              name: 'Streamtape',
            }],
          };

        }
      }

      /* ---------------- DOODSTREAM ---------------- */

      if (url.includes('dood')) {

        const html = await this.fetchHtml(url);

        const match = html.match(/pass_md5\/(.*?)'/);

        if (match) {

          const pass = `https://doodstream.com/pass_md5/${match[1]}`;

          const token = await this.fetchHtml(pass);

          const video = token + '123456789';

          return {
            streams: [{
              type: Provider.TYPE,
              url: video,
              name: 'DoodStream',
            }],
          };

        }
      }

      /* ---------------- FILEMOON ---------------- */

      if (url.includes('filemoon')) {

        const html = await this.fetchHtml(url);

        const match = html.match(/file:"([^"]+)"/);

        if (match) {

          return {
            streams: [{
              type: Provider.TYPE,
              url: match[1],
              name: 'Filemoon',
            }],
          };

        }
      }

    } catch (err) {
      logger.error(err, 'Host resolver failed');
    }

    return {
      streams: [{
        type: Provider.TYPE,
        url,
        name: 'External Host',
      }],
    };
  }
}

module.exports = SxyprnProvider.create;