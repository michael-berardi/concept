import { serve } from "@hono/node-server";
import { openDb } from "./db.js";
import { loadConfig, workspaceRoot } from "./config.js";
import { SqliteIndexer } from "./index/indexer.js";
import { VaultWatcher } from "./index/watcher.js";
import { EventBus } from "./events.js";
import { SyncManager } from "./sync/syncer.js";
import { VaultEngine } from "./vault/engine.js";
import { createApp } from "./app.js";
import path from "node:path";
import { existsSync } from "node:fs";

export function startServer(): void {
  const cfg = loadConfig();
  const db = openDb(path.join(cfg.dataDir, "concept.db"));
  const indexer = new SqliteIndexer(db);
  const bus = new EventBus();

  const engine = new VaultEngine(db, (slug) => path.join(workspaceRoot(cfg), slug));
  const sync = new SyncManager(
    db,
    cfg,
    (slug) => path.join(workspaceRoot(cfg), slug),
    (slug) => {
      const row = db.prepare(`SELECT id FROM workspaces WHERE slug = ?`).get(slug) as any;
      return row?.id ?? null;
    },
    (slug, status, detail) => {
      bus.publish(slug, { type: "sync", status, detail: detail ?? undefined });
    },
  );
  const watcher = new VaultWatcher(
    indexer,
    {
      onExternalChange: (slug, paths) => {
        bus.publish(slug, { type: "change", paths, actor: "external" });
        sync.markDirty(slug, "system:external");
      },
    },
    cfg.watchDebounceMs,
  );
  const app = createApp({ cfg, db, engine, indexer, watcher, bus, sync });

  // Watch all existing workspace vaults for external edits (retex, git, editors).
  const workspaces = db.prepare(`SELECT id, slug FROM workspaces`).all() as any[];
  for (const ws of workspaces) {
    const dir = engine.vaultDir(ws.slug);
    if (existsSync(dir)) watcher.watchWorkspace(ws.id, ws.slug, dir);
  }

  // Periodic sync for enabled workspaces (pull --rebase + push every 60 s).
  const syncTimer = setInterval(() => {
    // Re-read every tick so workspaces created after startup are covered too.
    const current = db.prepare(`SELECT id, slug FROM workspaces`).all() as any[];
    for (const ws of current) {
      const settings = sync.getSettings(ws.id);
      if (settings.enabled && settings.remoteUrl) {
        void sync.run(ws.slug, "system:timer");
      }
    }
  }, cfg.syncIntervalMs);
  syncTimer.unref?.();

  const server = serve({ fetch: app.fetch, port: cfg.port, hostname: cfg.host }, (info) => {
    console.log(`Concept server v${cfg.version}`);
    console.log(`  data dir : ${cfg.dataDir}`);
    console.log(`  public   : ${cfg.publicDir}`);
    console.log(`  listening: http://localhost:${info.port}`);
  });

  const shutdown = (signal: string) => {
    console.log(`\n[${signal}] shutting down…`);
    watcher.stopAll();
    clearInterval(syncTimer);
    server.close(() => process.exit(0));
    // Close keep-alive sockets so the process exits promptly.
    (server as unknown as { closeAllConnections?: () => void }).closeAllConnections?.();
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}
