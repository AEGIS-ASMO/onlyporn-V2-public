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
  
    const html = await super.fetchHtml(url, {
  headers: {
    'User-Agent': 'Mozilla/5.0',
    'Referer': this.baseUrl,
    'Origin': this.baseUrl,
    'Accept-Language': 'en-US,en;q=0.9'
  }
});  
  
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
getVideoUrl(html) {

  const $ = load(html);

  // ✅ 1. video tag
  let src =
    $('video source').attr('src') ||
    $('video').attr('src');

  if (src) {
    if (src.startsWith('//')) return 'https:' + src;
    if (src.startsWith('http')) return src;
  }

  // ✅ 2. m3u8
  let m3u8 = html.match(/https?:\/\/[^"' ]+\.m3u8[^"' ]*/);
  if (m3u8) return m3u8[0];

  // ✅ 3. mp4
  let mp4 = html.match(/https?:\/\/[^"' ]+\.mp4[^"' ]*/);
  if (mp4) return mp4[0];

  // ✅ 4. JS player fallback (IMPORTANT)
  let js = html.match(/(?:file|src)\s*:\s*["'](https?:\/\/[^"']+)["']/);
  if (js) return js[1];

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

  const videoPageUrl = this.getVideoUrl(html);

  if (!videoPageUrl) {
    logger.warn('Sxyprn: No video URL extracted');
  }

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
          Referer: this.baseUrl,
          Origin: this.baseUrl,
          'User-Agent': 'Mozilla/5.0'
        },
        name: 'Sxyprn HD',
      },
    ],
  };
}  
}  
  
module.exports = SxyprnProvider.create;