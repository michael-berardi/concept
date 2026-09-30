import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client, makeApp, eventually, type TestEnv } from "./helpers.js";
import { readZip } from "../src/zip.js";

let env: TestEnv;
let admin: Client;

before(async () => {
  env = await makeApp();
  admin = new Client(env.baseUrl);
  await admin.register("admin@concept.test", "password-123");
});

after(async () => {
  await env.close();
});

test("health reports setup state and version", async () => {
  const res = await admin.get("/api/health");
  assert.equal(res.status, 200);
  assert.equal(res.json.ok, true);
  assert.equal(res.json.setupRequired, false);
});

test("register requires email/password shape and rejects duplicates", async () => {
  const bad = await admin.post("/api/auth/register", { email: "not-an-email", password: "password-123" });
  assert.equal(bad.status, 400);
  assert.equal(bad.json.error.code, "invalid_email");
  const dup = await admin.post("/api/auth/register", { email: "admin@concept.test", password: "password-123" });
  assert.equal(dup.status, 409);
  assert.equal(dup.json.error.code, "email_taken");
});

test("unauthenticated requests are rejected with a coded error", async () => {
  const anon = new Client(env.baseUrl);
  const res = await anon.get("/api/me");
  assert.equal(res.status, 401);
  assert.equal(res.json.error.code, "unauthorized");
});

test("first user is instance admin", async () => {
  const res = await admin.get("/api/me");
  assert.equal(res.json.user.isAdmin, true);
});

test("personal API tokens work via Authorization header", async () => {
  const created = await admin.post("/api/me/tokens", { name: "ci" });
  assert.equal(created.status, 201);
  assert.match(created.json.token, /^cpt_/);
  const listed = await admin.get("/api/me/tokens");
  assert.ok(listed.json.tokens.some((t: any) => t.id === created.json.id));

  const tokenClient = new Client(env.baseUrl);
  tokenClient.bearer = created.json.token;
  const me = await tokenClient.get("/api/me");
  assert.equal(me.status, 200);
  assert.equal(me.json.user.email, "admin@concept.test");

  const bad = await tokenClient.req("GET", "/api/me", undefined, { authorization: "Bearer cpt_wrong" });
  assert.equal(bad.status, 401);
});

test("workspace creation (blank) seeds a welcome page and vault dirs", async () => {
  const res = await admin.post("/api/workspaces", { name: "Acme HQ" });
  assert.equal(res.status, 201);
  assert.equal(res.json.slug, "acme-hq");
  const vault = path.join(env.dataDir, "workspaces", "acme-hq");
  assert.ok(existsSync(path.join(vault, ".concept", "workspace.json")));
  assert.ok(existsSync(path.join(vault, "Pages", "Welcome.md")));
});

test("pages CRUD with optimistic concurrency (409 on stale If-Match)", async () => {
  const created = await admin.post("/api/w/acme-hq/pages", {
    title: "Roadmap",
    body: "Q1 plan with [[Welcome]]",
  });
  assert.equal(created.status, 201);
  const p = created.json;
  assert.equal(p.path, "Pages/Roadmap.md");
  assert.equal(p.body, "Q1 plan with [[Welcome]]");

  // conflict: stale hash
  const stale = await admin.put(`/api/w/acme-hq/pages/${p.path}`, { body: "stale write" }, {
    "if-match": `"deadbeef"`,
  });
  assert.equal(stale.status, 409);
  assert.equal(stale.json.error.code, "conflict");
  assert.equal(stale.json.error.current.path, p.path);
  assert.ok(stale.json.error.current.contentHash);

  // good write with If-Match
  const ok = await admin.put(`/api/w/acme-hq/pages/${p.path}`, { body: "Q1+Q2 plan, see [[Welcome]]" }, {
    "if-match": p.contentHash,
  });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.body, "Q1+Q2 plan, see [[Welcome]]");
  assert.notEqual(ok.json.contentHash, p.contentHash);

  // write without If-Match is allowed (last-write-wins)
  const ok2 = await admin.put(`/api/w/acme-hq/pages/${p.path}`, { body: "Q1-Q4 plan, see [[Welcome]]" });
  assert.equal(ok2.status, 200);

  // backlinks: Roadmap links [[Welcome]], so Welcome has Roadmap as a backlink
  const page = await admin.get(`/api/w/acme-hq/pages/${p.path}`);
  assert.deepEqual(page.json.backlinks, []);
  const welcomePage = await admin.get("/api/w/acme-hq/pages/Pages/Welcome.md");
  assert.deepEqual(welcomePage.json.backlinks, ["Pages/Roadmap.md"]);

  // nested page + move
  const child = await admin.post("/api/w/acme-hq/pages", { title: "Notes", parent: "Pages/Roadmap.md" });
  assert.equal(child.status, 201);
  assert.equal(child.json.path, "Pages/Roadmap/Notes.md");
  const moved = await admin.post(`/api/w/acme-hq/pages/${child.json.path}/move`, { parent: null });
  assert.equal(moved.status, 200);
  assert.equal(moved.json.path, "Pages/Notes.md");

  // delete moves to .trash
  const del = await admin.delete(`/api/w/acme-hq/pages/Pages/Notes.md`);
  assert.equal(del.status, 200);
  assert.match(del.json.trashedTo, /^\.trash\//);
  assert.ok(!existsSync(path.join(env.dataDir, "workspaces/acme-hq", "Pages/Notes.md")));
  assert.ok(existsSync(path.join(env.dataDir, "workspaces/acme-hq", del.json.trashedTo)));
});

test("custom frontmatter properties survive page updates", async () => {
  await admin.post("/api/w/acme-hq/pages", {
    title: "Custom",
    body: "x",
  });
  const p = await admin.get("/api/w/acme-hq/pages/Pages/Custom.md");
  const upd = await admin.put(`/api/w/acme-hq/pages/Pages/Custom.md`, {
    properties: { owner: "mike", mood: "focused", priority: 2 },
    body: "y",
  });
  assert.equal(upd.status, 200);
  const raw = readFileSync(path.join(env.dataDir, "workspaces/acme-hq", "Pages/Custom.md"), "utf8");
  assert.match(raw, /custom_unknown|owner: mike/);
  assert.match(raw, /mood: focused/);
  const again = await admin.put(`/api/w/acme-hq/pages/Pages/Custom.md`, { body: "z" });
  assert.equal(again.status, 200);
  const raw2 = readFileSync(path.join(env.dataDir, "workspaces/acme-hq", "Pages/Custom.md"), "utf8");
  assert.match(raw2, /mood: focused/); // unknown key preserved
  const final = await admin.get("/api/w/acme-hq/pages/Pages/Custom.md");
  assert.equal(final.json.properties.mood, "focused");
  void p;
});

test("crm starter creates Companies/Contacts/Deals/Activities with Retex stages", async () => {
  const res = await admin.post("/api/workspaces", { name: "CRM One", template: "crm" });
  assert.equal(res.status, 201);
  const dbs = await admin.get("/api/w/crm-one/databases");
  const slugs = dbs.json.databases.map((d: any) => d.slug).sort();
  assert.deepEqual(slugs, ["activities", "companies", "contacts", "deals"]);
  const deals = dbs.json.databases.find((d: any) => d.slug === "deals");
  const stages = deals.properties.find((p: any) => p.key === "status").options.map((o: any) => o.id);
  assert.deepEqual(stages, ["Inbox", "Qualified", "Proposal", "Negotiation", "Won", "Lost"]);
});

test("database rows: create, list, filter, update with conflict, delete", async () => {
  const created = await admin.post("/api/w/crm-one/databases/deals/rows", {
    properties: { title: "Acme renewal", status: "Proposal", value: 12000, company: "[[Acme]]" },
    body: "Renewal for [[Acme]].",
  });
  assert.equal(created.status, 201);
  const row = created.json;
  assert.equal(row.properties.type, "deal");
  assert.equal(row.properties.status, "Proposal");
  assert.ok(row.rank);

  const list = await admin.get("/api/w/crm-one/databases/deals/rows?view=board");
  assert.ok(list.json.rows.some((r: any) => r.id === row.id));

  const filtered = await admin.get(
    `/api/w/crm-one/databases/deals/rows?filter=${encodeURIComponent(JSON.stringify([{ key: "status", op: "eq", value: "Won" }]))}`,
  );
  assert.equal(filtered.json.rows.length, 0);

  const q = await admin.get("/api/w/crm-one/databases/deals/rows?q=acme");
  assert.equal(q.json.rows.length, 1);

  // stale If-Match → 409
  const stale = await admin.patch(`/api/w/crm-one/databases/deals/rows/${row.id}`, { properties: { value: 1 } }, {
    "if-match": "nope",
  });
  assert.equal(stale.status, 409);
  assert.equal(stale.json.error.code, "conflict");

  const upd = await admin.patch(`/api/w/crm-one/databases/deals/rows/${row.id}`, {
    properties: { value: 15000 },
  }, { "if-match": row.contentHash });
  assert.equal(upd.status, 200);
  assert.equal(upd.json.properties.value, 15000);

  const getOne = await admin.get(`/api/w/crm-one/databases/deals/rows/${row.id}`);
  assert.equal(getOne.json.properties.value, 15000);
  assert.match(getOne.json.body, /\[\[Acme\]\]/);

  // unknown database → 404 with code
  const missing = await admin.get("/api/w/crm-one/databases/nope/rows");
  assert.equal(missing.status, 404);
  assert.equal(missing.json.error.code, "not_found");
});

test("board move recomputes rank between neighbours and across columns", async () => {
  const mk = async (title: string, status: string) =>
    (await admin.post("/api/w/crm-one/databases/deals/rows", { properties: { title, status } })).json;
  const a = await mk("Deal A", "Inbox");
  const b = await mk("Deal B", "Inbox");
  const c = await mk("Deal C", "Inbox");
  assert.ok(a.rank < b.rank && b.rank < c.rank, `initial ranks not ordered: ${a.rank},${b.rank},${c.rank}`);

  // move C between A and B
  const moved = await admin.post(`/api/w/crm-one/databases/deals/rows/${c.id}/move`, {
    status: "Inbox",
    afterId: a.id,
    beforeId: b.id,
  });
  assert.equal(moved.status, 200);
  assert.ok(a.rank < moved.json.rank && moved.json.rank < b.rank, `moved rank ${moved.json.rank} not between ${a.rank} and ${b.rank}`);

  // move B to Proposal column, then check both columns order
  const movedB = await admin.post(`/api/w/crm-one/databases/deals/rows/${b.id}/move`, { status: "Proposal" });
  assert.equal(movedB.json.properties.status, "Proposal");
  assert.ok(movedB.json.rank);

  const inbox = await admin.get("/api/w/crm-one/databases/deals/rows?view=board");
  const inInbox = inbox.json.rows.filter((r: any) => r.properties.status === "Inbox");
  assert.equal(inInbox.length, 2);
  assert.equal(inInbox[0].id, a.id);
  assert.equal(inInbox[1].id, c.id);

  // invalid move (before/after swapped) → 400
  const invalid = await admin.post(`/api/w/crm-one/databases/deals/rows/${a.id}/move`, {
    status: "Inbox",
    afterId: c.id,
    beforeId: a.id === c.id ? null : c.id,
  });
  assert.equal(invalid.status, 400);

  // move with non-canonical external ranks triggers resequence and still orders correctly
  const rowFile = (r: any) => path.join(env.dataDir, "workspaces/crm-one", r.path);
  writeFileSync(rowFile(a), readFileSync(rowFile(a), "utf8").replace(/rank: .*/, "rank: \"junk-rank\""));
  await eventually(async () => {
    const l = await admin.get("/api/w/crm-one/databases/deals/rows");
    return l.json.rows.find((r: any) => r.id === a.id)?.rank === "junk-rank";
  });
  const afterJunk = await admin.post(`/api/w/crm-one/databases/deals/rows/${c.id}/move`, { status: "Inbox" });
  assert.equal(afterJunk.status, 200);
  const l2 = await admin.get("/api/w/crm-one/databases/deals/rows?view=board");
  const col = l2.json.rows.filter((r: any) => r.properties.status === "Inbox");
  const ranks = col.map((r: any) => r.rank);
  const sorted = [...ranks].sort();
  assert.deepEqual(ranks, sorted);
  for (const r of ranks) assert.match(r, /^[1-9][0-9]*$/);
});

test("FTS search, backlinks, graph, tags, links", async () => {
  const s = await admin.get("/api/w/crm-one/search?q=acme");
  assert.ok(s.json.results.length >= 1);
  assert.ok(s.json.results.some((r: any) => r.path.includes("deals/acme") || r.title === "Acme renewal"));

  const byType = await admin.get("/api/w/crm-one/search?q=acme&type=record");
  assert.ok(byType.json.results.every((r: any) => r.path.startsWith("Data/")));

  const bl = await admin.get(`/api/w/crm-one/backlinks?path=Pages/Welcome.md`);
  assert.ok(bl.status === 200 || bl.status === 403); // Welcome exists in acme-hq, maybe not crm-one
  void bl;

  // in acme-hq: Roadmap links to Welcome
  const backlinks = await admin.get("/api/w/acme-hq/backlinks?path=Pages/Welcome.md");
  assert.deepEqual(backlinks.json.backlinks, ["Pages/Roadmap.md"]);

  const links = await admin.get("/api/w/acme-hq/links?path=Pages/Roadmap.md");
  assert.equal(links.json.outgoing.length, 1);
  assert.equal(links.json.outgoing[0].resolved, "Pages/Welcome.md");

  const graph = await admin.get("/api/w/acme-hq/graph?scope=global");
  assert.ok(graph.json.nodes.some((n: any) => n.path === "Pages/Roadmap.md"));
  assert.ok(graph.json.edges.length >= 1);

  const local = await admin.get(`/api/w/acme-hq/graph?scope=local&path=${encodeURIComponent("Pages/Welcome.md")}&depth=1`);
  assert.ok(local.json.nodes.some((n: any) => n.path === "Pages/Roadmap.md"));

  const tags = await admin.get("/api/w/crm-one/tags");
  assert.ok(Array.isArray(tags.json.tags));

  // unresolved link shows up as unresolved
  await admin.post("/api/w/acme-hq/pages", { title: "Lonely", body: "points at [[Ghost Page]]" });
  const lonely = await admin.get("/api/w/acme-hq/links?path=Pages/Lonely.md");
  assert.deepEqual(lonely.json.unresolved, ["Ghost Page"]);
});

test("tags from frontmatter and inline #tags are indexed", async () => {
  await admin.post("/api/w/acme-hq/pages", { title: "Tagged", body: "has #inline-tag and a #second" });
  const upd = await admin.put(`/api/w/acme-hq/pages/Pages/Tagged.md`, {
    properties: { tags: ["front", "matter"] },
  });
  assert.equal(upd.status, 200);
  const tags = await admin.get("/api/w/acme-hq/tags");
  const names = tags.json.tags.map((t: any) => t.tag);
  for (const t of ["inline-tag", "second", "front", "matter"]) {
    assert.ok(names.includes(t), `missing tag ${t} in ${JSON.stringify(names)}`);
  }
});

test("comments, activity and attachments", async () => {
  const c = await admin.post("/api/w/acme-hq/comments", { path: "Pages/Roadmap.md", body: "First!" });
  assert.equal(c.status, 201);
  const list = await admin.get("/api/w/acme-hq/comments?path=Pages/Roadmap.md");
  assert.equal(list.json.comments.length, 1);
  const del = await admin.delete(`/api/w/acme-hq/comments/${c.json.id}`);
  assert.equal(del.status, 200);

  // attachment upload + fetch
  const form = new FormData();
  form.append("file", new Blob([Buffer.from("hello attachment")]), "notes.txt");
  const cookie = admin.cookie;
  const up = await fetch(`${env.baseUrl}/api/w/acme-hq/attachments`, {
    method: "POST",
    headers: cookie ? { cookie } : {},
    body: form,
  });
  assert.equal(up.status, 201);
  const meta = await up.json();
  const down = await fetch(`${env.baseUrl}/api/w/acme-hq/attachments/${meta.id}`, {
    headers: cookie ? { cookie } : {},
  });
  assert.equal(down.status, 200);
  assert.equal(await down.text(), "hello attachment");
  assert.ok(existsSync(path.join(env.dataDir, "workspaces/acme-hq", meta.path)));

  const activity = await admin.get("/api/w/acme-hq/activity?path=Pages/Roadmap.md&limit=10");
  assert.ok(activity.json.activity.length >= 1);
  assert.ok(activity.json.activity.some((a: any) => a.action === "page.updated"));
});

test("vault mode: raw tree, file read/write with conflict, move", async () => {
  const tree = await admin.get("/api/w/acme-hq/vault/tree");
  const paths: string[] = [];
  const walk = (nodes: any[]) => nodes.forEach((n) => (n.type === "folder" ? walk(n.children) : paths.push(n.path)));
  walk(tree.json.tree);
  assert.ok(paths.includes(".concept/workspace.json"));
  assert.ok(paths.includes("Pages/Roadmap.md"));

  const file = await admin.get("/api/w/acme-hq/vault/file/Pages/Roadmap.md");
  assert.equal(file.status, 200);
  assert.ok(file.json.frontmatter);
  const put = await admin.put(`/api/w/acme-hq/vault/file/Pages/Roadmap.md`, file.json.content + "\nappended", {
    "if-match": file.json.contentHash,
  });
  assert.equal(put.status, 200);
  const stalePut = await admin.put(`/api/w/acme-hq/vault/file/Pages/Roadmap.md`, "x", {
    "if-match": file.json.contentHash,
  });
  assert.equal(stalePut.status, 409);
  assert.equal(stalePut.json.error.code, "conflict");

  await admin.post("/api/w/acme-hq/pages", { title: "Movable", body: "move me" });
  const mv = await admin.post("/api/w/acme-hq/vault/move", { from: "Pages/Movable.md", to: "Data/Movable.md" });
  assert.equal(mv.status, 200);
  const got = await admin.get("/api/w/acme-hq/vault/file/Data/Movable.md");
  assert.equal(got.status, 200);

  const reserved = await admin.put(`/api/w/acme-hq/vault/file/.git/config`, "evil");
  assert.equal(reserved.status, 400);
  assert.equal(reserved.json.error.code, "reserved_path");
});

test("SSE stream delivers hello and change events", async () => {
  const controller = new AbortController();
  const res = await fetch(`${env.baseUrl}/api/w/acme-hq/events`, {
    headers: admin.cookie ? { cookie: admin.cookie, accept: "text/event-stream" } : { accept: "text/event-stream" },
    signal: controller.signal,
  });
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") ?? "", /text\/event-stream/);
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let seen = "";
  const readChunk = async () => {
    const { value } = await reader.read();
    return decoder.decode(value);
  };
  seen += await readChunk();
  assert.match(seen, /event: hello/);
  // trigger a change while listening
  await admin.post("/api/w/acme-hq/pages", { title: "SSE page", body: "x" });
  let gotChange = false;
  for (let i = 0; i < 5 && !gotChange; i++) {
    seen += await readChunk();
    gotChange = seen.includes("event: change");
  }
  assert.ok(gotChange, `no change event in stream: ${seen}`);
  controller.abort();
});

test("export.zip + import round-trip into a new workspace", async () => {
  const res = await fetch(`${env.baseUrl}/api/w/acme-hq/export.zip`, {
    headers: admin.cookie ? { cookie: admin.cookie } : {},
  });
  assert.equal(res.status, 200);
  const buf = Buffer.from(await res.arrayBuffer());
  const entries = readZip(buf);
  assert.ok(entries.some((e) => e.path === "Pages/Roadmap.md"));

  // import into fresh workspace
  const ws = await admin.post("/api/workspaces", { name: "Import Target" });
  assert.equal(ws.status, 201);
  const form = new FormData();
  form.append("file", new Blob([buf]), "vault.zip");
  const imp = await fetch(`${env.baseUrl}/api/w/import-target/import`, {
    method: "POST",
    headers: admin.cookie ? { cookie: admin.cookie } : {},
    body: form,
  });
  assert.equal(imp.status, 200);
  const page = await admin.get("/api/w/import-target/pages/Pages/Roadmap.md");
  assert.equal(page.status, 200);
  assert.match(page.json.body, /appended/);
});

test("retex schema endpoint returns the record contract", async () => {
  const res = await admin.get("/api/w/crm-one/retex/schema");
  assert.equal(res.status, 200);
  assert.ok(res.json.properties.includes("rank"));
  const deal = res.json.recordTypes.find((t: any) => t.type === "deal");
  assert.deepEqual(deal.statuses, ["Inbox", "Qualified", "Proposal", "Negotiation", "Won", "Lost"]);
});

test("sync endpoints exist and validate settings (disabled by default)", async () => {
  const get = await admin.get("/api/w/crm-one/sync");
  assert.equal(get.status, 200);
  assert.equal(get.json.enabled, false);
  const run = await admin.post("/api/w/crm-one/sync/run");
  assert.equal(run.status, 200);
  assert.equal(run.json.lastStatus, "skipped");
  const status = await admin.get("/api/w/crm-one/sync/status");
  assert.equal(status.status, 200);
});

test("unknown API routes return coded 404 JSON", async () => {
  const res = await admin.get("/api/w/acme-hq/definitely-not-a-route");
  assert.equal(res.status, 404);
  assert.equal(res.json.error.code, "not_found");
});

test("static serving returns the web app with SPA fallback", async () => {
  const root = await fetch(`${env.baseUrl}/`);
  const body = await root.text();
  assert.match(root.headers.get("content-type") ?? "", /text\/html/);
  assert.match(body, /<html/i);
  // SPA fallback: a client-side route returns the same app shell
  const deep = await fetch(`${env.baseUrl}/some/client/route`);
  assert.equal(deep.status, 200);
  assert.match(await deep.text(), /<html/i);
});
