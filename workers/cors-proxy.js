// Cloudflare Worker — CORS proxy for MangaDex API
// Deploy: npx wrangler deploy (or paste into Cloudflare Dashboard > Workers)
// Then set PROXY_URL in config.js to your worker URL.

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const target = url.searchParams.get("url");

    if (!target || !target.startsWith("https://api.mangadex.org/")) {
      return new Response("Only MangaDex API URLs are allowed.", { status: 403 });
    }

    const resp = await fetch(target, {
      headers: {
        "Accept": "application/json",
        "User-Agent": "OtakuPier/1.0",
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
