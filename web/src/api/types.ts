/** API contract types — mirror docs/SPEC.md. */

export type ApiError = { error: { code: string; message: string } };

export type Role = "owner" | "admin" | "member" | "guest";
export type Permission = "none" | "view" | "comment" | "edit" | "admin";

export interface User {
  id: string;
  email: string;
  name: string;
  avatarColor?: string;
  isAdmin?: boolean;
}

export interface Workspace {
  id: string;
  slug: string;
  name: string;
  icon?: string;
  accent?: string;
  role?: Role;
  createdAt?: string;
}

export type PropertyType =
  | "title" | "text" | "number" | "select" | "multi_select" | "status"
  | "date" | "checkbox" | "url" | "email" | "phone" | "person"
  | "relation" | "created" | "updated";

export interface SelectOption { id: string; name?: string; color?: string }

export interface Property {
  key: string;
  name: string;
  type: PropertyType;
  options?: SelectOption[] | null;
  format?: "currency" | "plain";
  database?: string; // for relation
  visible?: boolean;
}

export type ViewType = "table" | "board" | "list" | "calendar" | "gallery";
export type FilterOp = "eq" | "neq" | "contains" | "gt" | "lt" | "gte" | "lte" | "empty" | "notempty";
export interface Filter { key: string; op: FilterOp; value?: unknown }
export interface Sort { key: string; dir: "asc" | "desc" }

export interface DbView {
  id: string;
  name: string;
  type: ViewType;
  groupBy?: string;
  filters?: Filter[];
  sorts?: Sort[];
  visible?: string[];
  calendarDate?: string;
  cardFields?: string[];
}

export interface Database {
  slug: string;
  name: string;
  icon?: string;
  recordType: string;
  properties: Property[];
  views: DbView[];
}

export type RowProperties = Record<string, unknown>;

export interface DbRow {
  id: string;
  path: string;
  properties: RowProperties;
  rank: string;
  contentHash: string;
  body?: string;
  updatedAt?: string;
  tags?: string[];
  cover?: string;
}

export interface TreeNode {
  path: string;
  title: string;
  type: "page" | "database" | "folder";
  icon?: string;
  children?: TreeNode[];
}

export interface PageRecord {
  path: string;
  title: string;
  icon?: string;
  properties?: RowProperties;
  body: string;
  contentHash: string;
  updatedAt?: string;
  backlinks?: { path: string; title: string }[];
  permission: Permission;
  dbSlug?: string;
}

export interface Comment {
  id: string;
  path: string;
  userId: string;
  userName?: string;
  body: string;
  createdAt: string;
}

export interface ActivityEntry {
  id: string;
  userId: string;
  userName?: string;
  action: string;
  path?: string;
  detail?: string;
  createdAt: string;
}

export interface Member {
  userId: string;
  email: string;
  name: string;
  role: Role;
}

export interface Team {
  id: string;
  name: string;
  memberIds: string[];
}

export type AclSubjectType = "user" | "team" | "workspace";
export interface AclEntry {
  id: string;
  path: string;
  subjectType: AclSubjectType;
  subjectId: string;
  subjectName?: string;
  level: Permission;
}

export interface Invite {
  id: string;
  url: string;
  token: string;
  email?: string;
  role: Role;
  expiresAt: string;
}

export interface SyncConfig {
  remoteUrl?: string;
  branch?: string;
  enabled: boolean;
  hasToken?: boolean;
}

export interface SyncStatus {
  state: "disabled" | "clean" | "syncing" | "ahead" | "behind" | "conflict" | "error";
  lastSyncAt?: string;
  lastCommit?: string;
  message?: string;
  conflicts?: { path: string; savedAs: string }[];
}

export interface SearchResult {
  path: string;
  title: string;
  type: "page" | string;
  snippet?: string;
  dbSlug?: string;
}

/* ---- Vault mode ---- */

export interface VaultFile {
  path: string;
  title?: string;
  type: "file" | "dir";
  size?: number;
  recordType?: string; // retex badge
  children?: VaultFile[];
}

export interface VaultFileRecord {
  path: string;
  content: string;
  contentHash: string;
  size?: number;
  updatedAt?: string;
}

export interface GraphNode {
  id: string;
  path: string;
  title: string;
  type: "page" | "record" | "file";
  tags?: string[];
}

export interface GraphEdge { source: string; target: string }

export interface GraphResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface LinksResult {
  outgoing: { target: string; path?: string; title?: string; resolved: boolean }[];
  backlinks: { path: string; title: string }[];
  unresolved: string[];
}

export interface TagsResult {
  tags: { name: string; count: number }[];
}

export interface Token {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  secret?: string; // shown once
}

export interface Health {
  ok: boolean;
  version: string;
  setupRequired: boolean;
}
