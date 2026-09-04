// OtakuPier - configuration
// TODO: Fill these in when you create your free Supabase project (https://supabase.com)
// Settings > API in your Supabase dashboard to find these values.
const CONFIG = {
  SUPABASE_URL: "https://ujblssvczuzsnbxajxwc.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_-WgiSVvnk1_NA4nfdO0IPQ_EqkevAMl",

  // Jikan (MyAnimeList) API - free, no key needed
  JIKAN_BASE: "https://api.jikan.moe/v4",

  // AniList API - free GraphQL fallback when Jikan's /anime endpoint is down
  // (MAL upstream issues). Same MAL ids (idMal), CORS-open, huge coverage.
  ANILIST_BASE: "https://graphql.anilist.co",

  // CAPTCHA (bot protection) for login/signup forms.
  // Provider: "turnstile" (Cloudflare) or "hcaptcha".
  // CAPTCHA_SITE_KEY is the PUBLIC site key from your provider dashboard.
  // The matching SECRET key must be entered in Supabase:
  //   Auth > Bot and Abuse Protection > Enable CAPTCHA protection
  // If CAPTCHA_SITE_KEY is empty, the forms work without CAPTCHA.
  CAPTCHA_PROVIDER: "turnstile",
  CAPTCHA_SITE_KEY: "",

  SITE_NAME: "OtakuPier",
  SITE_TAGLINE: "Discover Anime & Manga — Find Where to Watch",
  // Your GitHub Pages URL once deployed
  SITE_URL: "https://otakupier.2bd.net",

  // ---- Watch Online (third-party streaming providers) ----
  // Add a provider for each service you want the site to stream from. Only
  // list services you have VERIFIED are legally licensed in your country and
  // permitted by your hosting/domain terms. The site just renders links /
  // embeds for these external providers — it does not host any video.
  //
  // Each entry:
  //   id      unique key (lowercase, no spaces)
  //   name    label shown to your visitors
  //   mode    "embed" = play inline in an <iframe> on the page,
  //           "link"  = open the provider in a new tab
  //   url     URL template for ONE episode. Placeholders:
  //             {mal_id}  -> this anime's MyAnimeList id
  //             {ep}      -> episode number zero-padded, e.g. "012"
  //             {ep_num}  -> plain episode number, e.g. "12"
  //             {title}   -> URL-encoded anime title
  //   enabled true to show it in the "Watch Online" panel
  STREAMING: [
    // Free, ad-supported, LEGAL platforms (link mode opens their search for
    // the title). No key, no account needed for viewers.
    { id: "tubi", name: "Tubi", mode: "link",
      url: "https://tubitv.com/search/{title}", enabled: true },
    { id: "pluto", name: "Pluto TV", mode: "link",
      url: "https://pluto.tv/on-demand/search?q={title}", enabled: true },
    { id: "retro", name: "RetroCrush", mode: "link",
      url: "https://retrocrush.tv/search?q={title}", enabled: true },
    { id: "roku", name: "Roku Channel", mode: "link",
      url: "https://therokuchannel.roku.com/search#!q={title}", enabled: true },
    { id: "plex", name: "Plex", mode: "link",
      url: "https://app.plex.tv/desktop/#!/search?query={title}", enabled: true },

    // More reputable third-party streamers. Link mode opens their search /
    // watch page for the title so the visitor can stream it there.
    { id: "youtube", name: "YouTube", mode: "link",
      url: "https://www.youtube.com/results?search_query={title}+episode+{ep_num}", enabled: true },
    { id: "crunchyroll", name: "Crunchyroll", mode: "link",
      url: "https://www.crunchyroll.com/search?q={title}", enabled: true },
    { id: "netflix", name: "Netflix", mode: "link",
      url: "https://www.netflix.com/search?q={title}", enabled: true },
    { id: "hidive", name: "HIDIVE", mode: "link",
      url: "https://www.hidive.com/search?q={title}", enabled: true },
    { id: "hulu", name: "Hulu", mode: "link",
      url: "https://www.hulu.com/search?q={title}", enabled: true },
    { id: "prime", name: "Prime Video", mode: "link",
      url: "https://www.primevideo.com/search/ref=atv_nb_sr?phrase={title}", enabled: true },
    { id: "disney", name: "Disney+", mode: "link",
      url: "https://www.disneyplus.com/search?q={title}", enabled: true },
    { id: "max", name: "Max", mode: "link",
      url: "https://www.max.com/search?q={title}", enabled: true },
    { id: "apple", name: "Apple TV", mode: "link",
      url: "https://tv.apple.com/search?q={title}", enabled: true },
    { id: "vudu", name: "Fandango at Home", mode: "link",
      url: "https://www.vudu.com/content/movies/search?q={title}", enabled: true },

    // AniKoto — free public catalog API (https://anikototvapi.vercel.app).
    { id: "anikoto", name: "Stream 1", mode: "embed", dynamic: "anikoto",
      referrerPolicy: "no-referrer-when-downgrade",
      sandbox: false, url: "", enabled: true, volumeControl: "none" },

    // AniPub — community anime catalog (https://anipub.xyz).
    { id: "anipub", name: "Stream 2", mode: "embed", sandbox: false, dynamic: "anipub",
      referrerPolicy: "no-referrer-when-downgrade",
      url: "https://anipub.xyz/video/{anipub_ep_id}/sub", enabled: true, volumeControl: "none" },

    // AniXo — active provider. Embed player keyed by AniList id + episode.
    { id: "anixo", name: "Stream 3", mode: "embed", dynamic: "anixo",
      sandbox: false, referrerPolicy: "no-referrer-when-downgrade",
      url: "https://anixo.buzz/embed/ani/{anilist_id}/{ep_num}/{sub}", enabled: true, volumeControl: "full" },

    // Direct video playback (mode "video") plays an actual MP4/HLS file
    // inline with the built-in player. Only add sources whose hosting you
    // have the rights to, e.g. your OWN files. Example pattern:
    //   { id: "self", name: "My Library", mode: "video",
    //     url: "https://cdn.yourdomain.com/anime/{mal_id}/{ep_num}.mp4",
    //     enabled: true },
  ],
};

// Running straight off the filesystem (file://) has no pretty-URL
// resolution — internal links need the real ".html" file there.
const IS_LOCAL = /^(file|ftp):/.test(window.location.protocol);

// Internal page link: clean (extensionless) form on the hosted site, the
// real ".html" file when opened straight from disk.
function pageHref(page) {
  const p = window.location.pathname.includes("/pages/") ? "../" : "";
  return p + "pages/" + page + (IS_LOCAL ? ".html" : "");
}
