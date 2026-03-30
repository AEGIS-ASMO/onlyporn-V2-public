require('dotenv').config();  
const { load } = require('cheerio');  
const logger = require('../logger');  
const { meta } = require('../model');  
const Provider = require('./provider');  
const htmlCache = new Map();
const metaCache = new Map();
const META_TTL = 1000 * 60 * 10;  
const inFlight = new Map();  
const HTML_TTL = 1000 * 60 * 5;  
  
const sortByMappings = {  
  'Latest': 'latest',  
  'Trending': 'trending',  
  'Views': 'views',  
  'Rating': 'rating',  
  'Orgasmic': 'orgasmic',  
};  
  
class SxyprnProvider extends Provider {  
  constructor() {  
    // 🔥 increase to match real page density  
    super('https://www.sxyprn.com', 'sxyprn', 20);  
  }  
  
  static create() {  
    return new SxyprnProvider();  
  }  
async fetchHtml(url) {  
  if (inFlight.has(url)) return inFlight.get(url);  
  
  const promise = (async () => {  
    const cached = htmlCache.get(url);  
  
    if (cached && Date.now() - cached.time < HTML_TTL) {  
      return cached.data;  
    }  
  
    const res = await fetch(url, {
  headers: {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
    'Referer': this.baseUrl,
    'Origin': this.baseUrl,
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept': 'text/html'
  }
});

const html = await res.text();  
  
    htmlCache.set(url, {  
      data: html,  
      time: Date.now()  
    });  
  
    return html;  
  })();  
  
  inFlight.set(url, promise);  
  
  try {  
    return await promise;  
  } finally {  
    inFlight.delete(url);  
  }  
}  
  
  /* =========================  
     🔥 FIX 1: correct default catalog  
  ========================= */  
  getInitialUrl() {  
    return `${this.baseUrl}/blog/all/0.html?sm=latest`;  
  }  
  
  /* =========================  
     🔥 FIX 2: working search  
  ========================= */  
  handleSearch({ extra: { search: keyword } }) {  
    return `${this.baseUrl}/blog/all/0.html?search=${encodeURIComponent(keyword)}`;  
  }  
  
  /* =========================  
     🔥 FIX 3: genre handling  
  ========================= */  
  handleGenre({ extra: { genre } }) {  
    if (!genre) return this.getInitialUrl();  
  
    let [category, sortBy] = genre.split('(');  
  
    category = category.trim().replace(/\s+/g, '-');  
    sortBy = sortByMappings[(sortBy || '').replace(')', '')] || 'latest';  
  
    return `${this.baseUrl}/${category}.html?sm=${sortBy}`;  
  }  
  
  /* =========================  
     🔥 FIX 4: pagination (CRITICAL)  
  ========================= */  
  handlePagination(url, { extra: { skip } }) {  
    const page = this.page(skip);  
  
    if (!page || page === '1') return url;  
  
    try {  
      const u = new URL(url);  
  
      // replace /0.html → /<offset>.html  
      const offset = (page - 1) * 20;  
  
      u.pathname = u.pathname.replace(/\/\d+\.html$/, `/${offset}.html`);  
  
      return u.toString();  
    } catch (e) {  
      return url;  
    }  
  }  
  
  /* =========================  
     🔥 FIX 5: robust catalog parser  
  ========================= */  
  getCatalogMetas(html) {  
    const metadataList = [];  
    const $ = load(html);  
  
    $('div.post_el_small').each((_, element) => {  
      const $e = $(element);  
  
      const title = $e.find('.post_text').text().trim();  
  
      const img = $e.find('img').first();  
  
      let poster =  
        img.attr('data-src') ||  
        img.attr('data-original') ||  
        img.attr('src');  
  
      if (poster && poster.startsWith('//')) {  
        poster = 'https:' + poster;  
      }  
  
      const path = $e.find('.js-pop').attr('href');  
      if (!path) return;  
  
      const videoPageUrl = this.baseUrl + path;  
  
      metadataList.push(  
        new meta.MetaPreview(  
          videoPageUrl,  
          'movie',  
          title,  
          poster,  
          { videoPageUrl }  
        )  
      );  
    });  
  
    return metadataList;  
  }  
  
  /* =========================  
     🔥 METADATA (mostly fine)  
  ========================= */  
  async getMetadata(args) {
  const { id } = args;

  const cached = metaCache.get(id);
  if (cached && Date.now() - cached.time < META_TTL) {
    return cached.data;
  }

  const html = await this.fetchHtml(id);
  const data = this.parseVideoPage({ id, html });

  metaCache.set(id, {
    data,
    time: Date.now()
  });

  return data;
}
getvsrc(html) {
  const $ = load(html);

  const el = $('.vidsnfo');
  if (!el.length) return null;

  const vidsnfo = el.data('vnfo');
  if (!vidsnfo) return null;

  for (const src of Object.values(vidsnfo)) {
    let tmp = src.split('/');

    if (!tmp || tmp.length < 8) continue;

    tmp[1] += '8';
    tmp = this.preda(tmp);

    const final = tmp.join('/');

// 🔥 CONVERT .vid → .mp4 HERE
let url = final.replace('.vid', '.mp4');

logger.warn(`Converted video URL: ${url}`);

if (url.startsWith('//')) return 'https:' + url;
if (url.startsWith('http')) return url;

if (url.startsWith('/')) {
  return this.baseUrl + url;
}

return 'https://' + url;
  }

  return null;
}
preda(arg) {
  arg[5] -= parseInt(this.ssut51(arg[6])) + parseInt(this.ssut51(arg[7]));
  return arg;
}

ssut51(arg) {
  const str = arg.replace(/[^0-9]/g, '');
  let sum = 0;

  for (let i = 0; i < str.length; i++) {
    sum += parseInt(str.charAt(i), 10);
  }

  return sum;
}
 
getVideoUrl(html) {
  const $ = load(html);

  logger.warn('Extracting EXTERNAL video links...');

  const links = [];

  $('a').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;

    // 🔥 target known external hosts
    if (
      href.includes('myvidplay.com') ||
      href.includes('vidara.so') ||
      href.includes('filemoon') ||
      href.includes('streamwish') ||
      href.includes('dood') ||
      href.includes('mixdrop')
    ) {
      links.push(href);
    }
  });

  logger.warn(`External links found: ${links.length}`);

  return links.length ? links : null;
}
  
    
  
  parseVideoPage({ id, html }) {
  const $ = load(html);

  const metaMap = {};
  $('meta').each((_, e) => {
    const a = e.attribs;
    metaMap[a.name || a.property] = a.content;
  });

  let poster = metaMap['og:image'];
  if (poster && poster.startsWith('//')) {
    poster = 'https:' + poster;
  }

  const description = metaMap['og:description'];

  logger.warn('========== SXYPRN DEBUG ==========');
logger.warn(`HTML LENGTH: ${html.length}`);
logger.warn('HTML SAMPLE:', html.slice(0, 500));

const externalLinks = this.getVideoUrl(html);

logger.warn(`External links: ${JSON.stringify(externalLinks)}`);
logger.warn('==================================');

  return new meta.MetaResponse(
  id,
  Provider.TYPE,
  metaMap['og:title'],
  {
    description,
    poster,
    background: poster,
    externalLinks, // 🔥 store ALL links
  }
);
}  
  
  async resolveExternalStream(link) {
  try {
    logger.warn(`Resolving external: ${link}`);

    const res = await fetch(link, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
        'Referer': this.baseUrl,
      }
    });

    const html = await res.text();

    // 🔥 1. direct mp4
    let mp4 = html.match(/https?:\/\/[^"' ]+\.mp4[^"' ]*/);
    if (mp4) {
      logger.warn(`MP4 FOUND: ${mp4[0]}`);
      return mp4[0];
    }

    // 🔥 2. m3u8 (HLS)
    let m3u8 = html.match(/https?:\/\/[^"' ]+\.m3u8[^"' ]*/);
    if (m3u8) {
      logger.warn(`M3U8 FOUND: ${m3u8[0]}`);
      return m3u8[0];
    }

    // 🔥 3. source tag fallback
    const $ = load(html);
    let src =
      $('video source').attr('src') ||
      $('video').attr('src');

    if (src) {
      if (src.startsWith('//')) return 'https:' + src;
      if (src.startsWith('http')) return src;
    }

    logger.warn('No playable stream found on external host');
    return null;

  } catch (err) {
    logger.error(`Resolve failed: ${err.message}`);
    return null;
  }
}

async getStreams(meta) {
  if (!meta.externalLinks || !meta.externalLinks.length) {
    logger.error('Sxyprn: no external links');
    return { streams: [] };
  }

  const streams = [];

  for (const link of meta.externalLinks) {
    const resolved = await this.resolveExternalStream(link);

    if (resolved) {
      streams.push({
        type: Provider.TYPE,
        url: resolved,
        name: 'Sxyprn External',
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
          'Referer': link
        }
      });
    }
  }

  return { streams };
}  
}  
  
module.exports = SxyprnProvider.create;