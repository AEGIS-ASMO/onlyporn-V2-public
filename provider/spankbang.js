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

  handleGenre({ extra: { genre } }) {

    const [keyword, order] = genre.split('(');

    if (order) {
      const searchUrl = this.handleSearch({
        extra: { search: keyword.trim() },
      });

      return searchUrl + `?o=${order.replace(')', '').toLowerCase()}`;
    }

    const path = pathMappings[keyword] || pathMappings.New;

    return `${this.baseUrl}${path}`;
  }

  handlePagination(url, { extra: { skip } }) {
    const page = this.page(skip);
    return `${url.replace(/\/$/, '')}/${page}/`;
  }

  getCatalogMetas(html) {

    const metadataList = [];
    const $ = load(html);

    $('div.video-item').each((index, element) => {

      const $e = $(element);

      const id = $e.attr('data-id');

      const $first = $e.children().first();

      const $imgNode = $first.find('img');

      const poster =
        $imgNode.attr('data-src') ||
        $imgNode.attr('src') ||
        $imgNode.attr('data-preview');

      const title = $imgNode.attr('alt');

      const videoPageUrl = this.baseUrl + $first.attr('href');

      if (!id || !title) return;

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

    const regex = /stream_data\s*=\s*(\{[^;]+\})/;

    const match = scripts.match(regex);

    if (!match) {
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