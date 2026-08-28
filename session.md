# OtakuPier Session State

## Current Status
Manga section overhauled with multi-source architecture. SEO overhaul completed.

### Manga Multi-Source System (Aug 28 2026)
- **ComicK API added** as primary manga catalog source (better coverage than AniList)
- **AniList kept** as fallback/secondary source
- **MangaDex** used for chapter reading (with multiple proxy fallbacks)
- **Merged results** — deduped by title so the grid has best coverage

#### Changes Made
1. **api.js** — Added:
   - `comickMangaSearch()` — ComicK search with cover art detail fetches
   - `comickPopular()` — Popular manga from ComicK (sorted by views/rating)
   - `comickMangaDetail()` — Full manga detail from ComicK
   - `_comickToManga()` — Converts ComicK results to unified format
   - Updated `mangaSearch()` — Merges AniList + ComicK results
   - Updated `mangaPopular()` — Merges AniList + ComicK popular
   - Updated `mangaTrending()` — Merges AniList trending + ComicK popular
   - Updated `mangaNewReleases()` — Merges AniList new + ComicK popular
   - Updated `mangaDetail()` — Supports both AniList IDs and ComicK hids

2. **pages/mangareader.html** — Improved:
   - Multiple CORS proxy fallbacks (direct → cors.lol → allorigins)
   - Better title matching with alternative title variations
   - Improved error messages with external reading links
   - Support for MangaDex UUID direct access

3. **pages/manga.html** — Updated:
   - Handles both AniList and ComicK manga formats
   - Genre objects now handled safely (string or object)
   - Added MangaDex external reading link for ComicK manga

4. **pages/catalog.html** — Updated:
   - `mangaCard()` handles both formats, shows status labels
   - `mangaHeroSlide()` handles genre objects safely
   - `renderMangaSuggest()` handles genre objects safely
   - `loadCatalog()` handles merged data format
   - `loadMangaRows()` handles merged data format

### Fixed Issues (Aug 22 2026)
- **No English chapters found**: Added fallback to Japanese raws when no English chapters exist
- **Image loading**: Improved error handling — retry logic tries both data/data-saver paths
- **Chapter ordering**: Fixed with proper numeric sort
- **Manga matching**: Improved `pickBestManga` scoring

### SEO Overhaul (Aug 22 2026)
- IndexNow, sitemap, OG tags, JSON-LD, hreflang on all pages
- Bing Webmaster Tools verified

## Architecture

### Manga Data Flow
```
Catalog Search → AniList (fast) + ComicK (fallback) → merged + deduped
Catalog Browse → AniList popular + ComicK popular → merged + deduped
Manga Detail   → AniList (by ID) or ComicK (by hid)
Manga Reading  → MangaDex API (with proxy fallbacks)
```

### API Sources
1. **AniList GraphQL** — CORS-open, good manga metadata, MANGA/MANHWA formats
2. **ComicK (api.comick.dev)** — CORS-open search, ratings, views, cover art
3. **MangaDex** — Chapter reading, English translations, cover images

### Key Functions
- `JIKAN.mangaSearch(query)` → merged AniList + ComicK results
- `JIKAN.mangaPopular(page)` → merged popular manga
- `JIKAN.mangaDetail(id)` → detail from AniList or ComicK
- `JIKAN.comickMangaSearch(query)` → ComicK-only search
- `JIKAN.comickMangaDetail(hid)` → ComicK detail by hid

## User Preferences
- No external links/buttons to MangaDex, MangaPlus, MangaKatana in UI
- Manga section should only show manga/manhwa (not anime)
- Push changes only when explicitly asked
- Verify before pushing
- Run `push_update.py` from `/home/ac/` for deployment

## Other Site Features (Already Working)
- Anime catalog with hero slider, scroll rows, genre filter, pagination
- Anime detail pages with relations, characters, recommendations
- Anime streaming (multi-provider: AniKoto, AniPub, AniXo, etc.)
- Manga reader (MangaDex chapters, retry logic, sidebar navigation)
- Dark/light theme toggle
- Search with live suggestions
- Responsive design (mobile/tablet/desktop)
- GoatCounter analytics
- Supabase backend for accounts, reviews, rankings, chat, forums, clubs
