const { load } = require("cheerio");
const logger = require("../logger");
const { meta } = require("../model");
const Provider = require("./provider");

class PorntrexProvider extends Provider {

  constructor() {
    super("https://porntrex.com/", "porntrex");
  }

  static create() {
    return new PorntrexProvider();
  }

  getInitialUrl(catalogId) {
    const segment = this.getSegment(catalogId);
    return segment ? `${this.baseUrl}${segment}/` : this.baseUrl;
  }

  getSegment(catalogId) {
    return catalogId.substring(this.getName().length + 1);
  }

  handleSearch({ extra: { search } }) {
    return `${this.baseUrl}search/${encodeURIComponent(search)}/`;
  }

  handleGenre(args) {
    return this.handleSearch({ ...args, extra: { search: args.extra.genre } });
  }

  handlePagination(url, { extra: { skip } }) {
    return `${url}page/${this.page(skip)}/`;
  }

  getCatalogMetas(html) {
    const $ = load(html);
    const metas = [];

    $("div.video-holder, div.video-item, div.thumb, div.item, div.video").each((i, el) => {

      const a = $(el).find("a").first();
      const href = a.attr("href");

      if (!href || !href.includes("/video/")) return;

      const videoPageUrl = href.startsWith("http")
        ? href
        : this.baseUrl.replace(/\/$/, "") + href;

      const img = a.find("img");

      let poster =
        img.attr("data-src") ||
        img.attr("data-original") ||
        img.attr("data-lazy-src") ||
        img.attr("src");

      if (poster && poster.startsWith("//")) poster = "https:" + poster;

      const title =
        img.attr("alt") ||
        a.attr("title") ||
        a.text().trim();

      if (!title) return;

      metas.push(
        new meta.MetaPreview(videoPageUrl, "movie", title, poster)
      );

    });

    return metas;
  }

  async parseVideoPage({ id, html }) {

    const videoIdMatch = id.match(/video\/(\d+)/i);

    if (!videoIdMatch) {
      logger.warn("Porntrex: invalid video id");
      return null;
    }

    const videoId = videoIdMatch[1];
    const embedUrl = `${this.baseUrl}embed/${videoId}`;

    const embedHtml = await this.fetchHtml(embedUrl);

    // find master playlist
    const playlistMatch =
      embedHtml.match(/https?:\/\/[^"'<>]+\.m3u8[^"'<>]*/i) ||
      embedHtml.match(/"(https?:\\\/\\\/[^"]+\.m3u8[^"]*)"/i);

    let playlistUrl = playlistMatch?.[1] || playlistMatch?.[0];

    if (playlistUrl) {
      playlistUrl = playlistUrl
        .replace(/\\\//g, "/")
        .replace(/"/g, "");
    }

    if (!playlistUrl) {
      logger.warn("Porntrex: no playlist found");
      return null;
    }

    const $ = load(html);

    const title =
      $('meta[property="og:title"]').attr("content") ||
      $("title").text().replace(/\s*-\s*Porntrex/i, "").trim() ||
      "Porntrex Video";

    const description =
      $('meta[name="description"]').attr("content") || title;

    let poster = $('meta[property="og:image"]').attr("content") || null;

    if (poster && poster.startsWith("//")) poster = "https:" + poster;

    return {
      metaResponse: new meta.MetaResponse(
        id,
        "movie",
        title,
        {
          description,
          background: poster
        }
      ),
      videoPageUrl: this.cleanUrl(playlistUrl)
    };

  }

}

module.exports = PorntrexProvider.create;