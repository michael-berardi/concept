import type {
  AclEntry, ActivityEntry, Comment, Database, DbRow, GraphResult, Health, Invite,
  LinksResult, Member, PageRecord, Permission, Role, SearchResult, SyncConfig,
  SyncStatus, TagsResult, Team, Token, TreeNode, User, VaultFile, VaultFileRecord, Workspace,
} from "./types";

export interface RowMove {
  status?: string;
  beforeId?: string | null;
  afterId?: string | null;
}

/** Transport-agnostic API surface (real HTTP and the dev mock implement this). */
export interface Api {
  health(): Promise<Health>;
  register(input: { email: string; name: string; password: string; inviteToken?: string }): Promise<{ user: User }>;
  login(input: { email: string; password: string }): Promise<{ user: User }>;
  logout(): Promise<void>;
  me(): Promise<User | null>;
  tokens(): Promise<Token[]>;
  createToken(name: string): Promise<Token>;
  deleteToken(id: string): Promise<void>;

  workspaces(): Promise<Workspace[]>;
  createWorkspace(input: { name: string; slug?: string; template?: "blank" | "crm" }): Promise<Workspace>;
  updateWorkspace(ws: string, patch: Partial<Pick<Workspace, "name" | "icon" | "accent">>): Promise<Workspace>;
  deleteWorkspace(ws: string): Promise<void>;

  members(ws: string): Promise<Member[]>;
  setMemberRole(ws: string, userId: string, role: Role): Promise<void>;
  removeMember(ws: string, userId: string): Promise<void>;
  invites(ws: string): Promise<Invite[]>;
  createInvite(ws: string, input: { email?: string; role: Role; expiresInDays: number }): Promise<Invite>;
  deleteInvite(ws: string, id: string): Promise<void>;
  acceptInvite(token: string): Promise<{ workspace: Workspace }>;
  teams(ws: string): Promise<Team[]>;
  createTeam(ws: string, name: string): Promise<Team>;
  renameTeam(ws: string, id: string, name: string): Promise<void>;
  deleteTeam(ws: string, id: string): Promise<void>;
  teamAddMember(ws: string, id: string, userId: string): Promise<void>;
  teamRemoveMember(ws: string, id: string, userId: string): Promise<void>;
  acl(ws: string, path?: string): Promise<AclEntry[]>;
  putAcl(ws: string, input: { path: string; subjectType: "user" | "team" | "workspace"; subjectId: string; level: Permission }): Promise<AclEntry>;
  deleteAcl(ws: string, id: string): Promise<void>;

  tree(ws: string): Promise<TreeNode[]>;
  page(ws: string, path: string): Promise<PageRecord>;
  createPage(ws: string, input: { title: string; parent?: string; body?: string; icon?: string }): Promise<PageRecord>;
  updatePage(ws: string, path: string, patch: { title?: string; properties?: Record<string, unknown>; body?: string; icon?: string }, ifMatch?: string): Promise<PageRecord>;
  deletePage(ws: string, path: string): Promise<void>;
  movePage(ws: string, path: string, parent: string | null): Promise<string>;

  databases(ws: string): Promise<Database[]>;
  database(ws: string, slug: string): Promise<Database>;
  createDatabase(ws: string, input: { name: string; template?: string }): Promise<Database>;
  updateDatabase(ws: string, slug: string, patch: Partial<Database>): Promise<Database>;
  deleteDatabase(ws: string, slug: string): Promise<void>;
  rows(ws: string, db: string, query?: { view?: string; q?: string; limit?: number }): Promise<{ rows: DbRow[]; nextCursor?: string }>;
  createRow(ws: string, db: string, input: { properties: Record<string, unknown>; body?: string }): Promise<DbRow>;
  updateRow(ws: string, db: string, id: string, patch: { properties?: Record<string, unknown>; body?: string }, ifMatch?: string): Promise<DbRow>;
  deleteRow(ws: string, db: string, id: string): Promise<void>;
  moveRow(ws: string, db: string, id: string, move: RowMove): Promise<{ rows: DbRow[] }>;

  search(ws: string, q: string, type?: string): Promise<SearchResult[]>;
  comments(ws: string, path: string): Promise<Comment[]>;
  addComment(ws: string, path: string, body: string): Promise<Comment>;
  deleteComment(ws: string, id: string): Promise<void>;
  activity(ws: string, path?: string, limit?: number): Promise<ActivityEntry[]>;

  syncConfig(ws: string): Promise<SyncConfig>;
  putSyncConfig(ws: string, cfg: SyncConfig & { token?: string }): Promise<SyncConfig>;
  syncRun(ws: string): Promise<SyncStatus>;
  syncStatus(ws: string): Promise<SyncStatus>;

  vaultTree(ws: string): Promise<VaultFile[]>;
  vaultFile(ws: string, path: string): Promise<VaultFileRecord>;
  putVaultFile(ws: string, path: string, content: string, ifMatch?: string): Promise<VaultFileRecord>;
  graph(ws: string, scope: "global" | "local", path?: string, depth?: number): Promise<GraphResult>;
  tags(ws: string): Promise<TagsResult>;
  links(ws: string, path: string): Promise<LinksResult>;

  /** SSE change events; returns an unsubscribe function. */
  onEvent(ws: string, handler: (ev: { type: string; path?: string }) => void): () => void;
}
