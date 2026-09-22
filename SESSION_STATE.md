# OtakuPier - Session State (2026-09-17)

## Current Version
All JS/HTML files use `v=30` for cache busting.

## Supabase Security
SQL fix file: `supabase_security_fix.sql` — run in Supabase SQL Editor.
Also enable leaked password protection in Dashboard > Authentication > Settings.

## SEO Status
All pages have proper meta tags, OG, Twitter, canonical, JSON-LD.
Dynamic SEO on: anime, manga, club, forum-thread, character pages.
IndexNow on: catalog, club, forum-thread.
Sitemap includes: index, catalog, anime, manga, forums, forum-thread, clubs, club, chat, character, watch.

## Google Indexing Fixes (Sep 17 — "Crawled - currently not indexed" validation)
### Root Cause (from Claude analysis)
Client-side rendered site on GitHub Pages. When Googlebot renders JS, Jikan API (3 req/sec) may be slow/rate-limited → Googlebot sees a loading spinner → marks page as thin content / soft-404. This is intermittent — works fine manually but fails for Googlebot's rendering budget.

### Critical Issues Fixed
1. **Hidden H1 tags removed** — All `display:none` H1 tags replaced with accessible `.sr-only` class
   - Files: anime.html, character.html, manga.html, watch.html, clubs.html, profile.html, mylist.html, mangareader.html
   - Google penalizes hidden text; `.sr-only` is the correct accessible pattern

2. **Visible SEO content blocks added** to CSR pages (THE REAL FIX)
   - anime.html, character.html, watch.html, manga.html
   - `<section class="seo-content container">` placed AFTER `<main>` but BEFORE `<footer>`
   - Always visible to crawlers regardless of JS execution / API speed
   - Contains H2, descriptive paragraphs, feature lists, internal links
   - Matches existing pattern from forums.html

3. **Noscript fallback content added** — JS-heavy pages now have meaningful static content for non-JS crawlers
   - anime.html, character.html, watch.html, manga.html, forum-thread.html, club.html

4. **Sitemap updated** — Added missing pages, fixed invalid changefreq
   - Added: forum-thread, club
   - Fixed: chat changefreq from "always" to "daily"
   - Updated all lastmod dates to 2026-09-17

5. **JSON-LD structured data added** to initial HTML
   - anime.html: TVSeries schema
   - character.html: Person schema

6. **CSS `.sr-only` class added** to style.css

### Pages correctly noindex (no changes needed)
- profile.html, mylist.html, friends.html, dms.html (private user pages)
- login.html, signup.html, admin.html (auth/admin pages)
- mangareader.html (utility page)

### Pages correctly indexed
- index.html, catalog.html, anime.html, manga.html, forums.html, forum-thread.html
- clubs.html, club.html, chat.html, character.html, watch.html

## PUSH NEEDED (Sep 17 — Google indexing fixes + adult manga fix + prior manga fixes)
GitHub token expired — user must rotate `/home/ac/.gh_token` before push.
Run: `python3 /home/ac/push_update.py "fix: Google indexing — visible SEO content blocks for CSR pages, remove hidden H1s, update sitemap; fix adult manga chapters — add pornographic/erotica content ratings to MangaDex search"`

### Files changed (NOT YET PUSHED)
- `css/style.css` — added `.sr-only` class
- `pages/anime.html` — removed display:none H1, added noscript, added visible SEO content block, added JSON-LD
- `pages/character.html` — removed display:none H1, added noscript, added visible SEO content block, added JSON-LD
- `pages/manga.html` — removed display:none H1, added noscript, added visible SEO content block
- `pages/watch.html` — removed display:none H1, added noscript, added visible SEO content block
- `pages/clubs.html` — removed display:none H1 (already had noscript + SEO content)
- `pages/profile.html` — removed display:none H1
- `pages/mylist.html` — removed display:none H1
- `pages/mangareader.html` — removed display:none H1
- `pages/forum-thread.html` — added noscript content
- `pages/club.html` — added noscript content
- `sitemap.xml` — added forum-thread/club, fixed chat changefreq, updated dates

### What was fixed (Sep 17)
1. **Hidden H1 penalty** — All 8 hidden H1s replaced with accessible `.sr-only` class.
2. **CSR thin content (THE REAL FIX)** — Added visible `<section class="seo-content">` blocks to anime, character, watch, manga pages. These are always rendered in HTML regardless of JS execution or API speed. Googlebot sees real content even if Jikan API is slow/rate-limited.
3. **Sitemap completeness** — Added forum-thread and club pages. Fixed chat changefreq from invalid "always" to "daily".
4. **Structured data** — Added JSON-LD to anime.html and character.html initial HTML.
5. **Noscript fallbacks** — Added to 6 JS-heavy pages for non-JS crawlers.
6. **Adult manga chapters (FIX)** — MangaDex search was missing `pornographic`/`erotica` content ratings, so adult manga like "MILF Hunter in Another World" and "Secret Class" weren't found. Fixed `fetchMangaDexChapters()` in `mangareader.html` to include all content ratings when `isAdult=true`.
7. **Adult manhwa chapter count (FIX)** — ManhwaUS has 2-3x more chapters than MangaDex for adult manhwa (e.g. Secret Class: ManhwaUS=328 vs MangaDex=150). Changed provider selection to always try ManhwaUS for adult manga and pick the provider with the most chapters.

### Files changed (Sep 17 — adult manga fix)
- `pages/mangareader.html` — Fixed MangaDex search to include adult content ratings (pornographic, erotica) when `isAdult=true`; changed provider selection to always try ManhwaUS for adult manga and pick provider with most chapters

### Files changed (Sep 18 — adult manga providers)
- `pages/mangareader.html` — Added Hentai20.io provider; improved ManhwaUS with search fallback + slug variations; provider selection now prefers ManhwaUS for adult manga; Hentai20 image loading handler added; isAdult made mutable for auto-detect
- `js/api.js` — Fixed `_mangadexDetail()`, `comickMangaDetail()`, and AniList `mangaDetail()` to return `isAdult` flag (was missing, causing reader to not know manga is adult)
- `pages/catalog.html` — Fixed hero "Read Now" link to pass `&adult=1` for adult manga

### Still pending from prior sessions
1. **RE-RUN `supabase_schema.sql`** in Supabase SQL Editor (RP system, watch_links admin policy, review replies, 5-link cap)
2. **Turn off "Confirm email"** in Supabase (or set up custom SMTP)
3. **GSC indexing** — re-request indexing every ~3–5 days
4. **Rotate leaked password** from `pass.txt`
5. Deploy NineAnime demo API (optional, scaffolded but disabled)
