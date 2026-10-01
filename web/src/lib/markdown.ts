/**
 * Markdown <-> Tiptap doc JSON serializer.
 * Pure functions on plain JSON (no DOM), so it is unit-testable in node and
 * shared by the block editor, vault source sync, and card bodies.
 *
 * Supported blocks: heading, paragraph, bulletList, orderedList, taskList,
 * blockquote, codeBlock, horizontalRule, image, table (GFM).
 * Inline: bold, italic, strike, code, link, image, hardBreak.
 * `[[wiki links]]` are plain text (round-trip safe).
 */

export type Mark =
  | { type: "bold" }
  | { type: "italic" }
  | { type: "strike" }
  | { type: "code" }
  | { type: "link"; attrs: { href: string; target?: string | null } };

export interface InlineNode {
  type: "text" | "hardBreak" | "image";
  text?: string;
  marks?: Mark[];
  attrs?: { src?: string; alt?: string | null; title?: string | null };
}

export interface BlockNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: (BlockNode | InlineNode)[];
  text?: string;
  marks?: Mark[];
}

export interface Doc { type: "doc"; content: BlockNode[] }

export const emptyDoc = (): Doc => ({ type: "doc", content: [] });

/* ------------------------------------------------------------------ */
/* doc -> markdown                                                     */
/* ------------------------------------------------------------------ */

function escapeAlt(s: string): string {
  return s.replace(/([\\[\]()])/g, "\\$1");
}

function inlineToMd(nodes: (InlineNode | BlockNode)[] | undefined): string {
  if (!nodes) return "";
  let out = "";
  for (const n of nodes as InlineNode[]) {
    if (n.type === "hardBreak") {
      out += "\n";
      continue;
    }
    if (n.type === "image") {
      out += `![${escapeAlt(n.attrs?.alt ?? "")}](${n.attrs?.src ?? ""})`;
      continue;
    }
    let text = n.text ?? "";
    if (n.marks?.some((m) => m.type === "code")) {
      const ticks = text.includes("`") ? "``" : "`";
      out += ticks + text + ticks;
      continue;
    }
    if (!(n.marks ?? []).some((m) => m.type === "link")) {
      text = escapeText(text);
    } else {
      text = text.replace(/([\\`])/g, "\\$1");
    }
    for (const m of n.marks ?? []) {
      if (m.type === "bold") text = `**${text}**`;
      else if (m.type === "italic") text = `*${text}*`;
      else if (m.type === "strike") text = `~~${text}~~`;
      else if (m.type === "link") text = `[${text}](${m.attrs.href})`;
    }
    out += text;
  }
  return out;
}

/** Escape characters that would otherwise parse as markup. */
function escapeText(s: string): string {
  // [[wiki links]] are kept verbatim so `[[my_page]]` stays a valid link target.
  return s
    .split(/(\[\[[^\]]*\]\])/)
    .map((part, i) => (i % 2 === 1 ? part : part.replace(/[\\`*_~]/g, (c) => "\\" + c)))
    .join("");
}

function blockToMd(node: BlockNode, indent: string, orderedDepth: number): string {
  const pad = indent;
  switch (node.type) {
    case "heading": {
      const level = Number(node.attrs?.level ?? 1);
      return `${"#".repeat(level)} ${inlineToMd(node.content as InlineNode[])}`;
    }
    case "paragraph":
      return inlineToMd(node.content as InlineNode[]);
    case "codeBlock": {
      const lang = String(node.attrs?.language ?? "");
      const code = (node.content as InlineNode[] | undefined)?.map((n) => n.text ?? "").join("") ?? "";
      const longest = Math.max(0, ...(code.match(/^\s*`{3,}/gm) ?? []).map((m) => m.trim().length));
      const fence = "`".repeat(Math.max(3, longest + 1));
      return fence + lang + "\n" + code + (code.endsWith("\n") || code === "" ? "" : "\n") + fence;
    }
    case "blockquote": {
      const inner = (node.content as BlockNode[]).map((b) => blockToMd(b, "", 0)).join("\n\n");
      return inner.split("\n").map((l) => (l === "" ? ">" : "> " + l)).join("\n");
    }
    case "horizontalRule":
      return "---";
    case "bulletList":
      return (node.content as BlockNode[])
        .map((li) => liToMd(li, pad + "- ", indent + "  ", orderedDepth))
        .join("\n");
    case "orderedList":
      return (node.content as BlockNode[])
        .map((li, i) => liToMd(li, pad + `${i + 1}. `, indent + "   ", orderedDepth))
        .join("\n");
    case "taskList":
      return (node.content as BlockNode[])
        .map((li) => {
          const check = li.attrs?.checked ? "[x]" : "[ ]";
          return liToMd(li, pad + `- ${check} `, indent + "  ", orderedDepth);
        })
        .join("\n");
    case "image":
      return `![${escapeAlt(String(node.attrs?.alt ?? ""))}](${node.attrs?.src ?? ""})`;
    case "table": {
      const rows = node.content as BlockNode[];
      const lines: string[] = [];
      const cellText = (cell: BlockNode): string =>
        (cell.content as BlockNode[] | undefined)
          ?.map((p) => inlineToMd((p.content as InlineNode[] | undefined)?.filter((x) => x.type !== "hardBreak")))
          .join(" ")
          .replace(/\|/g, "\\|")
          .replace(/\n/g, " ") ?? "";
      rows.forEach((row, ri) => {
        const cells = (row.content as BlockNode[]).map(cellText);
        lines.push("| " + cells.join(" | ") + " |");
        if (ri === 0) lines.push("|" + cells.map(() => " --- ").join("|") + "|");
      });
      return lines.join("\n");
    }
    default:
      return inlineToMd(node.content as InlineNode[]);
  }
}

function liToMd(li: BlockNode, marker: string, childIndent: string, orderedDepth: number): string {
  void childIndent;
  void orderedDepth;
  const blocks = (li.content as BlockNode[]) ?? [];
  const first = blocks[0];
  const rest = blocks.slice(1);
  let line = marker + (first ? blockToMd(first, "", 0) : "");
  for (const b of rest) {
    line += "\n" + blockToMd(b, childIndent, 0);
  }
  return line;
}

export function docToMd(doc: Doc): string {
  if (!doc || doc.type !== "doc") throw new Error("doc_expected: docToMd requires a {type:'doc'} node");
  return (doc.content ?? [])
    .map((b) => blockToMd(b as BlockNode, "", 0))
    .join("\n\n");
}

/* ------------------------------------------------------------------ */
/* markdown -> doc                                                     */
/* ------------------------------------------------------------------ */

function text(text: string, marks: Mark[] = []): InlineNode {
  return { type: "text", text, marks };
}

export function parseInline(src: string): InlineNode[] {
  const out: InlineNode[] = [];
  let i = 0;
  let plain = "";
  const flush = () => {
    if (plain) {
      out.push(text(plain));
      plain = "";
    }
  };
  while (i < src.length) {
    const rest = src.slice(i);
    // hard break: backslash-newline or two-space newline
    const hb = rest.match(/^(?:\\|  )\n/);
    if (hb) {
      flush();
      out.push({ type: "hardBreak" });
      i += hb[0].length;
      continue;
    }
    if (src[i] === "\\" && i + 1 < src.length && "\\`*_{}[]()#+-.!~".includes(src[i + 1])) {
      plain += src[i + 1];
      i += 2;
      continue;
    }
    if (src[i] === "\n") {
      flush();
      out.push({ type: "hardBreak" });
      i += 1;
      continue;
    }
    // inline code
    const code = rest.match(/^(`+)([\s\S]*?)\1/);
    if (code && code[2] !== undefined) {
      flush();
      out.push(text(code[2].replace(/^ | $/g, ""), [{ type: "code" }]));
      i += code[0].length;
      continue;
    }
    // image ![alt](src "title")
    const img = rest.match(/^!\[([^\]]*)\]\(\s*([^\s)]+)(?:\s+"([^"]*)")?\s*\)/);
    if (img) {
      flush();
      out.push({ type: "image", attrs: { src: img[2], alt: img[1] || null, title: img[3] || null } });
      i += img[0].length;
      continue;
    }
    // link [text](href)
    const link = rest.match(/^\[((?:[^\[\]]|\[[^\]]*\])*)\]\(\s*([^\s)]+)(?:\s+"([^"]*)")?\s*\)/);
    if (link) {
      flush();
      const inner = parseInline(link[1]).filter((n) => n.type === "text");
      const href = link[2];
      for (const n of inner) {
        out.push({ ...n, marks: [...(n.marks ?? []), { type: "link", attrs: { href, target: "_blank" } }] });
      }
      i += link[0].length;
      continue;
    }
    // bold+italic, bold, italic, strike
    if (rest.startsWith("***")) {
      flush();
      const close = findDelim(src, i + 3, "***");
      if (close > 0) {
        const inner = parseInline(src.slice(i + 3, close));
        pushMarked(out, inner, [{ type: "bold" }, { type: "italic" }]);
        i = close + 3;
        continue;
      }
    }
    if (rest.startsWith("**")) {
      flush();
      const close = findDelim(src, i + 2, "**");
      if (close > 0) {
        pushMarked(out, parseInline(src.slice(i + 2, close)), [{ type: "bold" }]);
        i = close + 2;
        continue;
      }
    }
    if (rest.startsWith("~~")) {
      flush();
      const close = src.indexOf("~~", i + 2);
      if (close > 0) {
        pushMarked(out, parseInline(src.slice(i + 2, close)), [{ type: "strike" }]);
        i = close + 2;
        continue;
      }
    }
    if (src[i] === "*") {
      flush();
      const close = findDelim(src, i + 1, "*");
      if (close > 0) {
        pushMarked(out, parseInline(src.slice(i + 1, close)), [{ type: "italic" }]);
        i = close + 1;
        continue;
      }
    }
    if (src[i] === "_") {
      // intraword underscores are literal
      const prevChar = src[i - 1];
      const literal = prevChar && /\w/.test(prevChar);
      const close = literal ? -1 : findDelim(src, i + 1, "_");
      if (!literal && close > 0) {
        flush();
        pushMarked(out, parseInline(src.slice(i + 1, close)), [{ type: "italic" }]);
        i = close + 1;
        continue;
      }
    }
    plain += src[i];
    i += 1;
  }
  flush();
  return mergeAdjacent(out);
}

/** Merge neighbouring text nodes carrying identical marks (tiptap-friendly). */
function mergeAdjacent(nodes: InlineNode[]): InlineNode[] {
  const out: InlineNode[] = [];
  for (const n of nodes) {
    const prev = out[out.length - 1];
    const key = (m: Mark[]) => JSON.stringify(m);
    if (prev && n.type === "text" && prev.type === "text" && key(prev.marks ?? []) === key(n.marks ?? [])) {
      prev.text = (prev.text ?? "") + (n.text ?? "");
    } else {
      out.push(n);
    }
  }
  return out;
}

function pushMarked(out: InlineNode[], inner: InlineNode[], marks: Mark[]): void {
  for (const n of inner) {
    if (n.type === "text") out.push({ ...n, marks: [...(n.marks ?? []), ...marks] });
    else out.push(n);
  }
}

function findDelim(src: string, from: number, delim: string): number {
  let j = from;
  while (true) {
    const k = src.indexOf(delim, j);
    if (k < 0) return -1;
    if (src[k - 1] !== "\\") return k;
    j = k + 1;
  }
}

const headingRe = /^(#{1,6})\s+(.*)$/;
const ulRe = /^(\s*)[-*+]\s+(.*)$/;
const olRe = /^(\s*)(\d{1,9})[.)]\s+(.*)$/;
const taskRe = /^(\s*)[-*+]\s+\[([ xX])\]\s+(.*)$/;
const quoteRe = /^\s*>\s?(.*)$/;
const fenceRe = /^(\s*)(`{3,}|~{3,})\s*(\S*)\s*$/;
const hrRe = /^\s{0,3}((?:-\s*){3,}|(?:\*\s*){3,}|(?:_\s*){3,})$/;
const imgOnlyRe = /^!\[([^\]]*)\]\(\s*([^\s)]+)(?:\s+"([^"]*)")?\s*\)$/;

type Line = { indent: number; text: string; raw: string };

export function mdToDoc(md: string): Doc {
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  const blocks: BlockNode[] = [];
  let i = 0;
  const lineOf = (idx: number): Line => {
    const raw = lines[idx] ?? "";
    return { raw, indent: raw.match(/^\s*/)![0].replace(/\t/g, "  ").length, text: raw.trim() };
  };

  while (i < lines.length) {
    const l = lineOf(i);
    if (l.text === "") {
      i++;
      continue;
    }
    // fenced code
    const fence = l.raw.match(fenceRe);
    if (fence) {
      // A fence closes only on the same character, at least as long, with nothing after it.
      const close = new RegExp("^" + (fence[2][0] === "`" ? "`" : "~") + "{" + fence[2].length + ",}\\s*$");
      const body: string[] = [];
      i++;
      while (i < lines.length && !close.test(lines[i].trimStart())) {
        body.push(lines[i]);
        i++;
      }
      i++; // closing fence
      blocks.push({
        type: "codeBlock",
        attrs: { language: fence[3] || null },
        content: [text(body.join("\n"))],
      });
      continue;
    }
    // heading
    const h = l.text.match(headingRe);
    if (h) {
      blocks.push({ type: "heading", attrs: { level: h[1].length, textAlign: null }, content: parseInline(h[2]) });
      i++;
      continue;
    }
    // hr
    if (hrRe.test(l.text)) {
      blocks.push({ type: "horizontalRule" });
      i++;
      continue;
    }
    // table
    if (l.text.startsWith("|") && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[i + 1]) && lines[i + 1].includes("-")) {
      const parseRow = (row: string): string[] => {
        // Pipes inside [[Target|Alias]] belong to the link, not the table.
        const guarded = row.trim().replace(/\[\[[^\]]*\]\]/g, (m) => m.replace(/\|/g, "\u0001"));
        const cells = guarded.replace(/^\|/, "").replace(/\|$/, "").split(/(?<!\\)\|/);
        return cells.map((c) => c.trim().replace(/\u0001/g, "|").replace(/\\\|/g, "|"));
      };
      const header = parseRow(l.text);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && (lines[i].trim().startsWith("|") || (lines[i].trim() !== "" && lines[i].includes("|")))) {
        if (lines[i].trim() === "") break;
        rows.push(parseRow(lines[i].trim()));
        i++;
      }
      const cellNode = (s: string): BlockNode => ({
        type: "tableCell" as string,
        attrs: { colspan: 1, rowspan: 1, colwidth: null },
        content: s === "" ? [] : [{ type: "paragraph", content: parseInline(s) }],
      });
      blocks.push({
        type: "table",
        content: [
          {
            type: "tableRow",
            content: header.map((c) => ({
              type: "tableHeader" as string,
              attrs: { colspan: 1, rowspan: 1, colwidth: null },
              content: c === "" ? [] : [{ type: "paragraph", content: parseInline(c) }],
            })),
          },
          ...rows.map((r) => ({
            type: "tableRow",
            content: r.map(cellNode),
          })),
        ],
      });
      continue;
    }
    // blockquote (single level, may contain several lines)
    if (quoteRe.test(l.raw)) {
      const inner: string[] = [];
      while (i < lines.length) {
        const q = (lines[i] ?? "").match(quoteRe);
        if (!q) break;
        inner.push(q[1]);
        i++;
      }
      const sub = mdToDoc(inner.join("\n"));
      blocks.push({ type: "blockquote", content: sub.content });
      continue;
    }
    // lists (task bullets first)
    const task = l.raw.match(taskRe);
    if (task) {
      const baseIndent = l.indent;
      const items: { checked: boolean; content: string[]; nested: string[] }[] = [];
      while (i < lines.length) {
        const cur = lineOf(i);
        const t = cur.raw.match(taskRe);
        if (t && cur.indent <= baseIndent + 1) {
          items.push({ checked: t[2].toLowerCase() === "x", content: [t[3]], nested: [] });
          i++;
        } else if (cur.text !== "" && cur.indent > baseIndent + 1) {
          const rel = cur.raw.slice(Math.min(baseIndent + 2, cur.indent));
          const it = items[items.length - 1];
          // Indented list markers start a nested list; other indented text continues the item.
          if (it.nested.length > 0 || /^\s*([-*+]|\d+[.)])\s/.test(rel)) it.nested.push(rel);
          else it.content.push(rel);
          i++;
        } else if (cur.text !== "" && cur.indent === baseIndent && !/^\s*([-*+]|\d+[.)])\s/.test(cur.raw)) {
          // lazy continuation
          items[items.length - 1].content.push(cur.raw.trim());
          i++;
        } else break;
      }
      blocks.push({
        type: "taskList",
        content: items.map((it) => ({
          type: "taskItem",
          attrs: { checked: it.checked },
          content: [
            { type: "paragraph", content: parseInline(it.content.join(" ")) },
            ...(it.nested.length ? (mdToDoc(it.nested.join("\n")).content as BlockNode[]) : []),
          ],
        })),
      });
      continue;
    }
    const ul = l.raw.match(ulRe);
    if (ul) {
      const baseIndent = l.indent;
      const items: string[][] = [];
      while (i < lines.length) {
        const cur = lineOf(i);
        const m = cur.raw.match(ulRe);
        const isTask = cur.raw.match(taskRe);
        if (m && !isTask && cur.indent <= baseIndent + 1) {
          items.push([m[2]]);
          i++;
        } else if (cur.text !== "" && cur.indent > baseIndent + 1) {
          items[items.length - 1].push(cur.raw.slice(Math.min(baseIndent + 2, cur.indent)));
          i++;
        } else if (cur.text !== "" && cur.indent === baseIndent && !/^\s*([-*+]|\d+[.)])\s/.test(cur.raw)) {
          items[items.length - 1].push(cur.raw.trim());
          i++;
        } else break;
      }
      blocks.push({
        type: "bulletList",
        content: items.map((it) => listItemNode(it)),
      });
      continue;
    }
    const ol = l.raw.match(olRe);
    if (ol) {
      const baseIndent = l.indent;
      const items: string[][] = [];
      while (i < lines.length) {
        const cur = lineOf(i);
        const m = cur.raw.match(olRe);
        if (m && cur.indent <= baseIndent + 1) {
          items.push([m[3]]);
          i++;
        } else if (cur.text !== "" && cur.indent > baseIndent + 1) {
          items[items.length - 1].push(cur.raw.slice(Math.min(baseIndent + 3, cur.indent)));
          i++;
        } else if (cur.text !== "" && cur.indent === baseIndent && !/^\s*([-*+]|\d+[.)])\s/.test(cur.raw)) {
          items[items.length - 1].push(cur.raw.trim());
          i++;
        } else break;
      }
      blocks.push({
        type: "orderedList",
        content: items.map((it) => listItemNode(it)),
      });
      continue;
    }
    // standalone image line
    const img = l.text.match(imgOnlyRe);
    if (img) {
      blocks.push({ type: "image", attrs: { src: img[2], alt: img[1] || null, title: img[3] || null } });
      i++;
      continue;
    }
    // paragraph: gather until blank line or block starter
    const para: string[] = [l.raw.trim()];
    i++;
    while (i < lines.length) {
      const cur = lineOf(i);
      const tableStart =
        cur.text.startsWith("|") &&
        i + 1 < lines.length &&
        /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[i + 1]) &&
        lines[i + 1].includes("-");
      if (
        cur.text === "" ||
        headingRe.test(cur.text) ||
        fenceRe.test(cur.raw) ||
        quoteRe.test(cur.raw) ||
        hrRe.test(cur.text) ||
        /^=+\s*$/.test(cur.text) ||
        ulRe.test(cur.raw) ||
        olRe.test(cur.raw) ||
        tableStart ||
        imgOnlyRe.test(cur.text)
      ) {
        break;
      }
      para.push(cur.raw.trim());
      i++;
    }
    // Setext heading: a single paragraph line underlined with "="s.
    if (para.length === 1 && i < lines.length && /^=+\s*$/.test(lines[i])) {
      blocks.push({ type: "heading", attrs: { level: 1, textAlign: null }, content: parseInline(para[0]) });
      i++;
      continue;
    }
    blocks.push({ type: "paragraph", content: parseInline(para.join("\n")) });
  }
  return { type: "doc", content: blocks };
}

function listItemNode(parts: string[]): BlockNode {
  return {
    type: "listItem",
    content: [{ type: "paragraph", content: parseInline(parts.join(" ")) }],
  };
}

/* ------------------------------------------------------------------ */

export function mdToDocSafe(md: string): Doc {
  try {
    return mdToDoc(md);
  } catch {
    const para: BlockNode = { type: "paragraph", content: [{ type: "text", text: md }] };
    return { type: "doc", content: [para] };
  }
}
