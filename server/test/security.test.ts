import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client, makeApp, type TestEnv } from "./helpers.js";
import { createZip } from "../src/zip.js";

let env: TestEnv;
let admin: Client;
let member: Client;
let slug: string;
const scratch: string[] = [];

before(async () => {
  env = await makeApp({ openSignup: true });
  admin = new Client(env.baseUrl);
  await admin.register("admin@sec.test");
  const ws = await admin.post("/api/workspaces", { name: "SecCo" });
  slug = ws.json.slug;
  member = new Client(env.baseUrl);
  const inv = await admin.post(`/api/w/${slug}/invites`, { role: "member" });
  await member.register("member@sec.test", "password-123", inv.json.token);
  await admin.post(`/api/w/${slug}/pages`, { title: "Secret", body: "top secret" });
  const me = await member.get("/api/me");
  await admin.put(`/api/w/${slug}/acl`, {
    path: "Pages/Secret.md",
    subjectType: "user",
    subjectId: me.json.user.id,
    level: "none",
  });
});

after(async () => {
  await env.close();
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

test("ACL cannot be bypassed with an alternate spelling of the path", async () => {
  assert.equal((await member.get(`/api/w/${slug}/pages/Pages/Secret.md`)).status, 403);
  for (const spelling of ["Pages%5CSecret.md", "Pages%2FSecret.md", "%2FPages/Secret.md"]) {
    const res = await member.get(`/api/w/${slug}/pages/${spelling}`);
    assert.notEqual(res.status, 200, `spelling ${spelling} leaked the page`);
    assert.ok(!res.text.includes("top secret"), `spelling ${spelling} leaked the body`);
  }
  const viaVault = await member.get(`/api/w/${slug}/vault/file/Pages%5CSecret.md`);
  assert.ok(!viaVault.text.includes("top secret"));
  const put = await member.put(`/api/w/${slug}/pages/Pages%5CSecret.md`, { body: "pwned" });
  assert.notEqual(put.status, 200);
});

test("attachments reject path-like ids", async () => {
  const res = await member.get(`/api/w/${slug}/attachments/..%2FPages%2FSecret.md`);
  assert.equal(res.status, 400);
  assert.ok(!res.text.includes("top secret"));
});

test("reserved and non-content paths are not reachable as pages or files", async () => {
  for (const p of [".git/config", "Pages/.git/config", ".trash/x.md", ".retex/state"]) {
    const res = await admin.get(`/api/w/${slug}/pages/${p}`);
    assert.ok([400, 404].includes(res.status), `${p} -> ${res.status}`);
    const put = await admin.put(`/api/w/${slug}/vault/file/${p}`, "x");
    assert.equal(put.status, 400, `${p} write -> ${put.status}`);
  }
});

test("a symlink inside the vault cannot lead outside it", async () => {
  const outside = mkdtempSync(path.join(tmpdir(), "concept-outside-"));
  scratch.push(outside);
  writeFileSync(path.join(outside, "x.txt"), "outside data");
  const vault = env.engine.vaultDir(slug);
  symlinkSync(outside, path.join(vault, "Pages", "Escape"));
  const read = await admin.get(`/api/w/${slug}/vault/file/Pages/Escape/x.txt`);
  assert.ok(!read.text.includes("outside data"), "read escaped the vault");
  const write = await admin.put(`/api/w/${slug}/vault/file/Pages/Escape/new.txt`, "pwn");
  assert.notEqual(write.status, 200, "write escaped the vault");
});

test("zip import skips reserved entries however they are spelled", async () => {
  const zip = createZip([
    { path: "./.git/config", data: Buffer.from("evil") },
    { path: "Pages/../../escape.md", data: Buffer.from("evil") },
    { path: "Pages/Imported.md", data: Buffer.from("# ok") },
  ]);
  const form = new FormData();
  form.set("file", new File([new Uint8Array(zip)], "x.zip"));
  const res = await fetch(`${env.baseUrl}/api/w/${slug}/import`, {
    method: "POST",
    headers: { cookie: admin.cookie! },
    body: form,
  });
  const json = await res.json();
  assert.equal(res.status, 200);
  assert.equal(json.imported, 1);
  assert.equal(json.skipped, 2);
});

test("sync refuses remotes and branches that git would parse as options", async () => {
  for (const remoteUrl of ["--upload-pack=touch /tmp/pwn", "ext::sh -c id", "-oProxyCommand=id", "http://example.invalid/r.git", "https://host/a b"]) {
    const res = await admin.put(`/api/w/${slug}/sync`, { remoteUrl, enabled: false });
    assert.equal(res.status, 400, `${remoteUrl} accepted`);
    assert.equal(res.json.error.code, "invalid_remote");
  }
  const badBranch = await admin.put(`/api/w/${slug}/sync`, { remoteUrl: "https://example.invalid/r.git", branch: "--x", enabled: false });
  assert.equal(badBranch.status, 400);
});

test("a team of another workspace cannot be modified", async () => {
  const other = new Client(env.baseUrl);
  await other.register("other-admin@sec.test");
  const ows = await other.post("/api/workspaces", { name: "OtherCo" });
  const victimTeam = await admin.post(`/api/w/${slug}/teams`, { name: "Victims" });
  const meAdmin = await admin.get("/api/me");
  await admin.put(`/api/w/${slug}/teams/${victimTeam.json.id}/members/${meAdmin.json.user.id}`);
  const res = await other.delete(`/api/w/${ows.json.slug}/teams/${victimTeam.json.id}/members/${meAdmin.json.user.id}`);
  assert.equal(res.status, 404);
  const teams = await admin.get(`/api/w/${slug}/teams`);
  assert.equal(teams.json.teams.find((t: any) => t.id === victimTeam.json.id).memberIds.length, 1);
});

test("SSE hides events about pages the member may not see", async () => {
  const ctl = new AbortController();
  const res = await fetch(`${env.baseUrl}/api/w/${slug}/events`, { headers: { cookie: member.cookie! }, signal: ctl.signal });
  const reader = res.body!.getReader();
  const chunks: string[] = [];
  const pump = (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        chunks.push(new TextDecoder().decode(value));
      }
    } catch {
      /* aborted */
    }
  })();
  await new Promise((r) => setTimeout(r, 300));
  const page = await admin.get(`/api/w/${slug}/pages/Pages/Secret.md`);
  await admin.put(`/api/w/${slug}/pages/Pages/Secret.md`, { body: "edited" }, { "if-match": page.json.contentHash });
  await admin.post(`/api/w/${slug}/pages`, { title: "Public note", body: "hi" });
  await new Promise((r) => setTimeout(r, 1500));
  ctl.abort();
  await pump;
  const all = chunks.join("");
  assert.ok(!all.includes("Secret.md"), "member saw an event for a hidden page");
  assert.ok(all.includes("Public note"), "member should see events for visible pages");
  assert.ok(!all.includes("admin@sec.test"), "event leaked an email address");
});

test("an admin cannot take or remove ownership", async () => {
  const ws = await admin.post("/api/workspaces", { name: "OwnerCo" });
  const s = ws.json.slug;
  const adm = new Client(env.baseUrl);
  const inv = await admin.post(`/api/w/${s}/invites`, { role: "admin" });
  await adm.register("second-admin@sec.test", "password-123", inv.json.token);
  const meAdm = await adm.get("/api/me");
  const meOwner = await admin.get("/api/me");
  assert.equal((await adm.patch(`/api/w/${s}/members/${meAdm.json.user.id}`, { role: "owner" })).status, 403);
  assert.equal((await adm.patch(`/api/w/${s}/members/${meOwner.json.user.id}`, { role: "guest" })).status, 403);
  assert.equal((await adm.delete(`/api/w/${s}/members/${meOwner.json.user.id}`)).status, 403);
});

test("a database schema with a path-like slug is ignored", async () => {
  const vault = env.engine.vaultDir(slug);
  writeFileSync(
    path.join(vault, ".concept", "databases", "evil.json"),
    JSON.stringify({ slug: "../../../x", name: "Evil", recordType: "x", properties: [{ key: "title", name: "T", type: "title" }], views: [] }),
  );
  const list = await admin.get(`/api/w/${slug}/databases`);
  assert.ok(!list.json.databases.some((d: any) => d.name === "Evil"));
});

test("only a hash of the session id is stored", async () => {
  const sid = admin.cookie!.split("=")[1];
  const row = env.db.prepare(`SELECT id FROM sessions WHERE id = ?`).get(sid);
  assert.equal(row, undefined);
});

test("repeated failed sign-ins are throttled", async () => {
  const c = new Client(env.baseUrl);
  let last = 0;
  for (let i = 0; i < 10; i++) last = (await c.post("/api/auth/login", { email: "nobody@sec.test", password: "wrong-password" })).status;
  assert.equal(last, 429);
});

test("case-variant spellings hit the same permissions as the real file", async () => {
  const res = await member.get(`/api/w/${slug}/pages/Pages/SECRET.md`);
  assert.notEqual(res.status, 200);
  assert.ok(!res.text.includes("top secret"));
});

test("moving or deleting a parent cannot expose or destroy what the member may not edit", async () => {
  const ws = await admin.post("/api/workspaces", { name: "TreeCo" });
  const s = ws.json.slug;
  const m = new Client(env.baseUrl);
  const inv = await admin.post(`/api/w/${s}/invites`, { role: "member" });
  await m.register("tree-member@sec.test", "password-123", inv.json.token);
  const me = await m.get("/api/me");
  await admin.post(`/api/w/${s}/pages`, { title: "Team", body: "team" });
  await admin.post(`/api/w/${s}/pages`, { title: "Other", body: "other" });
  await admin.post(`/api/w/${s}/pages`, { title: "HR", parent: "Pages/Team.md", body: "salaries" });
  await admin.put(`/api/w/${s}/acl`, { path: "Pages/Team/HR.md", subjectType: "user", subjectId: me.json.user.id, level: "none" });

  const move = await m.post(`/api/w/${s}/pages/Pages/Team.md/move`, { parent: "Pages/Other.md" });
  assert.equal(move.status, 403, "a member moved a page whose child they cannot see");
  const del = await m.delete(`/api/w/${s}/vault/file/Pages/Team`);
  assert.equal(del.status, 403, "a member deleted a folder holding a page they cannot edit");
  const still = await admin.get(`/api/w/${s}/pages/Pages/Team/HR.md`);
  assert.equal(still.status, 200);
});

test("a database schema file follows the database's permissions", async () => {
  const ws = await admin.post("/api/workspaces", { name: "SchemaCo", template: "crm" });
  const s = ws.json.slug;
  const m = new Client(env.baseUrl);
  const inv = await admin.post(`/api/w/${s}/invites`, { role: "member" });
  await m.register("schema-member@sec.test", "password-123", inv.json.token);
  const me = await m.get("/api/me");
  await admin.put(`/api/w/${s}/acl`, { path: "Data/deals", subjectType: "user", subjectId: me.json.user.id, level: "none" });
  assert.equal((await m.get(`/api/w/${s}/databases/deals`)).status, 403);
  assert.equal((await m.get(`/api/w/${s}/vault/file/.concept/databases/deals.json`)).status, 403);
});
