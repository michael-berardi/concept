import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { serve, type ServerType } from "@hono/node-server";
import { openDb, type DB } from "../src/db.js";
import type { Config } from "../src/config.js";
import { SqliteIndexer } from "../src/index/indexer.js";
import { VaultWatcher } from "../src/index/watcher.js";
import { EventBus } from "../src/events.js";
import { SyncManager } from "../src/sync/syncer.js";
import { VaultEngine } from "../src/vault/engine.js";
import { createApp } from "../src/app.js";

export interface TestEnv {
  baseUrl: string;
  dataDir: string;
  db: DB;
  engine: VaultEngine;
  sync: SyncManager;
  watcher: VaultWatcher;
  bus: EventBus;
  close: () => Promise<void>;
}

export async function makeApp(opts?: { watchDebounceMs?: number; openSignup?: boolean }): Promise<TestEnv> {
  const dataDir = mkdtempSync(path.join(tmpdir(), "concept-test-"));
  const cfg: Config = {
    dataDir,
    port: 0,
    host: "127.0.0.1",
    secret: "test-secret",
    openSignup: opts?.openSignup ?? false,
    publicDir: path.resolve(import.meta.dirname ?? ".", "../public"),
    version: "test",
    syncDebounceMs: 300,
    syncIntervalMs: 60_000,
    watchDebounceMs: opts?.watchDebounceMs ?? 250,
  };
  const db = openDb(path.join(dataDir, "concept.db"));
  const indexer = new SqliteIndexer(db);
  const bus = new EventBus();
  const engine = new VaultEngine(db, (slug) => path.join(dataDir, "workspaces", slug));
  const sync = new SyncManager(
    db,
    cfg,
    (slug) => path.join(dataDir, "workspaces", slug),
    (slug) => ((db.prepare(`SELECT id FROM workspaces WHERE slug = ?`).get(slug) as any)?.id ?? null),
    (slug, status) => {
      bus.publish(slug, { type: "sync", status });
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
  const server: ServerType = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" });
  await new Promise<void>((resolve) => server.on("listening", resolve));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("no port");
  const baseUrl = `http://127.0.0.1:${addr.port}`;
  return {
    baseUrl,
    dataDir,
    db,
    engine,
    sync,
    watcher,
    bus,
    close: async () => {
      watcher.stopAll();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      try {
        rmSync(dataDir, { recursive: true, force: true });
      } catch {
        // best effort cleanup
      }
    },
  };
}

/** Minimal JSON/cookie-session client for the integration tests. */
export class Client {
  cookie: string | null = null;
  bearer: string | null = null;

  constructor(readonly baseUrl: string) {}

  async req(
    method: string,
    urlPath: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ): Promise<{ status: number; json: any; text: string }> {
    const h: Record<string, string> = {};
    if (this.cookie) h["cookie"] = this.cookie;
    if (this.bearer) h["authorization"] = `Bearer ${this.bearer}`;
    Object.assign(h, headers); // explicit headers win (e.g. forged bearer)
    let payload: string | undefined;
    if (body !== undefined) {
      h["content-type"] = "application/json";
      payload = JSON.stringify(body);
    }
    const res = await fetch(`${this.baseUrl}${urlPath}`, { method, headers: h, body: payload });
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) this.cookie = setCookie.split(";")[0];
    const text = await res.text();
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    return { status: res.status, json, text };
  }

  get(p: string) {
    return this.req("GET", p);
  }
  post(p: string, b?: unknown) {
    return this.req("POST", p, b);
  }
  put(p: string, b?: unknown, headers?: Record<string, string>) {
    return this.req("PUT", p, b, headers);
  }
  patch(p: string, b?: unknown, headers?: Record<string, string>) {
    return this.req("PATCH", p, b, headers);
  }
  delete(p: string) {
    return this.req("DELETE", p);
  }

  async register(email: string, password = "password-123", inviteToken?: string) {
    const res = await this.post("/api/auth/register", {
      email,
      name: email.split("@")[0],
      password,
      inviteToken,
    });
    if (res.status !== 201) throw new Error(`register failed: ${res.status} ${res.text}`);
    return res.json.user;
  }

  async login(email: string, password = "password-123") {
    const res = await this.post("/api/auth/login", { email, password });
    if (res.status !== 200) throw new Error(`login failed: ${res.status} ${res.text}`);
    return res.json.user;
  }
}

export async function eventually(
  fn: () => Promise<boolean>,
  timeoutMs = 5000,
  stepMs = 100,
): Promise<void> {
  const start = Date.now();
  for (;;) {
    if (await fn()) return;
    if (Date.now() - start > timeoutMs) throw new Error(`eventually: condition not met within ${timeoutMs}ms`);
    await new Promise((r) => setTimeout(r, stepMs));
  }
}
