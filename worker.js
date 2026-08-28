export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const target = url.searchParams.get("url");
    if (!target) {
      return new Response(JSON.stringify({ error: "Missing ?url= parameter" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    try {
      const decoded = decodeURIComponent(target);

      const method = request.method;
      const cache = caches.default;

      // Check cache for GET requests
      if (method === "GET") {
        const cacheReq = new Request(url.toString(), request);
        const cached = await cache.match(cacheReq);
        if (cached) {
          const resp = new Response(cached.body, cached);
          resp.headers.set("X-Cache", "HIT");
          return resp;
        }
      }

      // Forward POST body if present
      let upstreamBody = null;
      if (method === "POST") {
        upstreamBody = await request.text();
      }

      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 20000);

      const upstreamReqInit = {
        method,
        signal: ctrl.signal,
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          "Accept": "application/json, text/html, */*",
          "Accept-Language": "en-US,en;q=0.9",
        },
      };
      if (upstreamBody) {
        upstreamReqInit.headers["Content-Type"] = "application/json";
        upstreamReqInit.body = upstreamBody;
      }

      const upstream = await fetch(decoded, upstreamReqInit);
      clearTimeout(timer);

      const contentType = upstream.headers.get("content-type") || "application/json";
      const body = await upstream.arrayBuffer();

      const resp = new Response(body, {
        status: upstream.status,
        headers: {
          ...corsHeaders,
          "Content-Type": contentType,
          "Cache-Control": "public, max-age=120",
          "X-Cache": "MISS",
        },
      });

      // Cache successful GET responses
      if (method === "GET" && upstream.status >= 200 && upstream.status < 400) {
        const cacheReq = new Request(url.toString(), request);
        const respToCache = resp.clone();
        // Set cacheable headers on the clone
        respToCache.headers.set("Cache-Control", "public, max-age=120");
        if (ctx && ctx.waitUntil) {
          ctx.waitUntil(cache.put(cacheReq, respToCache));
        }
      }

      return resp;
    } catch (e) {
      return new Response(JSON.stringify({ error: "Proxy failed", detail: e.message }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  },
};
