const { load } = require('cheerio');
const logger = require('../logger');
const { meta } = require('../model');
const Provider = require('./provider');

class XvideosProvider extends Provider {

  constructor() {
    super('https://www.xvideos.com', 'xvideos', 50);
  }

  static create() {
    return new XvideosProvider();
  }

  async fetchHtml(url) {
  console.info('fetching url', url);
  return super.fetchHtml(url);
}

  getInitialUrl() {
    return this.baseUrl;
  }

  handleSearch({ extra: { search: keyword } }) {
    return `${this.baseUrl}/?k=${encodeURIComponent(keyword)}`;
  }

  handleGenre(args) {
    return this.handleSearch({ ...args, extra: { search: args.extra.genre } });
  }

  handlePagination(url, { extra: { skip, search } }) {

  const prefix = url.includes('?') ? '&' : '?';

  if (search) {
    return `${url}${prefix}p=${Math.floor(skip / 25)}`;
  }

  return `${url}${prefix}p=${this.page(skip)}`;
}

  const prefix = url.includes('?') ? '&' : '?';

  return `${url}${prefix}p=${this.page(skip)}`;
}

  getCatalogMetas(html) {
    const metadatas = [];
    const $ = load(html);

    $('div.thumb-block').each((index, element) => {
      const $div = $(element);
      const $children = $div.children('div');

      let parsedMeta = {};

      if ($children.hasClass('thumb-inside')) {
        const attributes = {};
        $children.first().find('*').each((i, el) => {
          const attrs = el.attribs;
          for (const attr in attrs) {
            attributes[attr] = attrs[attr];
          }
        });

        parsedMeta = { ...attributes };
      }

      if ($children.hasClass('thumb-under')) {
        const title = $children.last().find('p > a').attr('title');
        parsedMeta = { ...parsedMeta, title };
      }

      if (parsedMeta['href']) {
  const id = new URL(parsedMeta['href'], this.baseUrl).href;

  metadatas.push(
    new meta.MetaPreview(
      id.replace('/THUMBNUM', ''),
      Provider.TYPE,
      parsedMeta['title'],
      parsedMeta['data-src'] || parsedMeta['data-original'] || parsedMeta['src']
    )
  );
}
    });

    return metadatas;
  }

  async getMetadata(args) {
    return super.getMetadata(args).then(meta => meta.metaResponse);
  }

  parseVideoPage({ id, html }) {

    const $ = load(html);

    const links = [];
    $('div.video-tags > a').each((i, e) => {
      const $tag = $(e);

      links.push(
        new meta.MetaLink(
          $tag.text(),
          'Genre',
          this.baseUrl + $tag.attr('href')
        )
      );
    });

    const regexVideoHLS = /html5player\.setVideoHLS\(['"]([^'"]+)['"]\)/;
    const regexVideoHigh = /html5player\.setVideoUrlHigh\(['"]([^'"]+)['"]\)/;
    const regexVideoLow = /html5player\.setVideoUrlLow\(['"]([^'"]+)['"]\)/;
    const regexThumbnail = /html5player\.setThumbUrl169\(['"]([^'"]+)['"]\)/;

    let videoPageUrl = '';
    let background = '';

    let match = html.match(regexVideoHLS);
    if (match && match[1]) {
  videoPageUrl = match[1].replace(/\\\//g, '/');
}

    if (!videoPageUrl) {
      match = html.match(regexVideoHigh);
      if (match && match[1]) {
  videoPageUrl = match[1].replace(/\\\//g, '/');
}
    }

    if (!videoPageUrl) {
      match = html.match(regexVideoLow);
      if (match && match[1]) {
  videoPageUrl = match[1].replace(/\\\//g, '/');
}
    }

    match = html.match(regexThumbnail);
    if (match && match[1]) {
      background = match[1].replace(/\\\//g, '/');
    }

    const metaMap = {};
    $('meta').each((i, e) => {
      const attribs = e.attribs;
      metaMap[attribs.name || attribs.property] = attribs.content;
    });

    const genres =
      metaMap['keywords'] ?
      metaMap['keywords'].split(',').map(g => g.trim()) :
      [];

    const metaResponse = new meta.MetaResponse(
      id,
      Provider.TYPE,
      metaMap['og:title'] || 'XVideos Video',
      {
        links,
        description: metaMap['description'],
        background,
        genres
      }
    );

logger.debug({ videoPageUrl }, 'XVideos extracted video URL');

    return {
      metaResponse,
      videoPageUrl
    };
  }

  async processStreams({ id }) {

  const html = await this.fetchHtml(id);

  const metaData = this.parseVideoPage({ id, html });

  logger.debug({ videoPageUrl: metaData.videoPageUrl }, 'XVideos stream source');

  let streamsResponse = await super.getStreams(metaData);

  if (streamsResponse?.streams?.length) {
    return streamsResponse;
  }

  const $ = load(html);
  let streams = [];

  try {
    const json = JSON.parse(
      $('script[type="application/ld+json"]').first().text()
    );

    if (json && json.contentUrl) {
      streams.push({
        type: 'movie',
        url: json.contentUrl,
        name: 'Onlyporn'
      });
    }

  } catch (e) {
    logger.warn('ld+json parse failed');
  }

  return { streams };
}

  transformStream(url, stream) {
    return {
      ...stream,
      url: url.includes('hls.m3u8')
        ? url
        : url.replace('hls.m3u8', '') + stream.url
    };
  }
}

module.exports = XvideosProvider.create;