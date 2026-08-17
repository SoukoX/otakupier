# OtakuPier

Anime catalog + community site. Browse anime, characters, episodes, and trailers — then rank, review, and chat with other fans. 100% free to build and host.

## Stack
- **Frontend:** Plain HTML/CSS/JS (no build step) — works anywhere
- **Anime data:** [Jikan API](https://docs.api.jikan.moe/) (MyAnimeList), free, no key
- **Accounts, reviews, rankings, chat:** [Supabase](https://supabase.com) free tier

## Project structure
```
otakupier/
├── index.html          # Home (trending + top rated + airing + upcoming)
├── 404.html
├── css/style.css       # All styling
├── js/
│   ├── config.js       # <-- Put your Supabase keys here
│   ├── api.js          # Jikan API helpers
│   └── app.js          # Nav, auth, shared UI, ranks/XP/badges, RP economy, admin helpers
├── pages/
│   ├── catalog.html    # Search + genre filter + pagination (100/page)
│   ├── anime.html      # Detail: trailer, characters+VA, all episodes w/ MAL ratings,
│   │                   #   seasons/related, manga links (MangaDex+MAL), save-to-list,
│   │                   #   vote, reviews with likes, comments
│   ├── character.html  # Character bio + appearances
│   ├── rankings.html   # Community top list
│   ├── chat.html       # Live chat (rank badges, highlighted messages)
│   ├── mylist.html     # Saved anime (My List)
│   ├── profile.html    # User profile: rank, XP bar, badges, stats, reviews
│   ├── friends.html    # Friend requests + friends list
│   ├── dms.html        # Private 1-on-1 messages
│   ├── forums.html     # Forum thread list + create
│   ├── forum-thread.html # Thread detail + replies
│   ├── clubs.html      # Club list + create
│   ├── club.html       # Club page: members + discussion posts
│   ├── admin.html      # Admin panel: dashboard, anime editor, custom anime, users & bans, moderation
│   ├── login.html
│   └── signup.html
└── supabase_schema.sql # Run once in Supabase
```

## Watch Online (third-party streaming)

OtakuPier doesn't host video — it surfaces legal streaming providers you choose to integrate. Each anime page shows a **Watch On** panel (provider buttons + an episode picker) and a ▶ Watch button next to every episode. Clicking opens the player in a safe, sandboxed modal overlay.

### How streaming works
1. Open `js/config.js` → the `STREAMING` array.
2. Add one entry per provider you legally use:
   ```js
   { id: "provider-id", name: "Provider Name", mode: "link", url: "https://provider.example/watch?anime={mal_id}&ep={ep}", enabled: true }
   ```
3. Placeholders in `url`:
   - `{mal_id}` — the anime's MyAnimeList id
   - `{ep}` — episode number zero-padded (e.g. `012`)
   - `{ep_num}` — plain episode number (e.g. `12`)
   - `{title}` — URL-encoded anime title
4. `mode` selects how the player opens:
   - `"link"` — opens the provider site in a new tab (used by the bundled Tubi / Pluto TV / RetroCrush entries, which are free, ad-supported, and legal)
   - `"embed"` — renders the provider's player in a sandboxed `<iframe>`
   - `"video"` — plays a direct MP4/HLS file inline with the built-in player (hls.js). For media you host yourself, e.g. `https://your-cdn.example/anime/{mal_id}/{ep_num}.mp4`

### Bundled providers
`STREAMING` comes pre-populated with **Tubi**, **Pluto TV**, and **RetroCrush** in link mode — free legal ad-supported services, no viewer account needed. They open each title's search page for the clicked episode.

### Security notes for providers
- Only add providers whose embeds you have verified are legally licensed in your country and permitted by your host/domain.
- The player modal sandboxes embed iframes (`allow-scripts allow-same-origin`), strips the referrer, and blocks popups/top-navigation. If a provider refuses to embed, switch its `mode` to `"link"`.
- No streaming URLs are ever stored in the database — they are built on the client from this config, so there's no data to leak.

## Admin system
Verified admins get a red name + "✓ Admin" badge site-wide and access to the **Admin** page (link in the top nav, or `pages/admin.html`).

### How to make yourself admin (one-time, after running the schema)
1. Sign up / log in as your account on the site
2. In Supabase **SQL Editor**, run (replace `YOUR-EMAIL@example.com`):
   ```sql
   update public.profiles set is_admin = true
   where id = (select id from auth.users where email = 'YOUR-EMAIL@example.com');
   ```
3. Refresh the site — the **Admin** nav link now appears for you.

### Admin capabilities
- **Dashboard** — site stats (users, reviews, chat messages, threads, clubs, bans)
- **Anime editor** — override any anime's title/image (also shown on home + catalog cards); edit Jikan's synopsis/status for a MAL id
- **Custom anime** — add anime that isn't on MyAnimeList (appears in searches/catalog)
- **Users & bans** — promote/demote admins, ban/unban users (banned users can't post, chat, or DM)
- **Moderation** — delete any violating reviews, chat messages, forum threads/replies, club posts/members, or DMs

### How admin privileges are protected (security model)
- **Admin-only writes:** `anime_edits`, `custom_anime`, and `bans` tables are RLS-locked so *only* rows where the caller is a verified admin can be inserted/updated/deleted. Everyone can still read them.
- **Self-promotion blocked:** a `BEFORE UPDATE` trigger on `profiles` raises an exception if `is_admin` changes unless the caller is already an admin. Regular users can't set the flag on themselves or anyone else.
- **Admin-only deletes:** admins can remove any review/chat/forum/club/DM content for moderation; normal users can only delete their own.
- **Ban enforcement:** `reviews`, `chat_messages`, `messages`, `forum_threads`, `forum_replies`, and `club_posts` insert policies all reject writes from banned users.
- **Admin page guard:** `admin.html` checks `isAdmin()` (verified against the profile row on every load) and redirects non-admins.
- **XP column still protected:** `xp`/`last_daily_xp` remain non-editable except via the whitelisted XP functions.

## Community features
- **Accounts** — email login/signup
- **Save anime** — "Save to My List" button on every anime page (+5 XP)
- **Rank & review** — vote an anime 1–10 (1 vote/user), write reviews & comments (+10 XP); reply to any review/comment (+5 XP)
- **Review likes** — like reviews; the author earns +10 XP
- **Chat** — live global chat (+1 XP per message)
- **Friends** — send/accept friend requests (+10 XP on accept)
- **Messages** — private DMs between users
- **Forums** — community threads by category; reply to discuss (+15 XP thread, +5 XP reply)
- **Clubs** — create/join fan clubs, post to the club discussion (+20 XP create, +10 XP join, +5 XP post)
- **Profiles** — view anyone's profile: rank, XP bar, badges, stats
- **XP & Ranks** — gain XP from all activity. Ranks: Newbie → Watcher → Otaku → Weeb → Elite → Legend. High ranks get highlighted chat messages.
- **Badges** — Member (years), Review Star (50 likes), Chatter (100 messages), Collector (50 saved), Critic (10 reviews), Rater (25 votes)
- **Reward Points (RP) & Reward Shop** — earn RP for contributing (reviews, replies, votes, saves, forums, clubs, friends, chat, approved watch links, likes received), then spend it on prestige/power perks: 🎨 custom **name color** (15k), 🏷️ **custom title** (25k), 👑 **golden avatar ring** (40k), 🖼️ **profile banner** (50k), ✨ **chat glow** 30d (8k), 🗳️ **Voting Power 2x** 30d (10k — your votes count twice in the OtakuPier community rating), and the ultimate 💎 **VIP badge** (500k). Points are scarce: small fixed rewards, daily caps server-side, and an immutable ledger
- **Responsive** — mobile-friendly nav (hamburger menu) and layouts down to ~360px

## How to set up Supabase (free) — enables login, reviews, rankings, chat
1. Create a free account at https://supabase.com
2. Click **New project**, pick a name/password/region (choose near you), wait ~1 min
3. In the left sidebar go to **SQL Editor** > **New query**, paste the whole contents of `supabase_schema.sql`, click **Run**
4. In the left sidebar go to **Settings** > **API** (or Project Settings > API). Copy the **Project URL** and the **anon public key**
5. Open `js/config.js` and replace:
   ```js
   SUPABASE_URL: "https://YOUR-PROJECT-REF.supabase.co",
   SUPABASE_ANON_KEY: "YOUR-ANON-KEY",
   ```
6. (Optional) Authentication > Providers > Email > enable email confirmation or leave off. Note: with confirmation ON, the **built-in** Supabase email service only sends to your project team's member addresses and is limited to **2 emails/hour**. For real users, configure a custom SMTP provider (Authentication > SMTP Settings) with any transactional service (Resend, SendGrid, Mailgun) — otherwise signup confirmations will never arrive.
7. The site now has full accounts, reviews, rankings, live chat, friends, DMs, My List, and XP/ranks

## How to deploy for free (GitHub Pages)
1. Push this folder to a GitHub repo named `otakupier`
2. Go to repo **Settings** > **Pages**
3. Under Build and deployment: Source = **Deploy from a branch**, Branch = `main`, folder = `/ (root)`, Save
4. Wait ~1 minute. Your site is live at `https://YOUR-USERNAME.github.io/otakupier/`
5. Update `js/config.js` → `SITE_URL` to that address

Note: if you deploy the repo at a different name, the site URL changes accordingly.

## Notes
- Jikan has rate limits (~3 req/sec). Browsing is fine; large imports may need caching later.
- Only logged-in users can review, rank, or chat (keeps moderation easy).
- All anime data, images, and trailers belong to their respective owners (MyAnimeList, studios, etc.). This is a fan project that links to official data.

### Expected Supabase linter warnings (safe to dismiss)
The Database Linter shows WARN findings named `authenticated_security_definer_function_executable` for the `SECURITY DEFINER` functions. These are **intentional** and should be marked as accepted in the linter UI:

- `add_xp`, `award_xp_to`, `claim_daily_xp` — the only path that writes the `xp` column (direct column updates are revoked for users via `revoke update (xp, last_daily_xp) on profiles`). They are login-only (`anon` EXECUTE is revoked), amount-clamped server-side (whitelist `1,5,10,15,20` / `5,10`), and `award_xp_to` rejects self-awards so nobody can farm their own XP.
- `prune_chat_messages` — the sole path that deletes old chat rows. The retention interval is now `integer` MINUTES, clamped server-side to a minimum of 60, so a caller can't pass a tiny value and wipe the whole chat table. It is login-only.
- `ensure_admin_can_change_admin_flag` (trigger function) — enforces that only a verified admin can flip `is_admin`. It is never executable via the API (no EXECUTE grant).
- Switching these to `SECURITY INVOKER` would break their purpose — the warning is the correct trade-off.

## Security hardening (applied)
- **Stored-XSS via avatar URLs fixed:** all avatar/`<img>` rendering now goes through `JIKAN.safeImg()` (only `http(s)` URLs pass; quotes/`<>`/backtick escaped) and attribute text through `JIKAN.safeAttr()`. Covers nav, profile, friends, DMs, chat.
- **Admin-panel JS-injection fixed:** the Ban button no longer embeds the target's name inside an inline `onclick="..."` string (which could break out via a `'` in the name). It passes ids via `data-*` attributes and reads them with `getAttribute()`.
- **Chat-wipe hole closed (DB):** `prune_chat_messages` only accepts minutes ≥ 60 and is login-only.
- **DM tampering closed (DB):** recipients can update *only* `read_at` on inbox messages (`grant update (read_at)`); `body`/`sender_id`/`created_at` are unmodifiable via the API.
- **Ban enforcement completed (DB):** banned users are also blocked from voting, saving anime, liking reviews, and joining clubs (previously only posting/chat/DM were blocked).
- **Password minimum raised** from 6 → 8 client-side (enforced on login + signup).
- **stricter referrer policy** (`strict-origin-when-cross-origin`) added to every page so full URLs (and any tokens in them) aren't leaked to third parties (Jikan, streaming embeds).

## Recommended user-side actions
- **Rotate / stop using `pass.txt`** — it contained a plaintext password (`i0dT!h5YSfo42tUV`, likely the Supabase DB password) and is gitignored but still on disk.
- **Keep the Supabase `anon` key publishable-only** (it is public by design — never put the `service_role` key in `js/config.js`; it would grant full DB control). Verify no `service_role`/secret lives in the repo.
- **Enable Supabase "Confirm email"** (or a custom SMTP) before real users sign up, so accounts can't be created/abused anonymously.
- **Keep Supabase CAPTCHA disabled or set a real site key** — otherwise signup breaks (see the email/account status notes).
