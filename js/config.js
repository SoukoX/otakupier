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
  CAPTCHA_SITE_KEY: "1307338918xyzbb.com",

  SITE_NAME: "OtakuPier",
  SITE_TAGLINE: "Watch & Discover Anime Online",
  // Your GitHub Pages URL once deployed
  SITE_URL: "https://soukox.github.io/otakupier",
};
