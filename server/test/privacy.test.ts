import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadConfig, resetConfigForTest } from "../src/config.js";
import { openDb } from "../src/db.js";

const root = path.resolve(import.meta.dirname ?? ".", "../..");

// Split needles so this test file does not flag itself when scanned.
const forbidden = [
  ["post", "hog"],
  ["@sentry", "/"],
  ["bug", "snag"],
  ["mix", "panel"],
  ["am", "plitude"],
  ["analytics", ".js"],
  ["segment", ".io"],
  ["plausible", ".io"],
  ["umami", ".is"],
  ["hot", "jar"],
  ["full", "story"],
  ["googletagmanager"],
  ["google-analytics"],
  ["datadoghq"],
  ["new", "relic"],
  ["crashlytics"],
  ["fonts.googleapis.com"],
  ["fonts.gstatic.com"],
  ["cdnjs.cloudflare.com"],
  ["cdn.jsdelivr.net"],
  ["unpkg.com"],
  ["@opentelemetry/sdk"],
  ["@opentelemetry/exporter"],
].map((parts) => parts.join(""));

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(rel));
    else if (entry.isFile()) out.push(rel);
  }
  return out;
}

function shippedFiles(): string[] {
  return [
    ...walk(path.join(root, "server/src")),
    ...walk(path.join(root, "web/src")),
    ...walk(path.join(root, "macos/Sources")),
    ...[
      "web/index.html",
      "web/vite.config.ts",
      "Dockerfile",
      "docker-compose.yml",
      "package.json",
      "server/package.json",
      "web/package.json",
      "macos/Package.swift",
    ].map((rel) => path.join(root, rel)),
  ];
}

test("shipped code has no telemetry/analytics SDKs, trackers or remote fonts", () => {
  const hits: string[] = [];
  for (const file of shippedFiles()) {
    const source = readFileSync(file, "utf8");
    for (const needle of forbidden) {
      if (source.includes(needle)) hits.push(`${path.relative(root, file)}: ${needle}`);
    }
    if (/\bsendBeacon\s*\(/.test(source)) hits.push(`${path.relative(root, file)}: sendBeacon`);
  }
  assert.deepEqual(hits, []);
});

const telemetryKeys = [
  "DO_NOT_TRACK",
  "NEXT_TELEMETRY_DISABLED",
  "ASTRO_TELEMETRY_DISABLED",
  "HF_HUB_DISABLE_TELEMETRY",
  "NO_UPDATE_NOTIFIER",
];

test("config disables dependency telemetry and creates owner-only data files", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "concept-privacy-"));
  const saved = new Map<string, string | undefined>();
  for (const key of [...telemetryKeys, "CONCEPT_DATA_DIR"]) {
    saved.set(key, process.env[key]);
    delete process.env[key];
  }
  try {
    process.env.CONCEPT_DATA_DIR = dir;
    chmodSync(dir, 0o755);
    resetConfigForTest();
    const cfg = loadConfig();
    for (const key of telemetryKeys) assert.equal(process.env[key], "1", key);
    assert.equal(statSync(cfg.dataDir).mode & 0o777, 0o700);

    const secret = path.join(cfg.dataDir, ".instance-secret");
    assert.ok(existsSync(secret));
    assert.equal(statSync(secret).mode & 0o777, 0o600);

    const dbFile = path.join(cfg.dataDir, "concept.db");
    const db = openDb(dbFile);
    assert.equal(statSync(dbFile).mode & 0o777, 0o600);
    db.close();
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    resetConfigForTest();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("seed never prints a generated admin password", () => {
  const source = readFileSync(path.join(root, "server/src/cli.ts"), "utf8");
  assert.match(source, /admin-password\.txt/);
  assert.doesNotMatch(source, /generated password:/);
});

for (const [days, keptOld] of [[90, false], [0, true]] as const) {
  test(`activity retention ${days === 0 ? "0 keeps all history" : `${days} days prunes older activity`}`, async () => {
    const { makeApp, Client } = await import("./helpers.js");
    const env = await makeApp({ activityRetentionDays: days });
    try {
      const admin = new Client(env.baseUrl);
      await admin.register("retention@concept.test", "password-123");
      const ws = await admin.post("/api/workspaces", { name: "Retention" });
      assert.equal(ws.status, 201);
      const wsId = (env.db.prepare(`SELECT id FROM workspaces WHERE slug = ?`).get(ws.json.slug) as any).id;
      const old = Date.now() - 200 * 24 * 3600 * 1000;
      env.db
        .prepare(`INSERT INTO activity (workspace_id, path, action, created_at) VALUES (?, NULL, 'synthetic.old', ?)`)
        .run(wsId, old);
      const page = await admin.post(`/api/w/${ws.json.slug}/pages`, { title: "Trigger" });
      assert.equal(page.status, 201);
      const left = env.db
        .prepare(`SELECT COUNT(*) AS n FROM activity WHERE workspace_id = ? AND action = 'synthetic.old'`)
        .get(wsId) as any;
      assert.equal(left.n, keptOld ? 1 : 0);
    } finally {
      await env.close();
    }
  });
}
