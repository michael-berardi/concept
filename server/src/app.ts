import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { getCookie } from "hono/cookie";
import type { DB } from "./db.js";
import type { Config } from "./config.js";
import type { VaultEngine, TreeNode } from "./vault/engine.js";
import type { Indexer } from "./index/indexer.js";
import type { VaultWatcher } from "./index/watcher.js";
import type { EventBus } from "./events.js";
import type { SyncManager } from "./sync/syncer.js";
import { ApiError, badRequest, forbidden, notFound, unauthorized } from "./errors.js";
import { shortId, now } from "./ids.js";
import {
  clearSessionCookie,
  createApiToken,
  createSession,
  effectiveLevel,
  getAccess,
  hashPassword,
  levelAtLeast,
  requireAuth,
  requireLevel,
  setSessionCookie,
  verifyPassword,
  workspaceAccess,
  type AclLevel,
  type UserRow,
  type WorkspaceAccess,
} from "./auth/access.js";
import { ftsQuery } from "./index/indexer.js";
import { createZip, readZip } from "./zip.js";
import {
  ATTACHMENTS_DIR,
  CONCEPT_DIR,
  DATA_DIR,
  PAGES_DIR,
  absPath,
  assertApiPath,
  assertContentPath,
  listAllFiles,
  readFileIfExists,
  safeRelPath,
} from "./vault/files.js";
import { slugifyDbSlug } from "./vault/engine.js";
import { serveStaticOrIndex } from "./static.js";
import path from "node:path";
import { mkdirSync, writeFileSync, existsSync, renameSync } from "node:fs";

export interface AppDeps {
  cfg: Config;
  db: DB;
  engine: VaultEngine;
  indexer: Indexer;
  watcher: VaultWatcher;
  bus: EventBus;
  sync: SyncManager;
}

type Env = { Variables: { user: UserRow; access: WorkspaceAccess } };

export function createApp(deps: AppDeps): Hono<Env> {
  const { db, cfg, engine, indexer, bus, sync } = deps;
  const app = new Hono<Env>();

  // ---------- error handling ----------
  app.onError((err, c) => {
    if (err instanceof ApiError) {
      c.status(err.status as 400);
      return c.json({
        error: { code: err.code, message: err.message, ...(err.extra ?? {}) },
      });
    }
    console.error("[api] internal error:", err);
    c.status(500);
    return c.json({
      error: { code: "internal", message: `Internal error: ${(err as Error).message}` },
    });
  });
  app.notFound((c) => {
    if (c.req.path.startsWith("/api/")) {
      c.status(404);
      return c.json({
        error: { code: "not_found", message: `No route for ${c.req.method} ${c.req.path}` },
      });
    }
    return serveStaticOrIndex(c, cfg);
  });

  // ---------- auth gate (health, login and register stay open) ----------
  app.use("/api/*", async (c, next) => {
    const open =
      c.req.path === "/api/health" ||
      c.req.path === "/api/auth/login" ||
      c.req.path === "/api/auth/register";
    if (open) return next();
    return requireAuth(db)(c, next);
  });

  // ---------- helpers ----------

  const userCount = (): number =>
    (db.prepare(`SELECT COUNT(*) AS n FROM users`).get() as any).n;

  const publicUser = (u: UserRow) => ({
    id: u.id,
    email: u.email,
    name: u.name,
    isAdmin: !!u.is_admin,
  });

  const getWs = (slug: string): { id: string; slug: string; name: string; template: string; created_by: string | null } => {
    const ws = db
      .prepare(`SELECT id, slug, name, template, created_by FROM workspaces WHERE slug = ?`)
      .get(slug) as any;
    if (!ws) throw notFound(`No workspace '${slug}'`);
    return ws;
  };

  /** Wildcard path param (URL-decoded, per segment). */
  const wildcard = (c: any, prefix: string): string => {
    const url = new URL(c.req.url);
    const rest = url.pathname.slice(prefix.length);
    let joined: string;
    try {
      joined = rest
        .split("/")
        .filter((s) => s !== "")
        .map((s) => decodeURIComponent(s))
        .join("/");
    } catch {
      throw badRequest("Malformed URL encoding in path", "invalid_path");
    }
    // Canonicalise once, before any ACL check or file access, so `\\`, `//`,
    // leading `/` and `.`/`..` can never differ between check and use.
    return safeRelPath(joined);
  };

  const jsonBody = async (c: any): Promise<Record<string, any>> => {
    try {
      const b = await c.req.json();
      if (b === null || typeof b !== "object" || Array.isArray(b)) {
        throw new Error("not an object");
      }
      return b;
    } catch {
      throw badRequest("Request body must be a JSON object", "invalid_json");
    }
  };

  const ifMatchHash = (c: any): string | null => {
    const h = c.req.header("if-match");
    if (!h) return null;
    const t = h.trim();
    if (t === "*") return null;
    return t.replace(/^W\//, "").replace(/^"|"$/g, "");
  };

  const logActivity = (
    wsId: string,
    path: string | null,
    user: UserRow | null,
    action: string,
    detail?: string,
  ): void => {
    db.prepare(
      `INSERT INTO activity (workspace_id, path, user_id, user_name, action, detail, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(wsId, path, user?.id ?? null, user?.name ?? "system", action, detail ?? null, now());
  };

  /** Hook the engine writes into indexing + SSE + git sync. */
  engine.onChange = (wsSlug, paths, actor) => {
    const ws = db.prepare(`SELECT id FROM workspaces WHERE slug = ?`).get(wsSlug) as any;
    if (!ws) return;
    for (const p of paths) {
      try {
        indexer.indexFile(ws.id, engine.vaultDir(wsSlug), p);
      } catch (err) {
        console.error(`[index] failed for ${p}: ${(err as Error).message}`);
      }
    }
    indexer.resolveAllLinks?.(ws.id);
    bus.publish(wsSlug, { type: "change", paths, actor });
    sync.markDirty(wsSlug, actor);
  };

  // =====================================================================
  // Health
  // =====================================================================
  app.get("/api/health", (c) =>
    c.json({ ok: true, version: cfg.version, setupRequired: userCount() === 0 }),
  );

  // =====================================================================
  // Auth
  // =====================================================================
  app.post("/api/auth/register", async (c) => {
    const b = await jsonBody(c);
    const email = String(b.email ?? "").trim().toLowerCase();
    const name = String(b.name ?? email.split("@")[0] ?? "").trim();
    const password = String(b.password ?? "");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      throw badRequest("A valid email is required", "invalid_email");
    }
    if (password.length < 8) {
      throw badRequest("Password must be at least 8 characters", "weak_password");
    }
    if (db.prepare(`SELECT id FROM users WHERE email = ?`).get(email)) {
      throw ApiError2(409, "email_taken", `An account with email ${email} already exists`);
    }
    const isFirst = userCount() === 0;
    if (!isFirst && !cfg.openSignup) {
      const token = String(b.inviteToken ?? "");
      const invite = token
        ? (db
            .prepare(
              `SELECT * FROM invites WHERE token = ? AND used_by IS NULL AND expires_at > ?`,
            )
            .get(token, now()) as any)
        : null;
      if (!invite) {
        throw forbidden(
          "Registration is invite-only. Provide a valid inviteToken or set CONCEPT_OPEN_SIGNUP=1.",
        );
      }
    }
    const id = shortId("usr");
    db.prepare(
      `INSERT INTO users (id, email, name, password_hash, is_admin, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(id, email, name || email, hashPassword(password), isFirst ? 1 : 0, now());

    // consume invite → workspace membership
    const token = String(b.inviteToken ?? "");
    if (token) {
      const invite = db
        .prepare(`SELECT * FROM invites WHERE token = ? AND used_by IS NULL AND expires_at > ?`)
        .get(token, now()) as any;
      if (invite) {
        db.prepare(`UPDATE invites SET used_by = ?, used_at = ? WHERE id = ?`).run(id, now(), invite.id);
        if (invite.workspace_id) {
          db.prepare(
            `INSERT OR IGNORE INTO members (workspace_id, user_id, role, created_at) VALUES (?, ?, ?, ?)`,
          ).run(invite.workspace_id, id, invite.role, now());
        }
      }
    }

    const user = db.prepare(`SELECT * FROM users WHERE id = ?`).get(id) as unknown as UserRow;
    setSessionCookie(c, createSession(db, id));
    return c.json({ user: publicUser(user) }, 201);
  });

  app.post("/api/auth/login", async (c) => {
    const b = await jsonBody(c);
    const email = String(b.email ?? "").trim().toLowerCase();
    const user = db.prepare(`SELECT * FROM users WHERE email = ?`).get(email) as
      | (UserRow & { password_hash: string })
      | undefined;
    if (!user || !verifyPassword(String(b.password ?? ""), user.password_hash)) {
      throw unauthorized("Email or password is incorrect");
    }
    setSessionCookie(c, createSession(db, user.id));
    return c.json({ user: publicUser(user) });
  });

  app.post("/api/auth/logout", (c) => {
    const session = getCookie(c, "concept_session");
    if (session) db.prepare(`DELETE FROM sessions WHERE id = ?`).run(session);
    clearSessionCookie(c);
    return c.json({ ok: true });
  });

  app.get("/api/me", (c) => {
    const user = c.get("user");
    const workspaces = (
      db
        .prepare(
          `SELECT w.slug, w.name, m.role FROM workspaces w JOIN members m ON m.workspace_id = w.id
           WHERE m.user_id = ? ORDER BY w.name`,
        )
        .all(user.id) as any[]
    ).map((r) => ({ slug: r.slug, name: r.name, role: r.role }));
    if (user.is_admin) {
      for (const w of db.prepare(`SELECT slug, name FROM workspaces`).all() as any[]) {
        if (!workspaces.some((x) => x.slug === w.slug)) {
          workspaces.push({ slug: w.slug, name: w.name, role: "owner" });
        }
      }
    }
    return c.json({ user: publicUser(user), workspaces });
  });

  // personal API tokens
  app.get("/api/me/tokens", (c) => {
    const user = c.get("user");
    const tokens = (
      db.prepare(`SELECT id, name, created_at, last_used_at FROM api_tokens WHERE user_id = ? ORDER BY created_at DESC`).all(user.id) as any[]
    ).map((t) => ({ id: t.id, name: t.name, createdAt: t.created_at, lastUsedAt: t.last_used_at }));
    return c.json({ tokens });
  });
  app.post("/api/me/tokens", async (c) => {
    const user = c.get("user");
    const b = await jsonBody(c);
    const name = String(b.name ?? "token").slice(0, 100);
    const { id, token } = createApiToken(db, user.id, name);
    return c.json({ id, name, token }, 201);
  });
  app.delete("/api/me/tokens/:id", (c) => {
    const user = c.get("user");
    const r = db
      .prepare(`DELETE FROM api_tokens WHERE id = ? AND user_id = ?`)
      .run(c.req.param("id"), user.id);
    if (r.changes === 0) throw notFound("No such token");
    return c.json({ ok: true });
  });

  // =====================================================================
  // Workspaces
  // =====================================================================
  const requireWsAdmin = (access: WorkspaceAccess) => {
    if (access.role !== "owner" && access.role !== "admin" && !access.isInstanceAdmin) {
      throw forbidden("Workspace admin role required");
    }
  };
  const requireWsOwner = (access: WorkspaceAccess) => {
    if (access.role !== "owner" && !access.isInstanceAdmin) {
      throw forbidden("Workspace owner role required");
    }
  };

  app.get("/api/workspaces", (c) => {
    const user = c.get("user");
    const rows = (
      db
        .prepare(
          `SELECT w.id, w.slug, w.name, m.role FROM workspaces w
           JOIN members m ON m.workspace_id = w.id WHERE m.user_id = ? ORDER BY w.name`,
        )
        .all(user.id) as any[]
    ).map((r) => ({ slug: r.slug, name: r.name, role: r.role }));
    return c.json({ workspaces: rows });
  });

  app.post("/api/workspaces", async (c) => {
    const user = c.get("user");
    const b = await jsonBody(c);
    const name = String(b.name ?? "").trim();
    if (!name) throw badRequest("name is required", "missing_name");
    const slug = slugifyDbSlug(b.slug || name);
    if (!/^[a-z0-9][a-z0-9-]{0,48}$/.test(slug)) {
      throw badRequest(`Invalid workspace slug '${slug}'`, "invalid_slug");
    }
    if (db.prepare(`SELECT id FROM workspaces WHERE slug = ?`).get(slug)) {
      throw ApiError2(409, "slug_taken", `Workspace slug '${slug}' is already in use`);
    }
    const template = b.template === "crm" ? "crm" : "blank";
    const id = shortId("ws");
    db.prepare(
      `INSERT INTO workspaces (id, slug, name, template, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(id, slug, name, template, user.id, now());
    db.prepare(`INSERT INTO members (workspace_id, user_id, role, created_at) VALUES (?, ?, 'owner', ?)`).run(
      id,
      user.id,
      now(),
    );
    engine.ensureVaultDirs(slug, name, id);
    deps.watcher.watchWorkspace(id, slug, engine.vaultDir(slug));
    const ws = { id, slug, name };
    if (template === "crm") {
      engine.createCrmStarter(ws, `${user.name} <${user.email}>`);
    } else {
      engine.createPage(ws, { title: "Welcome", body: `Welcome to **${name}**.` }, `${user.name} <${user.email}>`);
    }
    indexer.reindexWorkspace(id, engine.vaultDir(slug));
    return c.json({ slug, name, template }, 201);
  });

  // workspace-scoped middleware
  app.use("/api/w/:ws/*", async (c, next) => {
    const slug = c.req.param("ws");
    const ws = getWs(slug);
    const access = workspaceAccess(c, db, slug);
    access.workspaceId = ws.id;
    c.set("access", access);
    await next();
  });

  app.get("/api/w/:ws", (c) => {
    const access = c.get("access");
    const ws = getWs(access.slug);
    const members = (
      db
        .prepare(
          `SELECT m.role, u.id, u.email, u.name FROM members m JOIN users u ON u.id = m.user_id
           WHERE m.workspace_id = ?`,
        )
        .all(ws.id) as any[]
    ).map((m) => ({ id: m.id, email: m.email, name: m.name, role: m.role }));
    return c.json({ slug: ws.slug, name: ws.name, template: ws.template, yourRole: access.role, members });
  });

  app.patch("/api/w/:ws", async (c) => {
    const access = c.get("access");
    requireWsAdmin(access);
    const b = await jsonBody(c);
    const name = String(b.name ?? "").trim();
    if (!name) throw badRequest("name is required", "missing_name");
    db.prepare(`UPDATE workspaces SET name = ? WHERE id = ?`).run(name, access.workspaceId);
    engine.ensureVaultDirs(access.slug, name, access.workspaceId);
    return c.json({ slug: access.slug, name });
  });

  app.delete("/api/w/:ws", (c) => {
    const access = c.get("access");
    requireWsOwner(access);
    const vaultDir = engine.vaultDir(access.slug);
    db.prepare(`DELETE FROM workspaces WHERE id = ?`).run(access.workspaceId);
    deps.watcher.unwatchWorkspace(access.slug);
    // Move the vault aside instead of destroying data.
    const trashDir = path.join(cfg.dataDir, "deleted-workspaces");
    mkdirSync(trashDir, { recursive: true });
    if (existsSync(vaultDir)) {
      const dest = path.join(trashDir, `${access.slug}-${Date.now()}`);
      try {
        renameSync(vaultDir, dest);
      } catch (err) {
        console.error(`[workspace] could not move vault aside: ${(err as Error).message}`);
      }
    }
    return c.json({ ok: true });
  });

  // ---------- members ----------
  app.get("/api/w/:ws/members", (c) => {
    const access = c.get("access");
    const rows = (
      db
        .prepare(
          `SELECT u.id, u.email, u.name, m.role FROM members m JOIN users u ON u.id = m.user_id
           WHERE m.workspace_id = ? ORDER BY u.name`,
        )
        .all(access.workspaceId) as any[]
    ).map((m) => ({ id: m.id, email: m.email, name: m.name, role: m.role }));
    return c.json({ members: rows });
  });

  app.patch("/api/w/:ws/members/:userId", async (c) => {
    const access = c.get("access");
    requireWsAdmin(access);
    const b = await jsonBody(c);
    const role = String(b.role ?? "");
    if (!["owner", "admin", "member", "guest"].includes(role)) {
      throw badRequest(`Invalid role '${role}'`, "invalid_role");
    }
    const r = db
      .prepare(`UPDATE members SET role = ? WHERE workspace_id = ? AND user_id = ?`)
      .run(role, access.workspaceId, c.req.param("userId"));
    if (r.changes === 0) throw notFound("No such member");
    return c.json({ ok: true });
  });

  app.delete("/api/w/:ws/members/:userId", (c) => {
    const access = c.get("access");
    requireWsAdmin(access);
    const target = c.req.param("userId");
    const r = db
      .prepare(`DELETE FROM members WHERE workspace_id = ? AND user_id = ?`)
      .run(access.workspaceId, target);
    if (r.changes === 0) throw notFound("No such member");
    return c.json({ ok: true });
  });

  // ---------- invites ----------
  app.post("/api/w/:ws/invites", async (c) => {
    const access = c.get("access");
    requireWsAdmin(access);
    const b = await jsonBody(c);
    const role = String(b.role ?? "member");
    if (!["admin", "member", "guest"].includes(role)) {
      throw badRequest(`Invalid invite role '${role}'`, "invalid_role");
    }
    const days = Math.min(Math.max(Number(b.expiresInDays ?? 7), 1), 365);
    const id = shortId("inv");
    const token = shortId("ivt", 16).slice(4);
    const email = b.email ? String(b.email).trim().toLowerCase() : null;
    db.prepare(
      `INSERT INTO invites (id, workspace_id, email, role, token, created_by, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, access.workspaceId, email, role, token, access.userId, now() + days * 86400_000, now());
    return c.json(
      { id, url: `/invite/${token}`, token, role, expiresAt: now() + days * 86400_000 },
      201,
    );
  });

  app.get("/api/w/:ws/invites", (c) => {
    const access = c.get("access");
    requireWsAdmin(access);
    const invites = (
      db
        .prepare(
          `SELECT id, email, role, token, expires_at, used_by, used_at, created_at FROM invites
           WHERE workspace_id = ? ORDER BY created_at DESC`,
        )
        .all(access.workspaceId) as any[]
    ).map((i) => ({
      id: i.id,
      email: i.email,
      role: i.role,
      url: `/invite/${i.token}`,
      expiresAt: i.expires_at,
      usedBy: i.used_by,
      usedAt: i.used_at,
      createdAt: i.created_at,
    }));
    return c.json({ invites });
  });

  app.delete("/api/w/:ws/invites/:id", (c) => {
    const access = c.get("access");
    requireWsAdmin(access);
    const r = db
      .prepare(`DELETE FROM invites WHERE id = ? AND workspace_id = ?`)
      .run(c.req.param("id"), access.workspaceId);
    if (r.changes === 0) throw notFound("No such invite");
    return c.json({ ok: true });
  });

  app.post("/api/invites/:token/accept", (c) => {
    const user = c.get("user");
    const invite = db
      .prepare(`SELECT * FROM invites WHERE token = ? AND used_by IS NULL AND expires_at > ?`)
      .get(c.req.param("token"), now()) as any;
    if (!invite) throw notFound("This invite is invalid, already used, or expired");
    db.prepare(`UPDATE invites SET used_by = ?, used_at = ? WHERE id = ?`).run(user.id, now(), invite.id);
    if (invite.workspace_id) {
      db.prepare(
        `INSERT OR IGNORE INTO members (workspace_id, user_id, role, created_at) VALUES (?, ?, ?, ?)`,
      ).run(invite.workspace_id, user.id, invite.role, now());
    }
    const ws = db.prepare(`SELECT slug, name FROM workspaces WHERE id = ?`).get(invite.workspace_id) as any;
    return c.json({ ok: true, workspace: ws ?? null, role: invite.role });
  });

  // ---------- teams ----------
  app.get("/api/w/:ws/teams", (c) => {
    const access = c.get("access");
    const teams = (
      db.prepare(`SELECT id, name FROM teams WHERE workspace_id = ? ORDER BY name`).all(access.workspaceId) as any[]
    ).map((t) => ({
      id: t.id,
      name: t.name,
      memberIds: (
        db.prepare(`SELECT user_id FROM team_members WHERE team_id = ?`).all(t.id) as any[]
      ).map((m) => m.user_id),
    }));
    return c.json({ teams });
  });

  app.post("/api/w/:ws/teams", async (c) => {
    const access = c.get("access");
    requireWsAdmin(access);
    const b = await jsonBody(c);
    const name = String(b.name ?? "").trim();
    if (!name) throw badRequest("name is required", "missing_name");
    const existing = db
      .prepare(`SELECT id FROM teams WHERE workspace_id = ? AND name = ?`)
      .get(access.workspaceId, name) as any;
    if (existing) throw ApiError2(409, "name_taken", `Team '${name}' already exists`);
    const id = shortId("team");
    db.prepare(`INSERT INTO teams (id, workspace_id, name, created_at) VALUES (?, ?, ?, ?)`).run(
      id,
      access.workspaceId,
      name,
      now(),
    );
    return c.json({ id, name, memberIds: [] }, 201);
  });

  app.patch("/api/w/:ws/teams/:id", async (c) => {
    const access = c.get("access");
    requireWsAdmin(access);
    const b = await jsonBody(c);
    const name = String(b.name ?? "").trim();
    if (!name) throw badRequest("name is required", "missing_name");
    const r = db
      .prepare(`UPDATE teams SET name = ? WHERE id = ? AND workspace_id = ?`)
      .run(name, c.req.param("id"), access.workspaceId);
    if (r.changes === 0) throw notFound("No such team");
    return c.json({ ok: true });
  });

  app.delete("/api/w/:ws/teams/:id", (c) => {
    const access = c.get("access");
    requireWsAdmin(access);
    const r = db
      .prepare(`DELETE FROM teams WHERE id = ? AND workspace_id = ?`)
      .run(c.req.param("id"), access.workspaceId);
    if (r.changes === 0) throw notFound("No such team");
    return c.json({ ok: true });
  });

  app.put("/api/w/:ws/teams/:id/members/:userId", (c) => {
    const access = c.get("access");
    requireWsAdmin(access);
    const team = db
      .prepare(`SELECT id FROM teams WHERE id = ? AND workspace_id = ?`)
      .get(c.req.param("id"), access.workspaceId) as any;
    if (!team) throw notFound("No such team");
    const isMember = db
      .prepare(`SELECT 1 FROM members WHERE workspace_id = ? AND user_id = ?`)
      .get(access.workspaceId, c.req.param("userId"));
    if (!isMember) throw badRequest("User is not a member of this workspace", "not_a_member");
    db.prepare(`INSERT OR IGNORE INTO team_members (team_id, user_id) VALUES (?, ?)`).run(
      team.id,
      c.req.param("userId"),
    );
    return c.json({ ok: true });
  });

  app.delete("/api/w/:ws/teams/:id/members/:userId", (c) => {
    const access = c.get("access");
    requireWsAdmin(access);
    const ownTeam = db
      .prepare(`SELECT id FROM teams WHERE id = ? AND workspace_id = ?`)
      .get(c.req.param("id"), access.workspaceId);
    if (!ownTeam) throw notFound("No such team");
    const r = db
      .prepare(`DELETE FROM team_members WHERE team_id = ? AND user_id = ?`)
      .run(c.req.param("id"), c.req.param("userId"));
    if (r.changes === 0) throw notFound("User is not in this team");
    return c.json({ ok: true });
  });

  // ---------- ACL ----------
  app.get("/api/w/:ws/acl", (c) => {
    const access = c.get("access");
    const qPath = c.req.query("path");
    const rules = (
      db
        .prepare(
          `SELECT id, path, subject_type, subject_id, level, created_at FROM acls WHERE workspace_id = ? ORDER BY path`,
        )
        .all(access.workspaceId) as any[]
    ).map((r) => ({
      id: r.id,
      path: r.path,
      subjectType: r.subject_type,
      subjectId: r.subject_id,
      level: r.level,
      createdAt: r.created_at,
    }));
    if (qPath !== undefined && qPath !== "") {
      const safe = safeRelPath(qPath);
      return c.json({
        path: safe,
        level: effectiveLevel(db, access, safe),
        rules: rules.filter((r) => safe === r.path || safe.startsWith(`${r.path}/`) || r.path === ""),
      });
    }
    return c.json({ rules });
  });

  app.put("/api/w/:ws/acl", async (c) => {
    const access = c.get("access");
    requireWsAdmin(access);
    const b = await jsonBody(c);
    const p = safeRelPath(String(b.path ?? ""));
    const subjectType = String(b.subjectType ?? "");
    if (!["user", "team", "workspace"].includes(subjectType)) {
      throw badRequest(`subjectType must be user, team or workspace`, "invalid_subject");
    }
    const subjectId = subjectType === "workspace" ? null : String(b.subjectId ?? "");
    if (subjectType === "user" && !subjectId) throw badRequest("subjectId required for user subject", "invalid_subject");
    if (subjectType === "team" && !subjectId) throw badRequest("subjectId required for team subject", "invalid_subject");
    const level = String(b.level ?? "");
    if (!["none", "view", "comment", "edit", "admin"].includes(level)) {
      throw badRequest(`Invalid level '${level}'`, "invalid_level");
    }
    const existing = db
      .prepare(
        `SELECT id FROM acls WHERE workspace_id = ? AND path = ? AND subject_type = ? AND subject_id IS ?`,
      )
      .get(access.workspaceId, p, subjectType, subjectId) as any;
    let id: string;
    if (existing) {
      id = existing.id;
      db.prepare(`UPDATE acls SET level = ? WHERE id = ?`).run(level, id);
    } else {
      id = shortId("acl");
      db.prepare(
        `INSERT INTO acls (id, workspace_id, path, subject_type, subject_id, level, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(id, access.workspaceId, p, subjectType, subjectId, level, now());
    }
    return c.json({ id, path: p, subjectType, subjectId, level }, 201);
  });

  app.delete("/api/w/:ws/acl/:id", (c) => {
    const access = c.get("access");
    requireWsAdmin(access);
    const r = db
      .prepare(`DELETE FROM acls WHERE id = ? AND workspace_id = ?`)
      .run(c.req.param("id"), access.workspaceId);
    if (r.changes === 0) throw notFound("No such ACL rule");
    return c.json({ ok: true });
  });

  // =====================================================================
  // Content: tree / pages / databases / rows
  // =====================================================================

  app.get("/api/w/:ws/tree", (c) => {
    const access = c.get("access");
    const t = engine.tree({ id: access.workspaceId, slug: access.slug });
    const filterPages = (nodes: TreeNode[]): TreeNode[] =>
      nodes
        .map((n) => {
          const level = effectiveLevel(db, access, n.path);
          const children = filterPages(n.children ?? []);
          const visible = levelAtLeast(level, "view") || children.length > 0;
          return visible ? { ...n, children } : null;
        })
        .filter((n): n is TreeNode => n !== null);
    const pages = filterPages(t.pages);
    const databases = t.databases.filter((d) =>
      levelAtLeast(effectiveLevel(db, access, d.path), "view"),
    );
    return c.json({ pages, databases });
  });

  // ---------- pages ----------
  app.get("/api/w/:ws/pages", (c) => {
    const access = c.get("access");
    const parent = c.req.query("parent") ?? null;
    let metas = engine.listPages({ id: access.workspaceId }, parent === null ? undefined : parent);
    metas = metas.filter((m) => levelAtLeast(effectiveLevel(db, access, m.path), "view"));
    return c.json({
      pages: metas.map((m) => ({
        path: m.path,
        title: m.title,
        icon: m.properties.icon ?? null,
        contentHash: m.contentHash,
        updatedAt: m.updatedAt,
      })),
    });
  });

  app.post("/api/w/:ws/pages", async (c) => {
    const access = c.get("access");
    const b = await jsonBody(c);
    const parent = b.parent ? safeRelPath(String(b.parent)) : null;
    requireLevel(access, db, parent ?? PAGES_DIR, "edit");
    const page = engine.createPage(
      { id: access.workspaceId, slug: access.slug },
      {
        title: String(b.title ?? ""),
        parent,
        body: b.body !== undefined ? String(b.body) : undefined,
        icon: b.icon !== undefined && b.icon !== null ? String(b.icon) : null,
      },
      actorLabel(c),
    );
    logActivity(access.workspaceId, page.path, c.get("user"), "page.created");
    return c.json(page, 201);
  });

  app.get("/api/w/:ws/pages/*", (c) => {
    const access = c.get("access");
    const p = wildcard(c, `/api/w/${access.slug}/pages`);
    assertContentPath(p);
    requireLevel(access, db, p, "view");
    return c.json(engine.getPage({ id: access.workspaceId, slug: access.slug }, p, effectiveLevel(db, access, p)));
  });

  app.put("/api/w/:ws/pages/*", async (c) => {
    const access = c.get("access");
    const p = wildcard(c, `/api/w/${access.slug}/pages`);
    assertContentPath(p);
    requireLevel(access, db, p, "edit");
    const b = await jsonBody(c);
    const page = engine.updatePage(
      { id: access.workspaceId, slug: access.slug },
      p,
      {
        title: b.title !== undefined ? String(b.title) : undefined,
        properties: (b.properties ?? undefined) as Record<string, unknown> | undefined,
        body: b.body !== undefined ? String(b.body) : undefined,
      },
      ifMatchHash(c),
      actorLabel(c),
    );
    logActivity(access.workspaceId, p, c.get("user"), "page.updated");
    return c.json(page);
  });

  app.delete("/api/w/:ws/pages/*", (c) => {
    const access = c.get("access");
    const p = wildcard(c, `/api/w/${access.slug}/pages`);
    assertContentPath(p);
    requireLevel(access, db, p, "edit");
    const res = engine.deletePage({ id: access.workspaceId, slug: access.slug }, p, actorLabel(c));
    logActivity(access.workspaceId, p, c.get("user"), "page.deleted", `trashed to ${res.trashedTo}`);
    return c.json(res);
  });

  app.post("/api/w/:ws/pages/*", async (c) => {
    const access = c.get("access");
    let p = wildcard(c, `/api/w/${access.slug}/pages`);
    const isMove = p.endsWith("/move");
    if (isMove) p = p.slice(0, -"/move".length);
    const b = await jsonBody(c);
    if (isMove) {
      const parent = b.parent ? safeRelPath(String(b.parent)) : null;
      assertContentPath(p);
      if (parent) assertApiPath(parent);
      requireLevel(access, db, p, "edit");
      requireLevel(access, db, parent ?? PAGES_DIR, "edit");
      const page = engine.movePage(
        { id: access.workspaceId, slug: access.slug },
        p,
        parent,
        actorLabel(c),
      );
      logActivity(access.workspaceId, page.path, c.get("user"), "page.moved", `from ${p}`);
      return c.json(page);
    }
    // POST to a page path itself has no meaning unless it is a move.
    throw badRequest(`POST /pages expects a path ending in /move`, "invalid_route");
  });

  // ---------- databases ----------
  app.get("/api/w/:ws/databases", (c) => {
    const access = c.get("access");
    const dbs = engine
      .listDatabases({ id: access.workspaceId, slug: access.slug })
      .filter((d) => levelAtLeast(effectiveLevel(db, access, `${DATA_DIR}/${d.slug}`), "view"));
    return c.json({ databases: dbs });
  });

  app.post("/api/w/:ws/databases", async (c) => {
    const access = c.get("access");
    requireLevel(access, db, DATA_DIR, "edit");
    const b = await jsonBody(c);
    const schema = engine.createDatabase(
      { id: access.workspaceId, slug: access.slug },
      b,
      actorLabel(c),
    );
    logActivity(access.workspaceId, `${DATA_DIR}/${schema.slug}`, c.get("user"), "database.created");
    return c.json(schema, 201);
  });

  app.get("/api/w/:ws/databases/:db", (c) => {
    const access = c.get("access");
    const dbSlug = c.req.param("db");
    requireLevel(access, db, `${DATA_DIR}/${dbSlug}`, "view");
    return c.json(engine.getDatabase({ id: access.workspaceId, slug: access.slug }, dbSlug));
  });

  app.patch("/api/w/:ws/databases/:db", async (c) => {
    const access = c.get("access");
    const dbSlug = c.req.param("db");
    requireLevel(access, db, `${DATA_DIR}/${dbSlug}`, "edit");
    const b = await jsonBody(c);
    return c.json(
      engine.patchDatabase({ id: access.workspaceId, slug: access.slug }, dbSlug, b, actorLabel(c)),
    );
  });

  app.delete("/api/w/:ws/databases/:db", (c) => {
    const access = c.get("access");
    const dbSlug = c.req.param("db");
    requireLevel(access, db, `${DATA_DIR}/${dbSlug}`, "edit");
    const res = engine.deleteDatabase({ id: access.workspaceId, slug: access.slug }, dbSlug, actorLabel(c));
    logActivity(access.workspaceId, `${DATA_DIR}/${dbSlug}`, c.get("user"), "database.deleted");
    return c.json(res);
  });

  // ---------- rows ----------
  app.get("/api/w/:ws/databases/:db/rows", (c) => {
    const access = c.get("access");
    const dbSlug = c.req.param("db");
    requireLevel(access, db, `${DATA_DIR}/${dbSlug}`, "view");
    const res = engine.listRows({ id: access.workspaceId, slug: access.slug }, dbSlug, {
      view: c.req.query("view") || undefined,
      filter: c.req.query("filter") || undefined,
      sort: c.req.query("sort") || undefined,
      q: c.req.query("q") || undefined,
      limit: c.req.query("limit") ? Number(c.req.query("limit")) : undefined,
      cursor: c.req.query("cursor") ? Number(c.req.query("cursor")) : undefined,
      archived: c.req.query("archived") === "1",
    });
    const rows = res.rows.filter((r) => levelAtLeast(effectiveLevel(db, access, r.path), "view"));
    return c.json({ rows, nextCursor: res.nextCursor, view: res.view, schema: res.schema });
  });

  app.post("/api/w/:ws/databases/:db/rows", async (c) => {
    const access = c.get("access");
    const dbSlug = c.req.param("db");
    requireLevel(access, db, `${DATA_DIR}/${dbSlug}`, "edit");
    const b = await jsonBody(c);
    const row = engine.createRow(
      { id: access.workspaceId, slug: access.slug },
      dbSlug,
      { properties: (b.properties ?? {}) as Record<string, unknown>, body: b.body !== undefined ? String(b.body) : undefined },
      actorLabel(c),
    );
    logActivity(access.workspaceId, row.path, c.get("user"), "row.created", String(row.properties.title ?? ""));
    return c.json(row, 201);
  });

  app.get("/api/w/:ws/databases/:db/rows/:id", (c) => {
    const access = c.get("access");
    const dbSlug = c.req.param("db");
    const row = engine.getRow({ id: access.workspaceId, slug: access.slug }, dbSlug, c.req.param("id"));
    requireLevel(access, db, row.path, "view");
    return c.json(row);
  });

  app.patch("/api/w/:ws/databases/:db/rows/:id", async (c) => {
    const access = c.get("access");
    const dbSlug = c.req.param("db");
    const id = c.req.param("id");
    const existing = engine.getRow({ id: access.workspaceId, slug: access.slug }, dbSlug, id);
    requireLevel(access, db, existing.path, "edit");
    const b = await jsonBody(c);
    const row = engine.updateRow(
      { id: access.workspaceId, slug: access.slug },
      dbSlug,
      id,
      { properties: b.properties, body: b.body !== undefined ? String(b.body) : undefined },
      ifMatchHash(c),
      actorLabel(c),
    );
    logActivity(access.workspaceId, row.path, c.get("user"), "row.updated");
    return c.json(row);
  });

  app.delete("/api/w/:ws/databases/:db/rows/:id", (c) => {
    const access = c.get("access");
    const dbSlug = c.req.param("db");
    const id = c.req.param("id");
    const existing = engine.getRow({ id: access.workspaceId, slug: access.slug }, dbSlug, id);
    requireLevel(access, db, existing.path, "edit");
    const res = engine.deleteRow({ id: access.workspaceId, slug: access.slug }, dbSlug, id, actorLabel(c));
    logActivity(access.workspaceId, existing.path, c.get("user"), "row.deleted");
    return c.json(res);
  });

  app.post("/api/w/:ws/databases/:db/rows/:id/move", async (c) => {
    const access = c.get("access");
    const dbSlug = c.req.param("db");
    const id = c.req.param("id");
    const existing = engine.getRow({ id: access.workspaceId, slug: access.slug }, dbSlug, id);
    requireLevel(access, db, existing.path, "edit");
    const b = await jsonBody(c);
    const row = engine.moveRow(
      { id: access.workspaceId, slug: access.slug },
      dbSlug,
      id,
      { status: b.status, beforeId: b.beforeId ?? null, afterId: b.afterId ?? null },
      actorLabel(c),
    );
    logActivity(access.workspaceId, row.path, c.get("user"), "row.moved", `status=${b.status}`);
    return c.json(row);
  });

  // =====================================================================
  // Search / backlinks
  // =====================================================================
  app.get("/api/w/:ws/search", (c) => {
    const access = c.get("access");
    const q = c.req.query("q") ?? "";
    if (!q.trim()) return c.json({ results: [] });
    const type = c.req.query("type") || null;
    const limit = Math.min(Number(c.req.query("limit") ?? 50), 200);
    const rows = db
      .prepare(
        `SELECT f.path, f.title, f.kind, f.db_slug, snippet(search, 3, '', '', '…', 12) AS snip
         FROM search JOIN files f ON f.workspace_id = search.ws AND f.path = search.path
         WHERE search MATCH ? AND search.ws = ?
         ORDER BY search.rank LIMIT ?`,
      )
      .all(ftsQuery(q), access.workspaceId, limit * 2) as any[];
    const results = rows
      .filter((r) => {
        if (!levelAtLeast(effectiveLevel(db, access, r.path), "view")) return false;
        if (type === "page") return r.kind === "page";
        if (type === "record") return r.kind === "record";
        if (type && r.db_slug) return r.db_slug === type;
        return true;
      })
      .slice(0, limit);
    return c.json({ results });
  });

  app.get("/api/w/:ws/backlinks", (c) => {
    const access = c.get("access");
    const p = safeRelPath(String(c.req.query("path") ?? ""));
    requireLevel(access, db, p, "view");
    const links = (
      db
        .prepare(
          `SELECT l.src, l.target FROM links l WHERE l.workspace_id = ? AND l.resolved = ?
           ORDER BY l.src`,
        )
        .all(access.workspaceId, p) as any[]
    )
      .filter((l) => levelAtLeast(effectiveLevel(db, access, l.src), "view"))
      .map((l) => ({ source: l.src, target: l.target }));
    return c.json({ path: p, backlinks: links.map((l) => l.source) });
  });

  // =====================================================================
  // Comments / attachments / activity
  // =====================================================================
  app.get("/api/w/:ws/comments", (c) => {
    const access = c.get("access");
    const p = safeRelPath(String(c.req.query("path") ?? ""));
    requireLevel(access, db, p, "comment");
    const comments = (
      db
        .prepare(
          `SELECT cm.id, cm.path, cm.body, cm.created_at, u.id AS user_id, u.name AS user_name
           FROM comments cm LEFT JOIN users u ON u.id = cm.user_id
           WHERE cm.workspace_id = ? AND cm.path = ? ORDER BY cm.created_at`,
        )
        .all(access.workspaceId, p) as any[]
    ).map((cm) => ({
      id: cm.id,
      path: cm.path,
      body: cm.body,
      createdAt: cm.created_at,
      author: { id: cm.user_id, name: cm.user_name },
    }));
    return c.json({ comments });
  });

  app.post("/api/w/:ws/comments", async (c) => {
    const access = c.get("access");
    const b = await jsonBody(c);
    const p = safeRelPath(String(b.path ?? ""));
    requireLevel(access, db, p, "comment");
    const body = String(b.body ?? "").trim();
    if (!body) throw badRequest("Comment body is required", "missing_body");
    const id = shortId("cmt");
    db.prepare(
      `INSERT INTO comments (id, workspace_id, path, user_id, body, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(id, access.workspaceId, p, access.userId, body, now());
    bus.publish(access.slug, { type: "comment", path: p, actor: actorLabel(c) });
    return c.json({ id, path: p, body, createdAt: now() }, 201);
  });

  app.delete("/api/w/:ws/comments/:id", (c) => {
    const access = c.get("access");
    const comment = db
      .prepare(`SELECT * FROM comments WHERE id = ? AND workspace_id = ?`)
      .get(c.req.param("id"), access.workspaceId) as any;
    if (!comment) throw notFound("No such comment");
    const isAuthor = comment.user_id === access.userId;
    if (!isAuthor && access.role !== "owner" && access.role !== "admin" && !access.isInstanceAdmin) {
      throw forbidden("Only the author or a workspace admin can delete this comment");
    }
    db.prepare(`DELETE FROM comments WHERE id = ?`).run(comment.id);
    return c.json({ ok: true });
  });

  app.post("/api/w/:ws/attachments", async (c) => {
    const access = c.get("access");
    requireLevel(access, db, ATTACHMENTS_DIR, "edit");
    const body = await c.req.parseBody();
    const file = body["file"];
    if (!(file instanceof File)) {
      throw badRequest("Send multipart/form-data with a 'file' part", "missing_file");
    }
    const safeName = file.name.replace(/[^\w.\-() ]+/g, "_").slice(0, 120) || "file";
    const id = `${shortId("att", 5).slice(4)}-${safeName}`;
    const relPath = `${ATTACHMENTS_DIR}/${id}`;
    const buf = Buffer.from(await file.arrayBuffer());
    writeFileSync(absPath(engine.vaultDir(access.slug), relPath), buf);
    engine.afterWrite(access.slug, [relPath], actorLabel(c));
    logActivity(access.workspaceId, relPath, c.get("user"), "attachment.uploaded", `${buf.length} bytes`);
    return c.json({ id, path: relPath, size: buf.length }, 201);
  });

  app.get("/api/w/:ws/attachments/:id", (c) => {
    const access = c.get("access");
    requireLevel(access, db, ATTACHMENTS_DIR, "view");
    const id = c.req.param("id");
    if (!/^[\w.\-() ]{1,160}$/.test(id) || id.startsWith(".")) throw badRequest("Invalid attachment id", "invalid_path");
    const relPath = `${ATTACHMENTS_DIR}/${id}`;
    requireLevel(access, db, relPath, "view");
    const buf = readFileIfExists(engine.vaultDir(access.slug), relPath);
    if (!buf) throw notFound(`No attachment '${id}'`);
    return c.body(new Uint8Array(buf), 200, {
      // Uploaded files are untrusted: never let a browser run them as part of this origin.
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox",
      "content-type": contentTypeFor(relPath),
      "content-disposition": `inline; filename="${id.split("-").slice(1).join("-")}"`,
    });
  });

  app.get("/api/w/:ws/activity", (c) => {
    const access = c.get("access");
    const p = c.req.query("path");
    const limit = Math.min(Number(c.req.query("limit") ?? 100), 500);
    let sql = `SELECT a.path, a.action, a.detail, a.created_at, a.user_name, a.user_id
               FROM activity a WHERE a.workspace_id = ?`;
    const args: any[] = [access.workspaceId];
    if (p) {
      const safe = safeRelPath(p);
      sql += ` AND (a.path = ? OR a.path LIKE ? ESCAPE '\\')`;
      args.push(safe, `${safe.replace(/[\\%_]/g, (ch) => `\\${ch}`)}/%`);
    }
    sql += ` ORDER BY a.created_at DESC LIMIT ?`;
    args.push(limit);
    const activity = (db.prepare(sql).all(...args) as any[])
      .filter((a) => !a.path || levelAtLeast(effectiveLevel(db, access, a.path), "view"))
      .map((a) => ({
        path: a.path,
        action: a.action,
        detail: a.detail,
        at: a.created_at,
        user: { id: a.user_id, name: a.user_name },
      }));
    return c.json({ activity });
  });

  // =====================================================================
  // Vault mode: raw files, graph, tags, links
  // =====================================================================
  app.get("/api/w/:ws/vault/tree", (c) => {
    const access = c.get("access");
    const tree = engine.vaultTree({ id: access.workspaceId, slug: access.slug });
    const filterTree = (nodes: any[]): any[] =>
      nodes
        .map((n) => {
          if (n.type === "folder") {
            const children = filterTree(n.children);
            return children.length ? { ...n, children } : null;
          }
          return levelAtLeast(effectiveLevel(db, access, n.path), "view") ? n : null;
        })
        .filter((n) => n !== null);
    return c.json({ tree: filterTree(tree) });
  });

  app.get("/api/w/:ws/vault/file/*", (c) => {
    const access = c.get("access");
    const p = wildcard(c, `/api/w/${access.slug}/vault/file`);
    assertApiPath(p);
    requireLevel(access, db, p, "view");
    const file = engine.readVaultFile({ id: access.workspaceId, slug: access.slug }, p);
    if (!file) throw notFound(`No file at ${p}`);
    return c.json(file);
  });

  app.put("/api/w/:ws/vault/file/*", async (c) => {
    const access = c.get("access");
    const p = wildcard(c, `/api/w/${access.slug}/vault/file`);
    assertApiPath(p, true);
    requireLevel(access, db, p, "edit");
    const text = await c.req.text();
    const res = engine.writeVaultFile(
      { id: access.workspaceId, slug: access.slug },
      p,
      text,
      ifMatchHash(c),
      actorLabel(c),
    );
    logActivity(access.workspaceId, p, c.get("user"), "vault.file.saved");
    return c.json(res);
  });

  app.delete("/api/w/:ws/vault/file/*", (c) => {
    const access = c.get("access");
    const p = wildcard(c, `/api/w/${access.slug}/vault/file`);
    assertApiPath(p, true);
    requireLevel(access, db, p, "edit");
    const res = engine.deleteVaultFile({ id: access.workspaceId, slug: access.slug }, p, actorLabel(c));
    logActivity(access.workspaceId, p, c.get("user"), "vault.file.deleted", `trashed to ${res.trashedTo}`);
    return c.json(res);
  });

  app.post("/api/w/:ws/vault/move", async (c) => {
    const access = c.get("access");
    const b = await jsonBody(c);
    const from = safeRelPath(String(b.from ?? ""));
    const to = safeRelPath(String(b.to ?? ""));
    assertApiPath(from, true);
    assertApiPath(to, true);
    requireLevel(access, db, from, "edit");
    requireLevel(access, db, to, "edit");
    return c.json(engine.moveVaultEntry({ id: access.workspaceId, slug: access.slug }, from, to, actorLabel(c)));
  });

  app.get("/api/w/:ws/graph", (c) => {
    const access = c.get("access");
    const scope = c.req.query("scope") === "local" ? "local" : "global";
    const focus = c.req.query("path") || null;
    const depth = Math.min(Math.max(Number(c.req.query("depth") ?? 2), 1), 6);
    const allFiles = db
      .prepare(`SELECT path, title, kind, tags_json FROM files WHERE workspace_id = ? AND archived = 0`)
      .all(access.workspaceId) as any[];
    const visible = allFiles
      .filter((f) => levelAtLeast(effectiveLevel(db, access, f.path), "view"))
      .map((f) => ({
        id: f.path,
        path: f.path,
        title: f.title,
        type: f.kind,
        tags: JSON.parse(f.tags_json || "[]"),
      }));
    const visibleSet = new Set(visible.map((v) => v.id));
    const edgesRaw = db
      .prepare(`SELECT src, target, resolved FROM links WHERE workspace_id = ? AND resolved IS NOT NULL`)
      .all(access.workspaceId) as any[];
    let edges = edgesRaw
      .filter((e) => visibleSet.has(e.src) && visibleSet.has(e.resolved))
      .map((e) => ({ source: e.src, target: e.resolved }));

    let nodes = visible;
    if (scope === "local") {
      if (!focus) throw badRequest("scope=local requires path", "missing_path");
      const adj = new Map<string, Set<string>>();
      for (const e of edges) {
        if (!adj.has(e.source)) adj.set(e.source, new Set());
        adj.get(e.source)!.add(e.target);
        if (!adj.has(e.target)) adj.set(e.target, new Set());
        adj.get(e.target)!.add(e.source);
      }
      const keep = new Set<string>([focus]);
      let frontier = new Set<string>([focus]);
      for (let d = 0; d < depth; d++) {
        const next = new Set<string>();
        for (const n of frontier) {
          for (const m of adj.get(n) ?? []) {
            if (!keep.has(m)) {
              keep.add(m);
              next.add(m);
            }
          }
        }
        frontier = next;
      }
      nodes = nodes.filter((n) => keep.has(n.id));
      edges = edges.filter((e) => keep.has(e.source) && keep.has(e.target));
    }
    return c.json({ nodes, edges });
  });

  app.get("/api/w/:ws/tags", (c) => {
    const access = c.get("access");
    const rows = db
      .prepare(`SELECT tag, path FROM tags WHERE workspace_id = ?`)
      .all(access.workspaceId) as any[];
    const byTag = new Map<string, string[]>();
    for (const r of rows) {
      if (!levelAtLeast(effectiveLevel(db, access, r.path), "view")) continue;
      const list = byTag.get(r.tag) ?? [];
      list.push(r.path);
      byTag.set(r.tag, list);
    }
    return c.json({
      tags: [...byTag.entries()]
        .map(([tag, paths]) => ({ tag, count: paths.length, paths }))
        .sort((a, b) => b.count - a.count || (a.tag < b.tag ? -1 : 1)),
    });
  });

  app.get("/api/w/:ws/links", (c) => {
    const access = c.get("access");
    const p = safeRelPath(String(c.req.query("path") ?? ""));
    requireLevel(access, db, p, "view");
    const outgoing = (
      db.prepare(`SELECT target, resolved FROM links WHERE workspace_id = ? AND src = ?`).all(access.workspaceId, p) as any[]
    ).map((l) => ({ target: l.target, resolved: l.resolved }));
    const backlinks = (
      db
        .prepare(`SELECT src FROM links WHERE workspace_id = ? AND resolved = ? ORDER BY src`)
        .all(access.workspaceId, p) as any[]
    )
      .map((l) => l.src)
      .filter((src) => levelAtLeast(effectiveLevel(db, access, src), "view"));
    const unresolved = outgoing.filter((o) => !o.resolved).map((o) => o.target);
    return c.json({ path: p, outgoing, backlinks, unresolved });
  });

  // =====================================================================
  // Retex
  // =====================================================================
  app.get("/api/w/:ws/retex/schema", (c) => {
    const access = c.get("access");
    return c.json(engine.retexSchema({ id: access.workspaceId, slug: access.slug }));
  });

  // =====================================================================
  // Export / import
  // =====================================================================
  app.get("/api/w/:ws/export.zip", (c) => {
    const access = c.get("access");
    requireWsAdmin2(access);
    const vaultDir = engine.vaultDir(access.slug);
    const entries = listAllFiles(vaultDir, { includeSystem: true })
      .filter((f) => !f.startsWith(".git/"))
      .map((f) => ({
        path: f,
        data: readFileIfExists(vaultDir, f) as Buffer,
      }))
      .filter((e) => e.data !== null);
    const zip = createZip(entries);
    logActivity(access.workspaceId, null, c.get("user"), "workspace.exported", `${entries.length} files`);
    return c.body(new Uint8Array(zip), 200, {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="${access.slug}.zip"`,
    });
  });

  app.post("/api/w/:ws/import", async (c) => {
    const access = c.get("access");
    requireWsAdmin2(access);
    const body = await c.req.parseBody();
    const file = body["file"];
    if (!(file instanceof File)) throw badRequest("Send multipart/form-data with a 'file' part", "missing_file");
    let entries;
    try {
      entries = readZip(Buffer.from(await file.arrayBuffer()));
    } catch (err) {
      throw badRequest(`Could not read zip: ${(err as Error).message}`, "invalid_zip");
    }
    const vaultDir = engine.vaultDir(access.slug);
    const written: string[] = [];
    const skipped: string[] = [];
    for (const e of entries) {
      if (e.path.endsWith("/")) continue;
      let clean: string;
      try {
        clean = safeRelPath(e.path);
        assertApiPath(clean, true);
        if (clean === `${CONCEPT_DIR}/workspace.json`) throw new Error("reserved");
      } catch {
        skipped.push(e.path);
        continue;
      }
      const abs = absPath(vaultDir, clean);
      mkdirSync(path.dirname(abs), { recursive: true });
      writeFileSync(abs, e.data);
      written.push(clean);
    }
    const re = indexer.reindexWorkspace(access.workspaceId, vaultDir);
    bus.publish(access.slug, { type: "change", paths: ["*"], actor: actorLabel(c) });
    logActivity(access.workspaceId, null, c.get("user"), "workspace.imported", `${written.length} files`);
    return c.json({ imported: written.length, skipped: skipped.length, indexed: re.indexed }, 200);
  });

  function requireWsAdmin2(access: WorkspaceAccess) {
    if (access.role !== "owner" && access.role !== "admin" && !access.isInstanceAdmin) {
      throw forbidden("Workspace admin role required");
    }
  }

  // =====================================================================
  // SSE events
  // =====================================================================
  app.get("/api/w/:ws/events", (c) => {
    const first = c.get("access");
    const user = c.get("user");
    const wsRow = getWs(first.slug);
    return streamSSE(c, async (stream) => {
      let open = true;
      const names = (actor: string) => actor.replace(/\s*<[^>]*>\s*$/, "");
      // Re-evaluated per event, so a removed member or a new ACL rule takes effect immediately.
      const unsubscribe = bus.subscribe(first.slug, (event) => {
        if (!open) return;
        const access = getAccess(db, wsRow, user);
        if (!access) {
          open = false;
          return;
        }
        const canSee = (p: string) => p === "*" || levelAtLeast(effectiveLevel(db, access, p), "view");
        let out: unknown;
        if (event.type === "change") {
          const paths = event.paths.filter(canSee);
          if (paths.length === 0) return;
          out = { type: "change", paths, actor: names(event.actor) };
        } else if (event.type === "comment") {
          if (!canSee(event.path)) return;
          out = { type: "comment", path: event.path, actor: names(event.actor) };
        } else {
          const admin = access.role === "owner" || access.role === "admin" || access.isInstanceAdmin;
          out = admin ? event : { type: "sync", status: event.status };
        }
        void stream.writeSSE({ event: event.type, data: JSON.stringify(out) });
      });
      const heartbeat = setInterval(() => {
        if (!open) return;
        if (!getAccess(db, wsRow, user)) {
          open = false;
          return;
        }
        void stream.writeSSE({ event: "ping", data: String(Date.now()) });
      }, 25_000);
      void stream.writeSSE({ event: "hello", data: JSON.stringify({ workspace: first.slug }) });
      stream.onAbort(() => {
        open = false;
      });
      while (open) {
        await stream.sleep(1000);
      }
      clearInterval(heartbeat);
      unsubscribe();
    });
  });

  // =====================================================================
  // Sync
  // =====================================================================
  app.get("/api/w/:ws/sync", (c) => {
    const access = c.get("access");
    return c.json(sync.getSettings(access.workspaceId));
  });

  app.put("/api/w/:ws/sync", async (c) => {
    const access = c.get("access");
    requireWsAdmin2(access);
    const b = await jsonBody(c);
    const settings = sync.putSettings(access.workspaceId, {
      remoteUrl: b.remoteUrl !== undefined ? (b.remoteUrl ? String(b.remoteUrl) : null) : undefined,
      branch: b.branch !== undefined ? String(b.branch || "main") : undefined,
      token: b.token !== undefined ? (b.token ? String(b.token) : null) : undefined,
      enabled: b.enabled !== undefined ? !!b.enabled : undefined,
    });
    if (settings.enabled) {
      deps.watcher.watchWorkspace(access.workspaceId, access.slug, engine.vaultDir(access.slug));
    }
    return c.json(settings);
  });

  app.post("/api/w/:ws/sync/run", async (c) => {
    const access = c.get("access");
    requireWsAdmin2(access);
    const status = await sync.run(access.slug, actorLabel(c));
    return c.json(status);
  });

  app.get("/api/w/:ws/sync/status", (c) => {
    const access = c.get("access");
    return c.json(sync.getStatus(access.slug));
  });

  return app;
}

function ApiError2(status: number, code: string, message: string): ApiError {
  return new ApiError(status, code, message);
}

function actorLabel(c: { get(key: "user"): UserRow }): string {
  const user = c.get("user");
  return `${user.name} <${user.email}>`;
}

function contentTypeFor(p: string): string {
  const ext = p.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    svg: "image/svg+xml",
    pdf: "application/pdf",
    txt: "text/plain; charset=utf-8",
    md: "text/markdown; charset=utf-8",
    json: "application/json",
    csv: "text/csv",
    mp4: "video/mp4",
    webm: "video/webm",
    mp3: "audio/mpeg",
  };
  return map[ext] ?? "application/octet-stream";
}

