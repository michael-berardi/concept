import { createContext, useContext, useState, type ReactNode } from "react";

/** Right-hand context panel (backlinks, outline, local graph). */
const KEY = "concept.panel";
const Ctx = createContext<{ open: boolean; toggle: () => void }>({ open: false, toggle: () => {} });

export function PanelProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(() => {
    try {
      const v = localStorage.getItem(KEY);
      return v === null ? window.innerWidth > 1280 : v === "1";
    } catch {
      return false;
    }
  });
  const toggle = () =>
    setOpen((v) => {
      try {
        localStorage.setItem(KEY, v ? "0" : "1");
      } catch {
        /* ignore */
      }
      return !v;
    });
  return <Ctx.Provider value={{ open, toggle }}>{children}</Ctx.Provider>;
}

export const usePanel = () => useContext(Ctx);
