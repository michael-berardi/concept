import {
  existsSync,
  realpathSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import path from "node:path";
import { badRequest, forbidden, notFound } from "../errors.js";

export const RESERVED_DIRS = new Set([".concept", ".trash", ".retex", ".git", ".obsidian"]);
export const ATTACHMENTS_DIR = "Attachments";
export const PAGES_DIR = "Pages";
export const DATA_DIR = "Data";
export const CONCEPT_DIR = ".concept";

export function isReservedTopLevel(relPath: string): boolean {
  const top = relPath.split("/")[0];
  return RESERVED_DIRS.has(top);
}

/** Normalize and safety-check a vault-relative path. Returns POSIX-style path. */
export function safeRelPath(input: string): string {
  const cleaned = String(input ?? "")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/\/+/g, "/")
    .replace(/\/$/, "");
  if (cleaned === "" || cleaned === ".") throw badRequest("Empty path", "invalid_path");
  for (const seg of cleaned.split("/")) {
    if (seg === "." || seg === "..") throw badRequest(`Path must not contain '.' or '..': ${input}`, "invalid_path");
    if (seg.includes("\0")) throw badRequest("Path contains NUL byte", "invalid_path");
  }
  return cleaned;
}

export function isMarkdown(relPath: string): boolean {
  return relPath.toLowerCase().endsWith(".md");
}

/**
 * Absolute path of a vault-relative path, confined to the vault: the deepest
 * existing ancestor is resolved with realpath, so a symlink inside the vault
 * can never lead a read or write outside it.
 */
export function absPath(vaultDir: string, relPath: string): string {
  const abs = path.join(vaultDir, ...relPath.split("/"));
  let root: string;
  try {
    root = realpathSync(vaultDir);
  } catch {
    return abs;
  }
  let probe = abs;
  for (;;) {
    try {
      const real = realpathSync(probe);
      if (real !== root && !real.startsWith(root + path.sep)) {
        throw forbidden(`Path escapes the vault: ${relPath}`, "path_escape");
      }
      return abs;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT" || (err as NodeJS.ErrnoException).code === "ENOTDIR") {
        const parent = path.dirname(probe);
        if (parent === probe) return abs;
        probe = parent;
        continue;
      }
      throw err;
    }
  }
}

/**
 * Policy for paths reachable through the HTTP API: never `.git`, `.trash`,
 * `.retex` or `.obsidian`; the only dot-directory content is the database
 * schemas in `.concept/databases/`. `write` additionally protects the
 * workspace identity file.
 */
export function assertApiPath(relPath: string, write = false): void {
  const segs = relPath.split("/");
  if (segs[0] === CONCEPT_DIR) {
    const ok = segs[1] === "databases" && segs.length === 3 && segs[2].endsWith(".json") && !segs[2].startsWith(".");
    if (!ok) throw badRequest(`Reserved path: ${relPath}`, "reserved_path");
    return;
  }
  for (const s of segs) {
    if (s.startsWith(".")) throw badRequest(`Reserved path: ${relPath}`, "reserved_path");
  }
  void write;
}

/** Pages and rows are Markdown files under Pages/ or Data/. */
export function assertContentPath(relPath: string): void {
  assertApiPath(relPath);
  const top = relPath.split("/")[0];
  if ((top !== PAGES_DIR && top !== DATA_DIR) || !isMarkdown(relPath)) {
    throw badRequest(`Not a page path (expected Pages/… or Data/… ending in .md): ${relPath}`, "invalid_path");
  }
}

export function readFileIfExists(vaultDir: string, relPath: string): Buffer | null {
  const p = absPath(vaultDir, relPath);
  if (!existsSync(p)) return null;
  const st = statSync(p);
  if (!st.isFile()) return null;
  return readFileSync(p);
}

export function sha256(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

/** Atomic write: temp file in the same directory, then rename. */
export function atomicWrite(vaultDir: string, relPath: string, data: Buffer | string): void {
  const abs = absPath(vaultDir, relPath);
  mkdirSync(path.dirname(abs), { recursive: true });
  const tmp = path.join(path.dirname(abs), `.${path.basename(abs)}.${randomBytes(4).toString("hex")}.tmp`);
  writeFileSync(tmp, data);
  renameSync(tmp, abs);
}

/** Move a file into <vault>/.trash/ with a timestamp prefix. Returns new rel path. */
export function moveToTrash(vaultDir: string, relPath: string): string {
  const abs = absPath(vaultDir, relPath);
  if (!existsSync(abs)) throw notFound(`No such file: ${relPath}`);
  const trashDir = path.join(vaultDir, ".trash");
  mkdirSync(trashDir, { recursive: true });
  const base = path.basename(relPath);
  const name = `${Date.now()}-${base}`;
  let dest = path.join(trashDir, name);
  let n = 1;
  while (existsSync(dest)) dest = path.join(trashDir, `${Date.now()}-${n++}-${base}`);
  renameSync(abs, dest);
  return `.trash/${path.basename(dest)}`;
}

export function deleteFile(vaultDir: string, relPath: string): void {
  const abs = absPath(vaultDir, relPath);
  if (!existsSync(abs)) throw notFound(`No such file: ${relPath}`);
  rmSync(abs);
}

export function exists(vaultDir: string, relPath: string): boolean {
  return existsSync(absPath(vaultDir, relPath));
}

/**
 * Turn a title into a filesystem-friendly file stem.
 * Keeps unicode letters, strips path/hostile characters.
 */
export function slugifyTitle(title: string): string {
  const s = String(title ?? "")
    .replace(/[\u0000-\u001f<>:"/\\|?*#^\[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const stem = s === "" ? "Untitled" : s.slice(0, 80).trim();
  return stem.replace(/[. ]+$/, "") || "Untitled";
}

/** Find a unique file path for a desired path (appends -2, -3, ...). */
export function uniquePath(vaultDir: string, desired: string): string {
  if (!exists(vaultDir, desired)) return desired;
  const dir = path.posix.dirname(desired);
  const ext = path.posix.extname(desired);
  const stem = path.posix.basename(desired, ext);
  for (let i = 2; i < 10_000; i++) {
    const candidate = dir === "." ? `${stem}-${i}${ext}` : `${dir}/${stem}-${i}${ext}`;
    if (!exists(vaultDir, candidate)) return candidate;
  }
  throw badRequest("Could not find a unique file name", "name_conflict");
}

export function listAllFiles(
  vaultDir: string,
  opts?: { includeTrash?: boolean; includeSystem?: boolean },
): string[] {
  const out: string[] = [];
  const walk = (rel: string) => {
    const abs = path.join(vaultDir, ...rel.split("/").filter(Boolean));
    let dirents: import("node:fs").Dirent[];
    try {
      dirents = readdirSorted(abs);
    } catch {
      return;
    }
    for (const e of dirents) {
      const child = rel === "" ? e.name : `${rel}/${e.name}`;
      if (e.isDirectory()) {
        if (e.name === ".git") continue;
        if (e.name === ".trash" && !opts?.includeTrash) continue;
        if (RESERVED_DIRS.has(e.name) && !opts?.includeSystem) continue;
        walk(child);
      } else if (e.isFile()) {
        out.push(child);
      }
    }
  };
  walk("");
  return out.sort();
}

function readdirSorted(abs: string): import("node:fs").Dirent[] {
  return readdirSync(abs, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1));
}
