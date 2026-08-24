# OtakuPier Manga Reader - Session State

## Current Status
Manga feature is built and mostly working. SEO overhaul completed.

### Fixed Issues (Aug 22 2026)
- **No English chapters found**: Added fallback to Japanese raws when no English chapters exist (e.g. Vagabond, Ultimate Shut-in)
- **Image loading**: Improved error handling — retry logic tries both data/data-saver paths, shows visible error state when images fail
- **Chapter ordering**: Was already working correctly; Vagabond starts at Ch.216 because early chapters were never scanlated in English
- **Manga matching**: Improved `pickBestManga` scoring with romanization normalization ("ou"↔"o"), stronger spinoff penalties, prefix matching

### SEO Overhaul (Aug 22 2026)
- **IndexNow**: Implemented with Bing-generated key `7a9a2a35d24b473c811ecd475c7bd970`, ping on every deploy
- **Sitemap**: Fixed — removed noindex pages, added `<lastmod>`, `<changefreq>`
- **Open Graph**: Added og:title, og:description, og:image, og:type to all indexable pages
- **JSON-LD**: Added WebSite (SearchAction), CollectionPage (catalog), ItemList (rankings), TVSeries (anime detail)
- **hreflang**: Added `en` + `x-default` to all indexable pages
- **noindex**: Set on admin, login, signup, dms, friends, mylist, profile pages
- **Google/Bing ping**: Added sitemap ping to push_update.py after deploy
- **Bing Webmaster Tools**: Site added, IndexNow key verified, sitemap submitted
- **Bing Status**: URLs showing "Blocked" — normal for new sites, need 24-48 hours for indexing

## Files Modified
- `otakupier/pages/mangareader.html` — Full manga reader (sidebar + top bar + page viewer)
- `otakupier/pages/manga.html` — Manga detail page (removed external links, only "Read Now" button)
- `otakupier/css/style.css` — Reader layout styles (lines ~5016-5220)
- `otakupier/js/api.js` — AniList GraphQL manga queries (MANGA/Manhwa/Manhua)
- `otakupier/js/seo.js` — IndexNow ping utility added
- `otakupier/sitemap.xml` — Rebuilt with lastmod, changefreq, correct URLs
- All pages in `otakupier/pages/` — OG tags, hreflang, JSON-LD, noindex fixes
- `otakupier/index.html` — SearchAction JSON-LD, hreflang
- `otakupier/fa7eb9705f644b66ab22d305ec3351b9.txt` — IndexNow key file
- `/home/ac/push_update.py` — IndexNow + Google sitemap ping after deploy

## Architecture

### MangaDex API Flow
1. Search manga by title → `GET /manga?title=X&limit=10`
2. Pick best match via `pickBestManga()` scoring
3. Fetch all chapters → `GET /manga/{id}/feed?translatedLanguage[]=en&limit=500&order[chapter]=asc` (paginated)
4. Dedup by chapter number, keep entry with most pages
5. Sort by `parseChapterNum()` (extracts first number from string)
6. Load images → `GET /at-home/server/{chapterId}` → `baseUrl/data/{hash}/{filename}`

### CORS Handling
- Direct fetch to `api.mangadex.org` works from browser (CORS-enabled)
- at-home CDN (`*.mangadex.network`) also CORS-enabled
- Proxies: `allorigins.win`, `corsproxy.io` (backup, but unreliable)

### Key Issue: Some manga have ALL chapters as MangaPlus external links
- One Piece: ALL chapters have `externalUrl` pointing to `mangaplus.shueisha.co.jp`
- MangaDex doesn't host images for these — `at-home/server` returns 404
- `data` and `dataSaver` arrays are empty
- We detect this via `ch.attributes.externalUrl` and show "External Chapter" message

### Reader UI Structure
```
┌────────────────────────────────────┐
│ ← Back  ☰  ← Prev | Ch.X | Next→ │  top bar
├────────────┬───────────────────────┤
│ Chapters   │  Manga Pages          │  content area
│ (sidebar)  │                       │
└────────────┴───────────────────────┘
```
- Sidebar: always visible on desktop, overlays on mobile (≤768px)
- Toggle buttons: ☰ in top bar (opens sidebar), ✕ in sidebar head (closes)
- Smooth CSS width transition on hide/show
- Back button: `history.back()`

## Remaining Bugs to Fix

### 1. Image Loading (MEDIUM)
- Some chapters have images that fail to load from MangaDex CDN
- Retry logic now tries both data/data-saver paths with visible error state
- MangaDex CDN occasionally returns empty data arrays for certain chapters

### 2. Manga Matching (LOW - may need tuning)
- `pickBestManga()` scores results with penalties for colored/doujin/spinoff
- Scoring: exact match +200, starts-with +150, includes +50, colored -60, doujin -60, spinoff -50
- Prefers manga with more chapters and RELEASING/FINISHED status

### 3. AniList Manga Format Filter (NOT FIXED)
- User wants only MANGA and MANHWA in manga catalog section
- Tried `format_in: [MANGA, MANHWA, MANHUA]` in AniList GraphQL but it broke queries (returned nothing)
- Need to filter client-side instead

## User Preferences
- No external links/buttons to MangaDex, MangaPlus, MangaKatana in UI
- Manga section should only show manga/manhwa (not anime)
- Push changes only when explicitly asked
- Verify before pushing
- Run `push_update.py` from `/home/ac/` for deployment

## Debug Commands
```bash
# Start local server
cd /home/ac/otakupier && python3 -m http.server 8080

# Test MangaDex API
curl -s "https://api.mangadex.org/manga?title=Chainsaw+Man&limit=5" | python3 -m json.tool

# Test at-home server
curl -s "https://api.mangadex.org/at-home/server/{chapter-id}" | python3 -m json.tool

# Test chapter feed
curl -s "https://api.mangadex.org/manga/{manga-id}/feed?translatedLanguage[]=en&limit=10&order[chapter]=asc" | python3 -m json.tool
```

## Other Site Features (Already Working)
- Anime catalog with hero slider, scroll rows, genre filter, pagination
- Anime detail pages with relations, characters, recommendations
- Anime streaming (multi-provider: VidCloud, StreamTape, etc.)
- Manga detail pages (AniList GraphQL)
- Dark/light theme toggle
- Search with live suggestions
- Responsive design (mobile/tablet/desktop)
- GoatCounter analytics
- Supabase backend for tracking
