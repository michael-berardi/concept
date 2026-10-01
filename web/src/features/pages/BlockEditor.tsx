import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Image from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import { Table, TableRow, TableHeader, TableCell } from "@tiptap/extension-table";
import { Placeholder } from "@tiptap/extensions";
import { api } from "@/api";
import type { SearchResult } from "@/api";
import { mdToDoc, docToMd } from "@/lib/markdown";
import { WikiLink, applyWikiMarks } from "./wikiMark";
import { Icon } from "@/ui/icons";

/* ------------------------- Slash + wiki picker ------------------------- */

interface SlashItem {
  id: string;
  label: string;
  icon: string;
  hint: string;
  run: (editor: Editor) => void;
}

const SLASH_ITEMS: SlashItem[] = [
  { id: "h1", label: "Heading 1", icon: "heading", hint: "Large section title", run: (e) => e.chain().focus().toggleHeading({ level: 1 }).run() },
  { id: "h2", label: "Heading 2", icon: "heading", hint: "Medium section title", run: (e) => e.chain().focus().toggleHeading({ level: 2 }).run() },
  { id: "h3", label: "Heading 3", icon: "heading", hint: "Small section title", run: (e) => e.chain().focus().toggleHeading({ level: 3 }).run() },
  { id: "ul", label: "Bulleted list", icon: "list", hint: "Simple list", run: (e) => e.chain().focus().toggleBulletList().run() },
  { id: "ol", label: "Numbered list", icon: "list", hint: "Ordered list", run: (e) => e.chain().focus().toggleOrderedList().run() },
  { id: "task", label: "Task list", icon: "task", hint: "Checkable items", run: (e) => e.chain().focus().toggleTaskList().run() },
  { id: "quote", label: "Quote", icon: "quote", hint: "Callout a thought", run: (e) => e.chain().focus().toggleBlockquote().run() },
  { id: "code", label: "Code block", icon: "code", hint: "Monospace block", run: (e) => e.chain().focus().toggleCodeBlock().run() },
  { id: "table", label: "Table", icon: "table", hint: "3 x 3 grid", run: (e) => e.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
  { id: "hr", label: "Divider", icon: "minus", hint: "Visual break", run: (e) => e.chain().focus().setHorizontalRule().run() },
  {
    id: "image",
    label: "Image",
    icon: "image",
    hint: "Embed from URL",
    run: (e) => {
      const url = window.prompt("Image URL", "attachments/");
      if (url) e.chain().focus().setImage({ src: url }).run();
    },
  },
];

interface PickerState {
  open: boolean;
  wiki: boolean;
  query: string;
  range: { from: number; to: number } | null;
}

function PickerPortal({
  at, menuRef, onDown, children,
}: {
  at: { x: number; y: number };
  menuRef: React.RefObject<HTMLDivElement | null>;
  onDown: (e: React.MouseEvent) => void;
  children: React.ReactNode;
}) {
  return createPortal(
    <div style={{ position: "fixed", inset: 0, zIndex: 40 }} onMouseDown={onDown}>
      <div
        ref={menuRef}
        className="menu"
        style={{
          position: "fixed",
          left: Math.max(8, Math.min(at.x, window.innerWidth - 336)),
          top: Math.max(8, Math.min(at.y, window.innerHeight - 340)),
          width: 320,
          maxHeight: 330,
          overflow: "auto",
        }}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}

function SlashMenu({ editor, ws }: { editor: Editor; ws: string }) {
  const [state, setState] = useState<PickerState>({ open: false, wiki: false, query: "", range: null });
  const [hot, setHot] = useState(0);
  const [hits, setHits] = useState<SearchResult[]>([]);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const update = () => {
      const { state: st } = editor;
      const { $from } = st.selection;
      const textBefore = $from.parent.textBetween(0, $from.parentOffset, "\n", "\ufffc");
      const slash = textBefore.lastIndexOf("/");
      const bracket = textBefore.lastIndexOf("[[");
      if (bracket >= 0 && bracket >= slash) {
        const from = $from.pos - (textBefore.length - bracket);
        setState({ open: true, wiki: true, query: textBefore.slice(bracket + 2), range: { from, to: $from.pos } });
        return;
      }
      if (slash >= 0 && $from.parent.type.name === "paragraph" && /^[\w -]*$/.test(textBefore.slice(slash + 1))) {
        const from = $from.pos - (textBefore.length - slash);
        setState({ open: true, wiki: false, query: textBefore.slice(slash + 1), range: { from, to: $from.pos } });
        return;
      }
      setState((s) => (s.open ? { ...s, open: false } : s));
    };
    editor.on("selectionUpdate", update);
    editor.on("transaction", update);
    return () => {
      editor.off("selectionUpdate", update);
      editor.off("transaction", update);
    };
  }, [editor]);

  useEffect(() => {
    if (!state.wiki || !state.open) {
      setHits([]);
      return;
    }
    let on = true;
    api
      .search(ws, state.query)
      .then((r) => on && setHits(r.slice(0, 6)))
      .catch(() => on && setHits([]));
    return () => {
      on = false;
    };
  }, [state.wiki, state.open, state.query, ws]);

  const items = useMemo(() => {
    const q = state.query.toLowerCase().trim();
    return q ? SLASH_ITEMS.filter((i) => i.label.toLowerCase().includes(q) || i.id.includes(q)) : SLASH_ITEMS;
  }, [state.query]);

  if (!state.open || !state.range) return null;

  const close = () => setState((s) => ({ ...s, open: false }));
  const applySlash = (item: SlashItem) => {
    editor.chain().focus().deleteRange({ from: state.range!.from, to: state.range!.to }).run();
    item.run(editor);
    close();
  };
  const applyWiki = (title: string) => {
    editor.chain().focus().insertContentAt({ from: state.range!.from, to: state.range!.to }, `[[${title}]] `).run();
    close();
  };
  const rect = editor.view.coordsAtPos(state.range.from);
  const at = { x: rect.left, y: rect.bottom + 6 };
  const onDown = (e: React.MouseEvent) => {
    if (menuRef.current && !menuRef.current.contains(e.target as Node)) close();
    else e.preventDefault();
  };

  if (state.wiki) {
    return (
      <PickerPortal at={at} menuRef={menuRef} onDown={onDown}>
        <div className="side-label" style={{ padding: "6px 8px 2px" }}>Link to</div>
        {hits.map((h) => (
          <button key={h.path} className="menu-item" style={{ height: 34 }} onClick={() => applyWiki(h.title)}>
            <Icon name={h.dbSlug ? "database" : "page"} size={15} />
            <span style={{ flex: 1, color: "var(--text)" }}>{h.title}</span>
            {h.dbSlug ? <span className="faint" style={{ fontSize: 11 }}>{h.dbSlug}</span> : null}
          </button>
        ))}
        <button className="menu-item" onClick={() => applyWiki(state.query)}>
          <Icon name="plus" size={15} />
          <span style={{ flex: 1, color: "var(--text)" }}>Link “{state.query}”</span>
        </button>
      </PickerPortal>
    );
  }

  if (!items.length) return null;
  return (
    <PickerPortal at={at} menuRef={menuRef} onDown={onDown}>
      <div className="side-label" style={{ padding: "6px 8px 2px" }}>Blocks</div>
      {items.map((item, i) => (
        <button
          key={item.id}
          className={`menu-item${i === hot ? " hot" : ""}`}
          style={{ height: 40 }}
          onMouseEnter={() => setHot(i)}
          onClick={() => applySlash(item)}
        >
          <Icon name={item.icon} size={15} />
          <span style={{ flex: 1 }}>
            <span style={{ display: "block", color: "var(--text)" }}>{item.label}</span>
            <span style={{ display: "block", fontSize: 11.5, color: "var(--text-3)" }}>{item.hint}</span>
          </span>
        </button>
      ))}
    </PickerPortal>
  );
}

/* ------------------------- Editor ------------------------- */

export function BlockEditor({
  value, onChange, ws, placeholder, readOnly, editorRef, onOpenWiki,
}: {
  value: string;
  onChange: (md: string) => void;
  ws: string;
  placeholder?: string;
  readOnly?: boolean;
  editorRef?: (e: Editor | null) => void;
  onOpenWiki?: (target: string) => void;
}) {
  const lastEmitted = useRef(value);
  const onOpenWikiRef = useRef(onOpenWiki);
  onOpenWikiRef.current = onOpenWiki;
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({ link: false, heading: { levels: [1, 2, 3] } }),
        Link.configure({ openOnClick: false, autolink: true }),
        TaskList,
        TaskItem.configure({ nested: true }),
        Image.configure({ inline: false }),
        Table.configure({ resizable: false }),
        TableRow,
        TableHeader,
        TableCell,
        WikiLink,
        Placeholder.configure({ placeholder: placeholder ?? "Write, press / for blocks…" }),
      ],
      content: mdToDoc(value),
      editable: !readOnly,
      onUpdate: ({ editor }) => {
        if (debounce.current) clearTimeout(debounce.current);
        debounce.current = setTimeout(() => {
          const md = docToMd(editor.getJSON() as never);
          lastEmitted.current = md;
          onChange(md);
          applyWikiMarks(editor);
        }, 250);
      },
    },
    [],
  );

  useEffect(() => {
    editorRef?.(editor ?? null);
    return () => editorRef?.(null);
  }, [editor, editorRef]);

  // External value changes (conflict resolution, revert) replace content.
  useEffect(() => {
    if (!editor || value === lastEmitted.current) return;
    lastEmitted.current = value;
    editor.commands.setContent(mdToDoc(value), { emitUpdate: false });
    applyWikiMarks(editor);
  }, [value, editor]);

  useEffect(() => {
    if (!editor) return;
    const t = setTimeout(() => applyWikiMarks(editor), 60);
    return () => clearTimeout(t);
  }, [editor]);

  useEffect(
    () => () => {
      if (debounce.current) clearTimeout(debounce.current);
    },
    [],
  );

  if (!editor) return null;

  return (
    <div
      className="block-editor"
      data-readonly={readOnly || undefined}
      onClick={(e) => {
        const el = (e.target as HTMLElement).closest?.(".wiki-link") as HTMLElement | null;
        const target = el?.dataset.wiki;
        if (target && onOpenWikiRef.current && !(e.metaKey && false)) {
          e.preventDefault();
          onOpenWikiRef.current(target);
        }
      }}
    >
      <EditorContent editor={editor} />
      <SlashMenu editor={editor} ws={ws} />
    </div>
  );
}

/** Floating format bar that appears above a text selection. */
export function InlineToolbar({ editor }: { editor: Editor | null }) {
  const [, force] = useState(0);
  useEffect(() => {
    if (!editor) return;
    const f = () => force((n) => n + 1);
    editor.on("selectionUpdate", f);
    editor.on("transaction", f);
    editor.on("blur", f);
    return () => {
      editor.off("selectionUpdate", f);
      editor.off("transaction", f);
      editor.off("blur", f);
    };
  }, [editor]);
  if (!editor || editor.state.selection.empty || !editor.isFocused) return null;
  const { from, to } = editor.state.selection;
  const a = editor.view.coordsAtPos(from);
  const b = editor.view.coordsAtPos(to);
  const x = (a.left + b.right) / 2;
  const btn = (icon: string, label: string, active: boolean, run: () => void) => (
    <button
      key={label}
      className="tb-btn"
      style={{ height: 26, padding: "0 6px", color: active ? "var(--accent)" : undefined }}
      onMouseDown={(e) => {
        e.preventDefault();
        run();
      }}
      aria-label={label}
      aria-pressed={active}
    >
      <Icon name={icon} size={14} />
    </button>
  );
  return createPortal(
    <div className="bubble" style={{ left: Math.max(120, Math.min(x, window.innerWidth - 120)), top: Math.min(a.top, b.top) - 8 }}>
      {btn("bold", "Bold", editor.isActive("bold"), () => editor.chain().focus().toggleBold().run())}
      {btn("italic", "Italic", editor.isActive("italic"), () => editor.chain().focus().toggleItalic().run())}
      {btn("strikethrough", "Strikethrough", editor.isActive("strike"), () => editor.chain().focus().toggleStrike().run())}
      {btn("code", "Code", editor.isActive("code"), () => editor.chain().focus().toggleCode().run())}
      {btn("link", "Link", editor.isActive("link"), () => {
        const href = window.prompt("Link URL", "https://");
        if (href) editor.chain().focus().setLink({ href }).run();
        else editor.chain().focus().unsetLink().run();
      })}
      {btn("task", "Task list", editor.isActive("taskList"), () => editor.chain().focus().toggleTaskList().run())}
    </div>,
    document.body,
  );
}
