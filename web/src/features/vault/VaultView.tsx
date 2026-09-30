import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api, ApiError } from "@/api";
import type { LinksResult, TagsResult, VaultFile, VaultFileRecord } from "@/api";
import { Icon } from "@/ui/icons";
import { ErrorState, Loading, useToast } from "@/ui/primitives";
import { flattenVaultTree, parseFrontmatter, recordBadge } from "./vaultUtil";
import { outline as outlineOf } from "@/lib/wiki";
import { BlockEditor } from "@/features/pages/BlockEditor";
import { GraphView } from "./GraphView";
import { relativeTime } from "@/lib/format";

interface Tab {
  path: string;
  record: VaultFileRecord;
}

/** Obsidian-style vault mode: raw tree, tabs, source/reading, properties, links, graph. */
export function VaultView() {
  const { ws = "" } = useParams();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const { toast } = useToast();
  const [tree, setTree] = useState<VaultFile[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [sourceMode, setSourceMode] = useState(true);
  const [draft, setDraft] = useState("");
  const [dirty, setDirty] = useState(false);
  const [hash, setHash] = useState<string | undefined>();
  const [scope, setScope] = useState<"local" | "global">("local");
  const [links, setLinks] = useState<LinksResult | null>(null);
  const [tags, setTags] = useState<TagsResult | null>(null);
  const [rightPane, setRightPane] = useState<"info" | "graph">("info");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const activePath = params.get("file") ?? tabs[tabs.length - 1]?.path ?? null;
  const panel = params.get("panel");
  const active = tabs.find((t) => t.path === activePath) ?? null;

  const loadTree = useCallback(() => {
    api
      .vaultTree(ws)
      .then(setTree)
      .catch((e) => setError(e));
  }, [ws]);

  useEffect(() => {
    loadTree();
    api.tags(ws).then(setTags).catch(() => setTags(null));
  }, [loadTree, ws]);

  const openFile = useCallback(
    async (path: string) => {
      if (tabs.some((t) => t.path === path)) {
        const next = new URLSearchParams(params);
        next.set("file", path);
        setParams(next);
        return;
      }
      try {
        const rec = await api.vaultFile(ws, path);
        setTabs((ts) => [...ts, { path, record: rec }].slice(-8));
        const next = new URLSearchParams(params);
        next.set("file", path);
        setParams(next);
      } catch (e) {
        toast(e instanceof Error ? e.message : "Could not open file", "error");
      }
    },
    [ws, tabs, params, setParams, toast],
  );

  useEffect(() => {
    if (!activePath) return;
    if (active) {
      setDraft(active.record.content);
      setHash(active.record.contentHash);
      setDirty(false);
      api.links(ws, activePath).then(setLinks).catch(() => setLinks(null));
    } else {
      openFile(activePath);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePath]);

  const save = useCallback(
    async (content: string) => {
      if (!activePath) return;
      try {
        const rec = await api.putVaultFile(ws, activePath, content, hash);
        setHash(rec.contentHash);
        setDirty(false);
        setTabs((ts) => ts.map((t) => (t.path === activePath ? { ...t, record: rec } : t)));
        loadTree();
      } catch (e) {
        toast(e instanceof Error ? e.message : "Save failed", "error");
      }
    },
    [ws, activePath, hash, loadTree, toast],
  );

  const onEdit = useCallback(
    (content: string) => {
      setDraft(content);
      setDirty(true);
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => save(content), 900);
    },
    [save],
  );

  useEffect(
    () => () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    },
    [],
  );

  // ⌘⏎ on a record opens the card
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && activePath) {
        const badge = recordBadge(activePath);
        const dbSlug = badge;
        if (dbSlug) {
          e.preventDefault();
          nav(`/w/${ws}/db/${dbSlug}?card=${encodeURIComponent(activePath)}`);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activePath, nav, ws]);

  if (error) return <ErrorState error={error} retry={loadTree} />;

  const showGraph = panel === "graph" || rightPane === "graph";

  return (
    <div className="vault-wrap">
      {/* file explorer */}
      <div style={{ width: 232, flex: "none", borderRight: "1px solid var(--border)", overflowY: "auto", padding: "8px 6px", background: "var(--surface)" }}>
        <div className="side-label">
          <span>Files</span>
          <button className="tb-btn" style={{ height: 20, padding: "0 3px" }} aria-label="Graph" onClick={() => setRightPane((p) => (p === "graph" ? "info" : "graph"))}>
            <Icon name="graph" size={13} />
          </button>
        </div>
        {tree === null ? <Loading /> : <FileTree level={tree} depth={0} onOpen={openFile} activePath={activePath} />}
      </div>

      {/* tabs + editor */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <div className="tabbar" role="tablist">
          {tabs.map((t) => (
            <button
              key={t.path}
              role="tab"
              aria-selected={t.path === activePath}
              className={`tab${t.path === activePath ? " active" : ""}`}
              onClick={() => {
                const next = new URLSearchParams(params);
                next.set("file", t.path);
                setParams(next);
              }}
            >
              <Icon name={recordBadge(t.path) ? "database" : "page"} size={13} />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{t.path.split("/").pop()}</span>
              <span
                role="button"
                aria-label="Close tab"
                onClick={(e) => {
                  e.stopPropagation();
                  setTabs((ts) => ts.filter((x) => x.path !== t.path));
                }}
              >
                <Icon name="x" size={11} />
              </span>
            </button>
          ))}
          {tabs.length === 0 ? (
            <div className="tab" style={{ color: "var(--text-3)" }}>
              No file open — pick one from the tree
            </div>
          ) : null}
          <span style={{ flex: 1 }} />
          {active ? (
            <button className="tb-btn" style={{ alignSelf: "center", marginRight: 6 }} aria-pressed={sourceMode} onClick={() => setSourceMode((v) => !v)}>
              <Icon name={sourceMode ? "eye" : "code"} size={13} />
              {sourceMode ? "Reading" : "Source"}
            </button>
          ) : null}
        </div>

        <div style={{ flex: 1, overflow: "auto", minHeight: 0 }} className={sourceMode ? "vault-editor" : undefined}>
          {!active ? (
            <div className="state">
              <Icon name="file" size={20} className="icon" />
              <h3>Plain Markdown, always</h3>
              <p>Every file in the vault is here — including records and files Concept does not manage.</p>
            </div>
          ) : sourceMode ? (
            <textarea
              value={draft}
              onChange={(e) => onEdit(e.target.value)}
              spellCheck={false}
              aria-label="Markdown source"
              style={{
                width: "100%",
                height: "100%",
                background: "transparent",
                border: "none",
                outline: "none",
                resize: "none",
                padding: "20px 24px",
                color: "var(--text)",
                display: "block",
              }}
            />
          ) : (
            <div style={{ maxWidth: 720, margin: "0 auto", padding: "24px 24px 80px" }}>
              <BlockEditor value={draft} ws={ws} onChange={onEdit} readOnly placeholder="Empty file" />
            </div>
          )}
        </div>
        {dirty ? (
          <div className="faint" style={{ padding: "4px 12px", borderTop: "1px solid var(--border)", fontSize: 11.5, flex: "none" }}>
            Unsaved changes — saving…
          </div>
        ) : null}
      </div>

      {/* right pane */}
      <div style={{ width: 264, flex: "none", borderLeft: "1px solid var(--border)", overflowY: "auto", padding: 14, background: "var(--surface)" }}>
        {showGraph ? (
          <div style={{ height: "calc(100dvh - 100px)", display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", gap: 4, marginBottom: 10 }}>
              <button className={`tb-btn${scope === "local" ? " is-on" : ""}`} onClick={() => setScope("local")} style={{ fontSize: 12 }}>
                Local
              </button>
              <button className={`tb-btn${scope === "global" ? " is-on" : ""}`} onClick={() => setScope("global")} style={{ fontSize: 12 }}>
                Global
              </button>
              <span style={{ flex: 1 }} />
              <button className="tb-btn" onClick={() => setRightPane("info")} aria-label="Close graph">
                <Icon name="x" size={13} />
              </button>
            </div>
            <GraphView ws={ws} scope={scope} path={activePath ?? undefined} onOpen={(p) => openFile(p)} />
          </div>
        ) : active ? (
          <FilePane ws={ws} path={active.path} content={draft} links={links} tags={tags} onOpen={openFile} onGraph={() => setRightPane("graph")} />
        ) : (
          <TagsPane tags={tags} onPick={(t) => toast(`Filter by #${t} — coming via search`)} />
        )}
      </div>
    </div>
  );
}

function FilePane({
  ws, path, content, links, tags, onOpen, onGraph,
}: {
  ws: string;
  path: string;
  content: string;
  links: LinksResult | null;
  tags: TagsResult | null;
  onOpen: (p: string) => void;
  onGraph: () => void;
}) {
  const { fields } = useMemo(() => parseFrontmatter(content), [content]);
  const heads = useMemo(() => outlineOf(stripFrontmatter(content)), [content]);
  const badge = recordBadge(path);
  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 12 }}>
        <strong style={{ fontSize: 13, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{path.split("/").pop()?.replace(/\.md$/, "")}</strong>
        {badge ? <span className="badge">{badge}</span> : null}
        <button className="tb-btn" style={{ height: 22, padding: "0 4px" }} aria-label="Graph view" onClick={onGraph}>
          <Icon name="graph" size={13} />
        </button>
      </div>

      {fields.length > 0 ? (
        <>
          <div className="side-label" style={{ padding: "6px 0 4px" }}>Properties</div>
          {fields.map(([k, v]) => (
            <div key={k} className="prop-row">
              <span className="k">{k}</span>
              <span className="v">{v === "true" || v === "false" ? v : v}</span>
            </div>
          ))}
        </>
      ) : null}

      <div className="side-label" style={{ padding: "12px 0 4px" }}>Outline</div>
      {heads.length === 0 ? <p className="faint" style={{ fontSize: 12, margin: 0 }}>No headings.</p> : null}
      {heads.map((h, i) => (
        <div key={i} style={{ padding: "2px 0 2px " + (h.level - 1) * 10 + "px", fontSize: 12.5 }} className="muted">
          {h.text}
        </div>
      ))}

      <div className="side-label" style={{ padding: "14px 0 4px" }}>Links</div>
      {links === null ? (
        <Loading />
      ) : (
        <>
          {links.backlinks.map((b) => (
            <button key={b.path} className="side-item" style={{ height: 26, fontSize: 12.5 }} onClick={() => onOpen(b.path)}>
              <Icon name="arrowRight" size={12} className="icon" style={{ transform: "rotate(180deg)" }} />
              <span className="label">{b.title}</span>
            </button>
          ))}
          {links.outgoing.map((o) => (
            <button key={o.target} className="side-item" style={{ height: 26, fontSize: 12.5 }} onClick={() => onOpen(o.target.includes("/") ? o.target : guessPath(ws, o.target))}>
              <Icon name="arrowRight" size={12} className="icon" />
              <span className="label" style={{ color: o.resolved ? undefined : "var(--text-3)" }}>
                {o.title}
                {o.resolved ? "" : " (unresolved)"}
              </span>
            </button>
          ))}
          {links.backlinks.length === 0 && links.outgoing.length === 0 ? <p className="faint" style={{ fontSize: 12, margin: 0 }}>No links.</p> : null}
        </>
      )}

      {tags && tags.tags.length > 0 ? (
        <>
          <div className="side-label" style={{ padding: "14px 0 4px" }}>Tags</div>
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            {tags.tags.slice(0, 14).map((t) => (
              <span key={t.name} className="pill">
                #{t.name} · {t.count}
              </span>
            ))}
          </div>
        </>
      ) : null}
    </>
  );
}

function TagsPane({ tags, onPick }: { tags: TagsResult | null; onPick: (t: string) => void }) {
  if (!tags || tags.tags.length === 0) {
    return (
      <div>
        <div className="side-label" style={{ padding: 0 }}>Tags</div>
        <p className="faint" style={{ fontSize: 12 }}>No tags yet. Tag records with the labels property or #tags in notes.</p>
      </div>
    );
  }
  return (
    <>
      <div className="side-label" style={{ padding: 0 }}>Tags</div>
      {tags.tags.map((t) => (
        <button key={t.name} className="side-item" style={{ height: 26, fontSize: 12.5 }} onClick={() => onPick(t.name)}>
          <Icon name="tag" size={12} className="icon" />
          <span className="label">{t.name}</span>
          <span className="count num">{t.count}</span>
        </button>
      ))}
    </>
  );
}

function guessPath(_ws: string, title: string): string {
  return `Pages/${title}.md`;
}

function stripFrontmatter(content: string): string {
  const { bodyStart } = parseFrontmatter(content);
  return content.slice(bodyStart);
}

function FileTree({
  level, depth, onOpen, activePath,
}: {
  level: VaultFile[];
  depth: number;
  onOpen: (p: string) => void;
  activePath: string | null;
}) {
  const [open, setOpen] = useState<Set<string>>(() => new Set(["Pages", "Data"]));
  return (
    <>
      {level.map((f) => {
        if (f.type === "dir") {
          const isOpen = open.has(f.path);
          return (
            <div key={f.path}>
              <button
                className="side-item"
                style={{ paddingLeft: 6 + depth * 12, height: 26, fontSize: 12.5 }}
                onClick={() =>
                  setOpen((s) => {
                    const n = new Set(s);
                    if (n.has(f.path)) n.delete(f.path);
                    else n.add(f.path);
                    return n;
                  })
                }
              >
                <span style={{ display: "inline-flex", transform: isOpen ? "rotate(90deg)" : "none" }}>
                  <Icon name="chevronRight" size={11} />
                </span>
                <span className="label" style={{ color: "var(--text-2)" }}>
                  {f.path.split("/").pop()}
                </span>
              </button>
              {isOpen && f.children ? <FileTree level={f.children} depth={depth + 1} onOpen={onOpen} activePath={activePath} /> : null}
            </div>
          );
        }
        const badge = recordBadge(f.path);
        return (
          <button
            key={f.path}
            className={`side-item${f.path === activePath ? " active" : ""}`}
            style={{ paddingLeft: 6 + depth * 12 + 14, height: 26, fontSize: 12.5 }}
            onClick={() => onOpen(f.path)}
          >
            <Icon name={badge ? "database" : "page"} size={12} className="icon" />
            <span className="label">{f.path.split("/").pop()}</span>
            {badge ? <span className="badge">{badge}</span> : null}
          </button>
        );
      })}
    </>
  );
}

export { relativeTime, ApiError };
