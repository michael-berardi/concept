import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { Context, MiddlewareHandler } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { DB } from "../db.js";
import { now, shortId } from "../ids.js";
import { forbidden, unauthorized, ApiError } from "../errors.js";

export const SESSION_COOKIE = "concept_session";
const SESSION_TTL_MS = 30 * 24 * 3600 * 1000;

export interface UserRow {
  id: string;
  email: string;
  name: string;
  is_admin: number;
}

export interface WorkspaceAccess {
  workspaceId: string;
  slug: string;
  name: string;
  userId: string;
  role: "owner" | "admin" | "member" | "guest";
  teamIds: string[];
  isInstanceAdmin: boolean;
  _permCache: Map<string, AclLevel>;
}

export type AclLevel = "none" | "view" | "comment" | "edit" | "admin";
const LEVEL_ORDER: Record<AclLevel, number> = { none: 0, view: 1, comment: 2, edit: 3, admin: 4 };

export function levelAtLeast(level: AclLevel, needed: AclLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[needed];
}

export function maxLevel(a: AclLevel, b: AclLevel): AclLevel {
  return LEVEL_ORDER[a] >= LEVEL_ORDER[b] ? a : b;
}

// ---------- passwords ----------

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `s1$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "s1") return false;
  const salt = Buffer.from(parts[1], "base64");
  const expected = Buffer.from(parts[2], "base64");
  const actual = scryptSync(password, salt, expected.length, { N: 16384, r: 8, p: 1 });
  return timingSafeEqual(actual, expected);
}

// ---------- sessions & tokens ----------

/** Only a hash of the session id is stored, so a leaked database cannot be replayed as cookies. */
export function sessionKey(sid: string): string {
  return createHash("sha256").update(sid).digest("hex");
}

export function createSession(db: DB, userId: string): string {
  const sid = randomBytes(32).toString("base64url");
  db.prepare(`INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)`).run(
    sessionKey(sid),
    userId,
    now() + SESSION_TTL_MS,
    now(),
  );
  db.prepare(`DELETE FROM sessions WHERE expires_at < ?`).run(now());
  return sid;
}

export function setSessionCookie(c: Context, sid: string): void {
  setCookie(c, SESSION_COOKIE, sid, {
    httpOnly: true,
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
}

export function clearSessionCookie(c: Context): void {
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
}

export function userForSession(db: DB, sid: string): UserRow | null {
  const row = db
    .prepare(
      `SELECT u.id, u.email, u.name, u.is_admin FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.id = ? AND s.expires_at > ?`,
    )
    .get(sessionKey(sid), now()) as UserRow | undefined;
  return row ?? null;
}

export function hashApiToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function createApiToken(db: DB, userId: string, name: string): { id: string; token: string } {
  const token = `cpt_${randomBytes(24).toString("base64url")}`;
  const id = shortId("tok", 6);
  db.prepare(
    `INSERT INTO api_tokens (id, user_id, name, token_hash, created_at) VALUES (?, ?, ?, ?, ?)`,
  ).run(id, userId, name, hashApiToken(token), now());
  return { id, token };
}

export function userForBearer(db: DB, bearer: string): UserRow | null {
  const token = bearer.startsWith("Bearer ") ? bearer.slice(7).trim() : "";
  if (!token.startsWith("cpt_")) return null;
  const row = db
    .prepare(
      `SELECT u.id, u.email, u.name, u.is_admin FROM api_tokens t JOIN users u ON u.id = t.user_id
       WHERE t.token_hash = ?`,
    )
    .get(hashApiToken(token)) as UserRow | undefined;
  if (row) {
    db.prepare(`UPDATE api_tokens SET last_used_at = ? WHERE token_hash = ?`).run(now(), hashApiToken(token));
  }
  return row ?? null;
}

// ---------- middleware ----------

export function requireAuth(db: DB): MiddlewareHandler {
  return async (c, next) => {
    let user: UserRow | null = null;
    const sid = getCookie(c, SESSION_COOKIE);
    if (sid) user = userForSession(db, sid);
    if (!user) {
      const authz = c.req.header("authorization");
      if (authz) user = userForBearer(db, authz);
    }
    if (!user) {
      throw unauthorized("Sign in with a session cookie or an API token (cpt_…)");
    }
    c.set("user", user);
    await next();
  };
}

export function getAccess(db: DB, ws: { id: string; slug: string; name: string }, user: UserRow): WorkspaceAccess | null {
  const m = db
    .prepare(`SELECT role FROM members WHERE workspace_id = ? AND user_id = ?`)
    .get(ws.id, user.id) as { role: string } | undefined;
  if (!m && !user.is_admin) return null;
  const teamIds = (
    db
      .prepare(
        `SELECT tm.team_id FROM teams t JOIN team_members tm ON tm.team_id = t.id
         WHERE t.workspace_id = ? AND tm.user_id = ?`,
      )
      .all(ws.id, user.id) as any[]
  ).map((r) => r.team_id);
  let role = (m?.role ?? "member") as WorkspaceAccess["role"];
  if (user.is_admin && !m) role = "owner";
  return {
    workspaceId: ws.id,
    slug: ws.slug,
    name: ws.name,
    userId: user.id,
    role,
    teamIds,
    isInstanceAdmin: !!user.is_admin,
    _permCache: new Map(),
  };
}

/** Load the workspace by slug (or throw 404) and resolve the caller's access. */
export function workspaceAccess(c: Context, db: DB, slug: string): WorkspaceAccess {
  const user = c.get("user") as UserRow;
  const ws = db.prepare(`SELECT id, slug, name FROM workspaces WHERE slug = ?`).get(slug) as
    | { id: string; slug: string; name: string }
    | undefined;
  if (!ws) throw new ApiError(404, "not_found", `No workspace '${slug}'`);
  const access = getAccess(db, ws, user);
  if (!access) throw forbidden(`You are not a member of workspace '${slug}'`);
  return access;
}

// ---------- ACL resolution ----------

interface AclRule {
  path: string;
  subject_type: "user" | "team" | "workspace";
  subject_id: string | null;
  level: AclLevel;
}

const SUBJECT_PRIORITY: Record<string, number> = { user: 0, team: 1, workspace: 2 };

/**
 * Effective permission for a vault path. Most specific (longest) matching
 * prefix wins; within the same prefix user > team > workspace. With no
 * matching rule the workspace default applies (members edit, guests none).
 */
export function effectiveLevel(db: DB, access: WorkspaceAccess, rawPath: string): AclLevel {
  // `Page.conflict-123.md` is a copy of `Page.md`: it carries the same permissions.
  const path = rawPath.replace(/\.conflict-\d+(?=\.[^./]+$)/, "");
  const cached = access._permCache.get(path);
  if (cached) return cached;

  let level: AclLevel;
  const defaultLevel: AclLevel =
    access.role === "owner" || access.role === "admin"
      ? "admin"
      : access.role === "member"
        ? "edit"
        : "none";

  const rules = db
    .prepare(`SELECT path, subject_type, subject_id, level FROM acls WHERE workspace_id = ?`)
    .all(access.workspaceId) as unknown as AclRule[];
  const matching = rules.filter((r) => prefixMatches(r.path, path));
  matching.sort((a, b) => {
    const depth = b.path.split("/").length - a.path.split("/").length;
    if (depth !== 0) return depth;
    return (
      (SUBJECT_PRIORITY[a.subject_type] ?? 3) - (SUBJECT_PRIORITY[b.subject_type] ?? 3)
    );
  });
  const winner = matching.find(
    (r) =>
      (r.subject_type === "user" && r.subject_id === access.userId) ||
      (r.subject_type === "team" && access.teamIds.includes(r.subject_id as string)) ||
      (r.subject_type === "workspace" && r.subject_id === null),
  );
  level = winner ? winner.level : defaultLevel;
  if (access.role === "owner" || access.isInstanceAdmin) level = "admin";
  access._permCache.set(path, level);
  return level;
}

export function prefixMatches(rulePath: string, path: string): boolean {
  if (rulePath === "" || rulePath === "/") return true;
  // A rule on a page prefix ("Pages/Public") covers the page file itself
  // ("Pages/Public.md") and everything nested below it ("Pages/Public/Notes.md").
  const rule = rulePath.replace(/\.md$/i, "");
  const candidates = [path, path.replace(/\.md$/i, "")];
  return candidates.some((c) => c === rule || c.startsWith(`${rule}/`));
}

export function requireLevel(
  access: WorkspaceAccess,
  db: DB,
  path: string,
  needed: AclLevel,
): AclLevel {
  const level = effectiveLevel(db, access, path);
  if (!levelAtLeast(level, needed)) {
    throw forbidden(
      `Permission '${needed}' required for ${path || "this workspace"}; you have '${level}'`,
    );
  }
  return level;
}
