import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams, useLocation } from "react-router-dom";
import type { Editor } from "@tiptap/react";
import { api, ApiError } from "@/api";
import type { Database, PageRecord, Property } from "@/api";
import { Icon } from "@/ui/icons";
import { ErrorState, Loading, Menu, useMenu, useToast } from "@/ui/primitives";
import { BlockEditor, InlineToolbar } from "./BlockEditor";
import { PropertyEditor } from "@/features/db/PropEditor";
import { PagePanel } from "@/features/panel/PagePanel";
import { usePanel } from "@/state/panel";
import { useTabs } from "@/state/tabs";
import { pageHref } from "@/layout/AppShell";
import { relativeTime } from "@/lib/format";

const HIDDEN = new Set(["title", "type", "rank", "created", "updated", "archived", "cover"]);

export function PageView() {
  const { ws = "" } = useParams();
  const nav = useNavigate();
  const loc = useLocation();
  const [params, setParams] = useSearchParams();
  const { toast } = useToast();
  const panel = usePanel();
  const tabs = useTabs();
  const path = decodeURIComponent(loc.pathname.replace(/^\/w\/[^/]+\/page\/?/, ""));
  const isNew = params.get("new") === "1";

  const [page, setPage] = useState<PageRecord | null>(null);
  const [db, setDb] = useState<Database | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [props, setProps] = useState<Record<string, unknown>>({});
  const [error, setError] = useState<unknown>(null);
  const [conflict, setConflict] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [source, setSource] = useState(false);
  const [editor, setEditor] = useState<Editor | null>(null);
  const hashRef = useRef<string | undefined>(undefined);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef({ title: "", body: "", props: {} as Record<string, unknown> });
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const pageMenu = useMenu();

  const load = useCallback(async () => {
    setError(null);
    setPage(null);
    try {
      const p = await api.page(ws, path);
      const m = path.match(/^Data\/([^/]+)\//);
      setDb(m ? await api.database(ws, m[1]).catch(() => null) : null);
      setPage(p);
      setTitle(p.title);
      setBody(p.body);
      setProps(p.properties ?? {});
      latest.current = { title: p.title, body: p.body, props: p.properties ?? {} };
      setDirty(false);
      setConflict(false);
      hashRef.current = p.contentHash;
      tabs.open(p.path, p.title);
    } catch (e) {
      setError(e);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ws, path]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (page && isNew && titleRef.current) {
      titleRef.current.focus();
      titleRef.current.select();
    }
  }, [page, isNew]);

  // Reload when someone else (git, Retex, another user) changes this file.
  useEffect(
    () =>
      api.onEvent(ws, (ev) => {
        const paths = (ev as { paths?: string[] }).paths;
        if (paths?.includes(path) && !latest.current.title.length) return;
        if (paths?.includes(path) && !dirty) {
          api
            .page(ws, path)
            .then((p) => {
              if (p.contentHash === hashRef.current) return;
              hashRef.current = p.contentHash;
              setPage(p);
              setBody(p.body);
              setProps(p.properties ?? {});
              setTitle(p.title);
              latest.current = { title: p.title, body: p.body, props: p.properties ?? {} };
            })
            .catch(() => {});
        }
      }),
    [ws, path, dirty],
  );

  const save = useCallback(async () => {
    if (conflict || !page) return;
    const { title: t, body: b, props: pr } = latest.current;
    setSaving(true);
    try {
      const patch: { title?: string; body?: string; properties?: Record<string, unknown> } = { title: t, body: b };
      const extra = Object.fromEntries(Object.entries(pr).filter(([k]) => !HIDDEN.has(k)));
      patch.properties = extra;
      const p = await api.updatePage(ws, page.path, patch, hashRef.current);
      hashRef.current = p.contentHash;
      setDirty(false);
      setPage((cur) => (cur ? { ...cur, contentHash: p.contentHash, updatedAt: p.updatedAt } : cur));
      tabs.open(page.path, t);
    } catch (e) {
      if ((e as ApiError).code === "conflict") {
        setConflict(true);
        toast("This page changed elsewhere. Reload to see the latest version.", "error");
      } else {
        toast(e instanceof Error ? e.message : "Save failed", "error");
      }
    } finally {
      setSaving(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conflict, page, ws]);

  const schedule = useCallback(() => {
    setDirty(true);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(save, 700);
  }, [save]);

  useEffect(
    () => () => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        saveTimer.current = null;
      }
    },
    [],
  );

  const openWiki = useCallback(
    async (target: string) => {
      try {
        const hits = await api.search(ws, target);
        const exact = hits.find((h) => h.title.toLowerCase() === target.toLowerCase()) ?? hits[0];
        if (exact) return nav(pageHref(ws, exact.path));
        const created = await api.createPage(ws, { title: target, parent: "Pages", body: "" });
        nav(pageHref(ws, created.path));
      } catch (e) {
        toast(e instanceof Error ? e.message : `Could not open ${target}`, "error");
      }
    },
    [ws, nav, toast],
  );

  const crumbs = useMemo(() => {
    const parts = path.replace(/\.md$/, "").split("/");
    return parts.slice(0, -1).filter((p) => p !== "Pages");
  }, [path]);

  const schemaProps: Property[] = useMemo(
    () => (db ? db.properties.filter((p) => p.type !== "title" && !HIDDEN.has(p.key)) : []),
    [db],
  );
  const freeKeys = useMemo(
    () => Object.keys(props).filter((k) => !HIDDEN.has(k) && !schemaProps.some((p) => p.key === k)),
    [props, schemaProps],
  );

  const setProp = (key: string, value: unknown) => {
    const next = { ...props };
    if (value === null || value === undefined || value === "") delete next[key];
    else next[key] = value;
    setProps(next);
    latest.current.props = next;
    schedule();
  };

  if (error) {
    const notFound = (error as ApiError).code === "not_found";
    return notFound ? (
      <div className="state" style={{ height: "100%" }}>
        <Icon name="page" size={22} className="icon" />
        <h3>This page doesn’t exist</h3>
        <p>It may have been moved or deleted.</p>
        <button className="btn" onClick={() => nav(`/w/${ws}`)}>Go home</button>
      </div>
    ) : (
      <ErrorState error={error} retry={load} />
    );
  }
  if (!page) return <Loading />;

  return (
    <div className="page-layout">
      <div className="page-scroll">
        <div className="page-col">
          <div className="page-bar">
            <nav className="crumbs" aria-label="Breadcrumb">
              {crumbs.map((c) => (
                <span key={c}>
                  {c}
                  <Icon name="chevronRight" size={11} className="faint" />
                </span>
              ))}
              <span className="crumb-cur">{title || "Untitled"}</span>
            </nav>
            <span className="faint save-state">
              {conflict ? "Out of date" : dirty ? (saving ? "Saving…" : "Unsaved") : page.updatedAt ? `Saved ${relativeTime(page.updatedAt)}` : ""}
            </span>
            <button className={`tb-btn${source ? " is-on" : ""}`} aria-label="Toggle Markdown source" aria-pressed={source} title="Markdown source (⌘/)" onClick={() => setSource((s) => !s)}>
              <Icon name="code" size={15} />
            </button>
            <button className="tb-btn" aria-label="Page menu" onClick={(e) => pageMenu.toggle(e.currentTarget)}>
              <Icon name="more" size={16} />
            </button>
            <PageMenu menuHook={pageMenu} ws={ws} path={page.path} onDeleted={() => nav(`/w/${ws}`)} />
          </div>

          {conflict ? (
            <div role="alert" className="banner">
              <Icon name="sync" size={15} />
              <span style={{ flex: 1 }}>Someone else changed this page. Your edits are not saved yet.</span>
              <button className="btn sm" onClick={load}>Reload latest</button>
              <button
                className="btn sm primary"
                onClick={() => {
                  hashRef.current = "*";
                  setConflict(false);
                  setTimeout(save, 0);
                }}
              >
                Keep mine
              </button>
            </div>
          ) : null}

          <textarea
            ref={titleRef}
            rows={1}
            className="page-title"
            value={title}
            placeholder="Untitled"
            aria-label="Page title"
            onChange={(e) => {
              setTitle(e.target.value.replace(/\n/g, ""));
              latest.current.title = e.target.value.replace(/\n/g, "");
              schedule();
              e.target.style.height = "auto";
              e.target.style.height = e.target.scrollHeight + "px";
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                (document.querySelector(".block-editor .ProseMirror") as HTMLElement | null)?.focus();
                if (isNew) setParams({}, { replace: true });
              }
            }}
            onFocus={(e) => {
              e.target.style.height = "auto";
              e.target.style.height = e.target.scrollHeight + "px";
            }}
          />

          {schemaProps.length > 0 || freeKeys.length > 0 ? (
            <div className="props" aria-label="Properties">
              {schemaProps.map((p) => (
                <div className="prop" key={p.key}>
                  <span className="prop-k">
                    <Icon name={iconFor(p.type)} size={13} />
                    {p.name}
                  </span>
                  <span className="prop-v">
                    <PropertyEditor db={db!} prop={p} value={props[p.key]} onCommit={(v) => setProp(p.key, v)} ws={ws} />
                  </span>
                </div>
              ))}
              {freeKeys.map((k) => (
                <div className="prop" key={k}>
                  <span className="prop-k">
                    <Icon name="list" size={13} />
                    {k}
                  </span>
                  <span className="prop-v">
                    <FreeValue value={props[k]} onCommit={(v) => setProp(k, v)} />
                  </span>
                </div>
              ))}
            </div>
          ) : null}

          {source ? (
            <textarea
              className="source"
              spellCheck={false}
              value={body}
              aria-label="Markdown source"
              onChange={(e) => {
                setBody(e.target.value);
                latest.current.body = e.target.value;
                schedule();
              }}
            />
          ) : (
            <>
              <InlineToolbar editor={editor} />
              <BlockEditor
                key={page.path + ":" + (source ? "s" : "e")}
                value={body}
                ws={ws}
                editorRef={setEditor}
                onOpenWiki={openWiki}
                onChange={(md) => {
                  setBody(md);
                  latest.current.body = md;
                  schedule();
                }}
              />
            </>
          )}
        </div>
      </div>
      {panel.open ? (
        <PagePanel ws={ws} path={page.path} body={body} onOpen={(p) => nav(pageHref(ws, p))} onJump={(h) => jumpTo(h)} />
      ) : null}
    </div>
  );
}

function jumpTo(heading: string) {
  const el = Array.from(document.querySelectorAll(".block-editor h1,.block-editor h2,.block-editor h3")).find((n) => n.textContent?.trim() === heading);
  el?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function iconFor(type: string): string {
  switch (type) {
    case "date": return "calendar";
    case "status": case "select": case "multi_select": return "tag";
    case "person": return "user";
    case "relation": return "link";
    case "checkbox": return "check";
    case "number": return "table";
    default: return "list";
  }
}

function FreeValue({ value, onCommit }: { value: unknown; onCommit: (v: unknown) => void }) {
  const text = Array.isArray(value) ? value.join(", ") : value === null || value === undefined ? "" : String(value);
  return (
    <input
      className="cell-input"
      defaultValue={text}
      key={text}
      onBlur={(e) => {
        const v = e.target.value.trim();
        if (v === text) return;
        onCommit(Array.isArray(value) ? v.split(",").map((s) => s.trim()).filter(Boolean) : v);
      }}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
    />
  );
}

function PageMenu({
  menuHook, ws, path, onDeleted,
}: {
  menuHook: ReturnType<typeof useMenu>;
  ws: string;
  path: string;
  onDeleted: () => void;
}) {
  const nav = useNavigate();
  const { toast } = useToast();
  const tabs = useTabs();
  return (
    <Menu
      open={menuHook.open}
      onClose={menuHook.close}
      anchor={menuHook.anchor}
      items={[
        {
          label: "Duplicate",
          icon: "layers",
          onSelect: async () => {
            const p = await api.page(ws, path);
            const parent = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "Pages";
            const created = await api.createPage(ws, { title: `${p.title} copy`, parent, body: p.body });
            nav(pageHref(ws, created.path));
          },
        },
        {
          label: "Copy link",
          icon: "link",
          onSelect: async () => {
            const t = path.split("/").pop()!.replace(/\.md$/, "");
            await navigator.clipboard?.writeText(`[[${t}]]`).catch(() => {});
            toast(`Copied [[${t}]]`);
          },
        },
        { separator: true },
        {
          label: "Move to trash",
          icon: "trash",
          danger: true,
          onSelect: async () => {
            await api.deletePage(ws, path);
            tabs.close(path);
            onDeleted();
          },
        },
      ]}
    />
  );
}
