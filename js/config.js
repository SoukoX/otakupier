// OtakuPier - configuration
// TODO: Fill these in when you create your free Supabase project (https://supabase.com)
// Settings > API in your Supabase dashboard to find these values.
const CONFIG = {
  SUPABASE_URL: "https://ujblssvczuzsnbxajxwc.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_-WgiSVvnk1_NA4nfdO0IPQ_EqkevAMl",

  // Jikan (MyAnimeList) API - free, no key needed
  JIKAN_BASE: "https://api.jikan.moe/v4",

  // CAPTCHA (bot protection) for login/signup forms.
  // Provider: "turnstile" (Cloudflare) or "hcaptcha".
  // CAPTCHA_SITE_KEY is the PUBLIC site key from your provider dashboard.
  // The matching SECRET key must be entered in Supabase:
  //   Auth > Bot and Abuse Protection > Enable CAPTCHA protection
  // If CAPTCHA_SITE_KEY is empty, the forms work without CAPTCHA.
  CAPTCHA_PROVIDER: "turnstile",
  CAPTCHA_SITE_KEY: "",

  SITE_NAME: "OtakuPier",
  SITE_TAGLINE: "Discover, Rank & Review Anime — Find Where to Watch",
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
