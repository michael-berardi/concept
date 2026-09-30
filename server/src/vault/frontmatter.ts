import { parse as yamlParse, stringify as yamlStringify } from "yaml";

export type Props = Record<string, unknown>;

export interface ParsedDoc {
  /** Frontmatter properties. Ordering is preserved from the file. */
  props: Props;
  /** Markdown body without the frontmatter block (no leading newline). */
  body: string;
  /** Raw frontmatter text between the --- fences, or null if absent. */
  rawFrontmatter: string | null;
}

const FENCE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/** Parse a Markdown file with optional YAML frontmatter. */
export function parseDoc(raw: string): ParsedDoc {
  const m = FENCE.exec(raw);
  if (!m) return { props: {}, body: raw, rawFrontmatter: null };
  let props: Props = {};
  try {
    const parsed = yamlParse(m[1]);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      props = parsed as Props;
    }
  } catch {
    // Malformed frontmatter: keep raw text, empty props (no silent data loss).
    props = {};
  }
  // Strip the single newline renderDoc adds between the fence and the body.
  let body = raw.slice(m[0].length);
  if (body.startsWith("\n")) body = body.slice(1);
  return { props, body, rawFrontmatter: m[1] };
}

/** Serialize properties + body back to a Markdown file. */
export function renderDoc(props: Props, body: string): string {
  const keys = Object.keys(props);
  const fm = keys.length > 0 ? yamlStringify(props).trimEnd() : "";
  if (!fm) return body;
  const bodyPart = body === "" ? "" : body.startsWith("\n") ? body : `\n${body}`;
  return `---\n${fm}\n---\n${bodyPart}`;
}

/**
 * Return a copy of `props` with `updates` applied, preserving the original
 * key order and all unknown keys. Setting an existing key keeps its position;
 * new keys are appended in the given order. Keys set to null/undefined are removed.
 */
export function applyPropUpdates(props: Props, updates: Props): Props {
  const out: Props = { ...props };
  for (const [k, v] of Object.entries(updates)) {
    if (v === null || v === undefined) delete out[k];
    else out[k] = v;
  }
  return out;
}

/** Coerce frontmatter scalar to string for comparison/indexing. */
export function propToString(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (Array.isArray(v)) return v.map(propToString).join(", ");
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

export function propToStringArray(v: unknown): string[] {
  if (v === null || v === undefined) return [];
  if (Array.isArray(v)) return v.map(propToString).filter((s) => s !== "");
  const s = propToString(v);
  return s === "" ? [] : [s];
}
