import { mkdirSync, writeFileSync, readFileSync, existsSync, renameSync, statSync, readdirSync, rmdirSync } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import {
  ATTACHMENTS_DIR,
  CONCEPT_DIR,
  DATA_DIR,
  PAGES_DIR,
  absPath,
  atomicWrite,
  exists,
  isReservedTopLevel,
  listAllFiles,
  moveToTrash,
  readFileIfExists,
  safeRelPath,
  sha256,
  slugifyTitle,
  uniquePath,
} from "./files.js";
import { applyPropUpdates, parseDoc, propToStringArray, renderDoc, type Props } from "./frontmatter.js";
import { firstRank, isRank, moveRank, rankAfter, resequenceRanks } from "./rank.js";
import {
  CRM_STARTER,
  templateSchema,
  type DatabaseSchema,
  type DbView,
} from "./templates.js";
import { badRequest, conflict, notFound } from "../errors.js";
import type { DB } from "../db.js";

export interface FileMeta {
  path: string;
  kind: "page" | "record" | "other";
  dbSlug: string | null;
  title: string | null;
  status: string | null;
  rank: string | null;
  owner: string | null;
  tags: string[];
  properties: Props;
  archived: boolean;
  updatedAt: number;
  contentHash: string;
  size: number;
}

export interface PagePayload {
  path: string;
  title: string;
  icon: string | null;
  parent: string | null;
  properties: Props;
  body: string;
  contentHash: string;
  updatedAt: number;
  backlinks: string[];
  permission: string;
  archived: boolean;
}

export interface RowPayload {
  id: string;
  path: string;
  properties: Props;
  rank: string | null;
  contentHash: string;
  updatedAt: number;
  body?: string;
  archived?: boolean;
}

export type ChangeHook = (workspaceSlug: string, paths: string[], actor: string) => void;

/** Database slugs name directories under Data/ and schema files. */
export const DB_SLUG = /^[a-z0-9][a-z0-9-]{0,48}$/;

export class VaultEngine {
  /**
   * Called after engine mutations with the changed vault-relative paths so the
   * API layer can emit SSE events and schedule git sync.
   */
  onChange: ChangeHook = () => {};

  constructor(
    private db: DB,
    private getVaultDir: (slug: string) => string,
  ) {}

  // ---------- workspace directory ----------

  vaultDir(slug: string): string {
    return this.getVaultDir(slug);
  }

  ensureVaultDirs(slug: string, name: string, id: string): string {
    const dir = this.getVaultDir(slug);
    mkdirSync(path.join(dir, CONCEPT_DIR, "databases"), { recursive: true });
    mkdirSync(path.join(dir, PAGES_DIR), { recursive: true });
    mkdirSync(path.join(dir, DATA_DIR), { recursive: true });
    mkdirSync(path.join(dir, ATTACHMENTS_DIR), { recursive: true });
    writeJson(path.join(dir, CONCEPT_DIR, "workspace.json"), { name, id });
    const gitignore = path.join(dir, ".gitignore");
    if (!existsSync(gitignore)) {
      writeFileSync(gitignore, ".retex/\n.trash/\n.DS_Store\n");
    }
    return dir;
  }

  // ---------- index access ----------

  indexRow(wsId: string, relPath: string): FileMeta | null {
    const row = this.db
      .prepare(
        `SELECT path, kind, db_slug, title, status, rank, owner, tags_json, properties_json,
                archived, updated_at, content_hash, size
         FROM files WHERE workspace_id = ? AND path = ?`,
      )
      .get(wsId, relPath) as any;
    if (!row) return null;
    return {
      path: row.path,
      kind: row.kind,
      dbSlug: row.db_slug,
      title: row.title,
      status: row.status,
      rank: row.rank,
      owner: row.owner,
      tags: JSON.parse(row.tags_json || "[]"),
      properties: JSON.parse(row.properties_json || "{}"),
      archived: !!row.archived,
      updatedAt: row.updated_at,
      contentHash: row.content_hash,
      size: row.size,
    };
  }

  private mustIndexRow(wsId: string, relPath: string): FileMeta {
    const meta = this.indexRow(wsId, relPath);
    if (!meta) throw notFound(`File is not indexed: ${relPath}`);
    return meta;
  }

  // ---------- pages ----------

  /** Normalize a parent reference (page path or dir path) to a Pages/-rooted directory. */
  private normalizeParent(parent: string): string {
    const p = safeRelPath(parent);
    const rooted = p === PAGES_DIR || p.startsWith(`${PAGES_DIR}/`) ? p : `${PAGES_DIR}/${p}`;
    // A parent page file (Pages/Roadmap.md) nests children in Pages/Roadmap/.
    return rooted.replace(/\.md$/i, "");
  }

  createPage(
    ws: { id: string; slug: string },
    input: { title: string; parent?: string | null; body?: string; icon?: string | null },
    actor: string,
  ): PagePayload {
    const vaultDir = this.vaultDir(ws.slug);
    const title = String(input.title ?? "").trim();
    if (!title) throw badRequest("title is required", "missing_title");
    const parent = input.parent ? this.normalizeParent(input.parent) : null;
    const dirPart = parent ? parent.replace(/^Pages\/?/, "") : "";
    const desired = dirPart
      ? `${PAGES_DIR}/${dirPart}/${slugifyTitle(title)}.md`
      : `${PAGES_DIR}/${slugifyTitle(title)}.md`;
    const relPath = uniquePath(vaultDir, desired);
    const props: Props = {
      title,
      type: "page",
      created: new Date().toISOString(),
    };
    if (input.icon) props["icon"] = input.icon;
    const raw = renderDoc(props, input.body ?? "");
    atomicWrite(vaultDir, relPath, raw);
    this.afterWrite(ws.slug, [relPath], actor);
    return this.getPage(ws, relPath, "admin");
  }

  getPage(ws: { id: string; slug: string }, relPath: string, permission: string): PagePayload {
    const vaultDir = this.vaultDir(ws.slug);
    const p = safeRelPath(relPath);
    const buf = readFileIfExists(vaultDir, p);
    if (!buf) throw notFound(`No page at ${p}`);
    const { props, body } = parseDoc(buf.toString("utf8"));
    const backlinks = (
      this.db
        .prepare(`SELECT src FROM links WHERE workspace_id = ? AND resolved = ? ORDER BY src`)
        .all(ws.id, p) as any[]
    ).map((r) => r.src);
    return {
      path: p,
      title: String(props.title ?? p),
      icon: props.icon ? String(props.icon) : null,
      parent: parentOf(p),
      properties: props,
      body,
      contentHash: sha256(buf),
      updatedAt: updatedAtOf(vaultDir, p),
      backlinks,
      permission,
      archived: props.archived === true,
    };
  }

  updatePage(
    ws: { id: string; slug: string },
    relPath: string,
    input: { title?: string; properties?: Props; body?: string },
    expectedHash: string | null,
    actor: string,
  ): PagePayload {
    const vaultDir = this.vaultDir(ws.slug);
    const p = safeRelPath(relPath);
    const buf = readFileIfExists(vaultDir, p);
    if (!buf) throw notFound(`No page at ${p}`);
    const currentHash = sha256(buf);
    if (expectedHash && expectedHash !== currentHash) {
      throw conflict("The page was modified by someone else", {
        current: { path: p, contentHash: currentHash },
      });
    }
    const { props, body } = parseDoc(buf.toString("utf8"));
    let next = props;
    if (input.properties) next = applyPropUpdates(next, input.properties);
    if (input.title !== undefined) next["title"] = input.title;
    next["updated"] = new Date().toISOString();
    const nextBody = input.body !== undefined ? input.body : body;
    atomicWrite(vaultDir, p, renderDoc(next, nextBody));
    this.afterWrite(ws.slug, [p], actor);
    return this.getPage(ws, p, "edit");
  }

  deletePage(ws: { id: string; slug: string }, relPath: string, actor: string): { trashedTo: string } {
    const vaultDir = this.vaultDir(ws.slug);
    const p = safeRelPath(relPath);
    if (!exists(vaultDir, p)) throw notFound(`No page at ${p}`);
    const trashedTo = moveToTrash(vaultDir, p);
    this.afterWrite(ws.slug, [p], actor);
    return { trashedTo };
  }

  movePage(
    ws: { id: string; slug: string },
    relPath: string,
    newParent: string | null,
    actor: string,
  ): PagePayload {
    const vaultDir = this.vaultDir(ws.slug);
    const p = safeRelPath(relPath);
    const buf = readFileIfExists(vaultDir, p);
    if (!buf) throw notFound(`No page at ${p}`);
    let destDir = "";
    if (newParent) {
      destDir = this.normalizeParent(newParent).replace(/^Pages\/?/, "");
    }
    const dest = destDir ? `${PAGES_DIR}/${destDir}/${path.basename(p)}` : `${PAGES_DIR}/${path.basename(p)}`;
    if (dest !== p) {
      const finalDest = uniquePath(vaultDir, dest);
      mkdirSync(path.dirname(absPath(vaultDir, finalDest)), { recursive: true });
      renameSync(absPath(vaultDir, p), absPath(vaultDir, finalDest));
      // nested pages live in a directory named after the page: move it too
      const oldDir = p.replace(/\.md$/, "");
      const newDir = finalDest.replace(/\.md$/, "");
      if (exists(vaultDir, oldDir)) {
        renameSync(absPath(vaultDir, oldDir), absPath(vaultDir, newDir));
      }
      this.afterWrite(ws.slug, [p, finalDest], actor);
      return this.getPage(ws, finalDest, "edit");
    }
    return this.getPage(ws, p, "edit");
  }

  listPages(ws: { id: string }, parent?: string | null): FileMeta[] {
    let sql = `SELECT path FROM files WHERE workspace_id = ? AND kind = 'page'`;
    const args: any[] = [ws.id];
    if (parent !== undefined) {
      const norm = String(parent ?? "").replace(/\/$/, "");
      sql += ` AND (path LIKE ? ESCAPE '\\')`;
      const like = `${escapeLike(norm ? `${norm}/` : `${PAGES_DIR}/`)}%`;
      args.push(like);
    }
    sql += ` ORDER BY path`;
    return (this.db.prepare(sql).all(...args) as any[])
      .map((r) => this.indexRow(ws.id, r.path))
      .filter((m): m is FileMeta => m !== null);
  }

  /** Nested page + database tree (permission filtering is done by the caller). */
  tree(ws: { id: string; slug: string }): { pages: TreeNode[]; databases: DatabaseSummary[] } {
    const metas = this.listPages(ws).filter((m) => !m.archived);
    const pages = buildTree(metas);
    const databases = this.listDatabases(ws).map((d) => ({
      slug: d.slug,
      name: d.name,
      icon: d.icon ?? null,
      recordType: d.recordType,
      path: `${DATA_DIR}/${d.slug}`,
      rowCount: (
        this.db
          .prepare(
            `SELECT COUNT(*) AS n FROM files WHERE workspace_id = ? AND db_slug = ? AND archived = 0`,
          )
          .get(ws.id, d.slug) as any
      ).n,
    }));
    return { pages, databases };
  }

  // ---------- databases ----------

  private dbSchemaPath(slug: string): string {
    return `${CONCEPT_DIR}/databases/${slug}.json`;
  }

  listDatabases(ws: { id: string; slug: string }): DatabaseSchema[] {
    const vaultDir = this.vaultDir(ws.slug);
    const dir = absPath(vaultDir, `${CONCEPT_DIR}/databases`);
    if (!existsSync(dir)) return [];
    const out: DatabaseSchema[] = [];
    for (const f of readdirSafe(dir)) {
      if (!f.endsWith(".json")) continue;
      try {
        const parsed = JSON.parse(readFileSync(path.join(dir, f), "utf8")) as DatabaseSchema;
        // The slug becomes a directory name: it must be plain and match the file it came from.
        if (parsed && parsed.slug && DB_SLUG.test(parsed.slug) && f === `${parsed.slug}.json`) out.push(parsed);
      } catch {
        // Malformed schema file: skip rather than break the whole API.
      }
    }
    return out.sort((a, b) => (a.slug < b.slug ? -1 : 1));
  }

  getDatabase(ws: { id: string; slug: string }, dbSlug: string): DatabaseSchema {
    const schema = this.listDatabases(ws).find((d) => d.slug === dbSlug);
    if (!schema) throw notFound(`No database '${dbSlug}'`);
    return schema;
  }

  createDatabase(
    ws: { id: string; slug: string },
    input: {
      slug?: string;
      name?: string;
      icon?: string;
      recordType?: string;
      template?: string;
      properties?: DatabaseSchema["properties"];
      views?: DbView[];
    },
    actor: string,
  ): DatabaseSchema {
    let s: DatabaseSchema;
    if (input.template) {
      const t = templateSchema(input.template);
      if (!t) throw badRequest(`Unknown template '${input.template}'`, "unknown_template");
      s = structuredClone(t);
      if (input.name) s.name = input.name;
      if (input.slug) s.slug = input.slug;
    } else {
      const name = String(input.name ?? "").trim();
      if (!name) throw badRequest("name is required", "missing_name");
      const slug = slugifyDbSlug(input.slug || name);
      s = {
        slug,
        name,
        icon: input.icon,
        recordType: input.recordType || slug.replace(/s$/, "") || "record",
        properties: input.properties ?? [{ key: "title", name: "Name", type: "title" }],
        views: input.views ?? [{ id: "table", name: "Table", type: "table", filters: [], sorts: [] }],
      };
    }
    if (!s.slug || !/^[a-z0-9][a-z0-9-]{0,48}$/.test(s.slug)) {
      throw badRequest(`Invalid database slug '${s.slug}'`, "invalid_slug");
    }
    if (this.listDatabases(ws).some((d) => d.slug === s.slug)) {
      throw conflict(`Database '${s.slug}' already exists`);
    }
    if (!s.properties.some((p) => p.key === "title")) {
      s.properties = [{ key: "title", name: "Name", type: "title" }, ...s.properties];
    }
    const vaultDir = this.vaultDir(ws.slug);
    writeJson(absPath(vaultDir, this.dbSchemaPath(s.slug)), s);
    mkdirSync(absPath(vaultDir, `${DATA_DIR}/${s.slug}`), { recursive: true });
    this.afterWrite(ws.slug, [this.dbSchemaPath(s.slug)], actor);
    return s;
  }

  patchDatabase(
    ws: { id: string; slug: string },
    dbSlug: string,
    patch: Partial<Pick<DatabaseSchema, "name" | "icon" | "properties" | "views" | "recordType">>,
    actor: string,
  ): DatabaseSchema {
    const current = this.getDatabase(ws, dbSlug);
    const next: DatabaseSchema = {
      ...current,
      ...("name" in patch ? { name: String(patch.name ?? current.name) } : {}),
      ...("icon" in patch ? { icon: patch.icon } : {}),
      ...("recordType" in patch && patch.recordType ? { recordType: patch.recordType } : {}),
      ...(patch.properties ? { properties: patch.properties } : {}),
      ...(patch.views ? { views: patch.views } : {}),
    };
    const vaultDir = this.vaultDir(ws.slug);
    writeJson(absPath(vaultDir, this.dbSchemaPath(dbSlug)), next);
    this.afterWrite(ws.slug, [this.dbSchemaPath(dbSlug)], actor);
    return next;
  }

  deleteDatabase(ws: { id: string; slug: string }, dbSlug: string, actor: string): { trashedTo: string[] } {
    this.getDatabase(ws, dbSlug); // 404 if missing
    const vaultDir = this.vaultDir(ws.slug);
    const trashed: string[] = [moveToTrash(vaultDir, this.dbSchemaPath(dbSlug))];
    const dataDirRel = `${DATA_DIR}/${dbSlug}`;
    if (exists(vaultDir, dataDirRel)) {
      for (const rel of listAllFiles(absPath(vaultDir, dataDirRel))) {
        trashed.push(moveToTrash(vaultDir, `${dataDirRel}/${rel}`));
      }
      rmDirSafe(absPath(vaultDir, dataDirRel));
    }
    this.afterWrite(ws.slug, trashed, actor);
    return { trashedTo: trashed };
  }

  // ---------- rows ----------

  private rowPathById(ws: { id: string; slug: string }, dbSlug: string, id: string): string {
    const stem = safeRelPath(id).split("/").pop() as string;
    if (!stem || stem.startsWith(".")) throw badRequest(`Invalid row id '${id}'`, "invalid_row_id");
    if (!DB_SLUG.test(dbSlug)) throw badRequest(`Invalid database slug '${dbSlug}'`, "invalid_slug");
    const p = `${DATA_DIR}/${dbSlug}/${stem}.md`;
    if (!exists(this.vaultDir(ws.slug), p)) {
      throw notFound(`No row '${id}' in database '${dbSlug}'`);
    }
    return p;
  }

  listRows(
    ws: { id: string; slug: string },
    dbSlug: string,
    opts: {
      view?: string;
      filter?: string;
      sort?: string;
      q?: string;
      limit?: number;
      cursor?: number;
      archived?: boolean;
    },
  ): { rows: RowPayload[]; nextCursor: number | null; view: DbView | null; schema: DatabaseSchema } {
    const schema = this.getDatabase(ws, dbSlug);
    let view: DbView | null = null;
    if (opts.view) {
      view = schema.views.find((v) => v.id === opts.view) ?? null;
      if (!view) throw notFound(`No view '${opts.view}' in database '${dbSlug}'`);
    }

    const paths = (
      this.db
        .prepare(
          `SELECT path FROM files
           WHERE workspace_id = ? AND db_slug = ? AND archived = ?
           ORDER BY rank, path`,
        )
        .all(ws.id, dbSlug, opts.archived ? 1 : 0) as any[]
    ).map((r) => r.path);

    let metas = paths.map((p) => this.mustIndexRow(ws.id, p));

    const filterSets: { key: string; op: string; value?: unknown }[][] = [];
    if (view?.filters?.length) filterSets.push(view.filters);
    if (opts.filter) {
      try {
        const parsed = JSON.parse(opts.filter);
        if (Array.isArray(parsed)) filterSets.push(parsed);
        else throw new Error("not array");
      } catch {
        throw badRequest("filter must be a JSON array of {key,op,value}", "invalid_filter");
      }
    }
    for (const filters of filterSets) {
      metas = metas.filter((m) => filters.every((f) => matchFilter(m, f)));
    }
    if (opts.q) {
      const q = opts.q.toLowerCase();
      metas = metas.filter(
        (m) =>
          (m.title ?? "").toLowerCase().includes(q) ||
          JSON.stringify(m.properties).toLowerCase().includes(q),
      );
    }

    let sorts = view?.sorts ?? [];
    if (opts.sort) {
      try {
        sorts = JSON.parse(opts.sort);
      } catch {
        throw badRequest("sort must be a JSON array of {key,dir}", "invalid_sort");
      }
    }
    if (sorts.length) {
      const propVal = (m: FileMeta, key: string): unknown =>
        key === "title" ? m.title : key === "rank" ? m.rank : key === "status" ? m.status : m.properties[key];
      metas = [...metas].sort((a, b) => {
        for (const s of sorts) {
          const cmp = compareValues(propVal(a, s.key), propVal(b, s.key));
          if (cmp !== 0) return s.dir === "desc" ? -cmp : cmp;
        }
        return 0;
      });
    }

    const limit = Math.min(Math.max(opts.limit ?? 200, 1), 1000);
    const cursor = Math.max(opts.cursor ?? 0, 0);
    const page = metas.slice(cursor, cursor + limit);
    const nextCursor = cursor + limit < metas.length ? cursor + limit : null;
    return { rows: page.map(toRowPayload), nextCursor, view, schema };
  }

  createRow(
    ws: { id: string; slug: string },
    dbSlug: string,
    input: { properties: Props; body?: string },
    actor: string,
  ): RowPayload {
    const schema = this.getDatabase(ws, dbSlug);
    const vaultDir = this.vaultDir(ws.slug);
    const props = this.normalizeRowProps(schema, input.properties ?? {});
    const title = String(props.title ?? "Untitled");
    const status = props.status ? String(props.status) : null;
    if (status) props["rank"] = this.nextRankInColumn(ws, dbSlug, status);
    props["created"] = new Date().toISOString();
    const stem = `${slugifyTitle(title).replace(/\s+/g, "-")}-${randomBytes(3).toString("hex")}`;
    const relPath = uniquePath(vaultDir, `${DATA_DIR}/${dbSlug}/${stem}.md`);
    atomicWrite(vaultDir, relPath, renderDoc(props, input.body ?? ""));
    this.afterWrite(ws.slug, [relPath], actor);
    return toRowPayload(this.mustIndexRow(ws.id, relPath));
  }

  getRow(ws: { id: string; slug: string }, dbSlug: string, id: string): RowPayload & { body: string } {
    const p = this.rowPathById(ws, dbSlug, id);
    const meta = this.mustIndexRow(ws.id, p);
    const buf = readFileIfExists(this.vaultDir(ws.slug), p);
    const { body } = buf ? parseDoc(buf.toString("utf8")) : { body: "" };
    return { ...toRowPayload(meta), body };
  }

  updateRow(
    ws: { id: string; slug: string },
    dbSlug: string,
    id: string,
    input: { properties?: Props; body?: string },
    expectedHash: string | null,
    actor: string,
  ): RowPayload {
    const schema = this.getDatabase(ws, dbSlug);
    const p = this.rowPathById(ws, dbSlug, id);
    const vaultDir = this.vaultDir(ws.slug);
    const buf = readFileIfExists(vaultDir, p);
    if (!buf) throw notFound(`No row '${id}'`);
    const currentHash = sha256(buf);
    if (expectedHash && expectedHash !== currentHash) {
      throw conflict("The row was modified by someone else", {
        current: { id, path: p, contentHash: currentHash },
      });
    }
    const { props, body } = parseDoc(buf.toString("utf8"));
    let next = props;
    if (input.properties) {
      next = applyPropUpdates(next, this.normalizeRowProps(schema, input.properties, true));
      const newStatus = input.properties["status"];
      if (newStatus === null) {
        delete next["rank"];
      } else if (newStatus !== undefined && String(newStatus) !== String(props.status ?? "")) {
        next["rank"] = this.nextRankInColumn(ws, dbSlug, String(newStatus));
      }
    }
    next["updated"] = new Date().toISOString();
    const nextBody = input.body !== undefined ? input.body : body;
    atomicWrite(vaultDir, p, renderDoc(next, nextBody));
    this.afterWrite(ws.slug, [p], actor);
    return toRowPayload(this.mustIndexRow(ws.id, p));
  }

  deleteRow(ws: { id: string; slug: string }, dbSlug: string, id: string, actor: string): { trashedTo: string } {
    const p = this.rowPathById(ws, dbSlug, id);
    const trashedTo = moveToTrash(this.vaultDir(ws.slug), p);
    this.afterWrite(ws.slug, [p], actor);
    return { trashedTo };
  }

  moveRow(
    ws: { id: string; slug: string },
    dbSlug: string,
    id: string,
    input: { status: string; beforeId?: string | null; afterId?: string | null },
    actor: string,
  ): RowPayload {
    const schema = this.getDatabase(ws, dbSlug);
    const statusProp = schema.properties.find((pr) => pr.key === "status");
    if (!statusProp) throw badRequest(`Database '${dbSlug}' has no status property`, "no_status");
    if (input.status === undefined || input.status === null || String(input.status) === "") {
      throw badRequest("status is required for a board move", "missing_status");
    }
    const targetStatus = String(input.status);
    const p = this.rowPathById(ws, dbSlug, id);
    const vaultDir = this.vaultDir(ws.slug);
    const buf = readFileIfExists(vaultDir, p);
    if (!buf) throw notFound(`No row '${id}'`);
    const { props, body } = parseDoc(buf.toString("utf8"));

    const neighborRank = (rid: string | null | undefined): string | undefined => {
      if (!rid) return undefined;
      const m = this.mustIndexRow(ws.id, this.rowPathById(ws, dbSlug, String(rid)));
      return m.status === targetStatus ? (m.rank ?? undefined) : undefined;
    };
    let beforeRank = neighborRank(input.beforeId);
    let afterRank = neighborRank(input.afterId);
    if (beforeRank !== undefined && afterRank !== undefined && !(afterRank < beforeRank)) {
      throw badRequest("beforeId must come after afterId in the column", "invalid_move");
    }

    // If the column contains non-canonical ranks (e.g. written by other tools),
    // resequence it first so a fresh midpoint is guaranteed to exist.
    if (needsResequence(this.db, ws.id, dbSlug, targetStatus)) {
      this.resequenceColumn(ws, dbSlug, targetStatus);
      beforeRank = neighborRank(input.beforeId);
      afterRank = neighborRank(input.afterId);
    }

    const rank = moveRank(beforeRank, afterRank);
    const next = applyPropUpdates(props, { status: targetStatus, rank });
    next["updated"] = new Date().toISOString();
    atomicWrite(vaultDir, p, renderDoc(next, body));
    this.afterWrite(ws.slug, [p], actor);
    return toRowPayload(this.mustIndexRow(ws.id, p));
  }

  /** Assign fresh canonical ranks to every row in a column, preserving order. */
  resequenceColumn(ws: { id: string; slug: string }, dbSlug: string, status: string): void {
    const vaultDir = this.vaultDir(ws.slug);
    const paths = (
      this.db
        .prepare(
          `SELECT path FROM files WHERE workspace_id = ? AND db_slug = ? AND status = ? AND archived = 0 ORDER BY rank, path`,
        )
        .all(ws.id, dbSlug, status) as any[]
    ).map((r) => r.path);
    const ranks = resequenceRanks(paths.length);
    const changed: string[] = [];
    paths.forEach((p, i) => {
      const buf = readFileIfExists(vaultDir, p);
      if (!buf) return;
      const { props, body } = parseDoc(buf.toString("utf8"));
      const next = applyPropUpdates(props, { rank: ranks[i] });
      atomicWrite(vaultDir, p, renderDoc(next, body));
      changed.push(p);
    });
    if (changed.length) this.afterWrite(ws.slug, changed, "system:resequence");
  }

  private nextRankInColumn(ws: { id: string; slug: string }, dbSlug: string, status: string): string {
    const rows = this.db
      .prepare(
        `SELECT rank FROM files WHERE workspace_id = ? AND db_slug = ? AND status = ? AND archived = 0 ORDER BY rank DESC`,
      )
      .all(ws.id, dbSlug, status) as any[];
    return rankAfter(rows[0]?.rank as string | undefined);
  }

  /** Normalize incoming property values against the schema types. */
  private normalizeRowProps(schema: DatabaseSchema, props: Props, isUpdate = false): Props {
    const out: Props = {};
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined) continue;
      const def = schema.properties.find((p) => p.key === k);
      if (def?.type === "number") {
        out[k] = v === null || v === "" ? null : Number(v);
        if (Number.isNaN(out[k] as number)) out[k] = null;
      } else if (def?.type === "checkbox") {
        out[k] = v === true || v === "true" || v === 1;
      } else if ((def?.type === "multi_select" || (def?.type === "person" && Array.isArray(v)))) {
        out[k] = propToStringArray(v);
      } else {
        out[k] = v;
      }
    }
    if (!isUpdate) {
      if (!out["title"]) out["title"] = "Untitled";
      out["type"] = schema.recordType;
    }
    if (out["tags"] !== undefined && !Array.isArray(out["tags"])) {
      out["tags"] = propToStringArray(out["tags"]);
    }
    return out;
  }

  /** Notify listeners (SSE + git sync) that engine writes happened. */
  afterWrite(wsSlug: string, paths: string[], actor: string): void {
    this.onChange(wsSlug, paths, actor);
  }

  // ---------- vault (raw file) operations ----------

  vaultTree(ws: { id: string; slug: string }): VaultTreeNode[] {
    const vaultDir = this.vaultDir(ws.slug);
    const files = listAllFiles(vaultDir, { includeSystem: true });
    const root: VaultTreeNode = { name: "", path: "", type: "folder", children: [] };
    for (const f of files) {
      const parts = f.split("/");
      let node = root;
      for (let i = 0; i < parts.length; i++) {
        const isLeaf = i === parts.length - 1;
        const p = parts.slice(0, i + 1).join("/");
        if (isLeaf) {
          node.children.push({ name: parts[i], path: p, type: "file", children: [] });
        } else {
          let child = node.children.find((c) => c.type === "folder" && c.name === parts[i]);
          if (!child) {
            child = { name: parts[i], path: p, type: "folder", children: [] };
            node.children.push(child);
          }
          node = child;
        }
      }
    }
    const sortNode = (n: VaultTreeNode) => {
      n.children.sort((a, b) =>
        a.type === b.type ? (a.name < b.name ? -1 : 1) : a.type === "folder" ? -1 : 1,
      );
      n.children.forEach(sortNode);
    };
    sortNode(root);
    return root.children;
  }

  readVaultFile(
    ws: { id: string; slug: string },
    relPath: string,
  ): {
    path: string;
    content: string;
    contentHash: string;
    frontmatter: Props | null;
    size: number;
    updatedAt: number;
  } | null {
    const p = safeRelPath(relPath);
    const buf = readFileIfExists(this.vaultDir(ws.slug), p);
    if (!buf) return null;
    const text = buf.toString("utf8");
    let frontmatter: Props | null = null;
    if (p.toLowerCase().endsWith(".md")) {
      frontmatter = parseDoc(text).props;
    }
    return {
      path: p,
      content: text,
      contentHash: sha256(buf),
      frontmatter,
      size: buf.length,
      updatedAt: updatedAtOf(this.vaultDir(ws.slug), p),
    };
  }

  writeVaultFile(
    ws: { id: string; slug: string },
    relPath: string,
    content: string,
    expectedHash: string | null,
    actor: string,
  ): { path: string; contentHash: string } {
    const p = safeRelPath(relPath);
    const vaultDir = this.vaultDir(ws.slug);
    const managed =
      p === `${CONCEPT_DIR}/workspace.json` || p.startsWith(`${CONCEPT_DIR}/databases/`);
    if (isReservedTopLevel(p) && !managed) {
      throw badRequest(`Path is managed by the system: ${p}`, "reserved_path");
    }
    const buf = readFileIfExists(vaultDir, p);
    if (buf && expectedHash && expectedHash !== sha256(buf)) {
      throw conflict("The file was modified by someone else", {
        current: { path: p, contentHash: sha256(buf) },
      });
    }
    atomicWrite(vaultDir, p, content);
    this.afterWrite(ws.slug, [p], actor);
    return { path: p, contentHash: sha256(Buffer.from(content, "utf8")) };
  }

  deleteVaultFile(ws: { id: string; slug: string }, relPath: string, actor: string): { trashedTo: string } {
    const p = safeRelPath(relPath);
    if (isReservedTopLevel(p)) throw badRequest(`Path is managed by the system: ${p}`, "reserved_path");
    const trashedTo = moveToTrash(this.vaultDir(ws.slug), p);
    this.afterWrite(ws.slug, [p], actor);
    return { trashedTo };
  }

  moveVaultEntry(
    ws: { id: string; slug: string },
    from: string,
    to: string,
    actor: string,
  ): { from: string; to: string } {
    const vaultDir = this.vaultDir(ws.slug);
    const src = safeRelPath(from);
    const dst = safeRelPath(to);
    if (isReservedTopLevel(src) || isReservedTopLevel(dst)) {
      throw badRequest("Cannot move into or out of system directories", "reserved_path");
    }
    if (!exists(vaultDir, src)) throw notFound(`No such file: ${src}`);
    if (exists(vaultDir, dst)) throw conflict(`Destination already exists: ${dst}`);
    mkdirSync(path.dirname(absPath(vaultDir, dst)), { recursive: true });
    renameSync(absPath(vaultDir, src), absPath(vaultDir, dst));
    this.afterWrite(ws.slug, [src, dst], actor);
    return { from: src, to: dst };
  }

  // ---------- retex ----------

  retexSchema(ws: { id: string; slug: string }): Record<string, unknown> {
    const databases = this.listDatabases(ws);
    const recordTypes = databases.map((d) => {
      const statusProp = d.properties.find((p) => p.key === "status");
      return {
        type: d.recordType,
        database: d.slug,
        statuses: statusProp?.options?.map((o) => o.id) ?? [],
        properties: d.properties.map((p) => p.key),
      };
    });
    return {
      properties: [
        "title",
        "type",
        "status",
        "rank",
        "owner",
        "company",
        "value",
        "due",
        "next_action",
        "tags",
        "archived",
      ],
      recordTypes,
      boardLists: [
        ...new Set(
          databases.flatMap(
            (d) => d.properties.find((p) => p.key === "status")?.options?.map((o) => o.id) ?? [],
          ),
        ),
      ],
    };
  }

  /** Create the CRM starter databases (Companies, Contacts, Deals, Activities). */
  createCrmStarter(ws: { id: string; slug: string }, actor: string): DatabaseSchema[] {
    const created: DatabaseSchema[] = [];
    for (const t of CRM_STARTER) {
      try {
        created.push(this.createDatabase(ws, { template: t }, actor));
      } catch (e) {
        if (e instanceof conflict || (e as ApiErrorLike)?.code === "conflict") continue;
        throw e;
      }
    }
    return created;
  }
}

interface ApiErrorLike {
  code?: string;
}

// ---------- helpers ----------

export interface TreeNode {
  name: string;
  title?: string;
  path: string;
  type: "page";
  archived: boolean;
  children: TreeNode[];
}

export interface DatabaseSummary {
  slug: string;
  name: string;
  icon: string | null;
  recordType: string;
  path: string;
  rowCount: number;
}

export interface VaultTreeNode {
  name: string;
  path: string;
  type: "file" | "folder";
  children: VaultTreeNode[];
}

function parentOf(p: string): string | null {
  const dir = path.posix.dirname(p);
  if (dir === "." || dir === "/") return null;
  return dir;
}

function updatedAtOf(vaultDir: string, p: string): number {
  try {
    return Math.floor(statSync(absPath(vaultDir, p)).mtimeMs);
  } catch {
    return 0;
  }
}

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export function buildTree(metas: FileMeta[]): TreeNode[] {
  // Directories are implied by page paths (a parent page file is optional).
  const dirs = new Set<string>();
  for (const m of metas) {
    const rel = m.path.startsWith(`${PAGES_DIR}/`) ? m.path.slice(PAGES_DIR.length + 1) : m.path;
    const parts = rel.split("/");
    parts.pop(); // file name
    for (let i = 1; i <= parts.length; i++) {
      dirs.add(`${PAGES_DIR}/${parts.slice(0, i).join("/")}`);
    }
  }
  interface MutableNode {
    name: string;
    title?: string;
    path: string;
    isDir: boolean;
    children: MutableNode[];
  }
  const root: MutableNode = { name: PAGES_DIR, path: PAGES_DIR, isDir: true, children: [] };
  const ensureDir = (dirPath: string): MutableNode => {
    const parts = dirPath.split("/");
    let node = root;
    for (let i = 1; i < parts.length; i++) {
      const p = parts.slice(0, i + 1).join("/");
      let child = node.children.find((c) => c.isDir && c.path === p);
      if (!child) {
        child = { name: parts[i], path: p, isDir: true, children: [] };
        node.children.push(child);
      }
      node = child;
    }
    return node;
  };
  for (const d of [...dirs].sort()) ensureDir(d);
  for (const m of metas) {
    const dir = parentOf(m.path);
    const parent = dir && dir.startsWith(`${PAGES_DIR}`) && dirs.has(dir) ? ensureDir(dir) : root;
    parent.children.push({
      name: (m.path.split("/").pop() as string).replace(/\.md$/, ""),
      title: m.title ?? undefined,
      path: m.path,
      isDir: false,
      children: [],
    });
  }
  const convert = (n: MutableNode): TreeNode => ({
    name: n.name,
    title: n.title,
    path: n.path,
    type: "page" as const,
    archived: false,
    children: n.children
      .sort((a, b) => (a.isDir !== b.isDir ? (a.isDir ? -1 : 1) : a.name < b.name ? -1 : 1))
      .map(convert),
  });
  return root.children.map(convert);
}

function toRowPayload(m: FileMeta): RowPayload {
  return {
    id: path.posix.basename(m.path, ".md"),
    path: m.path,
    properties: m.properties,
    rank: m.rank,
    contentHash: m.contentHash,
    updatedAt: m.updatedAt,
    archived: m.archived,
  };
}

function compareValues(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (a === null || a === undefined) return -1;
  if (b === null || b === undefined) return 1;
  if (typeof a === "number" && typeof b === "number") return a < b ? -1 : a > b ? 1 : 0;
  const an = Number(a);
  const bn = Number(b);
  if (typeof a !== "boolean" && typeof b !== "boolean" && !Number.isNaN(an) && !Number.isNaN(bn)) {
    return an < bn ? -1 : an > bn ? 1 : 0;
  }
  const as = String(a);
  const bs = String(b);
  return as < bs ? -1 : as > bs ? 1 : 0;
}

function matchFilter(m: FileMeta, f: { key: string; op: string; value?: unknown }): boolean {
  const v =
    f.key === "title"
      ? m.title
      : f.key === "status"
        ? m.status
        : f.key === "tags"
          ? m.tags
          : m.properties[f.key];
  const target = f.value;
  const sv = v === null || v === undefined ? "" : Array.isArray(v) ? v.map(String).join("\u0000") : String(v);
  const st =
    target === null || target === undefined
      ? ""
      : Array.isArray(target)
        ? target.map(String).join("\u0000")
        : String(target);
  switch (f.op) {
    case "eq":
      return sv === st;
    case "neq":
      return sv !== st;
    case "contains":
      return Array.isArray(v) ? v.some((x) => String(x) === st) || sv.includes(st) : sv.includes(st);
    case "gt":
      return compareValues(v, target) > 0;
    case "lt":
      return compareValues(v, target) < 0;
    case "gte":
      return compareValues(v, target) >= 0;
    case "lte":
      return compareValues(v, target) <= 0;
    case "empty":
      return v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);
    case "notempty":
      return !(v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0));
    default:
      return false;
  }
}

function needsResequence(db: DB, wsId: string, dbSlug: string, status: string): boolean {
  const rows = db
    .prepare(
      `SELECT rank FROM files WHERE workspace_id = ? AND db_slug = ? AND status = ? AND archived = 0`,
    )
    .all(wsId, dbSlug, status) as any[];
  return rows.some((r) => r.rank === null || r.rank === "" || !isRank(r.rank));
}

function readdirSafe(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

function rmDirSafe(dir: string): void {
  try {
    rmdirSync(dir);
  } catch {
    // not empty or already gone
  }
}

function writeJson(file: string, data: unknown): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
}

export function slugifyDbSlug(input: string): string {
  return (
    String(input ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "db"
  );
}
