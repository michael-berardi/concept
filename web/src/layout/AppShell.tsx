import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate, useParams } from "react-router-dom";
import { api } from "@/api";
import type { Database, TreeNode } from "@/api";
import { Icon } from "@/ui/icons";
import { Icon as I } from "@/ui/icons";
import { EmptyState, ErrorState, Loading, useMenu, Menu, useTheme } from "@/ui/primitives";
import { useSession } from "@/state/session";
import { CommandPalette } from "./CommandPalette";

export function AppShell() {
  const { ws = "" } = useParams();
  const nav = useNavigate();
  const loc = useLocation();
  const { me, workspaces, refresh } = useSession();
  const { theme, setTheme } = useTheme();
  const [tree, setTree] = useState<TreeNode[] | null>(null);
  const [treeError, setTreeError] = useState<unknown>(null);
  const [databases, setDatabases] = useState<Database[]>([]);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [filesMode, setFilesMode] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth > 900);
  const wsMenu = useMenu();
  const themeMenu = useMenu();
  const newMenu = useMenu();

  useEffect(() => {
    let on = true;
    setTree(null);
    api
      .tree(ws)
      .then((t) => on && setTree(t))
      .catch((e) => on && setTreeError(e));
    api
      .databases(ws)
      .then((d) => on && setDatabases(d))
      .catch(() => on && setDatabases([]));
    return () => {
      on = false;
    };
  }, [ws]);

  useEffect(() => {
    const unsub = api.onEvent(ws, () => {
      api
        .tree(ws)
        .then((t) => setTree(t))
        .catch(() => {});
    });
    return unsub;
  }, [ws]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setFilesMode(false);
        setPaletteOpen(true);
      } else if (mod && e.key.toLowerCase() === "o") {
        e.preventDefault();
        setFilesMode(true);
        setPaletteOpen(true);
      } else if (mod && e.key === "1") {
        e.preventDefault();
        nav(`/w/${ws}`);
      } else if (mod && e.key === "2") {
        e.preventDefault();
        nav(`/w/${ws}/board`);
      } else if (mod && e.key === "3") {
        e.preventDefault();
        nav(`/w/${ws}/vault`);
      } else if (mod && e.key === "\\") {
        e.preventDefault();
        setSidebarOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [nav, ws]);

  const mode: "workspace" | "board" | "vault" = loc.pathname.endsWith("/vault")
    ? "vault"
    : loc.pathname.includes("/board")
      ? "board"
      : "workspace";

  const current = workspaces.find((w) => w.slug === ws);

  return (
    <div className="app">
      <aside className={`sidebar${sidebarOpen ? "" : " collapsed"}`} aria-label="Sidebar">
        <button
          className="ws-switch"
          onClick={(e) => wsMenu.toggle(e.currentTarget)}
          aria-label="Switch workspace"
        >
          <span className="ws-badge">{(current?.name ?? "C").slice(0, 1).toUpperCase()}</span>
          <span className="ws-name">{current?.name ?? "Workspace"}</span>
          <I name="chevronDown" size={14} className="faint" />
        </button>
        <div className="side-scroll">
          <div className="side-label" style={{ display: "flex", gap: 4, alignItems: "center" }}>
            <span style={{ flex: 1 }}>Workspace</span>
            <button
              className="tb-btn"
              style={{ height: 22, padding: "0 4px" }}
              aria-label="New"
              onClick={(e) => newMenu.toggle(e.currentTarget)}
            >
              <I name="plus" size={14} />
            </button>
          </div>
          <NavLink to={`/w/${ws}`} end className={({ isActive }) => `side-item${isActive ? " active" : ""}`}>
            <I name="home" size={15} className="icon" />
            <span className="label">Home</span>
          </NavLink>
          <NavLink to={`/w/${ws}/board`} className={({ isActive }) => `side-item${isActive ? " active" : ""}`}>
            <I name="board" size={15} className="icon" />
            <span className="label">Board</span>
          </NavLink>

          <div className="side-label">Databases</div>
          {databases.map((d) => (
            <NavLink
              key={d.slug}
              to={`/w/${ws}/db/${d.slug}`}
              className={({ isActive }) => `side-item${isActive ? " active" : ""}`}
            >
              <I name="database" size={15} className="icon" />
              <span className="label">{d.name}</span>
            </NavLink>
          ))}

          <div className="side-label">Pages</div>
          {tree === null && !treeError ? (
            <div style={{ padding: "4px 8px" }}>
              <div className="skeleton" style={{ height: 12, width: "70%", marginBottom: 8 }} />
              <div className="skeleton" style={{ height: 12, width: "52%", marginBottom: 8 }} />
              <div className="skeleton" style={{ height: 12, width: "63%" }} />
            </div>
          ) : treeError ? (
            <div className="faint" style={{ padding: "4px 8px", fontSize: 12 }}>
              Pages unavailable
            </div>
          ) : (
            <TreeLevel nodes={tree ?? []} ws={ws} depth={0} />
          )}
        </div>
        <div className="hairline" style={{ borderTop: "1px solid var(--border)", borderBottom: "none", padding: 8, display: "flex", gap: 4 }}>
          <NavLink to={`/w/${ws}/settings/members`} className={({ isActive }) => `side-item${isActive ? " active" : ""}`} style={{ flex: 1 }}>
            <I name="settings" size={15} className="icon" />
            <span className="label">Settings</span>
          </NavLink>
          <button
            className="tb-btn"
            aria-label="Theme"
            onClick={(e) => themeMenu.toggle(e.currentTarget)}
          >
            <I name="palette" size={15} />
          </button>
        </div>
      </aside>

      {!sidebarOpen ? (
        <button className="sidebar-backdrop" aria-label="Open sidebar" onClick={() => setSidebarOpen(true)} style={{ pointerEvents: "none" }} />
      ) : window.innerWidth <= 900 ? (
        <button className="sidebar-backdrop" aria-label="Close sidebar" onClick={() => setSidebarOpen(false)} />
      ) : null}

      <div className="main-col">
        <header className="topbar">
          <button className="tb-btn" aria-label="Toggle sidebar" onClick={() => setSidebarOpen((v) => !v)}>
            <I name="panelLeft" size={16} />
          </button>
          <div className="segmented" role="tablist" aria-label="Mode">
            {(
              [
                ["workspace", "Workspace", "layers", `/w/${ws}`],
                ["board", "Board", "board", `/w/${ws}/board`],
                ["vault", "Vault", "file", `/w/${ws}/vault`],
              ] as const
            ).map(([id, label, icon, to]) => (
              <button key={id} role="tab" aria-pressed={mode === id} onClick={() => nav(to)}>
                <I name={icon} size={14} />
                <span className="hide-mobile">{label}</span>
              </button>
            ))}
          </div>
          <div className="spacer" />
          <button
            className="tb-btn"
            onClick={() => {
              setFilesMode(false);
              setPaletteOpen(true);
            }}
            aria-label="Search"
          >
            <I name="search" size={15} />
            <span className="hide-mobile">Search</span>
            <span className="faint hide-mobile" style={{ fontSize: 11 }}>⌘K</span>
          </button>
          <button
            className="tb-btn"
            aria-label="Account"
            onClick={async () => {
              await api.logout();
              await refresh();
              nav("/login");
            }}
          >
            <I name="user" size={15} />
            <span className="hide-mobile" style={{ fontSize: 12.5 }}>{me?.name.split(" ")[0]}</span>
          </button>
        </header>
        <main className="content">
          <Outlet />
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
          {
            label: "New page",
            icon: "page",
            onSelect: () => nav(`/w/${ws}/page/Pages/Untitled?action=new`),
          },
          {
            label: "New database",
            icon: "database",
            onSelect: async () => {
              const name = window.prompt("Database name", "Projects");
              if (!name) return;
              const d = await api.createDatabase(ws, { name });
              nav(`/w/${ws}/db/${d.slug}`);
            },
          },
          { separator: true },
          { label: "Import / export", icon: "archive", hint: "soon", onSelect: () => {} },
        ]}
      />

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} ws={ws} mode={filesMode ? "files" : "all"} />
    </div>
  );
}

function TreeLevel({ nodes, ws, depth }: { nodes: TreeNode[]; ws: string; depth: number }) {
  const [openSet, setOpenSet] = useState<Set<string>>(() => new Set(nodes.slice(0, 2).map((n) => n.path)));
  // Database nodes are rendered in their own sidebar section already.
  const rendered = nodes.filter((n) => n.type !== "database");
  return (
    <>
      {rendered.map((n) => {
        if (n.type === "folder" || (n.type === "page" && n.children?.length)) {
          const open = openSet.has(n.path);
          return (
            <div key={n.path}>
              <button
                className="side-item"
                onClick={() =>
                  setOpenSet((s) => {
                    const next = new Set(s);
                    if (next.has(n.path)) next.delete(n.path);
                    else next.add(n.path);
                    return next;
                  })
                }
              >
                <span className="icon" style={{ display: "inline-flex", transform: open ? "rotate(90deg)" : "none" }}>
                  <I name="chevronRight" size={13} />
                </span>
                <I name="folder" size={15} className="icon" />
                <span className="label">{n.title}</span>
              </button>
              {open && n.children ? (
                <div className="tree-children">
                  <TreeLevel nodes={n.children} ws={ws} depth={depth + 1} />
                </div>
              ) : null}
            </div>
          );
        }

        return (
          <NavLink
            key={n.path}
            to={`/w/${ws}/page/${n.path.split("/").map(encodeURIComponent).join("/")}`}
            className={({ isActive }) => `side-item${isActive ? " active" : ""}`}
          >
            <span style={{ width: 13 }} />
            <I name="page" size={15} className="icon" />
            <span className="label">{n.title}</span>
          </NavLink>
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

export { EmptyState, ErrorState };
