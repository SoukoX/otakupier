# OtakuPier Manga Reader - Session State

## Current Status
Manga feature is built and mostly working. Two critical issues remain unfixed:
1. Chapter ordering not correct (should be 1 → latest)
2. Next/Prev buttons unreliable

## Files Modified
- `otakupier/pages/mangareader.html` — Full manga reader (sidebar + top bar + page viewer)
- `otakupier/pages/manga.html` — Manga detail page (removed external links, only "Read Now" button)
- `otakupier/css/style.css` — Reader layout styles (lines ~5016-5220)
- `otakupier/js/api.js` — AniList GraphQL manga queries (MANGA/Manhwa/Manhua)

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

### 1. Chapter Serialization (HIGH PRIORITY)
- `parseChapterNum()` extracts first number from string — works for "1", "1148.5"
- But fails for "Vol.1 Ch.3", "Chapter 1" (returns Infinity)
- MangaDex feed pagination may not preserve order across pages
- Dedup via Map may lose correct ordering
- **Fix needed**: After fetching ALL chapters and deduping, do a proper numeric sort
- Example: Chainsaw Man shows only 6 chapters (picks "Official Colored" version with 7 chapters instead of main series with 100+)

### 2. Next/Prev Buttons (HIGH PRIORITY)
- Event listeners are set up correctly
- `goToChapter(idx)` updates `currentChapterIdx` and calls `loadChapterImages()`
- `chapterGen` counter prevents stale renders from slow proxy calls
- Possible cause: `mdFetch` proxy fallback is slow (sequential attempts, each up to 10s)
- During slow fetch, clicking next may appear to do nothing
- **Fix needed**: Add loading indicator, disable buttons during load (with proper reset)

### 3. Manga Matching (FIXED - may need tuning)
- `pickBestManga()` scores results with penalties for colored/doujin/spinoff
- Regex on line 135 had syntax error (fixed: stray `)`)
- Scoring: exact match +200, starts-with +150, includes +50, colored -60, doujin -60, spinoff -50
- Prefers manga with more chapters and RELEASING/FINISHED status

### 4. AniList Manga Format Filter (NOT FIXED)
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
