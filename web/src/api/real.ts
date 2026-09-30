import { request } from "./request";
import type { Api, RowMove } from "./apiTypes";
import type {
  AclEntry, ActivityEntry, Comment, Database, DbRow, GraphResult, Health, Invite,
  LinksResult, Member, PageRecord, SearchResult, SyncConfig, SyncStatus, TagsResult,
  Team, Token, TreeNode, User, VaultFile, VaultFileRecord, Workspace,
} from "./types";

const enc = encodeURIComponent;

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
  me() {
    return request<User | null>("GET", "/api/me", {}, this.base).catch(() => null);
  }
  tokens() {
    return request<Token[]>("GET", "/api/me/tokens", {}, this.base);
  }
  createToken(name: string) {
    return request<Token>("POST", "/api/me/tokens", { json: { name } }, this.base);
  }
  deleteToken(id: string) {
    return request("DELETE", `/api/me/tokens/${enc(id)}`, {}, this.base).then(() => undefined);
  }

  workspaces() {
    return request<Workspace[]>("GET", "/api/workspaces", {}, this.base);
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

  members(ws: string) {
    return request<Member[]>("GET", `/api/w/${enc(ws)}/members`, {}, this.base);
  }
  setMemberRole(ws: string, userId: string, role: Parameters<Api["setMemberRole"]>[2]) {
    return request("PATCH", `/api/w/${enc(ws)}/members/${enc(userId)}`, { json: { role } }, this.base).then(() => undefined);
  }
  removeMember(ws: string, userId: string) {
    return request("DELETE", `/api/w/${enc(ws)}/members/${enc(userId)}`, {}, this.base).then(() => undefined);
  }
  invites(ws: string) {
    return request<Invite[]>("GET", `/api/w/${enc(ws)}/invites`, {}, this.base);
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
  teams(ws: string) {
    return request<Team[]>("GET", `/api/w/${enc(ws)}/teams`, {}, this.base);
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
  acl(ws: string, path?: string) {
    return request<AclEntry[]>("GET", `/api/w/${enc(ws)}/acl`, { query: { path } }, this.base);
  }
  putAcl(ws: string, input: Parameters<Api["putAcl"]>[1]) {
    return request<AclEntry>("PUT", `/api/w/${enc(ws)}/acl`, { json: input }, this.base);
  }
  deleteAcl(ws: string, id: string) {
    return request("DELETE", `/api/w/${enc(ws)}/acl/${enc(id)}`, {}, this.base).then(() => undefined);
  }

  tree(ws: string) {
    return request<TreeNode[]>("GET", `/api/w/${enc(ws)}/tree`, {}, this.base);
  }
  page(ws: string, path: string) {
    return request<PageRecord>("GET", `/api/w/${enc(ws)}/pages/${path.split("/").map(enc).join("/")}`, {}, this.base);
  }
  createPage(ws: string, input: Parameters<Api["createPage"]>[1]) {
    return request<PageRecord>("POST", `/api/w/${enc(ws)}/pages`, { json: input }, this.base);
  }
  updatePage(ws: string, path: string, patch: Parameters<Api["updatePage"]>[2], ifMatch?: string) {
    return request<PageRecord>("PUT", `/api/w/${enc(ws)}/pages/${path.split("/").map(enc).join("/")}`, { json: patch, ifMatch }, this.base);
  }
  deletePage(ws: string, path: string) {
    return request("DELETE", `/api/w/${enc(ws)}/pages/${path.split("/").map(enc).join("/")}`, {}, this.base).then(() => undefined);
  }
  movePage(ws: string, path: string, parent: string | null) {
    return request("POST", `/api/w/${enc(ws)}/pages/${path.split("/").map(enc).join("/")}/move`, { json: { parent } }, this.base).then(() => undefined);
  }

  databases(ws: string) {
    return request<Database[]>("GET", `/api/w/${enc(ws)}/databases`, {}, this.base);
  }
  database(ws: string, slug: string) {
    return request<Database>("GET", `/api/w/${enc(ws)}/databases/${enc(slug)}`, {}, this.base);
  }
  createDatabase(ws: string, input: Parameters<Api["createDatabase"]>[1]) {
    return request<Database>("POST", `/api/w/${enc(ws)}/databases`, { json: input }, this.base);
  }
  updateDatabase(ws: string, slug: string, patch: Parameters<Api["updateDatabase"]>[2]) {
    return request<Database>("PATCH", `/api/w/${enc(ws)}/databases/${enc(slug)}`, { json: patch }, this.base);
  }
  deleteDatabase(ws: string, slug: string) {
    return request("DELETE", `/api/w/${enc(ws)}/databases/${enc(slug)}`, {}, this.base).then(() => undefined);
  }
  rows(ws: string, db: string, query?: Parameters<Api["rows"]>[2]) {
    return request<{ rows: DbRow[]; nextCursor?: string }>("GET", `/api/w/${enc(ws)}/databases/${enc(db)}/rows`, { query }, this.base);
  }
  createRow(ws: string, db: string, input: Parameters<Api["createRow"]>[2]) {
    return request<DbRow>("POST", `/api/w/${enc(ws)}/databases/${enc(db)}/rows`, { json: input }, this.base);
  }
  updateRow(ws: string, db: string, id: string, patch: Parameters<Api["updateRow"]>[3], ifMatch?: string) {
    return request<DbRow>("PATCH", `/api/w/${enc(ws)}/databases/${enc(db)}/rows/${enc(id)}`, { json: patch, ifMatch }, this.base);
  }
  deleteRow(ws: string, db: string, id: string) {
    return request("DELETE", `/api/w/${enc(ws)}/databases/${enc(db)}/rows/${enc(id)}`, {}, this.base).then(() => undefined);
  }
  moveRow(ws: string, db: string, id: string, move: RowMove) {
    return request<{ rows: DbRow[] }>("POST", `/api/w/${enc(ws)}/databases/${enc(db)}/rows/${enc(id)}/move`, { json: move }, this.base);
  }

  search(ws: string, q: string, type?: string) {
    return request<SearchResult[]>("GET", `/api/w/${enc(ws)}/search`, { query: { q, type } }, this.base);
  }
  comments(ws: string, path: string) {
    return request<Comment[]>("GET", `/api/w/${enc(ws)}/comments`, { query: { path } }, this.base);
  }
  addComment(ws: string, path: string, body: string) {
    return request<Comment>("POST", `/api/w/${enc(ws)}/comments`, { json: { path, body } }, this.base);
  }
  deleteComment(ws: string, id: string) {
    return request("DELETE", `/api/w/${enc(ws)}/comments/${enc(id)}`, {}, this.base).then(() => undefined);
  }
  activity(ws: string, path?: string, limit?: number) {
    return request<ActivityEntry[]>("GET", `/api/w/${enc(ws)}/activity`, { query: { path, limit } }, this.base);
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

  vaultTree(ws: string) {
    return request<VaultFile[]>("GET", `/api/w/${enc(ws)}/vault/tree`, {}, this.base);
  }
  vaultFile(ws: string, path: string) {
    return request<VaultFileRecord>("GET", `/api/w/${enc(ws)}/vault/file/${path.split("/").map(enc).join("/")}`, {}, this.base);
  }
  putVaultFile(ws: string, path: string, content: string, ifMatch?: string) {
    return request<VaultFileRecord>("PUT", `/api/w/${enc(ws)}/vault/file/${path.split("/").map(enc).join("/")}`, { json: { content }, ifMatch }, this.base);
  }
  graph(ws: string, scope: "global" | "local", path?: string, depth?: number) {
    return request<GraphResult>("GET", `/api/w/${enc(ws)}/graph`, { query: { scope, path, depth } }, this.base);
  }
  tags(ws: string) {
    return request<TagsResult>("GET", `/api/w/${enc(ws)}/tags`, {}, this.base);
  }
  links(ws: string, path: string) {
    return request<LinksResult>("GET", `/api/w/${enc(ws)}/links`, { query: { path } }, this.base);
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
