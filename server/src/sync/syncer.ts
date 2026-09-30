import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import type { DB } from "../db.js";
import type { Config } from "../config.js";
import {
  authedUrl,
  git,
  isRepo,
  listConflictCopies,
  preserveConflictCopy,
  repoHasCommits,
} from "./git.js";

// ---------- token encryption (AES-256-GCM, key derived from instance secret) ----------

function keyFor(secret: string): Buffer {
  return createHash("sha256").update(`concept:git-token:${secret}`).digest();
}

export function encryptToken(secret: string, token: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFor(secret), iv);
  const enc = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString("base64url")}.${enc.toString("base64url")}.${tag.toString("base64url")}`;
}

export function decryptToken(secret: string, stored: string): string | null {
  try {
    const [v, ivB, dataB, tagB] = stored.split(".");
    if (v !== "v1") return null;
    const decipher = createDecipheriv("aes-256-gcm", keyFor(secret), Buffer.from(ivB, "base64url"));
    decipher.setAuthTag(Buffer.from(tagB, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(dataB, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
}

// ---------- sync settings ----------

export interface SyncSettings {
  remoteUrl: string | null;
  branch: string;
  enabled: boolean;
  hasToken: boolean;
}

export interface SyncStatus extends SyncSettings {
  lastSyncAt: number | null;
  lastStatus: string | null; // 'ok' | 'error' | 'conflict' | 'skipped' | 'syncing'
  lastMessage: string | null;
  lastCommit: string | null;
  conflicts: string[];
}

interface InternalState {
  lastSyncAt: number | null;
  lastStatus: string | null;
  lastMessage: string | null;
  lastCommit: string | null;
}

export class SyncManager {
  private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private chains = new Map<string, Promise<void>>();
  private state = new Map<string, InternalState>();

  constructor(
    private db: DB,
    private cfg: Config,
    private resolveVaultDir: (slug: string) => string,
    private resolveWsId: (slug: string) => string | null,
    private onStatus?: (slug: string, status: string, detail: string | null) => void,
  ) {}

  getSettings(wsId: string): SyncSettings {
    const row = this.db
      .prepare(`SELECT remote_url, branch, token_enc, enabled FROM sync_settings WHERE workspace_id = ?`)
      .get(wsId) as any;
    return {
      remoteUrl: row?.remote_url ?? null,
      branch: row?.branch ?? "main",
      enabled: !!row?.enabled,
      hasToken: !!row?.token_enc,
    };
  }

  putSettings(
    wsId: string,
    input: { remoteUrl?: string | null; branch?: string; token?: string | null; enabled?: boolean },
  ): SyncSettings {
    const current = this.getSettings(wsId);
    const remoteUrl = input.remoteUrl !== undefined ? input.remoteUrl : current.remoteUrl;
    const branch = input.branch ?? current.branch;
    const enabled = input.enabled ?? current.enabled;
    let tokenEnc: string | null = null;
    if (input.token !== undefined) {
      tokenEnc = input.token ? encryptToken(this.cfg.secret, input.token) : null;
    } else {
      const row = this.db
        .prepare(`SELECT token_enc FROM sync_settings WHERE workspace_id = ?`)
        .get(wsId) as any;
      tokenEnc = row?.token_enc ?? null;
    }
    this.db
      .prepare(
        `INSERT INTO sync_settings (workspace_id, remote_url, branch, token_enc, enabled, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (workspace_id) DO UPDATE SET
           remote_url = excluded.remote_url, branch = excluded.branch,
           token_enc = excluded.token_enc, enabled = excluded.enabled, updated_at = excluded.updated_at`,
      )
      .run(wsId, remoteUrl, branch, tokenEnc, enabled ? 1 : 0, Date.now());
    return this.getSettings(wsId);
  }

  getStatus(slug: string): SyncStatus {
    const wsId = this.resolveWsId(slug);
    if (!wsId) {
      return {
        remoteUrl: null,
        branch: "main",
        enabled: false,
        hasToken: false,
        lastSyncAt: null,
        lastStatus: null,
        lastMessage: null,
        lastCommit: null,
        conflicts: [],
      };
    }
    const settings = this.getSettings(wsId);
    const st = this.state.get(wsId);
    let conflicts: string[] = [];
    try {
      conflicts = listConflictCopies(this.resolveVaultDir(slug));
    } catch {
      conflicts = [];
    }
    return {
      ...settings,
      lastSyncAt: st?.lastSyncAt ?? null,
      lastStatus: st?.lastStatus ?? null,
      lastMessage: st?.lastMessage ?? null,
      lastCommit: st?.lastCommit ?? null,
      conflicts,
    };
  }

  private setState(wsId: string, patch: Partial<InternalState>): void {
    const cur = this.state.get(wsId) ?? {
      lastSyncAt: null,
      lastStatus: null,
      lastMessage: null,
      lastCommit: null,
    };
    this.state.set(wsId, { ...cur, ...patch });
    if (patch.lastStatus && this.onStatus) {
      const slug = this.slugOf(wsId);
      if (slug) this.onStatus(slug, patch.lastStatus, patch.lastMessage ?? null);
    }
  }

  private slugOf(wsId: string): string | null {
    const row = this.db.prepare(`SELECT slug FROM workspaces WHERE id = ?`).get(wsId) as any;
    return row?.slug ?? null;
  }

  /** Schedule a debounced commit + sync (10 s) attributed to `actor`. */
  markDirty(slug: string, actor: string): void {
    const wsId = this.resolveWsId(slug);
    if (!wsId) return;
    const settings = this.getSettings(wsId);
    if (!settings.enabled) return;
    const existing = this.debounceTimers.get(slug);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      this.debounceTimers.delete(slug);
      void this.run(slug, actor);
    }, this.cfg.syncDebounceMs);
    this.debounceTimers.set(slug, timer);
  }

  /** Run sync immediately (used by POST /sync/run and tests). */
  async run(slug: string, actor: string): Promise<SyncStatus> {
    const prev = this.chains.get(slug) ?? Promise.resolve();
    const next = prev.then(
      () => this.runOnce(slug, actor),
      () => this.runOnce(slug, actor),
    );
    this.chains.set(
      slug,
      next.then(
        () => undefined,
        () => undefined,
      ),
    );
    await next;
    return this.getStatus(slug);
  }

  private async runOnce(slug: string, actor: string): Promise<void> {
    const wsId = this.resolveWsId(slug);
    if (!wsId) return;
    const settings = this.getSettings(wsId);
    if (!settings.enabled || !settings.remoteUrl) {
      this.setState(wsId, { lastStatus: "skipped", lastMessage: "Sync is not enabled", lastSyncAt: Date.now() });
      return;
    }
    const vaultDir = this.resolveVaultDir(slug);
    mkdirSync(vaultDir, { recursive: true });
    this.setState(wsId, { lastStatus: "syncing", lastMessage: null, lastSyncAt: Date.now() });
    try {
      const result = await this.syncRepo(wsId, vaultDir, settings, actor);
      this.setState(wsId, { ...result, lastSyncAt: Date.now() });
    } catch (err) {
      this.setState(wsId, {
        lastStatus: "error",
        lastMessage: (err as Error).message || "sync failed",
        lastSyncAt: Date.now(),
      });
    }
  }

  private async syncRepo(
    wsId: string,
    vaultDir: string,
    settings: SyncSettings,
    actor: string,
  ): Promise<Partial<InternalState>> {
    const token = this.readToken(wsId);
    const remote = authedUrl(settings.remoteUrl as string, token);
    const branch = settings.branch || "main";

    if (!isRepo(vaultDir)) {
      const init = await git(vaultDir, ["init", "-b", branch]);
      if (init.code !== 0) throw new Error(`git init failed: ${init.stderr.trim()}`);
    }
    const author = actorAuthor(actor);

    // Stage and commit local changes (if any).
    await git(vaultDir, ["add", "-A"]);
    const staged = await git(vaultDir, ["diff", "--cached", "--quiet"]);
    if (staged.code !== 0) {
      const commit = await git(vaultDir, ["commit", "-m", `Concept sync (${actor})`], {
        authorName: author.name,
        authorEmail: author.email,
      });
      if (commit.code !== 0) throw new Error(`git commit failed: ${commit.stderr.trim()}`);
    } else if (!(await repoHasCommits(vaultDir))) {
      const commit = await git(vaultDir, ["commit", "--allow-empty", "-m", "Concept sync: initial"], {
        authorName: author.name,
        authorEmail: author.email,
      });
      if (commit.code !== 0) throw new Error(`git commit failed: ${commit.stderr.trim()}`);
    }

    // Fetch remote state. The (token-embedded) URL is used per-command so the
    // credential is never written to .git/config.
    const fetch = await git(vaultDir, ["fetch", "--quiet", remote, branch]);
    let conflicts: string[] = [];
    if (fetch.code === 0) {
      const remoteExists = await git(vaultDir, ["rev-parse", "--verify", `FETCH_HEAD`]);
      if (remoteExists.code === 0) {
        const upstream = await git(vaultDir, ["rev-parse", "FETCH_HEAD"]);
        const local = await git(vaultDir, ["rev-parse", "HEAD"]);
        if (upstream.stdout.trim() !== local.stdout.trim()) {
          // Try a clean fast-forward/rebase first.
          const rebase = await git(vaultDir, ["rebase", "FETCH_HEAD"], {
            authorName: author.name,
            authorEmail: author.email,
          });
          if (rebase.code !== 0) {
            // Conflict: never lose data. Abort the rebase, then save our losing
            // files as <name>.conflict-<ts>.md and take the remote version.
            await git(vaultDir, ["rebase", "--abort"]);
            const merge = await git(vaultDir, [
              "merge",
              "-q",
              "--no-commit",
              "--allow-unrelated-histories",
              "FETCH_HEAD",
            ], { authorName: author.name, authorEmail: author.email });
            if (merge.code !== 0) {
              const unmerged = await git(vaultDir, ["diff", "--name-only", "--diff-filter=U"]);
              const files = unmerged.stdout.split("\n").map((s) => s.trim()).filter(Boolean);
              for (const f of files) {
                const ours = await git(vaultDir, ["show", `HEAD:${f}`]);
                if (ours.code === 0) {
                  const copy = preserveConflictCopy(vaultDir, f, ours.stdout);
                  conflicts.push(copy);
                }
                // resolve by taking the remote (incoming) version in place
                const theirs = await git(vaultDir, ["show", `FETCH_HEAD:${f}`]);
                if (theirs.code === 0) {
                  const fs = await import("node:fs");
                  fs.writeFileSync(path.join(vaultDir, ...f.split("/")), theirs.stdout, "utf8");
                }
                await git(vaultDir, ["add", "-A", "--", f]);
              }
              const commit = await git(
                vaultDir,
                ["commit", "-m", `Concept sync: resolved conflicts with conflict copies (${actor})`],
                { authorName: author.name, authorEmail: author.email },
              );
              if (commit.code !== 0) throw new Error(`git conflict commit failed: ${commit.stderr.trim()}`);
              return {
                lastStatus: conflicts.length ? "conflict" : "ok",
                lastMessage: conflicts.length
                  ? `Local changes preserved as conflict copies: ${conflicts.join(", ")}`
                  : "merged",
                lastCommit: (await git(vaultDir, ["rev-parse", "HEAD"])).stdout.trim(),
              };
            }
            const mergeCommit = await git(
              vaultDir,
              ["commit", "-m", `Concept sync: merge remote (${actor})`],
              { authorName: author.name, authorEmail: author.email },
            );
            if (mergeCommit.code !== 0 && !/nothing to commit/.test(mergeCommit.stderr)) {
              await git(vaultDir, ["merge", "--abort"]).catch?.(() => {});
            }
          }
        }
      }
    }

    // Push.
    const push = await git(vaultDir, ["push", "--quiet", remote, `HEAD:refs/heads/${branch}`]);
    if (push.code !== 0) {
      return {
        lastStatus: "error",
        lastMessage: `git push failed: ${(push.stderr || push.stdout).trim().split("\n")[0]}`,
        lastCommit: (await git(vaultDir, ["rev-parse", "HEAD"])).stdout.trim(),
      };
    }
    conflicts = listConflictCopies(vaultDir);
    return {
      lastStatus: conflicts.length ? "conflict" : "ok",
      lastMessage: conflicts.length ? `Conflict copies present: ${conflicts.length}` : "synced",
      lastCommit: (await git(vaultDir, ["rev-parse", "HEAD"])).stdout.trim(),
    };
  }

  readToken(wsId: string | null): string | null {
    if (!wsId) return null;
    const row = this.db
      .prepare(`SELECT token_enc FROM sync_settings WHERE workspace_id = ?`)
      .get(wsId) as any;
    if (!row?.token_enc) return null;
    return decryptToken(this.cfg.secret, row.token_enc);
  }
}

export function actorAuthor(actor: string): { name: string; email: string } {
  if (actor.includes("<") && actor.includes(">")) {
    const name = actor.slice(0, actor.indexOf("<")).trim();
    const email = actor.slice(actor.indexOf("<") + 1, actor.indexOf(">")).trim();
    if (name && email.includes("@")) return { name, email };
  }
  if (actor === "system" || actor.startsWith("system")) {
    return { name: "Concept Server", email: "concept@local" };
  }
  return { name: actor || "Concept Server", email: "concept@local" };
}

export { existsSync };
