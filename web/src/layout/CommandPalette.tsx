import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/api";
import type { Database, SearchResult, VaultFile } from "@/api";
import { Icon } from "@/ui/icons";
import { useTheme } from "@/ui/primitives";
import { flattenVaultTree } from "@/features/vault/vaultUtil";

interface Cmd {
  id: string;
  label: string;
  hint?: string;
  icon: string;
  keywords?: string;
  run: () => void;
  section: string;
}

export function CommandPalette({
  open, onClose, ws, mode = "all",
}: {
  open: boolean;
  onClose: () => void;
  ws: string;
  mode?: "all" | "files";
}) {
  const nav = useNavigate();
  const { theme, setTheme } = useTheme();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [files, setFiles] = useState<VaultFile[]>([]);
  const [dbs, setDbs] = useState<Database[]>([]);
  const [hot, setHot] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setQ("");
      setHot(0);
      setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [open]);

  useEffect(() => {
    if (!open || mode !== "files") return;
    api.vaultTree(ws).then((t) => setFiles(flattenVaultTree(t).filter((f) => f.type === "file"))).catch(() => setFiles([]));
  }, [open, mode, ws]);

  useEffect(() => {
    if (!open) return;
    api.databases(ws).then(setDbs).catch(() => setDbs([]));
  }, [open, ws]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const r = await api.search(ws, q);
        if (!cancelled) setResults(r);
      } catch {
        if (!cancelled) setResults([]);
      }
    }, 80);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q, open, ws]);

  const cmds = useMemo<Cmd[]>(() => {
    const actions: Cmd[] = [
      { id: "new-page", label: "New page", icon: "plus", section: "Actions", run: () => nav(`/w/${ws}/page/Pages/Untitled?action=new`) },
      { id: "new-task", label: "New task", icon: "check", section: "Actions", run: () => nav(`/w/${ws}/db/tasks?new=1`) },
      { id: "go-board", label: "Open board lens", icon: "board", section: "Actions", run: () => nav(`/w/${ws}/board`) },
      { id: "go-vault", label: "Open vault", icon: "file", section: "Actions", run: () => nav(`/w/${ws}/vault`) },
      { id: "go-home", label: "CRM home", icon: "home", section: "Actions", run: () => nav(`/w/${ws}`) },
      { id: "go-settings", label: "Settings", icon: "settings", section: "Actions", run: () => nav(`/w/${ws}/settings/members`) },
      { id: "graph", label: "Open graph view", icon: "graph", section: "Actions", run: () => nav(`/w/${ws}/vault?panel=graph`) },
    ];
    for (const t of ["oled", "graphite", "paper", "snow", "midnight", "forest"] as const) {
      actions.push({
        id: "theme-" + t,
        label: `Theme: ${t[0].toUpperCase()}${t.slice(1)}`,
        icon: "palette",
        section: "Theme",
        keywords: "appearance dark light",
        run: () => setTheme(t),
      });
    }
    void theme;
    const ql = q.trim().toLowerCase();
    const filtered = ql ? actions.filter((a) => (a.label + " " + (a.keywords ?? "")).toLowerCase().includes(ql)) : actions;
    return filtered.slice(0, 8);
  }, [q, nav, ws, setTheme, theme]);

  const fileHits = useMemo(() => {
    if (mode !== "files" || !q.trim()) return [];
    const ql = q.toLowerCase();
    return files.filter((f) => f.path.toLowerCase().includes(ql)).slice(0, 10);
  }, [files, q, mode]);

  const dbHits = useMemo(() => {
    if (mode === "files") return [];
    const ql = q.trim().toLowerCase();
    if (!ql) return [];
    return dbs.filter((d) => d.name.toLowerCase().includes(ql)).slice(0, 4);
  }, [dbs, q, mode]);

  const searchHits = useMemo(() => {
    if (mode === "files") return [];
    return results.slice(0, 8);
  }, [results, mode]);

  const flat = useMemo(
    () => [
      ...cmds.map((c) => ({ kind: "cmd" as const, cmd: c })),
      ...dbHits.map((d) => ({ kind: "db" as const, db: d })),
      ...fileHits.map((f) => ({ kind: "file" as const, file: f })),
      ...searchHits.map((s) => ({ kind: "search" as const, hit: s })),
    ],
    [cmds, dbHits, fileHits, searchHits],
  );

  useEffect(() => {
    setHot((h) => Math.min(h, Math.max(0, flat.length - 1)));
  }, [flat.length]);

  if (!open) return null;

  const runIndex = (i: number) => {
    const item = flat[i];
    if (!item) return;
    onClose();
    if (item.kind === "cmd") item.cmd.run();
    else if (item.kind === "db") nav(`/w/${ws}/db/${item.db.slug}`);
    else if (item.kind === "file") nav(`/w/${ws}/vault?file=${encodeURIComponent(item.file.path)}`);
    else if (item.hit.dbSlug) nav(`/w/${ws}/db/${item.hit.dbSlug}?card=${encodeURIComponent(item.hit.path)}`);
    else nav(`/w/${ws}/page/${item.hit.path.split("/").map(encodeURIComponent).join("/")}`);
  };

  return (
    <div className="overlay" style={{ padding: "10vh 16px 16px" }} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-card" style={{ maxWidth: 560, minHeight: 0 }} role="dialog" aria-label="Command palette">
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderBottom: "1px solid var(--border)" }}>
          <Icon name="search" size={16} className="faint" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setHot((h) => (h + 1) % Math.max(1, flat.length));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setHot((h) => (h - 1 + flat.length) % Math.max(1, flat.length));
              } else if (e.key === "Enter") {
                e.preventDefault();
                runIndex(hot);
              }
            }}
            placeholder={mode === "files" ? "Jump to file…" : "Search or run a command…"}
            style={{ flex: 1, background: "none", border: "none", outline: "none", fontSize: 15 }}
          />
          <span className="faint" style={{ fontSize: 11 }}>esc</span>
        </div>
        <div ref={listRef} style={{ overflow: "auto", maxHeight: 380, padding: 6 }}>
          {flat.length === 0 ? (
            <div className="faint" style={{ padding: "18px 10px", textAlign: "center", fontSize: 13 }}>
              No matches for “{q}”
            </div>
          ) : (
            flat.map((item, i) => {
              const itemSection = (it: typeof item): string =>
                it.kind === "cmd" ? it.cmd.section : it.kind === "file" ? "Files" : "Results";
              const section = item.kind === "db" ? "Databases" : itemSection(item);
              const showSection = i === 0 || itemSection(flat[i - 1]) !== section;
              const label = item.kind === "cmd" ? item.cmd.label : item.kind === "db" ? item.db.name : item.kind === "file" ? item.file.path : item.hit.title;
              const icon = item.kind === "cmd" ? item.cmd.icon : item.kind === "db" ? "database" : item.kind === "file" ? "file" : item.hit.dbSlug ? "database" : "page";
              return (
                <div key={item.kind + i}>
                  {showSection ? (
                    <div className="side-label" style={{ padding: "8px 8px 2px" }}>
                      {section}
                    </div>
                  ) : null}
                  <button
                    className={`side-item${i === hot ? " active" : ""}`}
                    style={{ height: 34 }}
                    onMouseEnter={() => setHot(i)}
                    onClick={() => runIndex(i)}
                  >
                    <Icon name={icon} size={15} className="icon" />
                    <span className="label">{label}</span>
                    {item.kind === "search" && item.hit.dbSlug ? <span className="count">{item.hit.dbSlug}</span> : null}
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
