// OtakuPier - SEO & social-sharing helpers
// Dynamically updates <head> meta tags + JSON-LD for the current page/anime
// so shared links get rich previews (Discord/X/Facebook) and crawlers see
// relevant metadata. Runs client-side, after data is already loaded, so it
// adds no network calls and no meaningful performance cost.

const SEO = {
  BASE: "https://otakupier.2bd.net",
  INDEXNOW_KEY: "7a9a2a35d24b473c811ecd475c7bd970",

  // IndexNow: notify search engines (Bing, Yandex, Naver, etc.) about URL changes.
  // Can be called with a single URL string or an array of URLs.
  // Uses the bundled key hosted at /fa7eb9705f644b66ab22d305ec3351b9.txt.
  async pingIndexNow(urls) {
    if (!urls) return;
    const list = Array.isArray(urls) ? urls : [urls];
    const fullUrls = list.map(u => u.startsWith("http") ? u : this.BASE + u);
    const hosts = ["api.indexnow.org", "api.bing.com", "api.yandex.com", "search.naver.com"];
    const payload = JSON.stringify({
      host: "otakupier.2bd.net",
      key: this.INDEXNOW_KEY,
      keyLocation: `${this.BASE}/${this.INDEXNOW_KEY}.txt`,
      urlList: fullUrls,
    });
    const results = [];
    for (const host of hosts) {
      try {
        const r = await fetch(`https://${host}/indexnow`, {
          method: "POST",
          headers: { "Content-Type": "application/json; charset=utf-8" },
          body: payload,
        });
        results.push({ host, status: r.status });
      } catch (e) {
        results.push({ host, error: e.message });
      }
    }
    console.log("[IndexNow]", results);
    return results;
  },

  // Convenience: ping with the current page URL
  pingCurrentPage() {
    return this.pingIndexNow(window.location.href.split("#")[0]);
  },

  _set(selector, value) {
    let el = document.head.querySelector(selector);
    if (!el) {
      el = document.createElement("meta");
      const parts = selector.match(/^meta\[([a-z]+)=([^\]]+)\]$/);
      if (parts) el.setAttribute(parts[1], parts[2].replace(/"/g, ""));
      document.head.appendChild(el);
    }
    el.setAttribute("content", value);
  },

  // Strip markup + collapse whitespace for safe, compact meta content.
  _clean(str, max) {
    if (!str) return "";
    let s = String(str)
      .replace(/\[Written by MAL Rewrite\]/g, "")
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (max && s.length > max) s = s.slice(0, max - 1).trimEnd() + "…";
    return s;
  },

  // Set the canonical <link> for the current URL.
  setCanonical(url) {
    let el = document.head.querySelector('link[rel="canonical"]');
    if (!el) {
      el = document.createElement("link");
      el.setAttribute("rel", "canonical");
      document.head.appendChild(el);
    }
    el.setAttribute("href", url || window.location.href.split("#")[0]);
  },

  // Set title + description + OG/Twitter tags for the given anime object
  // (shape-compatible with both Jikan data and custom-anime entries).
  setAnimeMeta(anime) {
    if (!anime) return;
    const title = anime.title_english || anime.title || "Anime";
    const clean = this._clean(anime.synopsis, 200) || "View anime details, rankings and community reviews on OtakuPier.";
    const id = anime.mal_id || "";
    const url = id ? `${this.BASE}/pages/anime.html?id=${encodeURIComponent(id)}` : this.BASE + "/";
    const img = anime.images?.jpg?.large_image_url || anime.images?.jpg?.image_url || `${this.BASE}/images/banner.svg`;

    document.title = `${title} - Reviews, Ranking & Where to Watch | OtakuPier`;
    this._set('meta[name="description"]', clean);
    this._set('meta[property="og:type"]', "article");
    this._set('meta[property="og:site_name"]', "OtakuPier");
    this._set('meta[property="og:title"]', title);
    this._set('meta[property="og:description"]', clean);
    this._set('meta[property="og:url"]', url);
    this._set('meta[property="og:image"]', img);
    this._set('meta[property="og:image:alt"]', title);
    this._set('meta[name="twitter:card"]', "summary_large_image");
    this._set('meta[name="twitter:title"]', title);
    this._set('meta[name="twitter:description"]', clean);
    this._set('meta[name="twitter:image"]', img);
    this.setCanonical(url);
    this._injectJsonLd(anime, url);
  },

  // Fallback used on pages that don't load a specific anime (safe default).
  setDefaultMeta(title, description) {
    if (title) document.title = title;
    if (description) this._set('meta[name="description"]', this._clean(description, 200));
    this._set('meta[property="og:title"]', title || "OtakuPier");
    this._set('meta[property="og:description"]', description || "Anime catalog & community.");
    this.setCanonical(this.BASE + window.location.pathname.replace(/^\/pages/, "/pages"));
  },

  // Insert a schema.org JSON-LD block (TVSeries/Movie) for rich results.
  _injectJsonLd(anime, url) {
    const existing = document.getElementById("seo-jsonld");
    if (existing) existing.remove();
    const title = anime.title_english || anime.title || "Anime";
    const img = anime.images?.jpg?.large_image_url || anime.images?.jpg?.image_url || "";
    const type = /movie/i.test(anime.type || "") ? "Movie" : "TVSeries";
    const genre = (anime.genres || []).map((g) => g.name).slice(0, 5);
    const obj = {
      "@context": "https://schema.org",
      "@type": type,
      "name": title,
      "alternateName": anime.title || undefined,
      "url": url,
      "image": img || undefined,
      "description": this._clean(anime.synopsis, 500) || undefined,
      "genre": genre.length ? genre : undefined,
      "datePublished": anime.year ? String(anime.year) : undefined,
      "aggregateRating": anime.score ? {
        "@type": "AggregateRating",
        "ratingValue": anime.score,
        "bestRating": 10,
        "worstRating": 0,
      } : undefined,
      "publisher": { "@type": "Organization", "name": "OtakuPier" },
    };
    // Drop undefined keys so the JSON is clean. Escape "<" as \u003c so a
    // title/synopsis containing "</script>" can never break out of this
    // <script type="application/ld+json"> block (JSON.stringify keeps it
    // valid while neutralizing script-terminators).
    Object.keys(obj).forEach((k) => obj[k] === undefined && delete obj[k]);
    const script = document.createElement("script");
    script.type = "application/ld+json";
    script.id = "seo-jsonld";
    script.textContent = JSON.stringify(obj).replace(/</g, "\\u003c");
    document.head.appendChild(script);
  },

  // Build share URLs for a given anime (X/Twitter + Reddit + copy-link).
  // Returns an array of { label, href } suitable for rendering as buttons.
  shareLinks(anime) {
    const title = anime?.title_english || anime?.title || "OtakuPier";
    const id = anime?.mal_id || "";
    const url = id ? `${this.BASE}/pages/anime.html?id=${encodeURIComponent(id)}` : this.BASE + "/";
    const text = encodeURIComponent(`Check out "${title}" on OtakuPier - reviews, ranking & where to watch`);
    const encUrl = encodeURIComponent(url);
    return [
      { label: "𝕏 Post", href: `https://twitter.com/intent/tweet?text=${text}&url=${encUrl}` },
      { label: "Reddit", href: `https://www.reddit.com/submit?url=${encUrl}&title=${encodeURIComponent(title)}` },
      { label: "Copy link", href: "javascript:void(0)", copy: url },
    ];
  },

  // Set meta tags for manga detail pages (MangaDex data).
  setMangaMeta(manga, title, id) {
    if (!manga) return;
    const t = manga.title || title || "Manga";
    const clean = this._clean(manga.summary, 200) || "Read manga chapters on OtakuPier.";
    const url = `${this.BASE}/pages/manga.html?id=${encodeURIComponent(id)}`;
    const img = manga.cover || `${this.BASE}/images/banner.svg`;

    document.title = `${t} - Read Manga | OtakuPier`;
    this._set('meta[name="description"]', clean);
    this._set('meta[property="og:type"]', "article");
    this._set('meta[property="og:site_name"]', "OtakuPier");
    this._set('meta[property="og:title"]', t);
    this._set('meta[property="og:description"]', clean);
    this._set('meta[property="og:url"]', url);
    this._set('meta[property="og:image"]', img);
    this._set('meta[property="og:image:alt"]', t);
    this._set('meta[name="twitter:card"]', "summary_large_image");
    this._set('meta[name="twitter:title"]', t);
    this._set('meta[name="twitter:description"]', clean);
    this._set('meta[name="twitter:image"]', img);
    this.setCanonical(url);
  },
};
