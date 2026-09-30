import { existsSync, statSync, readFileSync } from "node:fs";
import path from "node:path";
import type { Context } from "hono";
import type { Config } from "./config.js";

const MIME: Record<string, string> = {
  html: "text/html; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  json: "application/json",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  ico: "image/x-icon",
  woff: "font/woff",
  woff2: "font/woff2",
  txt: "text/plain; charset=utf-8",
  map: "application/json",
  webmanifest: "application/manifest+json",
};

/**
 * Serve ./public with a SPA fallback: any GET that misses both the API and a
 * real file gets index.html so client-side routing works.
 */
export function serveStaticOrIndex(c: Context, cfg: Config): Response {
  const urlPath = decodeURIComponent(new URL(c.req.url).pathname);
  if (urlPath.includes("..")) {
    return c.notFound() as unknown as Response;
  }
  const rel = urlPath.replace(/^\/+/, "");
  const candidate = path.resolve(cfg.publicDir, ...rel.split("/").filter(Boolean));
  const safe = candidate.startsWith(path.resolve(cfg.publicDir));
  if (safe && existsSync(candidate) && statSync(candidate).isFile()) {
    const ext = candidate.split(".").pop()?.toLowerCase() ?? "";
    const body = readFileSync(candidate);
    return c.body(new Uint8Array(body), 200, {
      "content-type": MIME[ext] ?? "application/octet-stream",
      "cache-control": rel.startsWith("assets/") ? "public, max-age=31536000, immutable" : "no-cache",
    });
  }
  const index = path.join(cfg.publicDir, "index.html");
  if (existsSync(index)) {
    const body = readFileSync(index);
    return c.body(new Uint8Array(body), 200, { "content-type": MIME.html, "cache-control": "no-cache" });
  }
  c.status(404);
  return c.json({ error: { code: "not_found", message: "Web app is not built. Run `pnpm --filter @concept/web build` (or see docs/SELF-HOSTING.md)." } });
}
