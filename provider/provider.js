const axios = require('axios');
const m3u8 = require('m3u8-parser');
const logger = require('../logger');

class Provider {
  static LIMIT = 50;
  static TYPE = 'movie';
  static TRANSPORT_URL = '';

  constructor(baseUrl, name, limit) {
    this.baseUrl = baseUrl;
    this.name = name;
    this.limit = limit || Provider.LIMIT;
  }

  getName() {
    return this.name;
  }

  activate(catalogId) {
    return catalogId.indexOf(this.getName()) !== -1;
  }

  getInitialUrl() {
    return this.baseUrl;
  }

  static create() {
    return new Provider('', 'default');
  }

  normalizeUrl(url) {
    if (!url) return '';

    if (url.startsWith('http')) {
      return url;
    }

    if (url.startsWith('/')) {
      return this.baseUrl + url;
    }

    return `${this.baseUrl}/${url}`;
  }

  async fetchHtml(url) {
    const finalUrl = this.normalizeUrl(url);

    console.info('fetching url', finalUrl);

    try {
      const response = await axios.get(finalUrl, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
          Accept:
            'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          Connection: 'keep-alive',
          Referer: this.baseUrl,
        },
        timeout: 20000,
      });

      return response.data;
    } catch (error) {
      logger.error(error);
      return '';
    }
  }

  async fetchJson(url) {
    const finalUrl = this.normalizeUrl(url);

    try {
      const response = await axios.get(finalUrl, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
          Accept: 'application/json',
        },
        timeout: 20000,
      });

      return response.data;
    } catch (error) {
      logger.error(error);
      return null;
    }
  }

  async parseM3U8(url) {
    try {
      const response = await axios.get(url);

      const parser = new m3u8.Parser();
      parser.push(response.data);
      parser.end();

      return parser.manifest;
    } catch (err) {
      logger.error(err);
      return null;
    }
  }

  page(skip) {
    if (skip) {
      const page = Math.ceil((skip || 0) / this.limit);
      return page === 0 ? '' : `${page}`;
    }
    return '';
  }

  handleSearch({ extra: { search } }) {
    return `/search/${search}/`;
  }

  handleGenre({ extra: { genre } }) {
    return `?genre=${genre}`;
  }

  handlePagination(url, { extra: { skip } }) {
    return `${url}?skip=${skip}`;
  }

  buildStream(url, label) {
    const finalUrl = url.startsWith('http') ? url : this.normalizeUrl(url);

    return {
      title: label || this.name,
      url: finalUrl,
    };
  }

  getCatalogMetas() {
    return [];
  }

  async handleCatalog(args) {
    if (args.type !== Provider.TYPE || !this.activate(args.id)) {
      return null;
    }

    try {
      logger.info({ args }, 'handleCatalog');

      let url = this.getInitialUrl(args.id);

      if (args.extra) {
        if (args.extra.search) {
          url = this.handleSearch(args);
        }

        if (args.extra.genre) {
          url = this.handleGenre(args);
        }

        if (args.extra.skip) {
          url = this.handlePagination(url, args);
        }
      }

      const html = await this.fetchHtml(url);

      if (!html) {
        return { metas: [] };
      }

      const metas = this.getCatalogMetas(html) || [];

      return { metas };
    } catch (error) {
      logger.error(error);
      return { metas: [] };
    }
  }
}

module.exports = Provider;