import { request } from "./request";
import type { Api, RowMove } from "./apiTypes";
import type {
  AclEntry, ActivityEntry, Comment, Database, DbRow, GraphResult, Health, Invite,
  LinksResult, Member, PageRecord, SearchResult, SyncConfig, SyncStatus, TagsResult,
  Team, Token, TreeNode, User, VaultFile, VaultFileRecord, Workspace,
} from "./types";

const enc = encodeURIComponent;
const iso = (v: unknown): string | undefined =>
  typeof v === "number" ? new Date(v).toISOString() : typeof v === "string" ? v : undefined;
const stem = (p: string) => p.split("/").pop()!.replace(/\.md$/, "");
const encPath = (p: string) => p.split("/").map(enc).join("/");

/** Server tree -> web tree: merge `Foo/` + `Foo.md`, append databases. */
function normalizeTree(raw: { pages?: any[]; databases?: any[] }): TreeNode[] {
  const walk = (nodes: any[]): TreeNode[] => {
    const byName = new Map<string, TreeNode>();
    const order: TreeNode[] = [];
    for (const n of nodes) {
      const isFile = /\.md$/.test(n.path);
      const key = n.name;
      const kids = walk(n.children ?? []);
      const existing = byName.get(key);
      if (existing) {
        if (isFile) {
          existing.path = n.path;
          existing.type = "page";
        }
        existing.children = [...(existing.children ?? []), ...kids];
        continue;
      }
      const node: TreeNode = { path: n.path, title: n.name, type: isFile ? "page" : "folder", icon: n.icon ?? undefined, children: kids };
      byName.set(key, node);
      order.push(node);
    }
    return order;
  };
  const dbs: TreeNode[] = (raw.databases ?? []).map((d) => ({ path: `db:${d.slug}`, title: d.name, type: "database" as const, icon: d.icon, children: [] }));
  return [...dbs, ...walk(raw.pages ?? [])];
}
function normalizePage(p: any): PageRecord {
  return { ...p, updatedAt: iso(p.updatedAt), properties: p.properties ?? {}, backlinks: (p.backlinks ?? []).map((b: any) => (typeof b === "string" ? { path: b, title: stem(b) } : b)) };
}
function normalizeRow(r: any): DbRow {
  return { ...r, updatedAt: iso(r.updatedAt), tags: Array.isArray(r.properties?.tags) ? r.properties.tags : [] };
}
function normalizeDb(d: any): Database {
  return {
    ...d,
    properties: (d.properties ?? []).map((p: any) => ({ ...p, options: p.options ? p.options.map((o: any) => ({ ...o, name: o.name ?? o.id })) : p.options })),
  };
}
function toVault(n: any): VaultFile {
  return { path: n.path, title: n.name, type: n.type === "folder" ? "dir" : "file", size: n.size, children: (n.children ?? []).map(toVault) };
}

/** Real HTTP transport against the Concept server (docs/SPEC.md). */
export class RealApi implements Api {
  constructor(private base = "") {}

  health() {
    return request<Health>("GET", "/api/health", {}, this.base);
  }
  register(input: Parameters<Api["register"]>[0]) {
    return request<{ user: User }>("POST", "/api/auth/register", { json: input }, this.base);
  }
  login(input: Parameters<Api["login"]>[0]) {
    return request<{ user: User }>("POST", "/api/auth/login", { json: input }, this.base);
  }
  logout() {
    return request("POST", "/api/auth/logout", {}, this.base).then(() => undefined);
  }
  async me() {
    try {
      const r = await request<{ user: User; workspaces?: Workspace[] }>("GET", "/api/me", {}, this.base);
      return r.user;
    } catch {
      return null;
    }
  }
  async tokens() {
    const r = await request<{ tokens: any[] }>("GET", "/api/me/tokens", {}, this.base);
    return r.tokens.map((t) => ({ ...t, prefix: t.prefix ?? "cpt_…" })) as Token[];
  }
  async createToken(name: string) {
    const r = await request<any>("POST", "/api/me/tokens", { json: { name } }, this.base);
    return { id: r.id, name: r.name, prefix: String(r.token ?? "").slice(0, 8), createdAt: new Date().toISOString(), secret: r.token } as Token;
  }
  deleteToken(id: string) {
    return request("DELETE", `/api/me/tokens/${enc(id)}`, {}, this.base).then(() => undefined);
  }

  async workspaces() {
    const r = await request<{ workspaces: Workspace[] }>("GET", "/api/workspaces", {}, this.base);
    return r.workspaces;
  }
  createWorkspace(input: Parameters<Api["createWorkspace"]>[0]) {
    return request<Workspace>("POST", "/api/workspaces", { json: input }, this.base);
  }
  updateWorkspace(ws: string, patch: Parameters<Api["updateWorkspace"]>[1]) {
    return request<Workspace>("PATCH", `/api/w/${enc(ws)}`, { json: patch }, this.base);
  }
  deleteWorkspace(ws: string) {
    return request("DELETE", `/api/w/${enc(ws)}`, {}, this.base).then(() => undefined);
  }

  async members(ws: string) {
    const r = await request<{ members: any[] }>("GET", `/api/w/${enc(ws)}/members`, {}, this.base);
    return r.members.map((m) => ({ userId: m.id, email: m.email, name: m.name, role: m.role })) as Member[];
  }
  setMemberRole(ws: string, userId: string, role: Parameters<Api["setMemberRole"]>[2]) {
    return request("PATCH", `/api/w/${enc(ws)}/members/${enc(userId)}`, { json: { role } }, this.base).then(() => undefined);
  }
  removeMember(ws: string, userId: string) {
    return request("DELETE", `/api/w/${enc(ws)}/members/${enc(userId)}`, {}, this.base).then(() => undefined);
  }
  async invites(ws: string) {
    const r = await request<{ invites: Invite[] }>("GET", `/api/w/${enc(ws)}/invites`, {}, this.base);
    return r.invites;
  }
  createInvite(ws: string, input: Parameters<Api["createInvite"]>[1]) {
    return request<Invite>("POST", `/api/w/${enc(ws)}/invites`, { json: input }, this.base);
  }
  deleteInvite(ws: string, id: string) {
    return request("DELETE", `/api/w/${enc(ws)}/invites/${enc(id)}`, {}, this.base).then(() => undefined);
  }
  acceptInvite(token: string) {
    return request<{ workspace: Workspace }>("POST", `/api/invites/${enc(token)}/accept`, { json: {} }, this.base);
  }
  async teams(ws: string) {
    const r = await request<{ teams: Team[] }>("GET", `/api/w/${enc(ws)}/teams`, {}, this.base);
    return r.teams;
  }
  createTeam(ws: string, name: string) {
    return request<Team>("POST", `/api/w/${enc(ws)}/teams`, { json: { name } }, this.base);
  }
  renameTeam(ws: string, id: string, name: string) {
    return request("PATCH", `/api/w/${enc(ws)}/teams/${enc(id)}`, { json: { name } }, this.base).then(() => undefined);
  }
  deleteTeam(ws: string, id: string) {
    return request("DELETE", `/api/w/${enc(ws)}/teams/${enc(id)}`, {}, this.base).then(() => undefined);
  }
  teamAddMember(ws: string, id: string, userId: string) {
    return request("PUT", `/api/w/${enc(ws)}/teams/${enc(id)}/members/${enc(userId)}`, { json: {} }, this.base).then(() => undefined);
  }
  teamRemoveMember(ws: string, id: string, userId: string) {
    return request("DELETE", `/api/w/${enc(ws)}/teams/${enc(id)}/members/${enc(userId)}`, {}, this.base).then(() => undefined);
  }
  async acl(ws: string, path?: string) {
    const r = await request<{ rules: any[] }>("GET", `/api/w/${enc(ws)}/acl`, {}, this.base);
    return (path ? r.rules.filter((x) => x.path === path) : r.rules) as AclEntry[];
  }
  putAcl(ws: string, input: Parameters<Api["putAcl"]>[1]) {
    return request<AclEntry>("PUT", `/api/w/${enc(ws)}/acl`, { json: input }, this.base);
  }
  deleteAcl(ws: string, id: string) {
    return request("DELETE", `/api/w/${enc(ws)}/acl/${enc(id)}`, {}, this.base).then(() => undefined);
  }

  async tree(ws: string) {
    return normalizeTree(await request<any>("GET", `/api/w/${enc(ws)}/tree`, {}, this.base));
  }
  async page(ws: string, path: string) {
    return normalizePage(await request<any>("GET", `/api/w/${enc(ws)}/pages/${encPath(path)}`, {}, this.base));
  }
  async createPage(ws: string, input: Parameters<Api["createPage"]>[1]) {
    return normalizePage(await request<any>("POST", `/api/w/${enc(ws)}/pages`, { json: input }, this.base));
  }
  async updatePage(ws: string, path: string, patch: Parameters<Api["updatePage"]>[2], ifMatch?: string) {
    return normalizePage(await request<any>("PUT", `/api/w/${enc(ws)}/pages/${encPath(path)}`, { json: patch, ifMatch }, this.base));
  }
  deletePage(ws: string, path: string) {
    return request("DELETE", `/api/w/${enc(ws)}/pages/${path.split("/").map(enc).join("/")}`, {}, this.base).then(() => undefined);
  }
  movePage(ws: string, path: string, parent: string | null) {
    return request("POST", `/api/w/${enc(ws)}/pages/${path.split("/").map(enc).join("/")}/move`, { json: { parent } }, this.base).then(() => undefined);
  }

  async databases(ws: string) {
    const r = await request<{ databases: any[] }>("GET", `/api/w/${enc(ws)}/databases`, {}, this.base);
    return r.databases.map(normalizeDb);
  }
  async database(ws: string, slug: string) {
    return normalizeDb(await request<any>("GET", `/api/w/${enc(ws)}/databases/${enc(slug)}`, {}, this.base));
  }
  async createDatabase(ws: string, input: Parameters<Api["createDatabase"]>[1]) {
    return normalizeDb(await request<any>("POST", `/api/w/${enc(ws)}/databases`, { json: input }, this.base));
  }
  async updateDatabase(ws: string, slug: string, patch: Parameters<Api["updateDatabase"]>[2]) {
    return normalizeDb(await request<any>("PATCH", `/api/w/${enc(ws)}/databases/${enc(slug)}`, { json: patch }, this.base));
  }
  deleteDatabase(ws: string, slug: string) {
    return request("DELETE", `/api/w/${enc(ws)}/databases/${enc(slug)}`, {}, this.base).then(() => undefined);
  }
  async rows(ws: string, db: string, query?: Parameters<Api["rows"]>[2]) {
    const r = await request<{ rows: any[]; nextCursor?: string | number | null }>("GET", `/api/w/${enc(ws)}/databases/${enc(db)}/rows`, { query: { ...query, limit: query?.limit ?? 500 } }, this.base);
    return { rows: r.rows.map(normalizeRow), nextCursor: r.nextCursor == null ? undefined : String(r.nextCursor) };
  }
  async createRow(ws: string, db: string, input: Parameters<Api["createRow"]>[2]) {
    return normalizeRow(await request<any>("POST", `/api/w/${enc(ws)}/databases/${enc(db)}/rows`, { json: input }, this.base));
  }
  async updateRow(ws: string, db: string, id: string, patch: Parameters<Api["updateRow"]>[3], ifMatch?: string) {
    return normalizeRow(await request<any>("PATCH", `/api/w/${enc(ws)}/databases/${enc(db)}/rows/${enc(id)}`, { json: patch, ifMatch }, this.base));
  }
  deleteRow(ws: string, db: string, id: string) {
    return request("DELETE", `/api/w/${enc(ws)}/databases/${enc(db)}/rows/${enc(id)}`, {}, this.base).then(() => undefined);
  }
  async moveRow(ws: string, db: string, id: string, move: RowMove) {
    const r = await request<any>("POST", `/api/w/${enc(ws)}/databases/${enc(db)}/rows/${enc(id)}/move`, { json: move }, this.base);
    return { rows: Array.isArray(r?.rows) ? r.rows.map(normalizeRow) : r?.id ? [normalizeRow(r)] : [] };
  }

  async search(ws: string, q: string, type?: string) {
    const r = await request<{ results: any[] }>("GET", `/api/w/${enc(ws)}/search`, { query: { q, type } }, this.base);
    return r.results.map((x) => ({ path: x.path, title: x.title, type: x.kind, snippet: x.snip, dbSlug: x.db_slug ?? undefined })) as SearchResult[];
  }
  async comments(ws: string, path: string) {
    const r = await request<any>("GET", `/api/w/${enc(ws)}/comments`, { query: { path } }, this.base);
    const list: any[] = Array.isArray(r) ? r : r.comments ?? [];
    return list.map((c) => ({ ...c, userName: c.userName ?? c.user?.name, userId: c.userId ?? c.user?.id, createdAt: iso(c.createdAt ?? c.at) ?? "" })) as Comment[];
  }
  async addComment(ws: string, path: string, body: string) {
    const c = await request<any>("POST", `/api/w/${enc(ws)}/comments`, { json: { path, body } }, this.base);
    return { ...c, userName: c.userName ?? c.user?.name, createdAt: iso(c.createdAt ?? c.at) ?? new Date().toISOString() } as Comment;
  }
  deleteComment(ws: string, id: string) {
    return request("DELETE", `/api/w/${enc(ws)}/comments/${enc(id)}`, {}, this.base).then(() => undefined);
  }
  async activity(ws: string, path?: string, limit?: number) {
    const r = await request<{ activity: any[] }>("GET", `/api/w/${enc(ws)}/activity`, { query: { path, limit } }, this.base);
    return r.activity.map((a, i) => ({ id: `${a.at}-${i}`, userId: a.user?.id ?? "", userName: a.user?.name, action: a.action, path: a.path, detail: a.detail ?? undefined, createdAt: iso(a.at) ?? "" })) as ActivityEntry[];
  }

  syncConfig(ws: string) {
    return request<SyncConfig>("GET", `/api/w/${enc(ws)}/sync`, {}, this.base);
  }
  putSyncConfig(ws: string, cfg: Parameters<Api["putSyncConfig"]>[1]) {
    return request<SyncConfig>("PUT", `/api/w/${enc(ws)}/sync`, { json: cfg }, this.base);
  }
  syncRun(ws: string) {
    return request<SyncStatus>("POST", `/api/w/${enc(ws)}/sync/run`, { json: {} }, this.base);
  }
  syncStatus(ws: string) {
    return request<SyncStatus>("GET", `/api/w/${enc(ws)}/sync/status`, {}, this.base);
  }

  async vaultTree(ws: string) {
    const r = await request<{ tree: any[] }>("GET", `/api/w/${enc(ws)}/vault/tree`, {}, this.base);
    return r.tree.map(toVault);
  }
  vaultFile(ws: string, path: string) {
    return request<VaultFileRecord>("GET", `/api/w/${enc(ws)}/vault/file/${path.split("/").map(enc).join("/")}`, {}, this.base);
  }
  putVaultFile(ws: string, path: string, content: string, ifMatch?: string) {
    return request<VaultFileRecord>("PUT", `/api/w/${enc(ws)}/vault/file/${path.split("/").map(enc).join("/")}`, { text: content, ifMatch }, this.base);
  }
  graph(ws: string, scope: "global" | "local", path?: string, depth?: number) {
    return request<GraphResult>("GET", `/api/w/${enc(ws)}/graph`, { query: { scope, path, depth } }, this.base);
  }
  async tags(ws: string) {
    const r = await request<any>("GET", `/api/w/${enc(ws)}/tags`, {}, this.base);
    const list: any[] = Array.isArray(r) ? r : r.tags ?? [];
    return { tags: list.map((t) => ({ name: t.name ?? t.tag, count: t.count })) } as TagsResult;
  }
  async links(ws: string, path: string) {
    const r = await request<any>("GET", `/api/w/${enc(ws)}/links`, { query: { path } }, this.base);
    return {
      outgoing: (r.outgoing ?? []).map((o: any) => ({ target: o.target, path: typeof o.resolved === "string" ? o.resolved : undefined, title: o.target, resolved: !!o.resolved })),
      backlinks: (r.backlinks ?? []).map((b: any) => (typeof b === "string" ? { path: b, title: stem(b) } : b)),
      unresolved: r.unresolved ?? [],
    } as LinksResult;
  }

  onEvent(ws: string, handler: (ev: { type: string; path?: string }) => void): () => void {
    const es = new EventSource(`/api/w/${enc(ws)}/events`);
    const onChange = (e: MessageEvent) => {
      try {
        handler(JSON.parse(e.data));
      } catch {
        handler({ type: e.type });
      }
    };
    es.addEventListener("change", onChange as EventListener);
    es.addEventListener("comment", onChange as EventListener);
    es.addEventListener("sync", onChange as EventListener);
    es.onerror = () => {
      /* EventSource retries on its own; surfaced via next successful event */
    };
    return () => es.close();
  }
}
