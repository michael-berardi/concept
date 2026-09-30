import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function env(name: string, fallback: string): string {
  const v = process.env[name];
  return v === undefined || v === "" ? fallback : v;
}

export interface Config {
  dataDir: string;
  port: number;
  host: string;
  secret: string;
  openSignup: boolean;
  publicDir: string;
  version: string;
  syncDebounceMs: number;
  syncIntervalMs: number;
  watchDebounceMs: number;
}

let cached: Config | null = null;

export function loadConfig(): Config {
  if (cached) return cached;
  const dataDir = path.resolve(env("CONCEPT_DATA_DIR", path.join(process.cwd(), "data")));
  mkdirSync(dataDir, { recursive: true });

  let secret = process.env.CONCEPT_SECRET ?? "";
  if (!secret) {
    // Persist a generated instance secret so encrypted values (git tokens) survive restarts.
    const secretFile = path.join(dataDir, ".instance-secret");
    if (existsSync(secretFile)) {
      secret = readFileSync(secretFile, "utf8").trim();
    }
    if (!secret) {
      secret = randomBytes(32).toString("base64url");
      writeFileSync(secretFile, secret + "\n", { mode: 0o600 });
    }
  }

  cached = {
    dataDir,
    port: Number(env("PORT", "8787")),
    host: env("CONCEPT_HOST", "0.0.0.0"),
    secret,
    openSignup: env("CONCEPT_OPEN_SIGNUP", "0") === "1",
    // Default: the package's own public/ dir (server/public), regardless of cwd.
    publicDir: path.resolve(
      env("CONCEPT_PUBLIC_DIR", path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public")),
    ),
    version: env("npm_package_version", "0.1.0"),
    syncDebounceMs: Number(env("CONCEPT_SYNC_DEBOUNCE_MS", "10000")),
    syncIntervalMs: Number(env("CONCEPT_SYNC_INTERVAL_MS", "60000")),
    watchDebounceMs: Number(env("CONCEPT_WATCH_DEBOUNCE_MS", "300")),
  };
  return cached;
}

/** Test hook: reset cached config (config is read once per process). */
export function resetConfigForTest(): void {
  cached = null;
}

export function workspaceRoot(cfg: Config): string {
  const dir = path.join(cfg.dataDir, "workspaces");
  mkdirSync(dir, { recursive: true });
  return dir;
}
