import { Extension } from "@tiptap/core";
import type { Editor } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";

const RE = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;

interface Hit {
  from: number;
  to: number;
  target: string;
}

function findLinks(doc: PMNode): Hit[] {
  const out: Hit[] = [];
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;
    if (node.marks.some((m) => m.type.name === "code")) return;
    for (const m of node.text.matchAll(RE)) {
      const from = pos + (m.index ?? 0);
      out.push({ from, to: from + m[0].length, target: m[1].trim() });
    }
  });
  return out;
}

const key = new PluginKey("wikiLinks");

/**
 * `[[Wiki Link]]` presentation. The document keeps the literal `[[Target]]`
 * text (Markdown round-trips untouched); a decoration styles it as a link and
 * hides the brackets until the caret enters the link, like Obsidian.
 */
export const WikiLink = Extension.create({
  name: "wikiLinks",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key,
        props: {
          decorations(state) {
            const decos: Decoration[] = [];
            const head = state.selection.head;
            for (const h of findLinks(state.doc)) {
              const editing = head >= h.from && head <= h.to;
              decos.push(Decoration.inline(h.from, h.to, { class: "wiki-link", "data-wiki": h.target }));
              if (!editing) {
                const m = state.doc.textBetween(h.from, h.to).match(/^\[\[([^\]|]+\|)?/);
                const openLen = m ? m[0].length : 2;
                decos.push(Decoration.inline(h.from, h.from + openLen, { class: "wiki-hide" }));
                decos.push(Decoration.inline(h.to - 2, h.to, { class: "wiki-hide" }));
              }
            }
            return DecorationSet.create(state.doc, decos);
          },
        },
      }),
    ];
  },
});

/** Compatibility no-op: links are decorated live, nothing to apply. */
export function applyWikiMarks(_editor: Editor): void {}

/** The wiki target at a document position, if the position is inside a link. */
export function wikiTargetAt(editor: Editor, pos: number): string | null {
  for (const h of findLinks(editor.state.doc)) if (pos >= h.from && pos <= h.to) return h.target;
  return null;
}
