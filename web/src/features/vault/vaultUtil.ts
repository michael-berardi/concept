import type { VaultFile } from "@/api";

/** Flatten a nested vault tree into a list of files (path order). */
export function flattenVaultTree(tree: VaultFile[]): VaultFile[] {
  const out: VaultFile[] = [];
  const walk = (level: VaultFile[]) => {
    for (const f of level) {
      if (f.type === "dir") {
        out.push(f);
        if (f.children) walk(f.children);
      } else {
        out.push(f);
      }
    }
  };
  walk(tree);
  return out;
}

/** Frontmatter of a raw markdown file, as an ordered [key, value] list. */
export function parseFrontmatter(content: string): { fields: [string, string][]; bodyStart: number } {
  if (!content.startsWith("---")) return { fields: [], bodyStart: 0 };
  const end = content.indexOf("\n---", 3);
  if (end < 0) return { fields: [], bodyStart: 0 };
  const fm = content.slice(4, end);
  const fields: [string, string][] = [];
  for (const line of fm.split("\n")) {
    const idx = line.indexOf(":");
    if (idx > 0) fields.push([line.slice(0, idx).trim(), line.slice(idx + 1).trim().replace(/^"|"$/g, "")]);
  }
  return { fields, bodyStart: end + 4 };
}

/** Retex record badge: file name and record type from a vault path. */
export function recordBadge(path: string): string | null {
  const m = path.match(/^Data\/([^/]+)\//);
  return m ? m[1] : null;
}
