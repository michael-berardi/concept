import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

/** Open page tabs across the workspace (Obsidian-style). Kept per browser session. */
export interface Tab {
  path: string;
  title: string;
}

interface TabsState {
  tabs: Tab[];
  open: (path: string, title: string) => void;
  rename: (path: string, title: string) => void;
  close: (path: string) => Tab | null;
}

const KEY = "concept.tabs";
const TabsCtx = createContext<TabsState>({ tabs: [], open: () => {}, rename: () => {}, close: () => null });

function load(): Tab[] {
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Tab[]) : [];
  } catch {
    return [];
  }
}

export function TabsProvider({ children }: { children: ReactNode }) {
  const [tabs, setTabs] = useState<Tab[]>(load);

  const commit = useCallback((next: Tab[]) => {
    setTabs(next);
    try {
      sessionStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* storage unavailable: tabs stay in memory */
    }
  }, []);

  const open = useCallback(
    (path: string, title: string) =>
      setTabs((ts) => {
        const exists = ts.find((t) => t.path === path);
        const next = exists ? ts.map((t) => (t.path === path && t.title !== title ? { ...t, title } : t)) : [...ts.slice(-9), { path, title }];
        try {
          sessionStorage.setItem(KEY, JSON.stringify(next));
        } catch {
          /* ignore */
        }
        return next;
      }),
    [],
  );
  const rename = useCallback(
    (path: string, title: string) => commit(tabs.map((t) => (t.path === path ? { ...t, title } : t))),
    [commit, tabs],
  );
  const close = useCallback(
    (path: string) => {
      const i = tabs.findIndex((t) => t.path === path);
      const next = tabs.filter((t) => t.path !== path);
      commit(next);
      return next[Math.min(i, next.length - 1)] ?? null;
    },
    [commit, tabs],
  );

  const value = useMemo(() => ({ tabs, open, rename, close }), [tabs, open, rename, close]);
  return <TabsCtx.Provider value={value}>{children}</TabsCtx.Provider>;
}

export const useTabs = () => useContext(TabsCtx);
