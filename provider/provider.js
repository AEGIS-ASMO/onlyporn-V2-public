const axios = require('axios');
const m3u8 = require('m3u8-parser');
const logger = require('../logger');

class Provider {
  static LIMIT = 50;
  static TYPE = 'movie';

  constructor(baseUrl, name, limit) {
    this.baseUrl = baseUrl;
    this.name = name;
    this.limit = limit || Provider.LIMIT;
  }

  getName() {
    return this.name;
  }

  activate(catalogId) {
    return catalogId && catalogId.indexOf(this.getName()) !== -1;
  }

  normalizeUrl(url) {
    if (!url) return '';

    if (url.startsWith('http')) return url;

    if (url.startsWith('/')) return this.baseUrl + url;

    return `${this.baseUrl}/${url}`;
  }

  async fetchHtml(url) {
    const finalUrl = this.normalizeUrl(url);

    console.log('fetching url', finalUrl);

    try {
      const response = await axios.get(finalUrl, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
          Accept:
            'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          Referer: this.baseUrl,
        },
        timeout: 20000,
      });

      return response.data;
    } catch (err) {
      logger.error(err);
      return '';
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

  buildStream(url, label) {
    const finalUrl = url.startsWith('http')
      ? url
      : this.normalizeUrl(url);

    return {
      title: label || this.name,
      url: finalUrl,
    };
  }

  /*
  =========================
  CATALOG
  =========================
  */

  async handleCatalog(args) {
    if (args.type !== Provider.TYPE || !this.activate(args.id)) {
      return null;
    }

    try {
      const html = await this.fetchHtml(this.baseUrl);

      if (!html) return { metas: [] };

      const metas = this.getCatalogMetas(html) || [];

      return { metas };
    } catch (err) {
      logger.error(err);
      return { metas: [] };
    }
  }

  /*
  =========================
  META
  =========================
  */

  async handleMeta(args) {
    if (!this.activate(args.id)) return null;

    try {
      const html = await this.fetchHtml(args.id);

      if (!html) return { meta: {} };

      const meta = await this.getMeta(html, args);

      return { meta };
    } catch (err) {
      logger.error(err);
      return { meta: {} };
    }
  }

  /*
  =========================
  STREAM
  =========================
  */

  async handleStream(args) {
    if (!this.activate(args.id)) return null;

    try {
      const streams = await this.getStreams(args);

      if (!streams) return { streams: [] };

      return { streams };
    } catch (err) {
      logger.error(err);
      return { streams: [] };
    }
  }

  /*
  =========================
  PROVIDER METHODS
  (overridden by each site)
  =========================
  */

  getCatalogMetas() {
    return [];
  }

  async getMeta() {
    return {};
  }

  async getStreams() {
    return [];
  }
}

module.exports = Provider;