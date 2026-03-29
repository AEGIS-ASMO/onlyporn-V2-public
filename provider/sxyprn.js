require('dotenv').config();  
const { load } = require('cheerio');  
const logger = require('../logger');  
const { meta } = require('../model');  
const Provider = require('./provider');  
const htmlCache = new Map();  
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
  
    const html = await super.fetchHtml(url);  
  
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
    logger.debug({ args }, 'getMetadata');  
    const { id } = args;  
    return this.fetchHtml(id).then((html) =>  
      this.parseVideoPage({ id, html })  
    );  
  }  
  
  getvsrc(html) {  
    const $ = load(html);  
  
    if ($('.vidsnfo').length) {  
      const vidsnfo = $('.vidsnfo').data('vnfo');  
  
      for (const src of Object.values(vidsnfo)) {  
        let tmp = src.split('/');  
        tmp[1] += '8';  
        tmp = this.preda(tmp);  
        return tmp.join('/');  
      }  
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
    const vidSrc = this.getvsrc(html);  
  
    let videoPageUrl = null;  
  
    if (vidSrc) {  
  if (vidSrc.startsWith('//')) {  
    videoPageUrl = 'https:' + vidSrc;  
  } else if (vidSrc.startsWith('http')) {  
    videoPageUrl = vidSrc;  
  } else {  
    videoPageUrl = this.baseUrl + vidSrc;  
  }  
}  
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