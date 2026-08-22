# OtakuPier Manga Reader - Session State

## Current Status
Manga feature is built and mostly working. Two critical issues remain unfixed:
1. Chapter ordering not correct (should be 1 → latest)
2. Next/Prev buttons unreliable

## Files Modified
- `pages/mangareader.html` — Full manga reader (sidebar + top bar + page viewer)
- `pages/manga.html` — Manga detail page (removed external links, only "Read Now" button)
- `css/style.css` — Reader layout styles (lines ~5016-5220)

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

### 1. Chapter Serialization
- `parseChapterNum()` extracts first number from string — works for "1", "1148.5"
- But fails for "Vol.1 Ch.3", "Chapter 1" (returns Infinity)
- MangaDex feed pagination may not preserve order across pages
- Dedup via Map may lose correct ordering
- **Fix needed**: After fetching ALL chapters and deduping, do a proper numeric sort

### 2. Next/Prev Buttons
- Event listeners are set up correctly
- `goToChapter(idx)` updates `currentChapterIdx` and calls `loadChapterImages()`
- `chapterGen` counter prevents stale renders
- Possible cause: `mdFetch` proxy fallback is slow (sequential attempts)
- During slow fetch, clicking next may appear to do nothing
- **Fix needed**: Add loading indicator, disable buttons during load (with proper reset)

### 3. Manga Matching
- `pickBestManga()` scores results with penalties for colored/doujin/spinoff
- Regex on line 135 had syntax error (fixed: stray `)`)
- May need tuning for edge cases

## Debug Commands
```bash
# Start local server
cd /home/ac/otakupier && python3 -m http.server 8080

# Test MangaDex API from curl
curl -s "https://api.mangadex.org/manga?title=Chainsaw+Man&limit=5" | python3 -m json.tool

# Test at-home server
curl -s "https://api.mangadex.org/at-home/server/{chapter-id}" | python3 -m json.tool
```

## User Preferences
- No external links/buttons to MangaDex, MangaPlus, MangaKatana in UI
- Manga section should only show manga/manhwa (not anime)
- Push changes only when explicitly asked
- Verify before pushing
- Run `push_update.py` for deployment
