import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

/** One anonymous request per day; the only state is one small file in the data directory. */
export const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const UPDATE_CACHE_FILE = "update-check.json";
const CHECK_TIMEOUT_MS = 4000;
const USER_AGENT = "concept-update-check";

/** Docker and source installs are upgraded by the admin; the server never updates itself. */
export const UPGRADE_COMMANDS = {
  docker: "git pull && docker compose up -d --build",
  source: "git pull && pnpm install --frozen-lockfile && pnpm build",
} as const;

export function upgradeCommand(inDocker = existsSync("/.dockerenv")): string {
  return inDocker ? UPGRADE_COMMANDS.docker : UPGRADE_COMMANDS.source;
}

type Version = readonly [number, number, number];

export function parseVersion(raw: unknown): Version | null {
  if (typeof raw !== "string") return null;
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(raw.trim());
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** Stable x.y.z only: prereleases and unparseable tags are never newer. */
export function isNewerVersion(latest: unknown, current: unknown): boolean {
  const a = parseVersion(latest);
  const b = parseVersion(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return false;
}

/** Owner/repo comes from this package's own `repository` metadata. */
export function repositorySlug(packageJsonPath: URL | string = new URL("../package.json", import.meta.url)): string {
  const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { repository?: { url?: string } | string };
  const url = typeof pkg.repository === "string" ? pkg.repository : pkg.repository?.url ?? "";
  const match = /github\.com[:/]([^/]+)\/([^/#]+?)(?:\.git)?(?:#.*)?$/.exec(url);
  if (!match) throw new Error("package repository metadata is not a GitHub URL");
  return `${match[1]}/${match[2]}`;
}

export interface UpdateStatus {
  enabled: boolean;
  checkedAt: string | null;
  current: string;
  available: boolean;
  version: string | null;
  releaseUrl: string | null;
  notes: string | null;
  command: string;
  error: string | null;
}

interface CacheState {
  checkedAt?: number;
  latest?: string;
  releaseUrl?: string;
  notes?: string;
  error?: string;
}

export interface UpdateCheckerOptions {
  dataDir: string;
  currentVersion: string;
  disabled?: boolean;
  apiUrl?: string;
  repository?: string;
  command?: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

/** Cached, anonymous GitHub "latest release" check. `status()` never touches the network. */
export class UpdateChecker {
  private readonly apiUrl: string;
  private readonly cacheFile: string;
  private readonly currentVersion: string;
  private readonly disabled: boolean;
  private readonly command: string;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly repository: string;
  private state: CacheState = {};
  private pending: Promise<UpdateStatus> | null = null;

  constructor(opts: UpdateCheckerOptions) {
    this.currentVersion = opts.currentVersion;
    this.disabled = !!opts.disabled;
    this.apiUrl = (opts.apiUrl ?? "https://api.github.com").replace(/\/+$/, "");
    this.cacheFile = path.join(opts.dataDir, UPDATE_CACHE_FILE);
    this.command = opts.command ?? upgradeCommand();
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.now = opts.now ?? Date.now;
    this.repository = opts.repository ?? repositorySlug();
    // Opting out removes the cached state; nothing is kept for a disabled check.
    if (this.disabled) rmSync(this.cacheFile, { force: true });
    else this.state = this.readCache();
  }

  status(): UpdateStatus {
    const latest = this.disabled ? undefined : this.state.latest;
    const available = isNewerVersion(latest, this.currentVersion);
    return {
      enabled: !this.disabled,
      checkedAt: this.state.checkedAt ? new Date(this.state.checkedAt).toISOString() : null,
      current: this.currentVersion,
      available,
      version: available ? latest! : null,
      releaseUrl: available ? this.state.releaseUrl ?? null : null,
      notes: available ? this.state.notes ?? null : null,
      command: this.command,
      error: this.disabled ? null : this.state.error ?? null,
    };
  }

  /**
   * At most one request per 24 hours, failed attempts included; concurrent callers share it.
   * `force` is for an explicit `concept-server update --check`.
   */
  check(opts: { force?: boolean } = {}): Promise<UpdateStatus> {
    if (this.disabled) return Promise.resolve(this.status());
    if (this.pending) return this.pending;
    if (!opts.force && this.state.checkedAt && this.now() - this.state.checkedAt < UPDATE_CHECK_INTERVAL_MS) {
      return Promise.resolve(this.status());
    }
    this.pending = this.fetchLatest().finally(() => {
      this.pending = null;
    });
    return this.pending;
  }

  private async fetchLatest(): Promise<UpdateStatus> {
    // Record the attempt first: a crash or a hung request never turns into a retry loop.
    this.state = { ...this.state, checkedAt: this.now(), error: undefined };
    this.saveCache();
    try {
      const response = await this.fetchImpl(`${this.apiUrl}/repos/${this.repository}/releases/latest`, {
        headers: { "user-agent": USER_AGENT, accept: "application/vnd.github+json" },
        signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`GitHub returned HTTP ${response.status}`);
      const release = (await response.json()) as Record<string, unknown>;
      const version = parseVersion(release.tag_name);
      if (release.draft || release.prerelease || !version) {
        this.state = { checkedAt: this.state.checkedAt };
      } else {
        const tag = String(release.tag_name);
        this.state = {
          checkedAt: this.state.checkedAt,
          latest: version.join("."),
          releaseUrl: typeof release.html_url === "string"
            ? release.html_url
            : `https://github.com/${this.repository}/releases/tag/${tag}`,
          notes: shortNotes(release.body),
        };
      }
    } catch (err) {
      // Keep the last known release; record why this attempt failed.
      this.state = { ...this.state, error: `update check failed: ${(err as Error).message}` };
    }
    this.saveCache();
    return this.status();
  }

  private readCache(): CacheState {
    try {
      const parsed = JSON.parse(readFileSync(this.cacheFile, "utf8")) as CacheState;
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }

  /** Atomic write (temp file + rename, mode 0600); the temp file never outlives a failed write. */
  private saveCache(): void {
    const tmp = `${this.cacheFile}.${process.pid}.tmp`;
    try {
      mkdirSync(path.dirname(this.cacheFile), { recursive: true });
      writeFileSync(tmp, JSON.stringify(this.state), { mode: 0o600 });
      renameSync(tmp, this.cacheFile);
    } catch {
      // A read-only data dir must not break the server; the check simply runs again next start.
    } finally {
      if (existsSync(tmp)) rmSync(tmp, { force: true });
    }
  }
}

/** Up to five plain-text lines (Markdown headings dropped, bullets kept), at most 600 characters. */
export function shortNotes(body: unknown): string | undefined {
  if (typeof body !== "string") return undefined;
  const lines = body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => line.replace(/^[-*+]\s+/, "• ").replace(/\*\*|__|`/g, ""))
    .slice(0, 5);
  return lines.join("\n").slice(0, 600) || undefined;
}
