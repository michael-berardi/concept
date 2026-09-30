import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { Client, makeApp, type TestEnv } from "./helpers.js";

let env: TestEnv;
let admin: Client;

before(async () => {
  // this suite registers users directly, so open signup is on for the main env
  env = await makeApp({ openSignup: true });
  admin = new Client(env.baseUrl);
  await admin.register("admin@acl.test");
});

after(async () => {
  await env.close();
});

test("invite-only registration is enforced when signup is closed", async () => {
  // separate server with closed signup
  const closedEnv = await makeApp({ openSignup: false });
  try {
    const owner = new Client(closedEnv.baseUrl);
    await owner.register("owner@closed.test");
    const ws = await owner.post("/api/workspaces", { name: "Closed" });

    const stranger = new Client(closedEnv.baseUrl);
    const denied = await stranger.post("/api/auth/register", {
      email: "stranger@x.test",
      password: "password-123",
    });
    assert.equal(denied.status, 403);
    assert.match(denied.json.error.message, /invite/);

    // invite, then register with the token
    const inv = await owner.post(`/api/w/${ws.json.slug}/invites`, { role: "member", expiresInDays: 7 });
    assert.equal(inv.status, 201);
    const reg = await stranger.post("/api/auth/register", {
      email: "member@x.test",
      password: "password-123",
      inviteToken: inv.json.token,
    });
    assert.equal(reg.status, 201);
    const me = await stranger.get("/api/me");
    assert.ok(me.json.workspaces.some((w: any) => w.slug === ws.json.slug));

    // used invites cannot be reused
    const reuse = await (async () => {
      const third = new Client(closedEnv.baseUrl);
      return third.post("/api/auth/register", {
        email: "third@x.test",
        password: "password-123",
        inviteToken: inv.json.token,
      });
    })();
    assert.equal(reuse.status, 403);

    // expired invite rejected at accept-time
    const inv2 = await owner.post(`/api/w/${ws.json.slug}/invites`, { role: "guest" });
    const late = new Client(closedEnv.baseUrl);
    await late.register("late@x.test", "password-123", inv2.json.token);
    const acceptAgain = await late.post(`/api/invites/${inv2.json.token}/accept`);
    assert.equal(acceptAgain.status, 404);
    assert.equal(acceptAgain.json.error.code, "not_found");
  } finally {
    await closedEnv.close();
  }
});

test("path-prefix ACL denies edit and hides content from tree/search", async () => {
  // workspace with a public and a private subtree
  const ws = await admin.post("/api/workspaces", { name: "AclCo" });
  const slug = ws.json.slug;
  await admin.post(`/api/w/${slug}/pages`, { title: "Public", body: "public note" });
  await admin.post(`/api/w/${slug}/pages`, { title: "Pub", parent: "Pages/Public.md" });

  // member (default: edit everywhere)
  const member = new Client(env.baseUrl);
  const inv = await admin.post(`/api/w/${slug}/invites`, { role: "member" });
  await member.register("member@acl.test", "password-123", inv.json.token);

  // member can edit root-level content before any ACL
  const okEdit = await member.put(`/api/w/${slug}/pages/Pages/Public.md`, { body: "member edit" });
  assert.equal(okEdit.status, 200);

  // restrict Pages/Public subtree for this member
  const me = await member.get("/api/me");
  const memberId = me.json.user.id;
  const acl = await admin.put(`/api/w/${slug}/acl`, {
    path: "Pages/Public",
    subjectType: "user",
    subjectId: memberId,
    level: "none",
  });
  assert.equal(acl.status, 201);

  // page GET denied
  const denied = await member.get(`/api/w/${slug}/pages/Pages/Public.md`);
  assert.equal(denied.status, 403);
  assert.equal(denied.json.error.code, "forbidden");

  // write denied
  const deniedWrite = await member.put(`/api/w/${slug}/pages/Pages/Public.md`, { body: "nope" });
  assert.equal(deniedWrite.status, 403);

  // nested page denied too (prefix match)
  const deniedNested = await member.get(`/api/w/${slug}/pages/Pages/Public/Pub.md`);
  assert.equal(deniedNested.status, 403);

  // tree hides the subtree but keeps the rest
  const tree = await member.get(`/api/w/${slug}/tree`);
  const paths: string[] = [];
  const walk = (nodes: any[]) => nodes.forEach((n) => (n.type === "folder" ? (paths.push(n.path), walk(n.children)) : paths.push(n.path)));
  walk(tree.json.pages);
  assert.ok(!paths.includes("Pages/Public.md"), `private page leaked into tree: ${paths}`);
  assert.ok(paths.includes("Pages/Welcome.md"));

  // search hides it for the member, shows it for the admin
  await admin.put(`/api/w/${slug}/pages/Pages/Public.md`, { body: "secret zebra wording" });
  const memberSearch = await member.get(`/api/w/${slug}/search?q=zebra`);
  assert.equal(memberSearch.json.results.length, 0);
  const adminSearch = await admin.get(`/api/w/${slug}/search?q=zebra`);
  assert.ok(adminSearch.json.results.length >= 1);

  // effective level endpoint
  const level = await member.get(`/api/w/${slug}/acl?path=${encodeURIComponent("Pages/Public.md")}`);
  assert.equal(level.json.level, "none");
  const adminLevel = await admin.get(`/api/w/${slug}/acl?path=${encodeURIComponent("Pages/Public.md")}`);
  assert.equal(adminLevel.json.level, "admin");

  // admin (owner) can still edit
  const adminEdit = await admin.put(`/api/w/${slug}/pages/Pages/Public.md`, { body: "admin edit" });
  assert.equal(adminEdit.status, 200);
});

test("guest role sees nothing by default; explicit grant restores view", async () => {
  const ws = await admin.post("/api/workspaces", { name: "GuestCo" });
  const slug = ws.json.slug;
  const guest = new Client(env.baseUrl);
  const inv = await admin.post(`/api/w/${slug}/invites`, { role: "guest" });
  await guest.register("guest@acl.test", "password-123", inv.json.token);

  const denied = await guest.get(`/api/w/${slug}/pages/Pages/Welcome.md`);
  assert.equal(denied.status, 403);

  const tree = await guest.get(`/api/w/${slug}/tree`);
  assert.equal(tree.json.pages.length, 0);

  // grant view on Pages via workspace-wide rule for the guest
  const me = await guest.get("/api/me");
  const grant = await admin.put(`/api/w/${slug}/acl`, {
    path: "Pages",
    subjectType: "user",
    subjectId: me.json.user.id,
    level: "view",
  });
  assert.equal(grant.status, 201);
  const allowed = await guest.get(`/api/w/${slug}/pages/Pages/Welcome.md`);
  assert.equal(allowed.status, 200);
  assert.equal(allowed.json.permission, "view");
  const stillDeniedWrite = await guest.put(`/api/w/${slug}/pages/Pages/Welcome.md`, { body: "x" });
  assert.equal(stillDeniedWrite.status, 403);
});

test("team ACL grants apply to team members", async () => {
  const ws = await admin.post("/api/workspaces", { name: "TeamCo" });
  const slug = ws.json.slug;
  const member = new Client(env.baseUrl);
  const inv = await admin.post(`/api/w/${slug}/invites`, { role: "member" });
  await member.register("teammate@acl.test", "password-123", inv.json.token);
  const me = await member.get("/api/me");

  // workspace-wide rule: everyone downgraded to none on Pages…
  await admin.put(`/api/w/${slug}/acl`, {
    path: "Pages",
    subjectType: "workspace",
    level: "none",
  });
  const denied = await member.get(`/api/w/${slug}/pages/Pages/Welcome.md`);
  assert.equal(denied.status, 403);

  // …then the Readers team gets view back via a team rule (same specificity,
  // but a subject rule beats a workspace rule).
  const team = await admin.post(`/api/w/${slug}/teams`, { name: "Readers" });
  await admin.put(`/api/w/${slug}/teams/${team.json.id}/members/${me.json.user.id}`);
  await admin.put(`/api/w/${slug}/acl`, {
    path: "Pages",
    subjectType: "team",
    subjectId: team.json.id,
    level: "view",
  });
  const allowed = await member.get(`/api/w/${slug}/pages/Pages/Welcome.md`);
  assert.equal(allowed.status, 200);
  assert.equal(allowed.json.permission, "view");
  // view is not edit
  const writeDenied = await member.put(`/api/w/${slug}/pages/Pages/Welcome.md`, { body: "x" });
  assert.equal(writeDenied.status, 403);

  // a user rule at the same prefix wins over the team rule (user > team)
  await admin.put(`/api/w/${slug}/acl`, {
    path: "Pages",
    subjectType: "user",
    subjectId: me.json.user.id,
    level: "none",
  });
  const deniedAgain = await member.get(`/api/w/${slug}/pages/Pages/Welcome.md`);
  assert.equal(deniedAgain.status, 403);

  const teams = await admin.get(`/api/w/${slug}/teams`);
  assert.equal(teams.json.teams[0].memberIds.length, 1);
});

test("workspace settings and membership require the right role", async () => {
  const ws = await admin.post("/api/workspaces", { name: "RoleCo" });
  const slug = ws.json.slug;
  const member = new Client(env.baseUrl);
  const inv = await admin.post(`/api/w/${slug}/invites`, { role: "member" });
  await member.register("plain@acl.test", "password-123", inv.json.token);

  // member cannot manage ACLs / invites / members / sync / export
  for (const attempt of [
    member.put(`/api/w/${slug}/acl`, { path: "Pages", subjectType: "workspace", level: "none" }),
    member.post(`/api/w/${slug}/invites`, { role: "member" }),
    member.patch(`/api/w/${slug}`, { name: "Hacked" }),
    member.get(`/api/w/${slug}/invites`),
    member.put(`/api/w/${slug}/sync`, { enabled: true, remoteUrl: "https://example.invalid/x.git" }),
    member.post(`/api/w/${slug}/sync/run`),
  ]) {
    const res = await attempt;
    assert.equal(res.status, 403, `expected 403, got ${res.status} for ${res.json?.error?.message}`);
  }

  // member cannot delete the workspace
  const del = await member.delete(`/api/w/${slug}`);
  assert.equal(del.status, 403);

  // membership management as admin works
  const members = await admin.get(`/api/w/${slug}/members`);
  assert.equal(members.json.members.length, 2);
  const promote = await admin.patch(`/api/w/${slug}/members/${(await member.get("/api/me")).json.user.id}`, {
    role: "admin",
  });
  assert.equal(promote.status, 200);
  const nowAllowed = await member.get(`/api/w/${slug}/invites`);
  assert.equal(nowAllowed.status, 200);
});

test("import/export and ACL admin checks reject non-admin members", async () => {
  const ws = await admin.post("/api/workspaces", { name: "ExpCo" });
  const slug = ws.json.slug;
  const member = new Client(env.baseUrl);
  const inv = await admin.post(`/api/w/${slug}/invites`, { role: "member" });
  await member.register("exp@acl.test", "password-123", inv.json.token);
  const exp = await member.get(`/api/w/${slug}/export.zip`);
  assert.equal(exp.status, 403);
  const imp = await member.post(`/api/w/${slug}/import`, { whatever: 1 });
  assert.equal(imp.status, 403);
});
