import { DatabaseSync } from "node:sqlite";

export type DB = DatabaseSync;

export function openDb(file: string): DB {
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");
  migrate(db);
  return db;
}

function migrate(db: DB): void {
  db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  is_admin INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS api_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER
);
CREATE TABLE IF NOT EXISTS invites (
  id TEXT PRIMARY KEY,
  workspace_id TEXT,
  email TEXT,
  role TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  created_by TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used_by TEXT,
  used_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  template TEXT NOT NULL DEFAULT 'blank',
  created_by TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS members (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (workspace_id, user_id)
);
CREATE TABLE IF NOT EXISTS teams (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (workspace_id, name)
);
CREATE TABLE IF NOT EXISTS team_members (
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (team_id, user_id)
);
CREATE TABLE IF NOT EXISTS acls (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  subject_type TEXT NOT NULL,
  subject_id TEXT,
  level TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  user_id TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  path TEXT,
  user_id TEXT,
  user_name TEXT,
  action TEXT NOT NULL,
  detail TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_activity_ws ON activity(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_path ON activity(workspace_id, path);
CREATE TABLE IF NOT EXISTS sync_settings (
  workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  remote_url TEXT,
  branch TEXT NOT NULL DEFAULT 'main',
  token_enc TEXT,
  enabled INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

-- Vault index (files are the truth; this is only a derived index).
CREATE TABLE IF NOT EXISTS files (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  kind TEXT NOT NULL,             -- 'page' | 'record' | 'other'
  db_slug TEXT,
  title TEXT,
  status TEXT,
  rank TEXT,
  owner TEXT,
  tags_json TEXT,
  properties_json TEXT,
  archived INTEGER NOT NULL DEFAULT 0,
  mtime_ms INTEGER NOT NULL,
  size INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (workspace_id, path)
);
CREATE INDEX IF NOT EXISTS idx_files_db ON files(workspace_id, db_slug, archived);
CREATE VIRTUAL TABLE IF NOT EXISTS search USING fts5(
  ws UNINDEXED, path UNINDEXED, title, body, props
);
CREATE TABLE IF NOT EXISTS links (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  src TEXT NOT NULL,
  target TEXT NOT NULL,
  resolved TEXT,
  PRIMARY KEY (workspace_id, src, target)
);
CREATE TABLE IF NOT EXISTS tags (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  tag TEXT NOT NULL,
  PRIMARY KEY (workspace_id, path, tag)
);
CREATE INDEX IF NOT EXISTS idx_tags_tag ON tags(workspace_id, tag);
`);
}
