// OtakuPier - Jikan API helpers
// Docs: https://docs.api.jikan.moe/

const JIKAN = {
  base: CONFIG.JIKAN_BASE,

  // Jikan allows roughly 3 requests/sec. Instead of fully serializing every
  // request (which makes the anime page crawl when it fires 25+ fetches at
  // once), run up to MAX_CONCURRENT requests in parallel — still under the
  // rate limit, but dramatically faster for data-heavy pages.
  MAX_CONCURRENT: 3,
  _active: 0,
  _waiters: [],

  _enqueue(task) {
    return new Promise((resolve, reject) => {
      this._waiters.push({ task, resolve, reject });
      this._pump();
    });
  },

  _pump() {
    while (this._active < this.MAX_CONCURRENT && this._waiters.length) {
      const { task, resolve, reject } = this._waiters.shift();
      this._active++;
      Promise.resolve().then(task).then(
        (val) => { this._active--; this._pump(); resolve(val); },
        (err) => { this._active--; this._pump(); reject(err); }
      );
    }
  },

  // Small wrapper with retry/backoff to respect Jikan rate limits (~3 req/sec)
  async get(path, retries = 5) {
    return this._enqueue(async () => {
      for (let attempt = 0; attempt < retries; attempt++) {
        if (attempt > 0) await new Promise((r) => setTimeout(r, 700 * attempt));
        let res;
        try {
          res = await fetch(`${this.base}${path}`);
        } catch (err) {
          if (attempt < retries - 1) continue;
          throw err;
        }
        if (res.ok) {
          const body = await res.json();
          // Jikan sometimes returns HTTP 200 with an error body when its
          // upstream (MyAnimeList) fails. Detect and retry those too.
          if (body && body.data !== undefined) return body;
          if (attempt < retries - 1) continue;
        }
        if (res.status === 429 || res.status >= 500) {
          if (attempt < retries - 1) continue;
        }
        throw new Error(`Jikan API error ${res.status}`);
      }
      throw new Error(`Jikan API error after retries`);
    });
  },

  // Trending/popular anime for the homepage. Jikan's popularity filter is
  // occasionally flaky (upstream MAL issues), so fall back to the plain
  // top list rather than failing the whole request.
  async topAnime(page = 1) {
    try {
      return await this.get(`/top/anime?filter=bypopularity&page=${page}`);
    } catch (err) {
      return this.get(`/top/anime?page=${page}`);
    }
  },

  // Highest rated anime of all time
  async topRated(page = 1) {
    return this.get(`/top/anime?page=${page}`);
  },

  // Currently airing anime (seasonal)
  async currentSeason() {
    return this.get(`/seasons/now?sfw=true`);
  },

  // Upcoming anime (seasonal)
  async upcomingSeason() {
    return this.get(`/seasons/upcoming?sfw=true`);
  },

  // Search with optional filters
  async search(query, page = 1, type = "", minScore = "") {
    let q = `type=anime&order_by=popularity&page=${page}&q=${encodeURIComponent(query)}`;
    if (type) q += `&type=${type}`;
    if (minScore) q += `&min_score=${minScore}`;
    return this.get(`/anime?${q}`);
  },

  // Anime list filtered by genre
  async byGenre(genreId, page = 1) {
    return this.get(`/anime?genres=${genreId}&order_by=popularity&page=${page}`);
  },

  // All anime for catalog browsing (paged)
  async catalog(page = 1) {
    return this.get(`/top/anime?page=${page}`);
  },

  // Full details for one anime
  async getAnime(id) {
    return this.get(`/anime/${id}/full`);
  },

  // Characters for an anime
  async characters(id) {
    return this.get(`/anime/${id}/characters`);
  },

  // Episode list for an anime
  async episodes(id, page = 1) {
    return this.get(`/anime/${id}/episodes?page=${page}`);
  },

  // Single character details
  async character(id) {
    return this.get(`/characters/${id}/full`);
  },

  // List of genres for the filter bar
  async genres() {
    const res = await this.get(`/genres/anime`);
    return res.data;
  },

  // MangaDex search by title (free, CORS-enabled API)
  async mangadexSearch(title, limit = 1) {
    try {
      const res = await fetch(
        `https://api.mangadex.org/manga?title=${encodeURIComponent(title)}&limit=${limit}`
      );
      if (!res.ok) return [];
      const body = await res.json();
      return (body.data || []).map((m) => ({
        id: m.id,
        title: m.attributes?.title?.en || Object.values(m.attributes?.title || {})[0] || "",
        url: `https://mangadex.org/title/${m.id}`,
      }));
    } catch (err) {
      return [];
    }
  },

  // Related manga from an anime's relations list. Prefers the main
  // "Adaptation" and dedupes so one MAL link is shown.
  relatedManga(animeData) {
    const out = [];
    const seen = new Set();
    const score = (rel) => (/adaptation/i.test(rel) ? 0 : /parent/i.test(rel) ? 1 : 2);
    (animeData.relations || [])
      .slice()
      .sort((a, b) => score(a.relation) - score(b.relation))
      .forEach((rel) => {
        if (!/adaptation|parent|alternative version/i.test(rel.relation)) return;
        (rel.entry || []).forEach((e) => {
          if (e.type !== "manga") return;
          const key = e.mal_id || e.name;
          if (seen.has(key)) return;
          seen.add(key);
          out.push({ name: e.name, url: e.url, mal_id: e.mal_id });
        });
      });
    return out;
  },

  // Related anime (seasons, movies, OVAs) from relations — excludes the
  // anime itself and non-anime entries. Ordered sequel/prequel first.
  relatedAnime(animeData) {
    const out = [];
    const seen = new Set();
    const rank = {
      "Sequel": 0, "Prequel": 1, "Alternative Version": 2,
      "Side Story": 3, "Spin-off": 4, "Summary": 5, "Other": 6,
    };
    (animeData.relations || []).forEach((rel) => {
      (rel.entry || []).forEach((e) => {
        if (e.type !== "anime" || !e.mal_id || seen.has(e.mal_id)) return;
        if (animeData.mal_id && e.mal_id === animeData.mal_id) return;
        seen.add(e.mal_id);
        out.push({
          mal_id: e.mal_id,
          name: e.name,
          url: e.url,
          relation: rel.relation,
          sort: rank[rel.relation] ?? 7,
        });
      });
    });
    return out.sort((a, b) => a.sort - b.sort);
  },

  // Prefer the English title, falling back to the romanized title
  title(a) {
    return a?.title_english || a?.title || "";
  },

  // Admin overrides (custom titles/images) from the anime_edits table,
  // cached after the first load. Returns the map mal_id -> edit row.
  _edits: null,
  async loadEdits() {
    if (this._edits) return this._edits;
    try {
      const { data } = await supabase.from("anime_edits").select("*");
      this._edits = new Map((data || []).map((e) => [e.mal_id, e]));
    } catch (e) {
      this._edits = new Map();
    }
    return this._edits;
  },

  // Mutate an anime object with admin overrides (custom title/image)
  applyEdits(anime) {
    if (!anime || !this._edits) return anime;
    const edit = this._edits.get(anime.mal_id);
    if (edit) {
      if (edit.custom_title) {
        anime.title = edit.custom_title;
        anime.title_english = edit.custom_title;
      }
      if (edit.custom_image) {
        anime.images = anime.images || {};
        anime.images.jpg = { ...(anime.images.jpg || {}), image_url: edit.custom_image, large_image_url: edit.custom_image };
      }
    }
    return anime;
  },

  // Build a card element for an anime object
  card(anime) {
    this.applyEdits(anime);
    const el = document.createElement("div");
    el.className = "anime-card";
    const jp = anime.title_japanese && anime.title_japanese !== this.title(anime)
      ? `<div class="jtitle">${this.esc(anime.title_japanese)}</div>` : "";
    el.innerHTML = `
      <div class="poster">
        <img src="${anime.images?.jpg?.image_url || "https://placehold.co/300x400?text=?"}"
             alt="${this.esc(this.title(anime))}" loading="lazy"
             onerror="this.src='https://placehold.co/300x400?text=?'">
      </div>
      <div class="info">
        <div class="title">${this.esc(this.title(anime))}</div>
        ${jp}
        <div class="meta">
          <span class="score">★ ${anime.score ? anime.score.toFixed(2) : "N/A"}</span>
          <span class="pill">${anime.type || "Anime"}</span>
        </div>
      </div>`;
    el.addEventListener("click", () => {
      const prefix = window.location.pathname.includes("/pages/") ? "" : "pages/";
      window.location.href = `${prefix}anime.html?id=${anime.mal_id}`;
    });
    return el;
  },

  // Escape HTML to prevent breaking markup / XSS
  esc(str) {
    if (!str) return "";
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  },
};
