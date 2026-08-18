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

  // Small wrapper with retry/backoff to respect Jikan rate limits (~3 req/sec).
  // Retries are fast (no long sleep on transient failures) so slow Jikan
  // periods don't make pages crawl.
  async get(path, retries = 3) {
    return this._enqueue(async () => {
      for (let attempt = 0; attempt < retries; attempt++) {
        if (attempt > 0) await new Promise((r) => setTimeout(r, 350));
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

  // In-memory cache for repeated lookups (e.g. the same anime referenced from
  // related/cards). Keys on the full path so paginated calls stay distinct.
  _cache: new Map(),
  cachedGet(path, ttlMs = 10 * 60 * 1000) {
    const hit = this._cache.get(path);
    if (hit && Date.now() - hit.at < ttlMs) return Promise.resolve(hit.val);
    return this.get(path).then((val) => {
      this._cache.set(path, { at: Date.now(), val });
      return val;
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

  // Search with optional filters. Deliberately does NOT set order_by so the
  // API returns results in MAL's native relevance order (the most accurate
  // ranking for a title query) instead of a hard popularity sort.
  async search(query, page = 1, type = "", minScore = "") {
    let q = `type=anime&page=${page}&q=${encodeURIComponent(query)}`;
    if (type) q += `&type=${type}`;
    if (minScore) q += `&min_score=${minScore}`;
    try {
      return await this.get(`/anime?${q}`);
    } catch (err) {
      // Jikan's search endpoint is the first thing to break when its
      // upstream (MAL) is flaky. Fall back to client-side filtering of the
      // top list so search keeps working even during outages.
      const top = await this.catalog(page);
      const needle = query.toLowerCase();
      const score = (t) => String(t).toLowerCase();
      const matched = (top.data || []).filter((a) => {
        const titles = [a.title, a.title_english, a.title_japanese, a.title_synonyms].flat();
        return titles.some((t) => t && score(t).includes(needle));
      }).sort((a, b) => {
        // Rank closer title matches first: exact > starts-with > contains.
        const aT = score(a.title || "");
        const bT = score(b.title || "");
        const rank = (t) => (t === needle ? 0 : t.startsWith(needle) ? 1 : 2);
        return rank(aT) - rank(bT) || aT.length - bT.length;
      });
      top.data = matched;
      top.pagination = top.pagination || {};
      top.pagination.last_visible_page = 1;
      top.pagination.items = { total: matched.length, per_page: matched.length || 1, count: matched.length };
      return top;
    }
  },

  // Anime list filtered by genre
  async byGenre(genreId, page = 1) {
    return this.get(`/anime?genres=${genreId}&order_by=popularity&page=${page}`);
  },

  // All anime for catalog browsing (paged)
  async catalog(page = 1) {
    return this.get(`/top/anime?page=${page}`);
  },

  // Full details for one anime (cached — the same anime is looked up from
  // cards, related sections, and profiles repeatedly). The heavy /full
  // endpoint is the most flaky when MAL is under load, so fall back to the
  // lighter /anime/:id which has everything the page needs.
  async getAnime(id) {
    try {
      return await this.cachedGet(`/anime/${id}/full`);
    } catch (err) {
      return this.cachedGet(`/anime/${id}`);
    }
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

  // MangaDex search by title. The MangaDex API only returns
  // Access-Control-Allow-Origin for its own domains, so browsers can't read
  // it directly — we try the API straight, then via public CORS proxies, and
  // return the first successful result. Returns [] if all attempts fail
  // (callers should fall back to a plain MangaDex search link).
  async mangadexSearch(title, limit = 3) {
    const url = `https://api.mangadex.org/manga?title=${encodeURIComponent(title)}&limit=${limit}`;
    const attempts = [
      url,
      `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
      `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`,
      `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
    ];
    for (const target of attempts) {
      let json = null;
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 12000);
        const res = await fetch(target, { signal: ctrl.signal });
        clearTimeout(timer);
        if (!res.ok) continue;
        const raw = await res.text();
        // allorigins /get wraps the body as {contents: "..."}
        let body = raw;
        try {
          const wrap = JSON.parse(raw);
          if (wrap && typeof wrap === "object" && wrap.contents !== undefined) {
            body = wrap.contents;
          }
        } catch (e) {}
        json = JSON.parse(body);
      } catch (err) {
        continue;
      }
      const q = title.trim().toLowerCase();
      const matchScore = (t) => {
        const s = (t || "").toLowerCase();
        if (s === q) return 100;
        if (s.startsWith(q) || q.startsWith(s)) return 60;
        if (s.includes(q) || q.includes(s)) return 30;
        return 0;
      };
      const list = (json.data || [])
        .filter((m) => m.attributes?.title)
        .map((m) => {
          const t = m.attributes.title;
          const title = t.en || t["ja-ro"] || Object.values(t)[0] || "";
          return { id: m.id, title, url: `https://mangadex.org/title/${m.id}` };
        })
        // Best title match first so we don't link to a random spinoff.
        .sort((a, b) => matchScore(b.title) - matchScore(a.title));
      if (list.length) return list;
    }
    return [];
  },

  // MangaDex search link that always works (no API / CORS involved).
  mangadexSearchLink(title) {
    return `https://mangadex.org/search?q=${encodeURIComponent(title)}`;
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
      window.location.href = `${pageHref("anime")}?id=${anime.mal_id}`;
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

  // Sanitize a user-controlled image/avatar URL for safe use in an HTML
  // attribute (e.g. src="..."). Only absolute http(s) URLs pass; every
  // attribute-breaking character is HTML-escaped (&, ", ', <, >, `, \).
  // Returns "" for anything that isn't a safe http(s) URL, so callers can
  // fall back to their letter-avatar. This closes the stored-XSS vector
  // where a user could set avatar_url to `x" onerror=alert(1)`.
  safeImg(url) {
    if (!url) return "";
    const s = String(url).trim();
    if (!/^https?:\/\//i.test(s)) return "";
    return s.replace(/[&"'<>`\\]/g, (ch) => ({
      "&": "&amp;", '"': "&quot;", "'": "&#39;",
      "<": "&lt;", ">": "&gt;", "`": "&#96;", "\\": "&#92;",
    }[ch]));
  },

  // Escape a value for insertion inside an HTML attribute. Prevents both
  // attribute-breakout (">...) and JS-string breakout (') for raw user data
  // that is later read via dataset / getAttribute in event handlers.
  safeAttr(str) {
    if (str === null || str === undefined) return "";
    return String(str).replace(/[&"'<>`\\]/g, (ch) => ({
      "&": "&amp;", '"': "&quot;", "'": "&#39;",
      "<": "&lt;", ">": "&gt;", "`": "&#96;", "\\": "&#92;",
    }[ch]));
  },

  // ---------- Watch Online (third-party streaming providers) ----------
  // Enabled streaming providers configured in CONFIG.STREAMING. The
  // Archive.org player is always sorted to the end of the list so the
  // on-site community sources (AniPub) appear first. The 9anime provider
  // stays hidden until its hosted API base URL is configured.
  streamingProviders() {
    return (CONFIG.STREAMING || [])
      .filter((s) => s && s.enabled)
      .filter((s) => !(s.id === "nineanime") || CONFIG.NINEANIME_API_BASE)
      .sort((a, b) => (a.id === "archive" ? 1 : 0) - (b.id === "archive" ? 1 : 0));
  },

  // Look up an enabled streaming provider by its id (e.g. "anipub").
  providerById(id) {
    return this.streamingProviders().find((p) => p.id === id) || null;
  },

  // Human-friendly label for a provider's playback mode.
  modeLabel(provider) {
    if (!provider) return "";
    if (provider.mode === "embed") return "Plays on-site";
    if (provider.mode === "video") return "Inline player";
    return "Opens in new tab";
  },

  // Zero-pad an episode number (Jikan gives "012" for ep 12 in some fields).
  padEpisode(n) {
    const num = Number(n);
    if (Number.isNaN(num) || num < 1) return "";
    return String(num).padStart(3, "0");
  },

  // Build a provider's watch/embed URL for a given anime + episode number.
  // Returns null if the provider is disabled or no URL can be built.
  // Only https/http URLs are allowed (protects against javascript: etc.).
  streamingUrl(provider, { mal_id, ep, title }) {
    if (!provider || !provider.url) return null;
    const epNum = this.padEpisode(ep);
    const url = provider.url
      .replace("{mal_id}", String(mal_id || ""))
      .replace("{ep}", epNum)
      .replace("{ep_num}", String(ep || ""))
      .replace("{title}", encodeURIComponent(title || ""));
    try {
      const u = new URL(url, "https://unknown.invalid");
      if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    } catch (e) {
      return null;
    }
    return url;
  },

  // ---------- AniPub dynamic provider (API-resolved episode links) ----------
  // AniPub's embeddable episode pages (https://anipub.xyz/video/{id}/sub)
  // stream reliably inside an iframe, but they are keyed by AniPub's own
  // episode ids, not the MAL id / episode number. These resolve them via
  // AniPub's public (CORS-open) API: search for the anime by title to get
  // its AniPub id, then /v1/api/details for the per-episode video links.
  // Results are cached per MAL id (including failed lookups).
  _anipubCache: new Map(), // mal_id -> { anipubId, eps: [{n, id}] } | null

  async anipubEpisodes(anime) {
    const key = anime?.mal_id;
    if (!key) return null;
    if (this._anipubCache.has(key)) return this._anipubCache.get(key);
    const found = await this._resolveAnipub(anime).catch(() => null);
    this._anipubCache.set(key, found);
    return found;
  },

  // Full embed URL for a given episode on AniPub, or null if unresolvable.
  async anipubUrl(anime, ep) {
    const info = await this.anipubEpisodes(anime);
    const item = (info?.eps || []).find((e) => e.n === Number(ep)) ||
      (info?.eps || [])[Number(ep) - 1];
    return item ? `https://anipub.xyz/video/${item.id}/${item.variant || "sub"}` : null;
  },

  async _resolveAnipub(anime) {
    const title = this.title(anime) || anime?.title;
    if (!title) return null;
    const getJson = async (url) => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      try {
        const res = await fetch(url, { signal: ctrl.signal });
        if (!res.ok) return null;
        return await res.json().catch(() => null);
      } catch (e) {
        return null;
      } finally {
        clearTimeout(timer);
      }
    };

    // 1) search AniPub for the anime by title
    const search = await getJson(
      `https://anipub.xyz/api/searchall/${encodeURIComponent(title)}?page=1`);
    const results = search?.AniData || [];
    if (!results.length) return null;

    // 2) pick the best title match (exact > prefix/contains > first result)
    const norm = (s) => String(s || "").toLowerCase()
      .replace(/[^\p{L}\p{N}]/gu, "");
    const needle = norm(title);
    const score = (name) => {
      const n = norm(name);
      if (!needle || !n) return 0;
      if (n === needle) return 100;
      if (n.startsWith(needle) || needle.startsWith(n)) return 60;
      if (n.includes(needle) || needle.includes(n)) return 30;
      return 0;
    };
    let best = results[0];
    let bestScore = -1;
    results.forEach((r) => {
      const s = score(r.Name);
      if (s > bestScore) { bestScore = s; best = r; }
    });
    if (!best?._id) return null;

    // 3) episode list → /video/{id}/sub|dub links, in order (1..N). Links may
    // use www.anipub.xyz and carry a sub/dub suffix — normalize the domain and
    // keep the original variant.
    const det = await getJson(`https://anipub.xyz/v1/api/details/${best._id}`);
    const eps = (det?.local?.ep || []).map((e, i) => {
      const m = /(?:www\.)?anipub\.xyz\/video\/(\d+)\/(sub|dub)/i.exec(e?.link || "");
      return m ? { n: i + 1, id: m[1], variant: m[2] } : null;
    }).filter(Boolean);
    if (!eps.length) return null;
    return { anipubId: best._id, eps };
  },

  // ---------- 9anime dynamic provider (hosted NineAnimeClient API) ----------
  // The NineAnimeClient npm lib is Node-only, so it cannot run on static
  // GitHub Pages. When CONFIG.NINEANIME_API_BASE points at a hosted copy of
  // its demo server (Vercel/Railway/Render), these helpers resolve 9anime
  // streams and play them through the on-site <video> player (mode "video"),
  // tunneling around referer/CORS limits via the demo's /proxy/m3u8 +
  // /proxy/segment endpoints. Every step resolves to null when the API is
  // missing, disabled, or the title/episode can't be found (callers show a
  // graceful fallback). Enabled only once CONFIG.NINEANIME_API_BASE is set.
  nineAnimeBase() {
    return (CONFIG.NINEANIME_API_BASE || "").replace(/\/+$/, "");
  },

  _nineCache: new Map(), // mal_id -> { animeId, eps: [{n, season}] } | null

  async nineAnimeUrl(anime, ep) {
    const base = this.nineAnimeBase();
    if (!base) return null;
    const key = anime?.mal_id;
    if (key && this._nineCache.has(key)) {
      return this._nineStreamUrl(base, this._nineCache.get(key), ep);
    }
    const resolved = await this._resolveNineAnime(anime).catch(() => null);
    if (key) this._nineCache.set(key, resolved);
    return resolved ? this._nineStreamUrl(base, resolved, ep) : null;
  },

  async _nineGet(url) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10000);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) return null;
      return await res.json().catch(() => null);
    } catch (e) {
      return null;
    } finally {
      clearTimeout(timer);
    }
  },

  async _resolveNineAnime(anime) {
    const base = this.nineAnimeBase();
    const title = this.title(anime) || anime?.title;
    if (!base || !title) return null;

    // 1) search the 9anime catalog for the title
    const search = await this._nineGet(`${base}/api/search?q=${encodeURIComponent(title)}`);
    const results = Array.isArray(search) ? search
      : (Array.isArray(search?.data) ? search.data : []);
    if (!results.length) return null;

    // 2) pick the best title match (exact > prefix > contains > first)
    const norm = (s) => String(s || "").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
    const needle = norm(title);
    const score = (name) => {
      const n = norm(name);
      if (!needle || !n) return 0;
      if (n === needle) return 100;
      if (n.startsWith(needle) || needle.startsWith(n)) return 60;
      if (n.includes(needle) || needle.includes(n)) return 30;
      return 0;
    };
    let best = results[0];
    let bestScore = -1;
    results.forEach((r) => {
      const s = score(r.title || r.name || r.animeTitle || "");
      if (s > bestScore) { bestScore = s; best = r; }
    });
    const animeId = best?.id || best?.animeId || best?.anime_id;
    if (!animeId) return null;

    // 3) episode list (accepts the common response shapes)
    const details = await this._nineGet(`${base}/api/anime/${animeId}/details`);
    const eps = this._nineEpisodes(details);
    if (!eps.length) return null;
    return { animeId, eps };
  },

  // Normalize the episode list from a details response. Accepts:
  //   { seasons: [{ id, episodes: [{number, episodeId}] }] }
  //   { episodes: [{number, episodeId}] }
  //   { data: { episodes: [...] } }
  _nineEpisodes(details) {
    const out = [];
    const push = (n, season) => { if (n) out.push({ n: Number(n), season }); };
    const src = details?.data || details;
    const seasons = Array.isArray(src?.seasons) ? src.seasons
      : (Array.isArray(src?.seasonList) ? src.seasonList : []);
    if (seasons.length) {
      seasons.forEach((s) => {
        const id = s.id || s.season || "season-1";
        (Array.isArray(s.episodes) ? s.episodes : []).forEach((e) =>
          push(e.number ?? e.ep ?? e.episodeId, id));
      });
    } else {
      const flat = Array.isArray(src?.episodes) ? src.episodes
        : (Array.isArray(src?.epList) ? src.epList : []);
      flat.forEach((e) => push(e.number ?? e.ep ?? e.episodeId, "season-1"));
    }
    return out.sort((a, b) => a.n - b.n);
  },

  // Resolve one episode to a proxied HLS URL on the demo server.
  async _nineStreamUrl(base, info, ep) {
    if (!info) return null;
    const item = info.eps.find((e) => e.n === Number(ep)) || info.eps[Number(ep) - 1];
    if (!item) return null;
    const q = `season=${encodeURIComponent(item.season || "season-1")}&episode=${Number(ep)}`;
    const streams = await this._nineGet(`${base}/api/anime/${info.animeId}/streams?${q}`);
    if (!streams) return null;

    // Flatten every plausible source shape into { urls, ref } candidates.
    const candidates = [];
    const add = (c) => {
      if (!c || typeof c !== "object") return;
      const urls = [];
      if (typeof c.streamUrl === "string") urls.push(c.streamUrl);
      (Array.isArray(c.streams) ? c.streams : []).forEach((st) => {
        if (st && typeof st === "object" && st.url) urls.push(st.url);
        else if (typeof st === "string") urls.push(st);
      });
      if (typeof c.url === "string") urls.push(c.url);
      const ref = c.headers?.referer || c.headers?.Referer || c.headers?.referrer || "";
      if (urls.length) candidates.push({ urls, ref });
    };
    [streams, streams?.sources, streams?.sub, streams?.dub, streams?.unknown]
      .forEach((x) => {
        if (Array.isArray(x)) x.forEach(add);
        else add(x);
      });

    const hit = candidates.find((c) => c.urls.some((u) => /\.m3u8(\?|$)/i.test(u))) ||
      candidates[0];
    if (!hit) return null;
    const m3u8 = hit.urls.find((u) => /\.m3u8(\?|$)/i.test(u)) || hit.urls[0];
    return `${base}/api/proxy/m3u8?url=${encodeURIComponent(m3u8)}&ref=${encodeURIComponent(hit.ref || "")}`;
  },
};
