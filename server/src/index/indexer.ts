import { statSync } from "node:fs";
import path from "node:path";
import type { DB } from "../db.js";
import { listAllFiles, readFileIfExists, sha256 } from "../vault/files.js";
import { parseDoc, propToString, propToStringArray, type Props } from "../vault/frontmatter.js";
import { DATA_DIR, PAGES_DIR, CONCEPT_DIR } from "../vault/files.js";

export interface Indexer {
  indexFile(wsId: string, vaultDir: string, relPath: string): void;
  removeFromIndex(wsId: string, relPath: string): void;
  reindexWorkspace(wsId: string, vaultDir: string): { indexed: number; removed: number };
  /** Cheap stat-only pass: re-index files whose mtime/size changed, drop vanished ones. Returns changed paths. */
  reconcile(wsId: string, vaultDir: string): string[];
  resolveAllLinks(wsId: string): void;
  resolveLinkTitle(wsId: string, title: string): string | null;
}

const WIKI_LINK = /\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g;
const INLINE_TAG = /(^|[\s(])#([A-Za-z0-9/_-]{1,64})/g;

export class SqliteIndexer implements Indexer {
  constructor(private db: DB) {}

  indexFile(wsId: string, vaultDir: string, relPath: string): void {
    if (!relPath.toLowerCase().endsWith(".md")) return;
    if (relPath.startsWith(".trash/") || relPath.startsWith(".git/")) return;
    if (relPath.startsWith(`${CONCEPT_DIR}/`) || relPath.startsWith(".retex/")) return;
    const buf = readFileIfExists(vaultDir, relPath);
    if (!buf) {
      this.removeFromIndex(wsId, relPath);
      return;
    }
    const text = buf.toString("utf8");
    const { props, body } = parseDoc(text);
    const type = typeof props.type === "string" ? props.type : null;
    let kind: "page" | "record" | "other" = "other";
    let dbSlug: string | null = null;
    if (relPath.startsWith(`${PAGES_DIR}/`) || type === "page") {
      kind = "page";
    } else if (relPath.startsWith(`${DATA_DIR}/`)) {
      dbSlug = relPath.split("/")[1] ?? null;
      kind = "record";
    }
    if (kind === "other") return;

    const stat = statSync(path.join(vaultDir, ...relPath.split("/")));
    const hash = sha256(buf);
    const tags = [
      ...new Set([...propToStringArray(props.tags), ...inlineTags(body)]),
    ];
    const title = propToString(props.title) || relPath;
    const status = props.status === undefined || props.status === null ? null : propToString(props.status);
    const rank = typeof props.rank === "string" ? props.rank : props.rank === undefined ? null : propToString(props.rank);
    const owner = props.owner === undefined || props.owner === null ? null : propToString(props.owner);
    const archived = props.archived === true || props.archived === "true";

    this.db
      .prepare(
        `INSERT INTO files (workspace_id, path, kind, db_slug, title, status, rank, owner, tags_json,
                            properties_json, archived, mtime_ms, size, content_hash, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (workspace_id, path) DO UPDATE SET
           kind = excluded.kind, db_slug = excluded.db_slug, title = excluded.title,
           status = excluded.status, rank = excluded.rank, owner = excluded.owner,
           tags_json = excluded.tags_json, properties_json = excluded.properties_json,
           archived = excluded.archived, mtime_ms = excluded.mtime_ms, size = excluded.size,
           content_hash = excluded.content_hash, updated_at = excluded.updated_at`,
      )
      .run(
        wsId,
        relPath,
        kind,
        dbSlug,
        title,
        status,
        rank,
        owner,
        JSON.stringify(tags),
        JSON.stringify(props),
        archived ? 1 : 0,
        Math.floor(stat.mtimeMs),
        buf.length,
        hash,
        Math.floor(stat.mtimeMs),
      );

    // FTS
    this.db.prepare(`DELETE FROM search WHERE ws = ? AND path = ?`).run(wsId, relPath);
    const propsText = Object.entries(props as Props)
      .filter(([k]) => k !== "title")
      .map(([k, v]) => `${k} ${propToString(v)}`)
      .join(" ");
    this.db
      .prepare(`INSERT INTO search (ws, path, title, body, props) VALUES (?, ?, ?, ?, ?)`)
      .run(wsId, relPath, title, body, propsText);

    // links
    this.db.prepare(`DELETE FROM links WHERE workspace_id = ? AND src = ?`).run(wsId, relPath);
    const targets = new Set<string>();
    for (const m of text.matchAll(WIKI_LINK)) {
      const t = m[1].trim();
      if (t) targets.add(t);
    }
    for (const t of targets) {
      this.db
        .prepare(
          `INSERT OR IGNORE INTO links (workspace_id, src, target, resolved) VALUES (?, ?, ?, NULL)`,
        )
        .run(wsId, relPath, t);
    }
    this.resolveLinksFor(wsId, relPath);

    // tags
    this.db.prepare(`DELETE FROM tags WHERE workspace_id = ? AND path = ?`).run(wsId, relPath);
    for (const t of tags) {
      this.db.prepare(`INSERT OR IGNORE INTO tags (workspace_id, path, tag) VALUES (?, ?, ?)`).run(wsId, relPath, t);
    }
  }

  removeFromIndex(wsId: string, relPath: string): void {
    this.db.prepare(`DELETE FROM files WHERE workspace_id = ? AND path = ?`).run(wsId, relPath);
    this.db.prepare(`DELETE FROM search WHERE ws = ? AND path = ?`).run(wsId, relPath);
    this.db.prepare(`DELETE FROM links WHERE workspace_id = ? AND src = ?`).run(wsId, relPath);
    this.db.prepare(`DELETE FROM tags WHERE workspace_id = ? AND path = ?`).run(wsId, relPath);
  }

  reconcile(wsId: string, vaultDir: string): string[] {
    const changed: string[] = [];
    const known = new Map(
      (this.db.prepare(`SELECT path, mtime_ms, size FROM files WHERE workspace_id = ?`).all(wsId) as any[]).map((r) => [
        r.path as string,
        r,
      ]),
    );
    const onDisk = new Set<string>();
    for (const rel of listAllFiles(vaultDir)) {
      if (!rel.toLowerCase().endsWith(".md")) continue;
      onDisk.add(rel);
      const row = known.get(rel);
      let st;
      try {
        st = statSync(path.join(vaultDir, ...rel.split("/")));
      } catch {
        continue;
      }
      if (!row || Math.floor(st.mtimeMs) !== Number(row.mtime_ms) || st.size !== Number(row.size)) {
        this.indexFile(wsId, vaultDir, rel);
        changed.push(rel);
      }
    }
    for (const p of known.keys()) {
      if (!onDisk.has(p)) {
        this.removeFromIndex(wsId, p);
        changed.push(p);
      }
    }
    if (changed.length) this.resolveAllLinks(wsId);
    return changed;
  }

  reindexWorkspace(wsId: string, vaultDir: string): { indexed: number; removed: number } {
    const onDisk = new Set(listAllFiles(vaultDir).filter((f) => f.toLowerCase().endsWith(".md")));
    const inIndex = (
      this.db.prepare(`SELECT path FROM files WHERE workspace_id = ?`).all(wsId) as any[]
    ).map((r) => r.path);
    let indexed = 0;
    let removed = 0;
    for (const p of onDisk) {
      this.indexFile(wsId, vaultDir, p);
      indexed++;
    }
    for (const p of inIndex) {
      if (!onDisk.has(p)) {
        this.removeFromIndex(wsId, p);
        removed++;
      }
    }
    this.resolveAllLinks(wsId);
    return { indexed, removed };
  }

  /** Re-resolve pending links after new files appear. */
  resolveAllLinks(wsId: string): void {
    const pending = this.db
      .prepare(`SELECT DISTINCT target FROM links WHERE workspace_id = ? AND resolved IS NULL`)
      .all(wsId) as any[];
    for (const { target } of pending) {
      const resolved = this.resolveLinkTitle(wsId, target);
      if (resolved) {
        this.db
          .prepare(
            `UPDATE links SET resolved = ? WHERE workspace_id = ? AND target = ? AND resolved IS NULL`,
          )
          .run(resolved, wsId, target);
      }
    }
  }

  private resolveLinksFor(wsId: string, src: string): void {
    const rows = this.db
      .prepare(`SELECT rowid, target FROM links WHERE workspace_id = ? AND src = ?`)
      .all(wsId, src) as any[];
    for (const r of rows) {
      const resolved = this.resolveLinkTarget(wsId, r.target, src);
      this.db
        .prepare(`UPDATE links SET resolved = ? WHERE workspace_id = ? AND src = ? AND target = ?`)
        .run(resolved, wsId, src, r.target);
    }
  }

  resolveLinkTitle(wsId: string, title: string): string | null {
    const byTitle = this.db
      .prepare(
        `SELECT path FROM files WHERE workspace_id = ? AND lower(title) = lower(?) ORDER BY kind = 'page' DESC, path LIMIT 1`,
      )
      .get(wsId, title) as any;
    if (byTitle) return byTitle.path as string;
    return null;
  }

  /** Resolve a link target: path first (with or without .md), then title. */
  private resolveLinkTarget(wsId: string, target: string, src: string): string | null {
    const candidates = new Set<string>();
    const t = target.replace(/\.md$/i, "");
    candidates.add(`${t}.md`);
    // same-directory relative link
    const dir = src.includes("/") ? src.slice(0, src.lastIndexOf("/") + 1) : "";
    candidates.add(`${dir}${t}.md`);
    for (const c of candidates) {
      const hit = this.db
        .prepare(`SELECT path FROM files WHERE workspace_id = ? AND path = ?`)
        .get(wsId, c) as any;
      if (hit) return hit.path as string;
    }
    return this.resolveLinkTitle(wsId, target);
  }
}

function inlineTags(body: string): string[] {
  const out: string[] = [];
  // strip fenced code blocks so #include in code is not a tag
  const stripped = body.replace(/```[\s\S]*?```/g, " ");
  for (const m of stripped.matchAll(INLINE_TAG)) {
    out.push(m[2]);
  }
  return out;
}

/** Build an FTS5 MATCH expression from user input (prefix search per term). */
export function ftsQuery(q: string): string {
  const terms = q
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 12)
    .map((t) => `"${t.replace(/"/g, '""')}"*`);
  return terms.length ? terms.join(" AND ") : `""`;
}
