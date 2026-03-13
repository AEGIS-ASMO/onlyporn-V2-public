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

  activate(id) {
    return id.startsWith(this.baseUrl);
  }

  page(skip) {
    return Math.floor(skip / this.limit) + 1;
  }

  async fetchHtml(url, referer = null) {
    logger.info('fetching url', url);

    try {
      const response = await axios.get(url, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml',
          Referer: referer || this.baseUrl,
        },
        timeout: 15000,
      });

      return response.data;
    } catch (error) {
      console.error(error);
      return '';
    }
  }

  async handleCatalog(args) {
    if (args.type === Provider.TYPE && this.activate(args.id)) {
      logger.info({ args }, 'handleCatalog');

      let url = this.getInitialUrl(args.id);

      if (args.extra) {
        if (args.extra.search) url = this.handleSearch(args);
        if (args.extra.genre) url = this.handleGenre(args);
        if (args.extra.skip) url += this.handleSkip(url, args.extra.skip);
      }

      const html = await this.fetchHtml(url).catch(() => '');
      const metas = this.getCatalogMetas(html);

      logger.debug({ metasSize: metas.length }, 'catalog');
      return Promise.resolve({ metas });
    }

    return Promise.resolve({ metas: [] });
  }

  async handleMeta(args) {
    if (args.type === Provider.TYPE && this.activate(args.id)) {
      return this.getMetadata(args).then(meta => {
        return { meta };
      });
    }

    return Promise.resolve({ meta: {} });
  }

  async getMetadata(args) {
    logger.info({ args }, 'getMetadata');

    const { id } = args;

    return this.fetchHtml(id, id).then(html =>
      this.parseVideoPage({ id, html })
    );
  }

  async handleStream(args) {
    const { id } = args;

    if (args.type === Provider.TYPE && this.activate(id)) {
      logger.info({ args }, 'handleStream');
      return this.processStreams(args);
    }

    return Promise.resolve({ streams: [] });
  }

  async getStreams(meta) {
    return this.fetchHtml(meta.videoPageUrl, meta.videoPageUrl)
      .then(content => this.parseM3u8(content))
      .then(streams =>
        streams.map(stream =>
          this.transformStream(meta.videoPageUrl, stream)
        )
      )
      .then(streams => {
        return { streams };
      });
  }

  parseM3u8(content) {
    const streams = [];

    const parser = new m3u8.Parser();
    parser.push(content);
    parser.end();

    try {
      parser.manifest.playlists.forEach(playlist => {
        streams.push({
          url: playlist.uri,
          resolution: playlist.attributes.RESOLUTION.height + 'p',
        });
      });

      streams.sort(
        (a, b) =>
          parseInt(b.resolution) - parseInt(a.resolution)
      );

      return streams.map(stream => {
        return {
          type: 'movie',
          name: this.name + ' ' + stream.resolution,
          url: stream.url,
        };
      });
    } catch (err) {
      logger.error(err);
      return [];
    }
  }

  transformStream(url, stream) {
    return {
      ...stream,
      url: url.replace('hls.m3u8', '') + stream.url,
    };
  }
}

module.exports = Provider;