// Cloudflare Worker - MangaDex CORS Proxy
// Deploy: npx wrangler deploy --name mangadex-proxy

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const target = url.searchParams.get("url");

    if (!target) {
      return new Response(JSON.stringify({ error: "Missing ?url= parameter" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Only allow MangaDex API
    try {
      const targetUrl = new URL(target);
      if (!targetUrl.hostname.endsWith("mangadex.org")) {
        return new Response(JSON.stringify({ error: "Only MangaDex API allowed" }), {
          status: 403,
          headers: { "Content-Type": "application/json" },
        });
      }
    } catch (e) {
      return new Response(JSON.stringify({ error: "Invalid URL" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Forward request to MangaDex
    const mdRes = await fetch(target, {
      method: request.method,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; OtakuPier/1.0)",
        "Accept": "application/json",
      },
    });

    const body = await mdRes.text();
    return new Response(body, {
      status: mdRes.status,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Cache-Control": "public, max-age=60",
      },
    });
  },
};
