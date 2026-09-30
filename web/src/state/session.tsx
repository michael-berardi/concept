import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api } from "@/api";
import type { Health, User, Workspace } from "@/api";

interface SessionState {
  me: User | null;
  workspaces: Workspace[];
  health: Health | null;
  loading: boolean;
  refresh: () => Promise<void>;
}

const SessionCtx = createContext<SessionState>({
  me: null,
  workspaces: [],
  health: null,
  loading: true,
  refresh: async () => {},
});

export function SessionProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<User | null>(null);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [health, setHealth] = useState<Health | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const h = await api.health().catch(() => null);
    setHealth(h);
    const user = await api.me();
    setMe(user);
    if (user) {
      setWorkspaces(await api.workspaces().catch(() => []));
    } else {
      setWorkspaces([]);
    }
  }, []);

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  return <SessionCtx.Provider value={{ me, workspaces, health, loading, refresh }}>{children}</SessionCtx.Provider>;
}

export const useSession = () => useContext(SessionCtx);
