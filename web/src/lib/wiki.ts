/** Wiki-link and heading utilities shared by vault mode, graph, and editor. */

export interface WikiLink {
  target: string;
  text: string;
  start: number;
  end: number;
}

/** All [[wiki links]] in a markdown body, in order. */
export function parseWikiLinks(body: string): WikiLink[] {
  const out: WikiLink[] = [];
  const re = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
  for (const m of body.matchAll(re)) {
    out.push({
      target: m[1].trim(),
      text: (m[2] ?? m[1]).trim(),
      start: m.index ?? 0,
      end: (m.index ?? 0) + m[0].length,
    });
  }
  return out;
}

export interface Heading {
  level: number;
  text: string;
  line: number;
}

/** Heading outline of a markdown body (skips fenced code). */
export function outline(body: string): Heading[] {
  const out: Heading[] = [];
  let inFence = false;
  let fence = "";
  body.split("\n").forEach((line, idx) => {
    const f = line.match(/^\s*(`{3,}|~{3,})/);
    if (f) {
      if (!inFence) {
        inFence = true;
        fence = f[1][0];
      } else if (f[1][0] === fence) {
        inFence = false;
      }
      return;
    }
    if (inFence) return;
    const h = line.match(/^(#{1,6})\s+(.+?)\s*$/);
    if (h) out.push({ level: h[1].length, text: h[2], line: idx });
  });
  return out;
}

/** Extract tags (#tag and frontmatter tags are handled by the server; here: inline tags). */
export function inlineTags(body: string): string[] {
  const out = new Set<string>();
  for (const m of body.matchAll(/(?:^|\s)#([\w][\w-]*)/g)) out.add(m[1]);
  return [...out];
}

/** Uniquify a title for a new file name. */
export function safeFileName(title: string): string {
  return title.replace(/[/\\:]/g, "-").trim() || "untitled";
}
