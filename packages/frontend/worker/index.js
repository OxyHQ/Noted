import { observeEdgeRequest } from '@oxy.so/telemetry/edge';

/**
 * Noted web Worker -- SPA routing with proper MIME-type handling.
 *
 * Moved here from `public/_worker.js` when this app left Cloudflare Pages for a
 * Worker, and it MUST stay a real Worker entrypoint (`main` in wrangler.toml):
 * `_worker.js` is Pages Advanced Mode and nothing but Pages loads it. Left under
 * `public/` it would be inert AND uploaded as a public asset.
 *
 * The behaviour it exists for is unchanged, and so is the reason. The asset
 * pipeline (`env.ASSETS.fetch`) answers ANY miss with index.html --- on Pages
 * regardless of `_redirects`, and here because wrangler.toml sets
 * `not_found_handling = "single-page-application"`, which is what makes a deep
 * link work now that `public/_redirects` is gone. A browser that asked for a
 * stale hashed `.js` and was handed `text/html` rejects it, so this returns a
 * real 404 for asset extensions instead.
 *
 * Every request now passes through telemetry before delegating to ASSETS.
 * Cache headers remain owned by public/_headers in the asset pipeline.
 */

const STATIC_EXTENSIONS = new Set([
  ".css",
  ".js",
  ".mjs",
  ".json",
  ".map",
  ".wasm",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".svg",
  ".ico",
  ".webp",
  ".avif",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
  ".eot",
  ".mp3",
  ".mp4",
  ".webm",
  ".ogg",
  ".wav",
  ".pdf",
  ".xml",
  ".txt",
]);

function getExtension(pathname) {
  const lastDot = pathname.lastIndexOf(".");
  return lastDot === -1 ? "" : pathname.slice(lastDot).toLowerCase();
}

const assetWorker = {
  async fetch(request, env) {
    const url = new URL(request.url);
    const pathname = url.pathname;
    const extension = getExtension(pathname);

    // Try the asset pipeline first.
    const assetResponse = await env.ASSETS.fetch(request);
    const contentType = assetResponse.headers.get("content-type") || "";

    // Detect when the platform returns an HTML fallback for a static-asset URL.
    // If the URL has a known static extension but the response is HTML, the
    // actual file doesn't exist (e.g., stale hashed bundle from a previous
    // deploy). Return a clean 404 instead of HTML with the wrong MIME type.
    if (STATIC_EXTENSIONS.has(extension) && contentType.includes("text/html")) {
      return new Response("Not Found", { status: 404 });
    }

    // For non-asset paths (SPA navigation routes), the platform's index.html
    // fallback is correct behavior. Return the response as-is.
    return assetResponse;
  },
};

export default {
  fetch(request, env, ctx) {
    return observeEdgeRequest({ service: 'noted', request, env, ctx, next: () => assetWorker.fetch(request, env, ctx) });
  },
};
