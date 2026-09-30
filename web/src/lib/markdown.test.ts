import { describe, it, expect } from "vitest";
import { mdToDoc, docToMd, mdToDocSafe } from "./markdown";
import type { Doc } from "./markdown";

const round = (md: string): string => docToMd(mdToDoc(md));

describe("markdown blocks -> doc", () => {
  it("parses headings, paragraphs, hr", () => {
    const doc = mdToDoc("# Title\n\nBody line.\n\n---");
    expect(doc.content.map((b) => b.type)).toEqual(["heading", "paragraph", "horizontalRule"]);
    expect(doc.content[0].attrs?.level).toBe(1);
  });

  it("parses bullet, ordered and task lists", () => {
    const doc = mdToDoc("- a\n- b\n\n1. one\n2. two\n\n- [ ] todo\n- [x] done");
    expect(doc.content.map((b) => b.type)).toEqual(["bulletList", "orderedList", "taskList"]);
    const tasks = doc.content[2];
    expect(tasks.content![0].attrs).toEqual({ checked: false });
    expect(tasks.content![1].attrs).toEqual({ checked: true });
  });

  it("parses fenced code with language and keeps tildes/backticks", () => {
    const doc = mdToDoc("```ts\nconst a = 1;\n```");
    expect(doc.content[0].type).toBe("codeBlock");
    expect(doc.content[0].attrs?.language).toBe("ts");
    expect(doc.content[0].content![0].text).toBe("const a = 1;");
    const tilde = mdToDoc("~~~\n~~~\nplain");
    expect(tilde.content[0].type).toBe("codeBlock");
  });

  it("parses blockquotes and GFM tables", () => {
    const doc = mdToDoc("> quoted\ntext\n\n| a | b |\n| --- | --- |\n| 1 | 2 |");
    expect(doc.content[0].type).toBe("blockquote");
    expect(doc.content[1].type).toBe("paragraph");
    const table = doc.content[2];
    expect(table.type).toBe("table");
    const headerRow = table.content![0] as { content?: { content?: { content?: { text?: string }[] }[] }[] };
    const headerTexts = (headerRow.content ?? []).map((c) => c.content?.[0]?.content?.[0]?.text);
    expect(headerTexts).toEqual(["a", "b"]);
    expect((table.content![1] as { content: unknown[] }).content.length).toBe(2);
  });

  it("parses inline marks, links, images, code spans", () => {
    const doc = mdToDoc("**bold** *it* ~~gone~~ `code` [t](https://x.y) ![alt](/img.png)");
    const p = doc.content[0].content!;
    const kinds = p.map((n) => ({
      t: n.type,
      marks: (n.marks ?? []).map((m) => m.type),
    }));
    expect(kinds).toEqual([
      { t: "text", marks: ["bold"] },
      { t: "text", marks: [] },
      { t: "text", marks: ["italic"] },
      { t: "text", marks: [] },
      { t: "text", marks: ["strike"] },
      { t: "text", marks: [] },
      { t: "text", marks: ["code"] },
      { t: "text", marks: [] },
      { t: "text", marks: ["link"] },
      { t: "text", marks: [] },
      { t: "image", marks: [] },
    ]);
    expect((p[8].marks![0] as { attrs: { href: string } }).attrs.href).toBe("https://x.y");
  });

  it("parses soft line breaks as hardBreak nodes", () => {
    const doc = mdToDoc("one\ntwo");
    const p = doc.content[0].content as { type: string }[];
    expect(p.map((n) => n.type)).toEqual(["text", "hardBreak", "text"]);
  });

  it("keeps [[wiki links]] as plain text", () => {
    const doc = mdToDoc("see [[Other page]] now");
    const p = doc.content[0].content as { type: string; text?: string }[];
    expect(p[0].text).toBe("see [[Other page]] now");
  });
});

describe("round-trip doc -> markdown -> doc", () => {
  const cases = [
    "# Heading one\n\n## Sub\n\nA paragraph with **bold**, *italic*, ~~strike~~, `code` and a [link](https://example.com).\n\n- alpha\n- beta\n\n1. first\n2. second\n\n- [ ] open task\n- [x] closed task\n\n> A wise quote.\n\n```ts\nconst x: number = 1;\n```\n\n---\n\n| Name | Value |\n| --- | --- |\n| acme | 12 |\n\n![cover](attachments/1.png)",
    "Multi-line paragraph\ncontinued here.\n\n- item with **nested** marks",
    "Text with escaped \\*not emphasis\\* stays literal.",
  ];
  for (const [idx, md] of cases.entries()) {
    it(`case ${idx} is stable`, () => {
      const once = round(md);
      expect(once).toBe(md);
    });
  }

  it("normalizes equivalent markdown", () => {
    expect(round("* star list")).toBe("- star list");
    expect(round("1) paren ordered")).toBe("1. paren ordered");
    expect(round("***both***")).toBe("***both***");
    expect(round("Setext\n======")).toBe("# Setext");
  });
});

describe("robustness", () => {
  it("never throws on malformed input via mdToDocSafe", () => {
    expect(mdToDocSafe("```\nunclosed").type).toBe("doc");
  });
  it("empty input -> empty doc, docToMd rejects non-docs", () => {
    expect(mdToDoc("").content).toEqual([]);
    expect(() => docToMd({ type: "paragraph" } as unknown as Doc)).toThrow(/doc_expected/);
  });
});
