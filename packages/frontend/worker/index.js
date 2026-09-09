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
 * THIS SCRIPT ONLY EVER SEES A MISS. With `run_worker_first` unset, the asset
 * router answers any request that matches a real file WITHOUT invoking the
 * Worker --- measured, not assumed: an instrumented build of this file set
 * `max-age=1234` and an `X-Worker-Ran` header in a `/_expo/static/` branch, and
 * a request for a bundle that exists came back with neither, while a request
 * for one that does not came back with both. The immutable `Cache-Control` on
 * content-addressed assets comes from `public/_headers`, applied by the asset
 * router; a branch in here could never have set it. That dead branch was
 * deleted when this moved off Pages.
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

export default {
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
