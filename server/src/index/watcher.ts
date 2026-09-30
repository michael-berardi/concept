import { watch, statSync, type FSWatcher } from "node:fs";
import path from "node:path";
import type { Indexer } from "./indexer.js";
import type { EventBus } from "../events.js";

export interface WatcherHooks {
  /** Called after externally-caused index updates (for git sync + SSE). */
  onExternalChange: (wsSlug: string, paths: string[]) => void;
}

interface WatchedWorkspace {
  wsId: string;
  slug: string;
  vaultDir: string;
  watcher: FSWatcher;
  pending: Map<string, ReturnType<typeof setTimeout>>;
  fullRescanTimer: ReturnType<typeof setTimeout> | null;
}

/**
 * Watches vault directories with fs.watch(recursive) so external edits
 * (retex, git, editors) are re-indexed within a few hundred milliseconds.
 * No chokidar; no native addons.
 */
export class VaultWatcher {
  private watched = new Map<string, WatchedWorkspace>();

  constructor(
    private indexer: Indexer,
    private hooks: WatcherHooks,
    private debounceMs = 300,
  ) {}

  watchWorkspace(wsId: string, slug: string, vaultDir: string): void {
    this.unwatchWorkspace(slug);
    let watcher: FSWatcher;
    try {
      watcher = watch(vaultDir, { recursive: true, persistent: false }, (event, filename) => {
        this.handleChange(slug, event, filename);
      });
    } catch (err) {
      // Watching is best-effort; indexing still happens on our own mutations.
      console.error(`[watcher] fs.watch failed for ${slug}: ${(err as Error).message}`);
      return;
    }
    watcher.on("error", (err) => {
      console.error(`[watcher] error on ${slug}: ${err.message}`);
    });
    this.watched.set(slug, {
      wsId,
      slug,
      vaultDir,
      watcher,
      pending: new Map(),
      fullRescanTimer: null,
    });
  }

  unwatchWorkspace(slug: string): void {
    const w = this.watched.get(slug);
    if (!w) return;
    for (const t of w.pending.values()) clearTimeout(t);
    if (w.fullRescanTimer) clearTimeout(w.fullRescanTimer);
    try {
      w.watcher.close();
    } catch {
      // already closed
    }
    this.watched.delete(slug);
  }

  stopAll(): void {
    for (const slug of [...this.watched.keys()]) this.unwatchWorkspace(slug);
  }

  private handleChange(slug: string, _event: string, filename: string | Buffer | null): void {
    const w = this.watched.get(slug);
    if (!w) return;
    let rel: string | null = null;
    if (filename !== null) {
      rel = (typeof filename === "string" ? filename : filename.toString("utf8")).split(path.sep).join("/");
    }
    if (rel === null || rel === "" || rel.includes("/") === false && this.looksLikeDirEvent(rel, w)) {
      this.scheduleFullRescan(w);
      return;
    }
    if (
      rel.startsWith(".git/") ||
      rel.startsWith(".retex/") ||
      rel === ".git" ||
      rel === ".retex" ||
      rel.endsWith(".tmp")
    ) {
      return;
    }
    const existing = w.pending.get(rel);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      w.pending.delete(rel);
      this.processPath(w, rel as string);
    }, this.debounceMs);
    w.pending.set(rel, timer);
  }

  private looksLikeDirEvent(rel: string, w: WatchedWorkspace): boolean {
    try {
      return statSync(path.join(w.vaultDir, rel)).isDirectory();
    } catch {
      return false;
    }
  }

  private scheduleFullRescan(w: WatchedWorkspace): void {
    if (w.fullRescanTimer) return;
    w.fullRescanTimer = setTimeout(() => {
      w.fullRescanTimer = null;
      try {
        this.indexer.reindexWorkspace(w.wsId, w.vaultDir);
        this.hooks.onExternalChange(w.slug, ["*"]);
      } catch (err) {
        console.error(`[watcher] reindex failed for ${w.slug}: ${(err as Error).message}`);
      }
    }, Math.max(this.debounceMs * 2, 600));
  }

  private processPath(w: WatchedWorkspace, rel: string): void {
    const abs = path.join(w.vaultDir, ...rel.split("/"));
    let exists = false;
    try {
      exists = statSync(abs).isFile();
    } catch {
      exists = false;
    }
    try {
      if (exists) {
        this.indexer.indexFile(w.wsId, w.vaultDir, rel);
      } else {
        this.indexer.removeFromIndex(w.wsId, rel);
      }
      this.hooks.onExternalChange(w.slug, [rel]);
    } catch (err) {
      console.error(`[watcher] index failed for ${w.slug}/${rel}: ${(err as Error).message}`);
    }
  }
}
