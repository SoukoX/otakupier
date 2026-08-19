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
  _health: new Map(), // list-endpoint path -> last failure timestamp (ms)
  _markDown(family) { this._health.set(family, Date.now()); },
  _isDown(family, windowMs = 45 * 1000) {
    const t = this._health.get(family);
    return t != null && Date.now() - t < windowMs;
  },
  async get(path, retries = 3) {
    // Only list/search endpoints (/anime?…, /top/…) are circuit-broken —
    // detail lookups like /anime/123 must never be blocked by a dead search
    // endpoint. /top/anime is excluded too (it's our reliable fallback).
    const qidx = path.indexOf("?");
    const family = qidx >= 0 && !path.startsWith("/top/anime") ? path.slice(0, qidx) : null;
    if (family && this._isDown(family)) return Promise.reject(new Error(`Jikan API ${family} marked down`));
    return this._enqueue(async () => {
      for (let attempt = 0; attempt < retries; attempt++) {
        if (attempt > 0) await new Promise((r) => setTimeout(r, 350));
        let res;
        try {
          res = await fetch(`${this.base}${path}`);
        } catch (err) {
          if (attempt < retries - 1) continue;
          if (family) this._markDown(family);
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
          if (family) this._markDown(family);
        }
        throw new Error(`Jikan API error ${res.status}`);
      }
      throw new Error(`Jikan API error after retries`);
    });
  },

  // In-memory cache for repeated lookups (e.g. the same anime referenced from
  // related/cards). Keys on the full path so paginated calls stay distinct.
  _cache: new Map(),
  _inflight: new Map(), // path -> Promise (dedupes concurrent identical fetches)
  cachedGet(path, ttlMs = 10 * 60 * 1000) {
    const hit = this._cache.get(path);
    if (hit && Date.now() - hit.at < ttlMs) return Promise.resolve(hit.val);
    if (this._inflight.has(path)) return this._inflight.get(path);
    const p = this.get(path).then((val) => {
      this._cache.set(path, { at: Date.now(), val });
      return val;
    }).finally(() => this._inflight.delete(path));
    this._inflight.set(path, p);
    return p;
  },

  // Cached+deduped top-list page. /top/anime is the most reliable Jikan
  // endpoint (its items also carry genre tags), so it backs genre fallback
  // and the search pool — fetching it once per session and sharing the
  // in-flight promise avoids redundant calls when several features hit it
  // at once (catalog browsing + search pool + genre fallback).
  _topCache: new Map(), // page -> { at, val }
  _topInflight: new Map(), // page -> Promise
  topPage(page = 1, ttlMs = 10 * 60 * 1000) {
    const hit = this._topCache.get(page);
    if (hit && Date.now() - hit.at < ttlMs) return Promise.resolve(hit.val);
    if (this._topInflight.has(page)) return this._topInflight.get(page);
    const p = this.get(`/top/anime?page=${page}`).then((val) => {
      this._topCache.set(page, { at: Date.now(), val });
      return val;
    }).finally(() => this._topInflight.delete(page));
    this._topInflight.set(page, p);
    return p;
  },

  // Trending/popular anime for the homepage. Jikan's popularity filter is
  // occasionally flaky (upstream MAL issues), so fall back to the plain
  // top list rather than failing the whole request.
  async topAnime(page = 1) {
    try {
      return await this.get(`/top/anime?filter=bypopularity&page=${page}`, 2);
    } catch (err) {
      return this.topPage(page);
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

  // ---------- Smarter search (fuzzy + genre-aware) ----------
  // Beyond Jikan's plain relevance search: candidates are gathered from the
  // search endpoint, the title it matches to a genre (so typing "romance"
  // lists romance anime), and the top list — then every candidate is scored
  // client-side so exact, starts-with, contains, token-overlap, and typo-
  // tolerant (edit-distance) matches all surface, ranked best-first.

  // Normalize for matching: lowercase, strip accents, collapse symbols/spaces.
  _norm(s) {
    return String(s || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  },

  // Levenshtein edit distance (backing the typo-tolerant scoring).
  _lev(a, b) {
    const m = a.length, n = b.length;
    if (!m) return n;
    if (!n) return m;
    let prev = new Array(n + 1);
    let cur = new Array(n + 1);
    for (let j = 0; j <= n; j++) prev[j] = j;
    for (let i = 1; i <= m; i++) {
      cur[0] = i;
      for (let j = 1; j <= n; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      }
      const t = prev; prev = cur; cur = t;
    }
    return prev[n];
  },

  // Score one title against the normalized query → 0..1 (1 = exact).
  _fuzzyScore(qn, title) {
    if (!title || !qn) return 0;
    const tn = this._norm(title);
    if (!tn) return 0;
    if (tn === qn) return 1;
    if (tn.startsWith(qn)) return 0.94;
    if (tn.includes(qn)) return 0.88;
    const qTokens = qn.split(" ").filter(Boolean);
    const tTokens = tn.split(" ").filter(Boolean);
    if (qTokens.length > 1 && qTokens.every((w) => tn.includes(w))) return 0.84;
    if (qTokens.length && qTokens.every((w) => tTokens.some((tw) => tw.startsWith(w)))) return 0.8;
    if (qTokens.some((w) => tTokens.some((tw) => tw.startsWith(w)))) return 0.66;
    // Typo-tolerant: close spelling variants still match.
    const dist = this._lev(qn, tn);
    const sim = 1 - dist / Math.max(qn.length, tn.length);
    return sim >= 0.7 ? Math.min(0.82, 0.6 + (sim - 0.7) * 2) : 0;
  },

  // Best fuzzy score across every title a candidate carries.
  _bestScore(qn, a) {
    const titles = [a.title, a.title_english, a.title_japanese, a.title_synonyms].flat();
    let best = 0;
    for (const t of titles) best = Math.max(best, this._fuzzyScore(qn, t));
    return best;
  },

  _genreCache: null,

  // Static fallback genre map (id -> name) mirroring Jikan's official genres.
  // Lets genre-name queries ("romance", "action", …) resolve even when Jikan's
  // /genres endpoint is unreachable, so search never silently drops to nothing.
  _STATIC_GENRES: {
    Action: 1, Adventure: 2, "Avant Garde": 5, "Award Winning": 46,
    "Boys Love": 28, Comedy: 4, Drama: 8, Ecchi: 9, Fantasy: 10,
    "Girls Love": 26, Gourmet: 47, Hentai: 12, Historical: 13, Horror: 14,
    Josei: 43, Kids: 15, Magic: 16, "Martial Arts": 17, Mecha: 18,
    Military: 38, Music: 19, Mystery: 7, Parody: 20, Psychological: 40,
    Romance: 22, School: 23, "Sci-Fi": 24, Seinen: 42, Shoujo: 25,
    "Shoujo Ai": 73, Shounen: 27, "Shounen Ai": 74, "Slice of Life": 36,
    Space: 29, Sports: 30, "Super Power": 31, Supernatural: 37,
    Thriller: 41, Vampire: 32,
  },

  // Genre list = API result merged with the static map, so a failed API call
  // can never permanently disable genre matching (an empty result is NOT
  // cached — the next search retries).
  async _genresCached() {
    if (this._genreCache) return this._genreCache;
    const res = await this.genres().catch(() => null);
    const fromApi = (res || []).map((g) => ({ id: g.mal_id, name: this._norm(g.name) }));
    const fromStatic = Object.keys(this._STATIC_GENRES)
      .map((n) => ({ id: this._STATIC_GENRES[n], name: this._norm(n) }));
    const merged = [];
    const seen = new Set();
    for (const g of fromApi.concat(fromStatic)) {
      if (seen.has(g.id)) continue;
      seen.add(g.id);
      merged.push(g);
    }
    if (merged.length) this._genreCache = merged;
    return merged;
  },

  // If the query is basically a genre name, return it (exact, prefix, fuzzy).
  async _matchGenre(qn) {
    const list = await this._genresCached();
    let best = null, bestScore = 0;
    for (const g of list) {
      const s = this._fuzzyScore(qn, g.name);
      if (s > bestScore) { bestScore = s; best = g; }
    }
    return bestScore >= 0.8 ? best : null;
  },

  _searchCache: new Map(), // norm(query)|genre -> { at, merged }

  // Merge + score a fuzzy result pool, cached 5 min, then slice for paging.
  async smartSearch(query, page = 1, genreId = "") {
    const qn = this._norm(query);
    const cacheKey = (qn || "*") + "|" + (genreId || "");
    let merged = null;
    const hit = this._searchCache.get(cacheKey);
    if (hit && Date.now() - hit.at < 5 * 60 * 1000) merged = hit.merged;
    if (!merged) {
      merged = await this._buildSearchPool(query, qn, genreId);
      this._searchCache.set(cacheKey, { at: Date.now(), merged });
    }
    const PER = 24;
    const start = (page - 1) * PER;
    const data = merged.slice(start, start + PER);
    return {
      data,
      pagination: {
        last_visible_page: Math.max(1, Math.ceil(merged.length / PER)),
        items: { total: merged.length, per_page: PER, count: data.length },
      },
    };
  },

  async _buildSearchPool(query, qn, genreId) {
    const pool = [];
    if (query && !genreId) {
      pool.push(this.get(`/anime?type=anime&sfw=true&page=1&q=${encodeURIComponent(query)}`, 2));
      pool.push(this.get(`/anime?type=anime&sfw=true&page=2&q=${encodeURIComponent(query)}`, 2));
      // AniList search = wide-spectrum direct search (thousands of results)
      // regardless of Jikan's health; merges + dedupes by mal_id below.
      pool.push(this.aniSearch(query, 1).catch(() => null));
      pool.push(this.aniSearch(query, 2).catch(() => null));
    }
    let genre = null;
    if (genreId) {
      genre = { id: genreId };
    } else if (query) {
      genre = await this._matchGenre(qn);
    }
    let genrePool = false;
    let genreStart = -1;
    let genreEnd = -1;
    if (genre && genre.id) {
      genrePool = true;
      genreStart = pool.length;
      pool.push(this.get(`/anime?genres=${genre.id}&order_by=popularity&sfw=true&page=1`, 2));
      pool.push(this.get(`/anime?genres=${genre.id}&order_by=popularity&sfw=true&page=2`, 2));
      pool.push(this.aniByGenre(genre.id, 1).catch(() => null));
      pool.push(this.aniByGenre(genre.id, 2).catch(() => null));
      genreEnd = pool.length;
    }
    // Top list = a wider fuzzy-matching pool for near/partial titles Jikan's
    // search endpoint misses (and a client-side fallback when it's down).
    pool.push(this.topPage(1));
    pool.push(this.topPage(2));
    pool.push(this.topPage(3));

    const settled = await Promise.allSettled(pool);
    const map = new Map(); // mal_id -> { anime, score }
    const add = (a, score) => {
      if (!a || !a.mal_id) return;
      const cur = map.get(a.mal_id);
      if (!cur || score > cur.score) map.set(a.mal_id, { anime: a, score });
    };

    settled.forEach((s, i) => {
      if (s.status !== "fulfilled" || !s.value?.data) return;
      const fromGenrePool = genrePool && i >= genreStart && i < genreEnd;
      for (const a of s.value.data) {
        let score = this._bestScore(qn, a);
        // Genre-pool titles are valid answers for a genre query even when the
        // title itself doesn't contain the genre word. The same boost applies
        // to ANY pool item tagged with the genre (e.g. top-list items) so a
        // failing /anime endpoint can't empty a genre search.
        const tagged = genre && genre.id && (a.genres || []).some((g) => g.mal_id === genre.id);
        if ((fromGenrePool || tagged) && genre && genre.id) score = Math.max(score, 0.55);
        add(a, score);
      }
    });

    // Floor: a plain query needs ≥0.5, genre-only browsing (no query) passes
    // the genre-pool floor (0.55), and an empty unfiltered pool needs 0.6.
    const minScore = !qn && genre && genre.id ? 0.55 : (qn ? 0.5 : 0.6);
    const list = Array.from(map.values())
      .filter((e) => e.score >= minScore)
      .sort((a, b) =>
        b.score - a.score ||
        (a.anime.rank || 99999) - (b.anime.rank || 99999) ||
        (a.anime.title || "").localeCompare(b.anime.title || ""))
      .map((e) => e.anime);
    return list.slice(0, 150);
  },

  // Lightweight top suggestions for the typeahead dropdown (uses the same
  // merged pool so repeated typing is served from cache).
  async suggest(query) {
    const res = await this.smartSearch(query, 1);
    return (res.data || []).slice(0, 6);
  },

  // Anime list filtered by genre
  async byGenre(genreId, page = 1) {
    // Chain: Jikan (fast when healthy) → AniList (wide, same MAL ids) →
    // top-tag client filter (last resort). The genre select + genre browsing
    // hit this, so it must never show an empty grid just because Jikan's
    // /anime endpoint is flaky.
    try {
      // Fewer retries — the fallbacks below are near-instant, so a slow retry
      // loop on the dead endpoint would only delay showing results.
      return await this.get(`/anime?genres=${genreId}&order_by=popularity&page=${page}`, 2);
    } catch (err) {
      try {
        const ani = await this.aniByGenre(genreId, page);
        if (ani && ani.data && ani.data.length) return ani;
      } catch (e) { /* fall through */ }
      // /anime 504s when Jikan's upstream (MAL) is down, but /top/anime keeps
      // working and its items carry genre tags — so filter the top list
      // client-side as a same-shaped fallback instead of showing an empty grid.
      const per = 25;
      const pages = (await Promise.allSettled([1, 2, 3].map((p) => this.topPage(p))))
        .filter((s) => s.status === "fulfilled")
        .map((s) => s.value);
      const gid = Number(genreId);
      const matched = [];
      for (const res of pages) {
        for (const a of res.data || []) {
          if (a.genres && a.genres.some((g) => g.mal_id === gid) && !matched.some((m) => m.mal_id === a.mal_id)) {
            matched.push(a);
          }
        }
      }
      const start = (page - 1) * per;
      return {
        data: matched.slice(start, start + per),
        pagination: {
          last_visible_page: Math.max(1, Math.ceil(matched.length / per)),
          items: { total: matched.length, per_page: per, count: Math.min(per, Math.max(0, matched.length - start)) },
        },
      };
    }
  },

  // ---------- AniList fallback (wide-spectrum catalog/search) ----------
  // AniList is a free, CORS-open GraphQL API sharing MAL's ids (idMal). When
  // Jikan's /anime endpoint 504s (MAL upstream issues), it keeps genre browse
  // and search wide instead of collapsing to a ~50-title top pool.

  // Jikan genre id → AniList filter. AniList's fixed genre list only has 19
  // names; the rest are tags (verified against GenreCollection/MediaTagCollection).
  _ANI_GENRE_MAP: {
    1: { type: "genre", name: "Action" }, 2: { type: "genre", name: "Adventure" },
    4: { type: "genre", name: "Comedy" }, 5: { type: "genre", name: "Action" },
    7: { type: "genre", name: "Mystery" }, 8: { type: "genre", name: "Drama" },
    9: { type: "genre", name: "Ecchi" }, 10: { type: "genre", name: "Fantasy" },
    12: { type: "genre", name: "Hentai" }, 13: { type: "tag", name: "Historical" },
    14: { type: "genre", name: "Horror" }, 15: { type: "tag", name: "Kids" },
    16: { type: "tag", name: "Magic" }, 17: { type: "tag", name: "Martial Arts" },
    18: { type: "genre", name: "Mecha" }, 19: { type: "genre", name: "Music" },
    20: { type: "tag", name: "Parody" }, 22: { type: "genre", name: "Romance" },
    23: { type: "tag", name: "School" }, 24: { type: "genre", name: "Sci-Fi" },
    25: { type: "tag", name: "Shoujo" }, 26: { type: "tag", name: "Yuri" },
    27: { type: "tag", name: "Shounen" }, 28: { type: "tag", name: "Boys' Love" },
    29: { type: "tag", name: "Space" }, 30: { type: "genre", name: "Sports" },
    31: { type: "tag", name: "Super Power" }, 32: { type: "tag", name: "Vampire" },
    36: { type: "genre", name: "Slice of Life" }, 37: { type: "genre", name: "Supernatural" },
    38: { type: "tag", name: "Military" }, 40: { type: "genre", name: "Psychological" },
    41: { type: "genre", name: "Thriller" }, 42: { type: "tag", name: "Seinen" },
    43: { type: "tag", name: "Josei" }, 73: { type: "tag", name: "Yuri" },
    74: { type: "tag", name: "Boys' Love" },
    // 5 (Avant Garde), 46 (Award Winning), 47 (Gourmet): no AniList equivalent →
    // byGenre falls through to the top-tag client filter for those.
  },

  _aniCache: new Map(),   // query+variables key -> { at, val }
  _aniInflight: new Map(), // key -> Promise
  async _aniQuery(query, variables) {
    const key = JSON.stringify([query, variables]);
    const hit = this._aniCache.get(key);
    if (hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.val;
    if (this._aniInflight.has(key)) return this._aniInflight.get(key);
    const p = (async () => {
      const res = await fetch(CONFIG.ANILIST_BASE, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ query, variables }),
      });
      const body = await res.json();
      if (!body || body.errors) throw new Error(body?.errors?.[0]?.message || "AniList error");
      return body.data;
    })().then((val) => {
      this._aniCache.set(key, { at: Date.now(), val });
      return val;
    }).finally(() => this._aniInflight.delete(key));
    this._aniInflight.set(key, p);
    return p;
  },

  // Convert an AniList media node into a Jikan-shaped anime object so every
  // consumer (cards, suggest, detail links) works unchanged.
  _aniToJikan(m) {
    return {
      mal_id: m.idMal,
      title: m.title?.english || m.title?.romaji || "",
      title_english: m.title?.english || "",
      title_japanese: m.title?.native || "",
      images: { jpg: { image_url: m.coverImage?.extraLarge || m.coverImage?.large || "" } },
      score: m.averageScore != null ? m.averageScore / 10 : null,
      type: m.format,
      year: m.startDate?.year,
      rank: null,
      genres: (m.genres || []).map((name) => ({ name })),
    };
  },

  _ANI_PAGE_FIELDS: `
      pageInfo { currentPage lastPage hasNextPage total }
      media(type: ANIME, isAdult: false, idMal_not: null, sort: [POPULARITY_DESC]) {
        id idMal title { romaji english native }
        coverImage { extraLarge large }
        averageScore format startDate { year } genres
      }`,

  // Wide genre browse via AniList (genre or tag filter). Returns Jikan shape.
  async aniByGenre(genreId, page = 1) {
    const map = this._ANI_GENRE_MAP[Number(genreId)];
    if (!map) return { data: [], pagination: { last_visible_page: 1, items: { total: 0, per_page: 25, count: 0 } } };
    const q = map.type === "genre"
      ? `query($g: [String], $p: Int, $per: Int) { Page(page: $p, perPage: $per) { ${this._ANI_PAGE_FIELDS.replace("media(type: ANIME, isAdult: false, idMal_not: null, sort: [POPULARITY_DESC])", `media(type: ANIME, genre_in: $g, isAdult: false, idMal_not: null, sort: [POPULARITY_DESC])`)} } }`
      : `query($t: [String], $p: Int, $per: Int) { Page(page: $p, perPage: $per) { ${this._ANI_PAGE_FIELDS.replace("media(type: ANIME, isAdult: false, idMal_not: null, sort: [POPULARITY_DESC])", `media(type: ANIME, tag_in: $t, isAdult: false, idMal_not: null, sort: [POPULARITY_DESC])`)} } }`;
    const vars = map.type === "genre" ? { g: [map.name] } : { t: [map.name] };
    const data = await this._aniQuery(q, { ...vars, p: page, per: 25 });
    const nodes = data?.Page?.media || [];
    const total = data?.Page?.pageInfo?.total || nodes.length;
    return {
      data: nodes.map((m) => this._aniToJikan(m)),
      pagination: {
        last_visible_page: data?.Page?.pageInfo?.lastPage || 1,
        items: { total, per_page: 25, count: nodes.length },
      },
    };
  },

  // Wide direct search via AniList. Returns Jikan shape.
  async aniSearch(query, page = 1) {
    const q = `query($s: String, $p: Int, $per: Int) { Page(page: $p, perPage: $per) { ${this._ANI_PAGE_FIELDS.replace("media(type: ANIME, isAdult: false, idMal_not: null, sort: [POPULARITY_DESC])", "media(type: ANIME, search: $s, isAdult: false, idMal_not: null, sort: [POPULARITY_DESC])")} } }`;
    const data = await this._aniQuery(q, { s: query, p: page, per: 25 });
    const nodes = data?.Page?.media || [];
    const total = data?.Page?.pageInfo?.total || nodes.length;
    return {
      data: nodes.map((m) => this._aniToJikan(m)),
      pagination: {
        last_visible_page: data?.Page?.pageInfo?.lastPage || 1,
        items: { total, per_page: 25, count: nodes.length },
      },
    };
  },

  // All anime for catalog browsing. Rotates the sort daily so the "Latest
  // titles" first page isn't the same every visit, falling back to Jikan's
  // cached top list when AniList is unreachable.
  _ANI_SORTS: ["POPULARITY_DESC", "SCORE_DESC", "TRENDING_DESC", "FAVOURITES_DESC"],
  async catalog(page = 1) {
    try {
      const day = Math.floor(Date.now() / 86400000);
      const sort = this._ANI_SORTS[day % this._ANI_SORTS.length];
      const q = `query($p: Int, $per: Int, $sort: [MediaSort]) { Page(page: $p, perPage: $per) { ${this._ANI_PAGE_FIELDS.replace("sort: [POPULARITY_DESC]", "sort: $sort")} } }`;
      const data = await this._aniQuery(q, { p: page, per: 25, sort: [sort] });
      const nodes = data?.Page?.media || [];
      if (nodes.length) {
        return {
          data: nodes.map((m) => this._aniToJikan(m)),
          pagination: {
            last_visible_page: data.Page.pageInfo.lastPage || 1,
            items: { total: data.Page.pageInfo.total || nodes.length, per_page: 25, count: nodes.length },
          },
        };
      }
    } catch (e) { /* fall back below */ }
    return this.topPage(page);
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
  // Enabled streaming providers configured in CONFIG.STREAMING. The 9anime
  // provider stays hidden until its hosted API base URL is configured.
  streamingProviders() {
    return (CONFIG.STREAMING || [])
      .filter((s) => s && s.enabled)
      .filter((s) => !(s.id === "nineanime") || CONFIG.NINEANIME_API_BASE);
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
  _anipubCache: new Map(), // mal_id -> { at: timestamp, value: { anipubId, eps } | null }

  // Resolve an anime's AniPub episode list, cached per MAL id. Results (even
  // null) are cached briefly so a transient API failure doesn't permanently
  // fail the title for the rest of the session, while genuinely-missing
  // titles aren't re-resolved on every episode click.
  async anipubEpisodes(anime) {
    const key = anime?.mal_id;
    if (!key) return null;
    const cached = this._anipubCache.get(key);
    if (cached && Date.now() - cached.at < 5 * 60 * 1000) return cached.value;
    const found = await this._resolveAnipub(anime).catch(() => null);
    this._anipubCache.set(key, { at: Date.now(), value: found });
    return found;
  },

  // Full embed URL for a given episode on AniPub, or null if unresolvable.
  // `variant` (optional) forces the sub/dub suffix; otherwise the variant the
  // API returned for that episode is kept.
  async anipubUrl(anime, ep, variant) {
    const info = await this.anipubEpisodes(anime);
    const item = (info?.eps || []).find((e) => e.n === Number(ep)) ||
      (info?.eps || [])[Number(ep) - 1];
    if (!item) return null;
    return `https://anipub.xyz/video/${item.id}/${variant || item.variant || "sub"}`;
  },

  // Whether an AniPub episode has an English-dub file. megaplay serves its
  // player from /stream/s-2/{id}/dub and omits `data-id` (showing an
  // "Error - MegaPlay" page) when the dub file is missing, so the availability
  // is sniffed from that page. Fails open (returns true) if the probe can't
  // run, letting the player attempt the dub anyway.
  async anipubDubAvailable(id) {
    try {
      const r = await fetch(`https://megaplay.buzz/stream/s-2/${id}/dub`);
      if (!r.ok) return false;
      const t = await r.text();
      return /data-id="\d+"/.test(t) && !/Error - MegaPlay/.test(t);
    } catch (e) {
      return true;
    }
  },

  async _resolveAnipub(anime) {
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

    // Search titles tried in order — the localized/English name first, then
    // the original (often the one AniPub indexes) and any synonyms. Stops at
    // the first variant that resolves a playable episode list.
    const seenTitles = new Set();
    const searchTitles = [
      this.title(anime) || anime?.title,
      anime?.title_english,
      anime?.title,
      anime?.title_japanese,
      ...(anime?.title_synonyms || []),
    ].filter((t) => t && !seenTitles.has(t) && seenTitles.add(t));

    // Resolve one title variant to an episode list (or null).
    const tryTitle = async (title) => {
      // 1) search AniPub for the anime by title (one retry — the search
      // endpoint occasionally returns an empty response)
      let search = await getJson(
        `https://anipub.xyz/api/searchall/${encodeURIComponent(title)}?page=1`);
      if (!search) search = await getJson(
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
      // Rank by title match, then confirm against AniPub's own MAL id so we
      // land on the exact entry (not a movie/OVA/sequel with a similar name).
      // AniPub exposes MALID via /api/info/{id}; scan the search results (the
      // correct entry can rank well below similarly-named movies/OVAs) and
      // prefer a MAL id match, falling back to the best title score.
      const malId = anime?.mal_id ? String(anime.mal_id) : "";
      const malEps = Number(anime?.episodes) || 0;
      const plausible = (count) => !malEps || !count ||
        Math.abs(count - malEps) <= Math.max(2, malEps * 0.15);
      let ranked = results
        .map((r) => ({ r, s: score(r.Name) }))
        .sort((a, b) => b.s - a.s);
      const candidates = ranked.slice(0, 20).map((x) => x.r);
      let best = null;
      if (malId) {
        for (const c of candidates) {
          const info = await getJson(`https://anipub.xyz/api/info/${c._id}`);
          if (info && String(info.MALID) === malId) {
            // AniPub's MAL ids/episode counts are occasionally mislabeled
            // (e.g. "Gintama: Enchousen" carrying the 201-ep "Gintama" MAL
            // id). Skip a match whose episode count is implausible so the
            // real entry wins.
            if (plausible(Number(info?.epCount) || 0)) { best = c; break; }
          }
        }
      }
      if (!best) {
        // No MAL-id match: accept the best title-scored candidate. Exact-name
        // matches are taken as-is (the ep count metadata is often missing or
        // off); fuzzy matches additionally need a plausible episode count so
        // OVAs/movies with similar names aren't mislabeled as the series.
        const top = ranked[0];
        const topScore = top?.s || 0;
        if (top && topScore >= 60) {
          const info = await getJson(`https://anipub.xyz/api/info/${top.r._id}`);
          const count = Number(info?.epCount) || 0;
          if (topScore >= 100 || plausible(count)) best = top.r;
        } else if (top && topScore > 0) {
          best = top.r;
        }
      }
      if (!best?._id) return null;

      // 3) episode list → /video/{id}/sub|dub links. The details response
      // stores Episode 1 in `local.link` and `local.ep[]` starts at Episode
      // 2 — so prepend `local.link` to keep the correct 1..N order (some
      // titles are off-by-one otherwise). Links may use www.anipub.xyz and
      // carry a sub/dub suffix — normalize the domain and keep the variant.
      let det = await getJson(`https://anipub.xyz/v1/api/details/${best._id}`);
      if (!det) det = await getJson(`https://anipub.xyz/v1/api/details/${best._id}`);
      const parse = (link) => {
        const m = /(?:www\.)?anipub\.xyz\/video\/(\d+)\/(sub|dub)/i.exec(link || "");
        return m ? { id: m[1], variant: m[2] } : null;
      };
      const eps = (det?.local?.ep || []).map((e, i) => {
        const p = parse(e?.link);
        return p ? { n: i + 2, ...p } : null;
      }).filter(Boolean);
      const first = parse(det?.local?.link);
      if (first && (eps.length === 0 || first.id !== eps[0].id)) {
        eps.unshift({ n: 1, ...first });
      }
      if (!eps.length) return null;
      return { anipubId: best._id, eps };
    };

    for (const title of searchTitles) {
      const found = await tryTitle(title);
      if (found) return found;
    }
    return null;
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

  // ---------- AniKotoAPI dynamic provider (megaplay embed URLs) ----------
  // AniKotoAPI (https://anikototvapi.vercel.app) is a free, CORS-open anime
  // catalog API scraping anikototv.to. It covers titles AniPub lacks (e.g.
  // Fullmetal Alchemist: Brotherhood) and exposes both sub & dub. Its flow:
  //   search?keyword=   -> candidates (animeId, sub/dub counts)
  //   /episodes/{animeId} -> episode list (episode_no + server_ids + mal_id)
  //   /servers?ids=...  -> per-episode servers typed sub / dub / hsub
  //   /stream?id=...    -> the embed URL (megaplay, streams inside an iframe)
  // Episode data is cached per MAL id (5 min TTL), stream URLs per episode.
  _anikotoCache: new Map(),        // mal_id -> { at, value: { animeId, eps, dub } | null }
  _anikotoStreamCache: new Map(),  // server_ids|variant -> { at, url }

  anikotoBase() {
    return "https://anikototvapi.vercel.app/api";
  },

  // Resolve an anime's AniKoto episode list, cached per MAL id (same 5-min
  // TTL + transient-failure tolerance as the AniPub cache).
  async anikotoEpisodes(anime) {
    const key = anime?.mal_id;
    if (!key) return null;
    const cached = this._anikotoCache.get(key);
    if (cached && Date.now() - cached.at < 5 * 60 * 1000) return cached.value;
    const found = await this._resolveAnikoto(anime).catch(() => null);
    this._anikotoCache.set(key, { at: Date.now(), value: found });
    return found;
  },

  // Whether the catalog lists English-dub tracks for the title.
  async anikotoDubAvailable(anime) {
    const info = await this.anikotoEpisodes(anime);
    return !!(info && info.dub);
  },

  // Full embed URL for one episode, or null if unresolvable. `variant`
  // ("sub"|"dub") picks the matching server; sub is the fallback.
  async anikotoUrl(anime, ep, variant) {
    const info = await this.anikotoEpisodes(anime);
    if (!info) return null;
    const item = (info.eps || []).find((e) => e.n === Number(ep)) ||
      (info.eps || [])[Number(ep) - 1];
    if (!item?.server_ids) return null;
    const want = variant === "dub" ? "dub" : "sub";
    const cacheKey = item.server_ids + "|" + want;
    const cached = this._anikotoStreamCache.get(cacheKey);
    if (cached && Date.now() - cached.at < 5 * 60 * 1000) return cached.url;

    const servers = await this._anikotoGet(
      `${this.anikotoBase()}/servers?ids=${encodeURIComponent(item.server_ids)}`);
    const list = Array.isArray(servers?.results) ? servers.results : [];
    let server = list.find((s) => s.type === want);
    if (!server && want === "dub") {
      server = list.find((s) => s.type === "dub") || list.find((s) => s.type === "hsub");
    }
    if (!server) server = list.find((s) => s.type === "sub") || list[0];
    if (!server?.link_id) return null;

    const stream = await this._anikotoGet(
      `${this.anikotoBase()}/stream?id=${encodeURIComponent(server.link_id)}`);
    const raw = stream?.results?.url || null;
    if (!raw) return null;
    // The API returns a megaplay embed (https://megaplay.buzz/stream/s-2/{id}/{sub|dub}).
    // megaplay only serves its player when the request carries a Referer, and
    // inside an iframe that depends on the embedder's referrer policy. To match
    // the exact conditions of the proven-working AniPub provider, proxy through
    // AniPub's generic player wrapper (the same page AniPub uses), which always
    // embeds megaplay with a Referer. Re-host by extracting the megaplay id and
    // track, falling back to the raw URL if the shape ever changes.
    const m = raw.match(/\/s-2\/([^/?#]+)\/(sub|dub)/);
    const id = m && m[1];
    const track = (m && m[2]) || want;
    const url = id ? `https://anipub.xyz/video/${encodeURIComponent(id)}/${track}` : raw;
    this._anikotoStreamCache.set(cacheKey, { at: Date.now(), url });
    return url;
  },

  async _anikotoGet(url) {
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

  // Search the AniKoto catalog for the anime and return its episode list.
  // Candidates are confirmed against the anime's MAL id via the episode list
  // (every episode carries mal_id); a fuzzy match additionally needs a
  // plausible episode count so movies/OVAs aren't mislabeled as the series.
  async _resolveAnikoto(anime) {
    const base = this.anikotoBase();
    const seenTitles = new Set();
    const searchTitles = [
      this.title(anime) || anime?.title,
      anime?.title_english,
      anime?.title,
      anime?.title_japanese,
      ...(anime?.title_synonyms || []),
    ].filter((t) => t && !seenTitles.has(t) && seenTitles.add(t));

    const tryTitle = async (title) => {
      let search = await this._anikotoGet(`${base}/search?keyword=${encodeURIComponent(title)}`);
      if (!search) search = await this._anikotoGet(`${base}/search?keyword=${encodeURIComponent(title)}`);
      const results = Array.isArray(search?.results?.data) ? search.results.data : [];
      if (!results.length) return null;

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
      const ranked = results
        .map((r) => ({ r, s: score(r.title || r.name || "") }))
        .sort((a, b) => b.s - a.s);
      const candidates = ranked.slice(0, 10);

      const malId = anime?.mal_id ? String(anime.mal_id) : "";
      const malEps = Number(anime?.episodes) || 0;
      const plausible = (count) => !malEps || !count ||
        Math.abs(count - malEps) <= Math.max(2, malEps * 0.15);

      let pick = null;
      for (const { r, s } of candidates) {
        if (s <= 0) continue;
        const epsRes = await this._anikotoGet(`${base}/episodes/${r.animeId}`);
        const eps = Array.isArray(epsRes?.results?.episodes) ? epsRes.results.episodes : [];
        if (!eps.length) continue;
        const epMal = String(eps[0]?.mal_id || "");
        const total = Number(epsRes?.results?.totalEpisodes) || eps.length;
        if (malId && epMal === malId) { pick = { r, eps, total }; break; }
        if (s >= 60 && plausible(total)) { pick = { r, eps, total }; break; }
      }
      if (!pick) return null;

      const items = pick.eps
        .map((e) => ({ n: Number(e.episode_no ?? e.episode), server_ids: e.server_ids || "" }))
        .filter((e) => e.n && e.server_ids)
        .sort((a, b) => a.n - b.n);
      if (!items.length) return null;
      return { animeId: pick.r.animeId, eps: items, dub: Number(pick.r.dub) > 0 };
    };

    for (const title of searchTitles) {
      const found = await tryTitle(title);
      if (found) return found;
    }
    return null;
  },
};
