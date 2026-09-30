import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams, useLocation } from "react-router-dom";
import type { Editor } from "@tiptap/react";
import { api, ApiError } from "@/api";
import type { PageRecord } from "@/api";
import { Icon } from "@/ui/icons";
import { ErrorState, Loading, Menu, useMenu, useToast } from "@/ui/primitives";
import { BlockEditor, InlineToolbar } from "./BlockEditor";
import { outline as outlineOf, type Heading } from "@/lib/wiki";
import { relativeTime } from "@/lib/format";

export function PageView() {
  const { ws = "" } = useParams();
  const nav = useNavigate();
  const loc = useLocation();
  const [params] = useSearchParams();
  const { toast } = useToast();
  const rawPath = loc.pathname.replace(/^\/w\/[^/]+\/page\/?/, "");
  const path = decodeURIComponent(rawPath);
  const isNew = params.get("action") === "new" || path.endsWith("/Untitled");

  const [page, setPage] = useState<PageRecord | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [notFound, setNotFound] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [editor, setEditor] = useState<Editor | null>(null);
  const hashRef = useRef<string | undefined>(undefined);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pageMenu = useMenu();

  const load = useCallback(async () => {
    setError(null);
    setNotFound(false);
    try {
      const p = await api.page(ws, path);
      setPage(p);
      setTitle(p.title);
      setBody(p.body);
      setDirty(false);
      setConflict(false);
      hashRef.current = p.contentHash;
    } catch (e) {
      if ((e as ApiError).code === "not_found") {
        setNotFound(true);
        setTitle(path.split("/").pop()?.replace(/\.md$/, "") ?? "Untitled");
        setBody("");
        hashRef.current = undefined;
      } else {
        setError(e);
      }
    }
  }, [ws, path]);

  useEffect(() => {
    load();
  }, [load]);

  const create = useCallback(
    async (newTitle: string, newBody: string) => {
      const parentDir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "Pages";
      const p = await api.createPage(ws, { title: newTitle, parent: parentDir, body: newBody });
      hashRef.current = p.contentHash;
      setPage(p);
      setDirty(false);
      nav(`/w/${ws}/page/${p.path.split("/").map(encodeURIComponent).join("/")}`, { replace: true });
    },
    [ws, path, nav],
  );

  const save = useCallback(
    async (nextTitle: string, nextBody: string) => {
      if (conflict) return;
      setSaving(true);
      try {
        if (!page) {
          await create(nextTitle, nextBody);
        } else {
          const p = await api.updatePage(ws, page.path, { title: nextTitle, body: nextBody }, hashRef.current);
          hashRef.current = p.contentHash;
          setPage(p);
          setDirty(false);
        }
      } catch (e) {
        if ((e as ApiError).code === "conflict") {
          setConflict(true);
          toast("This page changed on the server — review before saving", "error");
        } else {
          toast(e instanceof Error ? e.message : "Save failed", "error");
        }
      } finally {
        setSaving(false);
      }
    },
    [conflict, page, create, toast, ws],
  );

  const scheduleSave = useCallback(
    (nextTitle: string, nextBody: string) => {
      setDirty(true);
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => save(nextTitle, nextBody), 900);
    },
    [save],
  );

  useEffect(
    () => () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    },
    [],
  );

  const heads: Heading[] = outlineOf(body);
  const backlinks = page?.backlinks ?? [];

  if (error) return <ErrorState error={error} retry={load} />;

  return (
    <div style={{ maxWidth: 760, margin: "0 auto", padding: "40px 24px 120px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 18 }}>
        <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 6 }}>
          <InlineToolbar editor={editor} />
        </div>
        {dirty ? <span className="faint" style={{ fontSize: 12 }}>{saving ? "Saving…" : "Unsaved"}</span> : page ? <span className="faint" style={{ fontSize: 12 }}>Saved · {relativeTime(page.updatedAt)}</span> : null}
        <button
          className="tb-btn"
          aria-label="Page menu"
          onClick={(e) => pageMenu.toggle(e.currentTarget)}
        >
          <Icon name="more" size={16} />
        </button>
        <PageMenu menuHook={pageMenu} ws={ws} path={page?.path ?? path} onDeleted={() => nav(`/w/${ws}`)} onReveal={() => nav(`/w/${ws}/vault?file=${encodeURIComponent(page?.path ?? path)}`)} />
      </div>

      {conflict ? (
        <div role="alert" style={{ display: "flex", gap: 10, alignItems: "center", border: "1px solid var(--warn)", borderRadius: 10, padding: "10px 14px", marginBottom: 18, fontSize: 13 }}>
          <Icon name="sync" size={16} />
          <span style={{ flex: 1 }}>The server has a newer version. Reloading keeps both — the server stores the conflicting copy separately.</span>
          <button className="btn sm" onClick={load}>
            Reload
          </button>
          <button
            className="btn sm primary"
            onClick={() => {
              setConflict(false);
              save(title, body);
            }}
          >
            Overwrite anyway
          </button>
        </div>
      ) : null}

      <input
        value={title}
        onChange={(e) => {
          setTitle(e.target.value);
          scheduleSave(e.target.value, body);
        }}
        placeholder="Untitled"
        aria-label="Page title"
        style={{
          width: "100%",
          background: "none",
          border: "none",
          outline: "none",
          fontSize: 30,
          fontWeight: 650,
          letterSpacing: "-0.02em",
          marginBottom: 6,
          color: "var(--text)",
        }}
      />
      <div className="faint mono" style={{ fontSize: 11, marginBottom: 26 }}>
        {notFound ? `${path} · new file` : path}
      </div>

      <BlockEditor
        key={page?.path ?? "new"}
        value={body}
        ws={ws}
        editorRef={setEditor}
        onChange={(md) => {
          setBody(md);
          scheduleSave(title, md);
        }}
      />

      <div style={{ marginTop: 64, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 32 }}>
        <div>
          <div className="side-label" style={{ padding: 0 }}>Outline</div>
          {heads.length === 0 ? (
            <p className="faint" style={{ fontSize: 12.5 }}>No headings yet.</p>
          ) : (
            heads.map((h, i) => (
              <div key={i} style={{ paddingLeft: (h.level - 1) * 14, padding: "3px 0" }}>
                <span className="muted" style={{ fontSize: 12.5 }}>{h.text}</span>
              </div>
            ))
          )}
        </div>
        <div>
          <div className="side-label" style={{ padding: 0 }}>Backlinks</div>
          {backlinks.length === 0 ? (
            <p className="faint" style={{ fontSize: 12.5 }}>Nothing links here yet.</p>
          ) : (
            backlinks.map((b) => (
              <button
                key={b.path}
                className="side-item"
                onClick={() => nav(`/w/${ws}/page/${b.path.split("/").map(encodeURIComponent).join("/")}`)}
                style={{ paddingLeft: 0 }}
              >
                <Icon name="page" size={14} className="icon" />
                <span className="label">{b.title}</span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function PageMenu({
  menuHook, ws, path, onDeleted, onReveal,
}: {
  menuHook: ReturnType<typeof useMenu>;
  ws: string;
  path: string;
  onDeleted: () => void;
  onReveal: () => void;
}) {
  const nav = useNavigate();
  return (
    <Menu
      open={menuHook.open}
      onClose={menuHook.close}
      anchor={menuHook.anchor}
      items={[
        { label: "Reveal in vault", icon: "file", onSelect: onReveal },
        {
          label: "Duplicate",
          icon: "layers",
          onSelect: async () => {
            const p = await api.page(ws, path);
            const created = await api.createPage(ws, { title: `${p.title} copy`, parent: path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "Pages", body: p.body });
            nav(`/w/${ws}/page/${created.path.split("/").map(encodeURIComponent).join("/")}`);
          },
        },
        { separator: true },
        {
          label: "Move to trash",
          icon: "trash",
          danger: true,
          onSelect: async () => {
            await api.deletePage(ws, path);
            onDeleted();
          },
        },
      ]}
    />
  );
}
