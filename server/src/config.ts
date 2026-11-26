import { randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { privateMkdir } from "./vault/files.js";

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
  noUpdateCheck: boolean;
  updateApiUrl: string;
  syncDebounceMs: number;
  syncIntervalMs: number;
  watchDebounceMs: number;
  /** Days of activity history to keep; 0 keeps it all. */
  activityRetentionDays: number;
}

let cached: Config | null = null;

const TELEMETRY_OFF = [
  "DO_NOT_TRACK",
  "NEXT_TELEMETRY_DISABLED",
  "ASTRO_TELEMETRY_DISABLED",
  "HF_HUB_DISABLE_TELEMETRY",
  "NO_UPDATE_NOTIFIER",
];

export function loadConfig(): Config {
  if (cached) return cached;
  // Any transitive library that reads these flags must stay silent.
  for (const key of TELEMETRY_OFF) {
    if (!process.env[key]) process.env[key] = "1";
  }
  const dataDir = path.resolve(env("CONCEPT_DATA_DIR", path.join(process.cwd(), "data")));
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  chmodSync(dataDir, 0o700);

  let secret = process.env.CONCEPT_SECRET ?? "";
  if (!secret) {
    // Persist a generated instance secret so encrypted values (git tokens) survive restarts.
    const secretFile = path.join(dataDir, ".instance-secret");
    if (existsSync(secretFile)) {
      secret = readFileSync(secretFile, "utf8").trim();
      chmodSync(secretFile, 0o600);
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
    version: env("npm_package_version", "0.2.0"),
    // The daily release check is off when opted out and in CI.
    noUpdateCheck: env("CONCEPT_NO_UPDATE_CHECK", "0") === "1" || !["", "0", "false"].includes(env("CI", "").toLowerCase()),
    updateApiUrl: env("CONCEPT_UPDATE_API", "https://api.github.com"),
    syncDebounceMs: Number(env("CONCEPT_SYNC_DEBOUNCE_MS", "10000")),
    syncIntervalMs: Number(env("CONCEPT_SYNC_INTERVAL_MS", "60000")),
    watchDebounceMs: Number(env("CONCEPT_WATCH_DEBOUNCE_MS", "300")),
    activityRetentionDays: activityRetention(env("CONCEPT_ACTIVITY_RETENTION_DAYS", "90")),
  };
  return cached;
}

function activityRetention(raw: string): number {
  const days = Number(raw);
  if (!Number.isInteger(days) || days < 0) {
    throw new Error(`CONCEPT_ACTIVITY_RETENTION_DAYS must be a whole number of days (0 keeps all), got ${JSON.stringify(raw)}`);
  }
  return days;
}

/** Test hook: reset cached config (config is read once per process). */
export function resetConfigForTest(): void {
  cached = null;
}

export function workspaceRoot(cfg: Config): string {
  const dir = path.join(cfg.dataDir, "workspaces");
  privateMkdir(dir);
  return dir;
}
