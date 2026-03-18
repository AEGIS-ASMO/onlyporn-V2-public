const { load } = require('cheerio');
const logger = require('../logger');
const { meta } = require('../model');
const Provider = require('./provider');

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

      // 🔥 Detect block page
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

    // 🔍 SEARCH + ORDER
    if (order) {
      const searchUrl = this.handleSearch({
        extra: { search: keyword.trim() },
      });

      return searchUrl + `?o=${order.replace(')', '').toLowerCase()}`;
    }

    const path = pathMappings[keyword] || pathMappings.New;

    let url = `${this.baseUrl}${path}`;

    // 🔥 QUALITY FILTER
    if (quality) {
      const qualityMap = {
        '4k': 'uhd',
        '1080p': 'fhd',
        '720p': 'hd',
      };

      const q = qualityMap[quality];
      if (q) {
        url += `?q=${q}`;
      }
    }

    return url;
  }

  handlePagination(url, { extra: { skip } }) {
    const page = this.page(skip);

    // 🔥 Preserve query params
    if (url.includes('?')) {
      return `${url}&page=${page}`;
    }

    return `${url}?page=${page}`;
  }

  getCatalogMetas(html) {

    const metadataList = [];
    const $ = load(html);

    // 🔥 Robust selector (fixes empty catalog)
    const items = $('[data-id], .video-item, .video-list-item');

    items.each((index, element) => {

      const $e = $(element);

      const link = $e.find('a').attr('href');
      const img = $e.find('img');

      const poster =
        img.attr('data-src') ||
        img.attr('data-preview') ||
        img.attr('src');

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

  parseVideoPage({ html }) {

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

    // ⚠️ Old method (likely broken, kept as fallback)
    const regex = /stream_data\s*=\s*(\{[^;]+\})/;

    const match = scripts.match(regex);

    if (!match) {
      logger.warn('⚠️ No stream_data found');
      return {};
    }

    const streamsData = JSON.parse(match[1]);

    const streams = Object.entries(streamsData).map(([quality, url]) => ({
      name: quality,
      url,
      type: Provider.TYPE,
    }));

    logger.debug({ streams }, 'streams %d', streams.length);

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