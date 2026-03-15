const axios = require('axios');
const { wrapper } = require('axios-cookiejar-support');
const { CookieJar } = require('tough-cookie');

const jar = new CookieJar();
const client = wrapper(axios.create({ jar }));
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

  async fetchHtml(url) {
  console.info('fetching url', url);

  try {
    const response = await client.get(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122 Safari/537.36",
        "Accept":
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": this.baseUrl,
        "Origin": this.baseUrl,
        "Connection": "keep-alive"
      },
      timeout: 15000
    });

    return response.data;

  } catch (error) {
    console.error(error);
    return '';
  }
}

async fetchJson(url) {

  try {
    const response = await client.get(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122 Safari/537.36",
        "Accept": "application/json, text/plain, */*",
        "Referer": this.baseUrl
      },
      timeout: 15000
    });

    return response.data;

  } catch (error) {
    console.error("fetchJson error", error);
    return null;
  }
}

  cleanUrl(url) {
    if (!url) return url;

    return url
      .replace(/\\\//g, '/')
      .replace(/\\u0026/g, '&')
      .replace(/&amp;/g, '&');
  }

  page(skip) {
    if (skip) {
      const page = Math.ceil((skip || 0) / this.limit);
      if (page === 0) return '';
      return `${page}`;
    }
    return '';
  }

  handleSearch({ extra: { search: keyword } }) {
    return `/search/${keyword}/`;
  }

  handleGenre({ extra: { genre } }) {
    return '?genre=' + genre;
  }

  handlePagination(url, { extra: { skip } }) {
    return `?skip=${skip}`;
  }

  getCatalogMetas() {
    return [];
  }

  getAnalyticEvent(event, id) {
    if (id) return `${event}-${id}`;
    return `${event}-${this.getName()}`;
  }

  async handleCatalog(args) {
    if (args.type === Provider.TYPE && this.activate(args.id)) {

      logger.info({ args }, 'handleCatalog');

      let url = this.getInitialUrl(args.id);

      if (args.extra) {

        if (args.extra.search) {
          url = this.handleSearch(args);
        }

        if (args.extra.genre) {
          url = this.handleGenre(args);
        }

      }

      if (args.extra.skip) {
        url += this.handlePagination(url, args);
      }

      const html = await this.fetchHtml(url).catch(() => '');
      const metas = this.getCatalogMetas(html);

      logger.debug({ metasSize: metas.length }, 'catalog');

      return { metas };
    }

    return { metas: [] };
  }

  async handleMeta(args) {

    if (args.type === Provider.TYPE && this.activate(args.id)) {
      const meta = await this.getMetadata(args);
      return { meta };
    }

    return { meta: {} };
  }

  async getMetadata(args) {

    logger.info({ args }, 'getMetadata');

    const { id } = args;

    const result = await this.fetchHtml(id)
      .then(html => this.parseVideoPage({ id, html }));

    if (result && result.metaResponse) {
      return result.metaResponse;
    }

    return result;
  }

  async handleStream(args) {

    const { id } = args;

    if (args.type === Provider.TYPE && this.activate(id)) {

      logger.info({ args }, 'handleStream');

      return this.processStreams(args);
    }

    return { streams: [] };
  }

  async processStreams({ id }) {

    const html = await this.fetchHtml(id);

    const hls = html.match(/https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*/i);
    if (hls) {
      return this.getStreams({ videoPageUrl: this.cleanUrl(hls[0]) });
    }

    const dash = html.match(/https?:\/\/[^\s"'<>]+\.mpd[^\s"'<>]*/i);
    if (dash) {
      return {
        streams: [{
          type: 'movie',
          url: this.cleanUrl(dash[0]),
          name: 'DASH'
        }]
      };
    }

    const mp4 = html.match(/https?:\/\/[^\s"'<>]+\.mp4[^\s"'<>]*/i);
    if (mp4) {
      return {
        streams: [{
          type: 'movie',
          url: this.cleanUrl(mp4[0]),
          name: 'HD'
        }]
      };
    }

    const meta = await this.parseVideoPage({ id, html });

    return this.getStreams(meta);
  }

  getStreams(meta) {

    if (!meta.videoPageUrl) {
      return Promise.resolve({ streams: [] });
    }

    if (/\.mp4(\?|$)/i.test(meta.videoPageUrl) || /\.m3u8(\?|$)/i.test(meta.videoPageUrl)) {
  return Promise.resolve({
    streams: [{
      type: 'movie',
      url: meta.videoPageUrl,
      name: 'HD'
    }]
  });
}

    return this.fetchHtml(meta.videoPageUrl)

      .then(content => {

        if (content.includes("#EXTM3U")) {
          return this.parseM3u8(content);
        }

        return [];

      })

      .then(streams =>
        streams.map(stream =>
          this.transformStream(meta.videoPageUrl, stream)
        )
      )

      .then(streams => ({ streams }));
  }

  transformStream(baseUrl, stream) {

    if (!stream.url) return stream;

    if (stream.url.startsWith('http')) {
      return stream;
    }

    const base = baseUrl.substring(0, baseUrl.lastIndexOf('/') + 1);

    return {
      ...stream,
      url: base + stream.url
    };
  }

  parseM3u8(content) {

    const streams = [];

    const parser = new m3u8.Parser();

    parser.push(content);
    parser.end();

    try {

      parser.manifest.playlists.forEach(playlist => {

        const height =
          playlist.attributes?.RESOLUTION?.height || 'auto';

        streams.push({
          resolution: height + 'p',
          url: playlist.uri
        });

      });

      streams.sort(
        (a, b) =>
          parseInt(b.resolution) -
          parseInt(a.resolution)
      );

      logger.debug({ streams }, 'streams', streams.length);

      return streams.map(stream => ({
        type: 'movie',
        url: stream.url,
        name: stream.resolution
      }));

    } catch (e) {

      console.error('parseM3u8 error', e);

      return streams;
    }
  }

  parseVideoPage() {
    return {};
  }

  track() {}

}

module.exports = Provider;