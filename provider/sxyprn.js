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

    if (final.startsWith('//')) return 'https:' + final;
    if (final.startsWith('http')) return final;

    if (final.startsWith('/')) {
  return this.baseUrl + final;
}
return 'https://' + final;
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

  logger.warn('Trying to extract video...');

  const $ = load(html);

  // 🔍 check vidsnfo presence
  logger.warn('vidsnfo exists:', $('.vidsnfo').length);

  // ✅ 1. vidsnfo
  const vnfo = this.getvsrc(html);
  if (vnfo) {
    logger.warn('VIDSNFO URL FOUND:', vnfo);
    return vnfo;
  }

  // ✅ 2. video tag
  let src =
    $('video source').attr('src') ||
    $('video').attr('src');

  if (src) {
    logger.warn('VIDEO TAG FOUND:', src);

    if (src.startsWith('//')) return 'https:' + src;
    if (src.startsWith('http')) return src;
  }

  // ✅ 3. mp4
  let mp4 = html.match(/https?:\/\/[^"' ]+\.mp4[^"' ]*/);
  if (mp4) {
    logger.warn('MP4 FOUND:', mp4[0]);
    return mp4[0];
  }

  // ✅ 4. m3u8
  let m3u8 = html.match(/https?:\/\/[^"' ]+\.m3u8[^"' ]*/);
  if (m3u8) {
    logger.warn('M3U8 FOUND:', m3u8[0]);
    return m3u8[0];
  }

  // 🔍 5. packed JS detection
  let packed = html.match(/eval\(function\(p,a,c,k,e,d\).*?\)\)/s);
  if (packed) {
    logger.warn('PACKED JS FOUND (OBFUSCATED)');
  }

  // ❌ nothing found
  logger.warn('NO VIDEO URL FOUND');
  return null;
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
logger.warn('HTML LENGTH:', html.length);
logger.warn('HTML SAMPLE:', html.slice(0, 500));

const videoPageUrl = this.getVideoUrl(html);

logger.warn(`FINAL EXTRACTED URL: ${videoPageUrl}`);
logger.warn('==================================');

  return new meta.MetaResponse(
    id,
    Provider.TYPE,
    metaMap['og:title'],
    {
      description,
      poster,
      background: poster,
      videoPageUrl,
    }
  );
}  
  
  async getStreams(meta) {

  if (!meta.videoPageUrl) {
    logger.error('Sxyprn: stream missing');
    return { streams: [] };
  }

  return {
    streams: [
      {
        type: Provider.TYPE,
        url: meta.videoPageUrl,
        headers: {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
  'Referer': meta.id, // 🔥 VERY IMPORTANT (video page URL, not homepage)
  'Origin': this.baseUrl,
  'Accept': '*/*',
  'Connection': 'keep-alive'
},
        name: 'Sxyprn HD',
      },
    ],
  };
}  
}  
  
module.exports = SxyprnProvider.create;