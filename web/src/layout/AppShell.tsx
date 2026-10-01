import { useCallback, useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate, useParams } from "react-router-dom";
import { api } from "@/api";
import type { TreeNode } from "@/api";
import { Icon } from "@/ui/icons";
import { Loading, useMenu, Menu, useTheme, useToast } from "@/ui/primitives";
import { useSession } from "@/state/session";
import { useTabs } from "@/state/tabs";
import { usePanel } from "@/state/panel";
import { CommandPalette } from "./CommandPalette";

const enc = (p: string) => p.split("/").map(encodeURIComponent).join("/");
export const pageHref = (ws: string, path: string) => `/w/${ws}/page/${enc(path)}`;

const OPEN_KEY = "concept.tree.open";
function loadOpen(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(OPEN_KEY) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}

export function AppShell() {
  const { ws = "" } = useParams();
  const nav = useNavigate();
  const loc = useLocation();
  const { toast } = useToast();
  const { me, workspaces, refresh } = useSession();
  const { theme, setTheme } = useTheme();
  const { tabs, close: closeTab } = useTabs();
  const panel = usePanel();
  const [tree, setTree] = useState<TreeNode[] | null>(null);
  const [treeError, setTreeError] = useState<unknown>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [filesMode, setFilesMode] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth > 900);
  const [openSet, setOpenSet] = useState<Set<string>>(loadOpen);
  const wsMenu = useMenu();
  const themeMenu = useMenu();
  const newMenu = useMenu();

  const loadTree = useCallback(() => {
    api
      .tree(ws)
      .then((t) => {
        setTree(t);
        setTreeError(null);
      })
      .catch((e) => setTreeError(e));
  }, [ws]);

  useEffect(() => {
    setTree(null);
    loadTree();
  }, [loadTree]);

  useEffect(() => api.onEvent(ws, () => loadTree()), [ws, loadTree]);

  // Close the sidebar after navigating on small screens.
  useEffect(() => {
    if (window.innerWidth <= 900) setSidebarOpen(false);
  }, [loc.pathname]);

  const toggleOpen = (path: string) =>
    setOpenSet((s) => {
      const next = new Set(s);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      try {
        localStorage.setItem(OPEN_KEY, JSON.stringify([...next]));
      } catch {
        /* ignore */
      }
      return next;
    });

  const newPage = useCallback(
    async (parent?: string) => {
      try {
        const p = await api.createPage(ws, { title: "Untitled", parent: parent ?? "Pages", body: "" });
        if (parent) setOpenSet((s) => new Set(s).add(parent));
        loadTree();
        nav(pageHref(ws, p.path) + "?new=1");
      } catch (e) {
        toast(e instanceof Error ? e.message : "Could not create page", "error");
      }
    },
    [ws, nav, loadTree, toast],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const k = e.key.toLowerCase();
      if (k === "k") {
        e.preventDefault();
        setFilesMode(false);
        setPaletteOpen(true);
      } else if (k === "o") {
        e.preventDefault();
        setFilesMode(true);
        setPaletteOpen(true);
      } else if (e.key === "1") {
        e.preventDefault();
        nav(`/w/${ws}`);
      } else if (e.key === "2") {
        e.preventDefault();
        nav(`/w/${ws}/board`);
      } else if (k === "g" && !e.shiftKey) {
        e.preventDefault();
        nav(`/w/${ws}/graph`);
      } else if (e.key === "\\") {
        e.preventDefault();
        setSidebarOpen((v) => !v);
      } else if (e.altKey && k === "b") {
        e.preventDefault();
        panel.toggle();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [nav, ws, panel]);

  const mode: "workspace" | "board" = loc.pathname.includes("/board") ? "board" : "workspace";
  const current = workspaces.find((w) => w.slug === ws);
  const activePath = loc.pathname.startsWith(`/w/${ws}/page/`)
    ? decodeURIComponent(loc.pathname.slice(`/w/${ws}/page/`.length))
    : null;
  const small = typeof window !== "undefined" && window.innerWidth <= 900;

  return (
    <div className="app">
      <aside className={`sidebar${sidebarOpen ? "" : " collapsed"}`} aria-label="Sidebar">
        <button className="ws-switch" onClick={(e) => wsMenu.toggle(e.currentTarget)} aria-label="Switch workspace">
          <span className="ws-badge">{(current?.name ?? "C").slice(0, 1).toUpperCase()}</span>
          <span className="ws-name">{current?.name ?? "Workspace"}</span>
          <Icon name="chevronDown" size={14} className="faint" />
        </button>

        <div className="side-quick">
          <button
            className="side-item"
            onClick={() => {
              setFilesMode(false);
              setPaletteOpen(true);
            }}
          >
            <Icon name="search" size={15} className="icon" />
            <span className="label">Search</span>
            <span className="kbd">⌘K</span>
          </button>
          <NavLink to={`/w/${ws}`} end className={({ isActive }) => `side-item${isActive ? " active" : ""}`}>
            <Icon name="home" size={15} className="icon" />
            <span className="label">Home</span>
          </NavLink>
          <NavLink to={`/w/${ws}/graph`} className={({ isActive }) => `side-item${isActive ? " active" : ""}`}>
            <Icon name="graph" size={15} className="icon" />
            <span className="label">Graph</span>
            <span className="kbd">⌘G</span>
          </NavLink>
        </div>

        <div className="side-scroll">
          {tree === null && !treeError ? (
            <div style={{ padding: "8px" }}>
              <div className="skeleton" style={{ height: 12, width: "70%", marginBottom: 10 }} />
              <div className="skeleton" style={{ height: 12, width: "52%", marginBottom: 10 }} />
              <div className="skeleton" style={{ height: 12, width: "63%" }} />
            </div>
          ) : treeError ? (
            <div className="faint" style={{ padding: "6px 8px", fontSize: 12.5 }}>
              Could not load the file tree.{" "}
              <button className="link-btn" onClick={loadTree}>
                Retry
              </button>
            </div>
          ) : (
            <TreeLevel
              nodes={tree ?? []}
              ws={ws}
              activePath={activePath}
              openSet={openSet}
              toggleOpen={toggleOpen}
              onAdd={newPage}
              onMoved={loadTree}
            />
          )}
          <button className="side-item side-add" onClick={() => newPage()}>
            <Icon name="plus" size={15} className="icon" />
            <span className="label">New page</span>
          </button>
        </div>

        <div className="side-foot">
          <NavLink to={`/w/${ws}/settings/members`} className={({ isActive }) => `side-item${isActive ? " active" : ""}`} style={{ flex: 1 }}>
            <Icon name="settings" size={15} className="icon" />
            <span className="label">Settings</span>
          </NavLink>
          <button className="tb-btn" aria-label="Theme" onClick={(e) => themeMenu.toggle(e.currentTarget)}>
            <Icon name="palette" size={15} />
          </button>
        </div>
      </aside>

      {sidebarOpen && small ? <button className="sidebar-backdrop" aria-label="Close sidebar" onClick={() => setSidebarOpen(false)} /> : null}

      <div className="main-col">
        <header className="topbar">
          <button className="tb-btn" aria-label="Toggle sidebar" onClick={() => setSidebarOpen((v) => !v)}>
            <Icon name="panelLeft" size={16} />
          </button>
          <div className="segmented" role="tablist" aria-label="View">
            {(
              [
                ["workspace", "Workspace", "layers", `/w/${ws}`],
                ["board", "Board", "kanban", `/w/${ws}/board`],
              ] as const
            ).map(([id, label, icon, to]) => (
              <button key={id} role="tab" aria-selected={mode === id} aria-pressed={mode === id} onClick={() => nav(to)}>
                <Icon name={icon} size={14} />
                <span className="hide-mobile">{label}</span>
              </button>
            ))}
          </div>
          <div className="spacer" />
          <button className="tb-btn" aria-label="New" onClick={(e) => newMenu.toggle(e.currentTarget)}>
            <Icon name="plus" size={15} />
          </button>
          <button className={`tb-btn${panel.open ? " is-on" : ""}`} aria-label="Toggle side panel" onClick={panel.toggle} title="Side panel (⌥⌘B)">
            <Icon name="sidebar" size={16} />
          </button>
          <button
            className="tb-btn"
            aria-label="Sign out"
            title="Sign out"
            onClick={async () => {
              await api.logout();
              await refresh();
              nav("/login");
            }}
          >
            <Icon name="user" size={15} />
            <span className="hide-mobile" style={{ fontSize: 12.5 }}>{me?.name.split(" ")[0]}</span>
          </button>
        </header>

        {mode === "workspace" && tabs.length > 0 ? (
          <div className="tabbar" role="tablist" aria-label="Open pages">
            {tabs.map((t) => (
              <div key={t.path} className={`tab${activePath === t.path ? " active" : ""}`} role="tab" aria-selected={activePath === t.path}>
                <button className="tab-main" onClick={() => nav(pageHref(ws, t.path))}>
                  <Icon name="page" size={13} />
                  <span className="tab-title">{t.title || "Untitled"}</span>
                </button>
                <button
                  className="tab-x"
                  aria-label={`Close ${t.title}`}
                  onClick={() => {
                    const next = closeTab(t.path);
                    if (activePath === t.path) nav(next ? pageHref(ws, next.path) : `/w/${ws}`);
                  }}
                >
                  <Icon name="x" size={12} />
                </button>
              </div>
            ))}
          </div>
        ) : null}

        <main className="content">
          <Outlet context={{ reloadTree: loadTree, newPage }} />
        </main>
      </div>

      <Menu
        open={wsMenu.open}
        onClose={wsMenu.close}
        anchor={wsMenu.anchor}
        items={[
          ...workspaces.map((w) => ({
            label: w.name,
            icon: w.slug === ws ? "check" : undefined,
            onSelect: () => nav(`/w/${w.slug}`),
          })),
          { separator: true },
          {
            label: "New workspace",
            icon: "plus",
            onSelect: async () => {
              const name = window.prompt("Workspace name");
              if (!name) return;
              const w = await api.createWorkspace({ name, template: "crm" });
              await refresh();
              nav(`/w/${w.slug}`);
            },
          },
        ]}
      />
      <Menu
        open={themeMenu.open}
        onClose={themeMenu.close}
        anchor={themeMenu.anchor}
        items={(["oled", "graphite", "paper", "snow", "midnight", "forest"] as const).map((t) => ({
          label: t[0].toUpperCase() + t.slice(1),
          checked: theme === t,
          onSelect: () => setTheme(t),
        }))}
      />
      <Menu
        open={newMenu.open}
        onClose={newMenu.close}
        anchor={newMenu.anchor}
        items={[
          { label: "New page", icon: "page", onSelect: () => newPage() },
          {
            label: "New database",
            icon: "database",
            onSelect: async () => {
              const name = window.prompt("Database name", "Projects");
              if (!name) return;
              const d = await api.createDatabase(ws, { name });
              loadTree();
              nav(`/w/${ws}/db/${d.slug}`);
            },
          },
        ]}
      />

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} ws={ws} mode={filesMode ? "files" : "all"} />
    </div>
  );
}

function TreeLevel({
  nodes, ws, activePath, openSet, toggleOpen, onAdd, onMoved,
}: {
  nodes: TreeNode[];
  ws: string;
  activePath: string | null;
  openSet: Set<string>;
  toggleOpen: (p: string) => void;
  onAdd: (parent: string) => void;
  onMoved: () => void;
}) {
  const nav = useNavigate();
  const { toast } = useToast();
  const [dropOn, setDropOn] = useState<string | null>(null);

  const drop = async (e: React.DragEvent, target: TreeNode) => {
    e.preventDefault();
    setDropOn(null);
    const from = e.dataTransfer.getData("text/concept-path");
    if (!from || from === target.path || target.path.startsWith(from.replace(/\.md$/, "") + "/")) return;
    try {
      await api.movePage(ws, from, target.path);
      onMoved();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not move page", "error");
    }
  };

  return (
    <>
      {nodes.map((n) => {
        if (n.type === "database") {
          const slug = n.path.slice(3);
          return (
            <NavLink key={n.path} to={`/w/${ws}/db/${slug}`} className={({ isActive }) => `side-item${isActive ? " active" : ""}`}>
              <span className="chev-space" />
              <Icon name="database" size={15} className="icon" />
              <span className="label">{n.title}</span>
            </NavLink>
          );
        }
        const hasKids = !!n.children?.length;
        const open = openSet.has(n.path);
        const isFile = n.type === "page";
        const active = activePath === n.path;
        const dir = n.path.replace(/\.md$/, "");
        return (
          <div key={n.path}>
            <div
              className={`side-row${active ? " active" : ""}${dropOn === n.path ? " drop" : ""}`}
              draggable={isFile}
              onDragStart={(e) => e.dataTransfer.setData("text/concept-path", n.path)}
              onDragOver={(e) => {
                e.preventDefault();
                setDropOn(n.path);
              }}
              onDragLeave={() => setDropOn((d) => (d === n.path ? null : d))}
              onDrop={(e) => drop(e, n)}
            >
              <button className="chev" aria-label={open ? "Collapse" : "Expand"} onClick={() => toggleOpen(n.path)} style={{ visibility: hasKids ? "visible" : "hidden" }}>
                <Icon name="chevronRight" size={12} style={{ transform: open ? "rotate(90deg)" : "none", transition: "transform .12s" }} />
              </button>
              <button
                className="side-item"
                onClick={() => (isFile ? nav(pageHref(ws, n.path)) : toggleOpen(n.path))}
                title={n.path}
              >
                <Icon name={isFile ? "page" : "folder"} size={15} className="icon" />
                <span className="label">{n.title}</span>
              </button>
              <button className="row-add" aria-label={`Add a page inside ${n.title}`} title="Add a page inside" onClick={() => onAdd(isFile ? n.path : dir)}>
                <Icon name="plus" size={13} />
              </button>
            </div>
            {hasKids && open ? (
              <div className="tree-children">
                <TreeLevel nodes={n.children!} ws={ws} activePath={activePath} openSet={openSet} toggleOpen={toggleOpen} onAdd={onAdd} onMoved={onMoved} />
              </div>
            ) : null}
          </div>
        );
      })}
    </>
  );
}

export function ShellFallback() {
  return (
    <div className="state">
      <Loading />
    </div>
  );
}
