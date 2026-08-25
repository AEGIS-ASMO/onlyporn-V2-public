require('dotenv').config();

const { load } = require('cheerio');
const logger = require('../logger');
const { meta } = require('../model');
const Provider = require('./provider');

const genrePathMappings = {
  '4k porn': '4k-porn',
  'hd 1080p': 'hd-sex',
  '60fps': '60fps',
  'anal': 'anal',
  'pov': 'pov',
  'blowjob': 'blowjob',
  'stepsister': 'stepsister',
  'japanese': 'japanese',
  'asian porn': 'asian',
  'big tits': 'big-tits',
  'stepmom': 'stepmom',
  'family': 'family',
  'creampie': 'creampie',
  'hq porn': 'hq-porn',
};

const sortByMappings = {
  'Most Recent': '',
  'Weekly Top': 'SORT-top-weekly',
  'Monthly Top': 'SORT-top-monthly',
  'Most Viewed': 'SORT-most-viewed',
  'Top Rated': 'SORT-top-rated',
  'Longest': 'SORT-longest',
};

const cleanText = (value) =>
  (value || '')
    .replace(/\s+/g, ' ')
    .replace(/\u00a0/g, ' ')
    .trim();

const cleanUrl = (url, baseUrl = 'https://www.eporner.com') => {
  if (!url || typeof url !== 'string') return null;

  url = url
    .replace(/\\\//g, '/')
    .replace(/&amp;/g, '&')
    .replace(/\\u0026/g, '&')
    .trim();

  if (url.startsWith('//')) {
    return `https:${url}`;
  }

  try {
    return new URL(url, baseUrl).href;
  } catch {
    return url;
  }
};

class EpornerProvider extends Provider {
  constructor() {
    super('https://www.eporner.com', 'eporner', 60);
  }

  static create() {
    return new EpornerProvider();
  }

  /*
   * CATALOG
   */

  getInitialUrl() {
    return `${this.baseUrl}/cat/all/`;
  }

  handleSearch({ extra: { search: keyword } }) {
    return `${this.baseUrl}/search/${encodeURIComponent(keyword)}/`;
  }

  /*
   * GENRE
   *
   * Example:
   * 4k Porn (Most Recent)
   * -> /cat/4k-porn/
   *
   * 4k Porn (Top Rated)
   * -> /cat/4k-porn/SORT-top-rated/
   */

  handleGenre({ extra = {} }) {
    const raw = cleanText(extra.genre);

    if (!raw) {
      return `${this.baseUrl}/cat/all/`;
    }

    let genreName = raw;
    let sortName = 'Most Recent';

    const match = raw.match(/^(.*?)\s*\((.*?)\)\s*$/);

    if (match) {
      genreName = cleanText(match[1]);
      sortName = cleanText(match[2]);
    }

    const category = genrePathMappings[genreName.toLowerCase()];

    if (!category) {
      logger.warn(
        { genre: raw },
        'Eporner unknown genre'
      );

      return `${this.baseUrl}/cat/all/`;
    }

    const sort = sortByMappings[sortName] ?? '';

    return sort
      ? `${this.baseUrl}/cat/${category}/${sort}/`
      : `${this.baseUrl}/cat/${category}/`;
  }

  /*
   * PAGINATION
   */

  handlePagination(url, { extra: { skip } }) {
    const page = this.page(skip);

    if (!page || page === '1') {
      return '';
    }

    const clean = url.replace(/\/+$/, '');

    // Replace an existing page number.
    if (/\/\d+$/.test(clean)) {
      return `${clean.replace(/\/\d+$/, '')}/${page}/`;
    }

    return `${clean}/${page}/`;
  }

  /*
   * CATALOG METADATA
   *
   * Eporner's normal catalog structure:
   *
   * div.mb
   *   -> .mbimg
   *   -> .mbcontent
   *   -> a
   *   -> img
   */

  getCatalogMetas(html) {
    if (!html) {
      return [];
    }

    const $ = load(html);
    const metadataList = [];

    $('div.mb').each((_, element) => {
      const $mb = $(element);
      const $a = $mb.find('.mbimg .mbcontent > a').first();
      const $img = $a.find('img').first();

      const videoPageUrl = $a.attr('href');

      if (!videoPageUrl) {
        return;
      }

      const poster = cleanUrl(
        $img.attr('data-src') || $img.attr('src'),
        this.baseUrl
      );

      const title = cleanText(
        $img.attr('alt') ||
        $a.attr('title') ||
        $a.text()
      );

      metadataList.push(
        new meta.MetaPreview(
          cleanUrl(videoPageUrl, this.baseUrl),
          Provider.TYPE,
          title || 'Eporner Video',
          poster,
          {
            videoPageUrl: cleanUrl(videoPageUrl, this.baseUrl),
            posterShape: 'landscape',
          }
        )
      );
    });

    logger.debug(
      { metasSize: metadataList.length },
      'Eporner catalog parsed'
    );

    return metadataList;
  }

  /*
   * VIDEO METADATA
   */

  async getMetadata({ id }) {
    const html = await this.fetchHtml(id);

    if (!html) {
      return {};
    }

    return this.parseVideoPage({ id, html });
  }

  parseVideoPage({ id, html }) {
    if (!html) {
      return {};
    }

    const $ = load(html);
    const metaMap = {};

    $('meta').each((_, element) => {
      const name =
        $(element).attr('name') ||
        $(element).attr('property');

      const content = $(element).attr('content');

      if (name && content) {
        metaMap[name] = content;
      }
    });

    const title = cleanText(
      metaMap['og:title'] ||
      $('title').text() ||
      'Eporner Video'
    );

    const poster = cleanUrl(
      metaMap['og:image'],
      this.baseUrl
    );

    const hashMatch = html.match(
      /EP\.video\.player\.hash\s*=\s*['"]([^'"]+)['"]/i
    );

    const videoIdMatch = html.match(
      /EP\.video\.player\.vid\s*=\s*['"]([^'"]+)['"]/i
    );

    const videoId =
      videoIdMatch?.[1] ||
      id.match(/\/video-([^/]+)\//i)?.[1] ||
      null;

    const hash = hashMatch?.[1] || null;

    const keywords =
      metaMap['keywords'] ||
      metaMap['video:tag'] ||
      '';

    const genres = keywords
      .split(',')
      .map(cleanText)
      .filter(Boolean);

    return new meta.MetaResponse(
      id,
      Provider.TYPE,
      title,
      {
        description: cleanText(
          metaMap['og:description'] ||
          metaMap['description'] ||
          ''
        ),

        poster,
        background: poster,
        posterShape: 'landscape',

        genres,
        links: [],

        extra: {
          hash,
          videoId,
        },
      }
    );
  }

  /*
   * HASH
   */

  hash(value) {
    if (!value || value.length < 32) {
      return '';
    }

    try {
      return (
        parseInt(value.substring(0, 8), 16).toString(36) +
        parseInt(value.substring(8, 16), 16).toString(36) +
        parseInt(value.substring(16, 24), 16).toString(36) +
        parseInt(value.substring(24, 32), 16).toString(36)
      );
    } catch {
      return '';
    }
  }

  /*
   * STREAMS
   */

  async processStreams({ id }) {
    const html = await this.fetchHtml(id);

    if (!html) {
      return { streams: [] };
    }

    /*
     * First try a directly exposed HLS URL.
     */
    const hlsMatch = html.match(
      /https?:\/\/[^"'\\\s<>]+\.m3u8(?:\?[^"'\\\s<>]*)?/i
    );

    if (hlsMatch?.[0]) {
      return this.getStreams({
        videoPageUrl: cleanUrl(hlsMatch[0], this.baseUrl),
      });
    }

    /*
     * Otherwise use Eporner's XHR API.
     */
    const parsed = this.parseVideoPage({ id, html });

    const { videoId, hash } = parsed.extra || {};

    if (!videoId || !hash) {
      logger.warn(
        { id },
        'Eporner stream information missing'
      );

      return { streams: [] };
    }

    const convertedHash = this.hash(hash);

    if (!convertedHash) {
      return { streams: [] };
    }

    const xhrUrl =
      `${this.baseUrl}/xhr/video/${encodeURIComponent(videoId)}` +
      `?hash=${encodeURIComponent(convertedHash)}` +
      `&domain=www.eporner.com` +
      `&pixelRatio=2` +
      `&playerWidth=0` +
      `&playerHeight=0` +
      `&fallback=false` +
      `&embed=false` +
      `&supportedFormats=hls,dash,h265,vp9,av1,mp4`;

    const response = await this.fetchHtml(xhrUrl);

    let data;

    try {
      data =
        typeof response === 'string'
          ? JSON.parse(response)
          : response;
    } catch {
      logger.warn(
        { id },
        'Eporner stream API returned invalid JSON'
      );

      return { streams: [] };
    }

    return this.selectSources(data?.sources);
  }

  /*
   * SOURCE SELECTION
   *
   * HLS first, MP4 second.
   */

  selectSources(sources) {
    if (!sources) {
      return { streams: [] };
    }

    if (sources.hls) {
      const hls =
        sources.hls.auto?.src ||
        Object.values(sources.hls).find(
          source =>
            source?.src &&
            /\.m3u8/i.test(source.src)
        )?.src;

      if (hls) {
        return this.getStreams({
          videoPageUrl: cleanUrl(hls, this.baseUrl),
        });
      }
    }

    if (sources.mp4) {
      const streams = Object.values(sources.mp4)
        .filter(mp4 => mp4?.src)
        .map(mp4 => ({
          url: cleanUrl(mp4.src, this.baseUrl),
          name:
            mp4.labelShort ||
            mp4.label ||
            'MP4',
          type: Provider.TYPE,
        }));

      return { streams };
    }

    return { streams: [] };
  }
}

module.exports = EpornerProvider.create;