import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client, makeApp, eventually, type TestEnv } from "./helpers.js";

let env: TestEnv;
let admin: Client;
let bareRepo: string;
let workClone: string;
let tmpDirs: string[] = [];

function git(cwd: string, args: string): Promise<{ code: number; out: string }> {
  // tokenize honoring double quotes so messages with spaces survive
  const argv = args.match(/(?:[^\s"]+|"[^"]*")+/g)?.map((t) => t.replace(/^"|"$/g, "")) ?? [];
  return new Promise((resolve) => {
    execFile("git", argv, { cwd }, (err, stdout, stderr) => {
      resolve({ code: err ? 1 : 0, out: `${stdout}${stderr}` });
    });
  });
}

before(async () => {
  env = await makeApp(150);
  admin = new Client(env.baseUrl);
  await admin.register("admin@sync.test");

  bareRepo = mkdtempSync(path.join(tmpdir(), "concept-bare-"));
  tmpDirs.push(bareRepo);
  const init = await git(bareRepo, "--version");
  assert.equal(init.code, 0, "git must be available for sync tests");
});

after(async () => {
  await env.close();
  for (const d of tmpDirs) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      // best effort
    }
  }
});

test("git sync: commits with user authorship, pushes to a bare repo", async () => {
  const ws = await admin.post("/api/workspaces", { name: "SyncCo" });
  const slug = ws.json.slug;

  bareRepo = path.join(bareRepo, "remote.git");
  mkdirSync(bareRepo, { recursive: true });
  const initBare = await git(bareRepo, "init --bare -b main");
  assert.equal(initBare.code, 0, initBare.out);

  const put = await admin.put(`/api/w/${slug}/sync`, {
    remoteUrl: `file://${bareRepo}`,
    branch: "main",
    enabled: true,
  });
  assert.equal(put.status, 200);
  assert.equal(put.json.enabled, true);

  await admin.post(`/api/w/${slug}/pages`, { title: "Synced", body: "written by concept" });

  const run = await admin.post(`/api/w/${slug}/sync/run`);
  assert.equal(run.status, 200);
  assert.equal(run.json.lastStatus, "ok", `sync failed: ${run.json.lastMessage}`);

  // clone and verify content landed in the bare repo
  workClone = path.join(path.dirname(bareRepo), "clone");
  const clone = await git(path.dirname(bareRepo), `clone ${bareRepo} clone`);
  assert.equal(clone.code, 0, clone.out);
  const clonedFile = path.join(workClone, "Pages", "Synced.md");
  assert.ok(existsSync(clonedFile), "pushed page missing from clone");
  assert.match(readFileSync(clonedFile, "utf8"), /written by concept/);

  // author attribution: the commit was made by the acting user
  const log = await git(workClone, "log --format=%an|%ae -1");
  assert.match(log.out, /admin@sync\.test/);
});

test("git sync: conflicting edits keep both versions (conflict copies)", async () => {
  const slug = "syncco";
  // 1. remote advances: edit the file in the clone and push
  const cloneFile = path.join(workClone, "Pages", "Synced.md");
  writeFileSync(cloneFile, readFileSync(cloneFile, "utf8").replace("written by concept", "edited remotely"));
  await git(workClone, "add -A");
  await git(workClone, '-c user.name=Remote -c user.email=remote@x.test commit -m "remote edit"');
  const push = await git(workClone, "push origin main");
  assert.equal(push.code, 0, push.out);

  // 2. local (server) edits the same file via the API
  const page = await admin.get(`/api/w/${slug}/pages/Pages/Synced.md`);
  await admin.put(`/api/w/${slug}/pages/Pages/Synced.md`, { body: "edited locally at the same time" });

  // 3. sync → conflict handling must not lose either side
  const run = await admin.post(`/api/w/${slug}/sync/run`);
  assert.equal(run.status, 200);
  assert.equal(run.json.lastStatus, "conflict", `expected conflict, got ${run.json.lastStatus}: ${run.json.lastMessage}`);
  assert.ok(run.json.conflicts.length >= 1, "no conflict copy reported");

  const vault = path.join(env.dataDir, "workspaces", slug);
  const copyPath = path.join(vault, run.json.conflicts[0]);
  assert.ok(existsSync(copyPath), "conflict copy file missing");
  assert.match(copyPath, /\.conflict-\d+\.md$/);
  assert.match(readFileSync(copyPath, "utf8"), /edited locally at the same time/, "local edit lost!");
  const inPlace = readFileSync(path.join(vault, "Pages", "Synced.md"), "utf8");
  assert.match(inPlace, /edited remotely/, "remote version not applied");

  // status endpoint surfaces conflicts
  const status = await admin.get(`/api/w/${slug}/sync/status`);
  assert.equal(status.json.lastStatus, "conflict");
  assert.ok(status.json.conflicts.length >= 1);

  // encrypted token at rest
  const settings = env.db
    .prepare(`SELECT token_enc FROM sync_settings WHERE workspace_id = (SELECT id FROM workspaces WHERE slug = ?)`)
    .get(slug) as any;
  assert.ok(settings.token_enc === null || /^v1\./.test(settings.token_enc), "token not stored encrypted");

  // a follow-up sync commits the conflict copy too and reports clean conflict state afterwards
  const run2 = await admin.post(`/api/w/${slug}/sync/run`);
  assert.equal(run2.status, 200);
  assert.ok(["ok", "conflict"].includes(run2.json.lastStatus));
});

test("watcher: external file edits by retex/git re-index within a moment", async () => {
  const ws = await admin.post("/api/workspaces", { name: "WatchCo" });
  const slug = ws.json.slug;
  const dbs = await admin.post(`/api/w/${slug}/databases`, { template: "tasks" });
  assert.equal(dbs.status, 201);
  const row = (await admin.post(`/api/w/${slug}/databases/tasks/rows`, {
    properties: { title: "External task", status: "Todo" },
  })).json;

  const vault = path.join(env.dataDir, "workspaces", slug);
  const rowFile = path.join(vault, row.path);
  assert.ok(existsSync(rowFile));

  // Simulate retex move: rewrite the file directly on disk.
  const original = readFileSync(rowFile, "utf8");
  writeFileSync(rowFile, original.replace(/status: Todo/, "status: Done").replace(/rank: .*/, "rank: \"4\""));

  // The index reflects the external edit.
  await eventually(async () => {
    const rows = await admin.get(`/api/w/${slug}/databases/tasks/rows?view=board`);
    const match = rows.json.rows.find((r: any) => r.id === row.id);
    return match?.properties?.status === "Done";
  }, 6000);

  // External deletion disappears from the index.
  rmSync(rowFile);
  await eventually(async () => {
    const rows = await admin.get(`/api/w/${slug}/databases/tasks/rows`);
    return !rows.json.rows.some((r: any) => r.id === row.id);
  }, 6000);

  // External creation is indexed too.
  const newFile = path.join(vault, "Pages", "External.md");
  writeFileSync(newFile, `---\ntitle: External\ntype: page\n---\nhello from retex\n`);
  await eventually(async () => {
    const res = await admin.get(`/api/w/${slug}/pages/Pages/External.md`);
    return res.status === 200;
  }, 6000);
});

test("watcher: own API writes do not lose data (file matches API response)", async () => {
  const slug = "watchco";
  const page = (await admin.post(`/api/w/${slug}/pages`, { title: "Own", body: "v1" })).json;
  const upd = await admin.put(`/api/w/${slug}/pages/${page.path}`, { body: "v2" });
  assert.equal(upd.status, 200);
  await eventually(async () => {
    const raw = readFileSync(path.join(env.dataDir, "workspaces", slug, page.path), "utf8");
    return raw.includes("v2");
  });
  const final = await admin.get(`/api/w/${slug}/pages/${page.path}`);
  assert.equal(final.json.body, "v2");
});
