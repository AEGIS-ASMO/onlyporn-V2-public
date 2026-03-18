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

    // 🔍 SEARCH + ORDER
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

    // 🔥 QUALITY FILTER (SAFE)
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

    // 🔥 Attempt old stream_data (fixed parsing)
    const regex = /stream_data\s*=\s*(\{[^;]+\})/;
    const match = scripts.match(regex);

    let streams = [];

    if (match) {
      try {
        let jsonString = match[1];

        // Fix invalid JSON keys
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

    // 🔥 Fallback: extract m3u8 / mp4 directly
    if (!streams.length) {
      const urls = scripts.match(/https?:\/\/[^"' ]+\.(m3u8|mp4)[^"' ]*/g);

      if (urls && urls.length) {
        streams = urls.map((u) => ({
          name: u.includes('m3u8') ? 'hls' : 'mp4',
          url: u,
          type: Provider.TYPE,
        }));

        logger.debug({ streams }, 'fallback streams');
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