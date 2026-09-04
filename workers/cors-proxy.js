// Cloudflare Worker — CORS proxy for MangaDex API + images
// Deploy: npx wrangler deploy (or paste into Cloudflare Dashboard > Workers)
// Then set PROXY_URL in config.js to your worker URL.

const ALLOWED_HOSTS = [
  "api.mangadex.org",
  "uploads.mangadex.org",
  "cmdxd98sb0x3yprd.mangadex.network",
];

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const target = url.searchParams.get("url");

    if (!target) {
      return new Response("Missing ?url= parameter.", { status: 400 });
    }

    let allowed = false;
    try {
      const t = new URL(target);
      allowed = ALLOWED_HOSTS.some(h => t.hostname === h || t.hostname.endsWith("." + h));
    } catch (_) {}

    if (!allowed) {
      return new Response("URL not allowed. Only MangaDex API and CDN URLs are permitted.", { status: 403 });
    }

    const resp = await fetch(target, {
      headers: {
        "Accept": "image/webp,image/avif,image/apng,image/svg+xml,image/*,*/*;q=0.8,application/json",
        "User-Agent": "OtakuPier/1.0",
        "Referer": "https://mangadex.org/",
      },
      redirect: "follow",
    });

    const headers = new Headers(resp.headers);
    headers.set("Access-Control-Allow-Origin", "*");
    headers.set("Access-Control-Allow-Methods", "GET, OPTIONS");
    headers.delete("Cross-Origin-Embedder-Policy");
    headers.delete("Cross-Origin-Opener-Policy");
    headers.delete("Cross-Origin-Resource-Policy");

    // Handle preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, OPTIONS",
          "Access-Control-Allow-Headers": "*",
          "Access-Control-Max-Age": "86400",
        },
      });
    }

    return new Response(resp.body, {
      status: resp.status,
      headers,
    });
  },
};
