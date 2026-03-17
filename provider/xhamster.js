const { load } = require('cheerio');
const logger = require('../logger');
const { meta } = require('../model');
const Provider = require('./provider');

const pathMappings = {
  'Best (Daily)': '/best/daily',
  'Best (Weekly)': '/best/weekly',
  'Best (Monthly)': '/best/monthly',
};

class XhamsterProvider extends Provider {

  constructor() {
    super('https://xhamster.com', 'xhamster', 45);
  }

  static create() {
    return new XhamsterProvider();
  }

  getInitialUrl(catalogId) {

    let url = this.baseUrl;

    if (catalogId.includes('4k')) {
      url += '/4k';
    }

    return url + '/newest';
  }

  handleSearch({ extra: { search: keyword } }) {

    return `${this.baseUrl}/search/${encodeURIComponent(keyword)}/`;
  }

  handleGenre({ id, extra: { genre } }) {

    let path = '';

    if (id.includes('4k')) {
      path += '/4k';
    }

    path += pathMappings[genre];

    return this.baseUrl + path;
  }

  handlePagination(url, { extra: { skip } }) {
  const page = this.page(skip);
if (!page || page === '1') return url;

  try {
    const u = new URL(url);

    // remove trailing slash
    let pathname = u.pathname.replace(/\/$/, '');

    // remove existing page if already present
    pathname = pathname.replace(/\/\d+$/, '');

    u.pathname = `${pathname}/${page}/`;

    return u.toString();
  } catch (e) {
    // fallback (should rarely happen)
    return `${url.replace(/\/$/, '')}/${page}/`;
  }
}

  getCatalogMetas(html) {
if (!html || html.length < 1000) {
  return [];
}

    const metadataList = [];

    const $ = load(html);

   let count = 0;

$('.thumb-list__item').each((_, element) => {

  if (count >= this.limit) return false; // 🛑 STOP LOOP

  const $e = $(element);
  const $a = $e.find('a').first();

  let videoPageUrl = $a.attr('href');

  // 🚫 skip ads early
  if (videoPageUrl && videoPageUrl.includes('/ff/out')) return;

  const $img = $a.find('img').first();

  const srcset = $img.attr('data-srcset');
  const bestSrc =
    srcset?.split(',').pop()?.trim().split(' ')[0];

  const rawSrc =
    $img.attr('data-src') ||
    bestSrc ||
    $img.attr('data-preview') ||
    $img.attr('src');

  let poster = rawSrc;

  // 🚫 skip useless images EARLY
  if (!poster || poster.startsWith('data:')) return;

  // 🔁 force absolute URL
  if (!poster.startsWith('http')) {
    poster = this.baseUrl + poster;
  }

  if (videoPageUrl && !videoPageUrl.startsWith('http')) {
    videoPageUrl = this.baseUrl + videoPageUrl;
  }

  const title =
    $img.attr('alt') ||
    $a.attr('title');

  if (!videoPageUrl || !title) return;

  metadataList.push(
    new meta.MetaPreview(
      videoPageUrl,
      'movie',
      title,
      poster,
      { videoPageUrl },
    ),
  );

  count++; // ✅ increment only when valid
});

    return metadataList;
  }

  async getMetadata(args) {

  logger.debug({ args }, 'getMetadata');

  let { id } = args;

  // Fix: ensure id is a full URL
  if (!id.startsWith('http')) {
    id = this.baseUrl + id;
  }

  return this.fetchHtml(id)
    .then(html => this.parseVideoPage({ id, html }));
}

  parseVideoPage({ id, html }) {

    let match =
      html.match(/window\.initials\s*=\s*(\{.*?\});/) ||
      html.match(/window\.initials\s*=\s*JSON\.parse\("(.+?)"\)/);

    if (!match) {
      return {};
    }

    let json;

    try {

      if (match[1].startsWith('{')) {

        json = JSON.parse(match[1]);

      } else {

        const decoded = match[1]
          .replace(/\\"/g, '"')
          .replace(/\\\\/g, '\\');

        json = JSON.parse(decoded);
      }

    } catch (err) {

      logger.error(err);

      return {};
    }

    const title =
      json?.videoEntity?.title ||
      json?.videoModel?.title;

    const description =
      json?.videoModel?.description ||
      title;

    const poster =
      json?.videoModel?.thumbURL;

    let streamUrl = null;

const sources = json?.xplayerSettings?.sources || {};

if (sources?.hls?.h264?.url) {
  streamUrl = sources.hls.h264.url;
} else if (sources?.hls?.av1?.url) {
  streamUrl = sources.hls.av1.url;
} else if (sources?.mp4?.high?.url) {
  streamUrl = sources.mp4.high.url;
} else if (sources?.mp4?.medium?.url) {
  streamUrl = sources.mp4.medium.url;
}

/* FIX: ignore invalid tokens */
if (streamUrl && !streamUrl.startsWith('http')) {
  streamUrl = null;
}

    const tags =
      json?.videoTagsListProps?.tags?.map(t => t.name).slice(0, 20) || [];

    if (!streamUrl) {
  logger.warn("xHamster: no stream URL found");
}

return new meta.MetaResponse(
  id,
  Provider.TYPE,
  title,
  {
    videoPageUrl: streamUrl,
    description,
    poster,
    background: poster,
    genres: tags,
  },
);
  }

  transformStream(url, stream) {

    return {
      ...stream,
      url:
        url
          .replace('_TPL_.av1.mp4.m3u8', '')
          .replace('_TPL_.h264.mp4.m3u8', '') +
        stream.url,
    };
  }
}

module.exports = XhamsterProvider.create;