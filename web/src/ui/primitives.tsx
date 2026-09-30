import {
  createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef,
  useState, type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Icon } from "./icons";

/* ---------------- Overlay dismissal ---------------- */

export function useDismiss(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("mousedown", onDown, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("mousedown", onDown, true);
    };
  }, [open, onClose]);
  return ref;
}

/* ---------------- Menu (popover) ---------------- */

export interface MenuItemDef {
  label?: string;
  icon?: string;
  danger?: boolean;
  onSelect?: () => void;
  separator?: boolean;
  hint?: string;
  checked?: boolean;
}

export function Menu({
  open, onClose, anchor, items, width = 210,
}: {
  open: boolean;
  onClose: () => void;
  anchor: HTMLElement | null;
  items: MenuItemDef[];
  width?: number;
}) {
  const ref = useDismiss(open, onClose);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    if (!open || !anchor) return;
    const r = anchor.getBoundingClientRect();
    const left = Math.min(r.left, window.innerWidth - width - 8);
    const below = r.bottom + 6;
    const est = items.length * 32 + 12;
    const top = below + est > window.innerHeight - 8 ? Math.max(8, r.top - est - 6) : below;
    setPos({ left: Math.max(8, left), top });
  }, [open, anchor, items.length, width]);
  if (!open || !pos) return null;
  return createPortal(
    <div ref={ref} className="menu" style={{ left: pos.left, top: pos.top, width }} role="menu">
      {items.map((it, i) =>
        it.separator ? (
          <div key={i} className="menu-sep" />
        ) : (
          <button
            key={i}
            role="menuitem"
            className={`menu-item${it.danger ? " danger" : ""}`}
            onClick={() => {
              onClose();
              it.onSelect?.();
            }}
          >
            {it.icon ? <Icon name={it.icon} size={15} /> : it.checked ? <Icon name="check" size={15} /> : <span style={{ width: 15 }} />}
            <span style={{ flex: 1 }}>{it.label}</span>
            {it.hint ? <span className="faint" style={{ fontSize: 11 }}>{it.hint}</span> : null}
          </button>
        ),
      )}
    </div>,
    document.body,
  );
}

export function useMenu(): {
  open: boolean;
  anchor: HTMLElement | null;
  toggle: (el: HTMLElement) => void;
  close: () => void;
  setOpen: (v: boolean) => void;
} {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const toggle = useCallback((el: HTMLElement) => {
    setAnchor(el);
    setOpen((v) => !v);
  }, []);
  return { open, anchor, toggle, close: () => setOpen(false), setOpen };
}

/* ---------------- Modal ---------------- */

export function Modal({
  title, onClose, children, width = 560, footer,
}: {
  title?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  width?: number;
  footer?: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return createPortal(
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-card" style={{ maxWidth: width }} role="dialog" aria-modal="true">
        {title ? (
          <div className="hairline" style={{ display: "flex", alignItems: "center", padding: "12px 16px", gap: 8 }}>
            <div style={{ flex: 1, fontWeight: 550, fontSize: 13.5 }}>{title}</div>
            <button className="tb-btn" onClick={onClose} aria-label="Close">
              <Icon name="x" size={15} />
            </button>
          </div>
        ) : null}
        <div style={{ overflow: "auto", padding: 16 }}>{children}</div>
        {footer ? <div className="hairline" style={{ borderTop: "1px solid var(--border)", borderBottom: "none", padding: "10px 16px", display: "flex", justifyContent: "flex-end", gap: 8 }}>{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}

/* ---------------- States ---------------- */

export function EmptyState({ icon, title, hint, action }: { icon?: string; title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="state">
      {icon ? <Icon name={icon} size={22} className="icon" /> : null}
      <h3>{title}</h3>
      {hint ? <p>{hint}</p> : null}
      {action}
    </div>
  );
}

export function ErrorState({ error, retry }: { error: unknown; retry?: () => void }) {
  const code = (error as { code?: string })?.code ?? "unknown_error";
  const message = error instanceof Error ? error.message.replace(/^[a-z_]+: /, "") : String(error);
  return (
    <div className="state">
      <Icon name="inbox" size={22} className="icon" />
      <h3>Something went sideways</h3>
      <p>{message}</p>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <span className="error-code">{code}</span>
        {retry ? (
          <button className="btn sm" onClick={retry}>
            Try again
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function Spinner({ size = 16 }: { size?: number }) {
  return <span className="spinner" style={{ width: size, height: size }} aria-label="Loading" />;
}

export function Loading() {
  return (
    <div className="state" aria-label="Loading">
      <Spinner size={18} />
    </div>
  );
}

export function SkeletonRows({ rows = 6 }: { rows?: number }) {
  return (
    <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="skeleton" style={{ height: 14, width: `${88 - i * 7}%` }} />
      ))}
    </div>
  );
}

/* ---------------- Theme ---------------- */

export const THEMES = [
  { id: "oled", name: "OLED", swatch: "#000000" },
  { id: "graphite", name: "Graphite", swatch: "#232327" },
  { id: "paper", name: "Paper", swatch: "#f3efe7" },
  { id: "snow", name: "Snow", swatch: "#f2f4f6" },
  { id: "midnight", name: "Midnight", swatch: "#131a29" },
  { id: "forest", name: "Forest", swatch: "#171f1a" },
] as const;

export type ThemeId = (typeof THEMES)[number]["id"];

const ThemeCtx = createContext<{ theme: ThemeId; setTheme: (t: ThemeId) => void }>({
  theme: "oled",
  setTheme: () => {},
});

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeId>(() => {
    const saved = localStorage.getItem("concept.theme") as ThemeId | null;
    return saved && THEMES.some((t) => t.id === saved) ? saved : "oled";
  });
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("concept.theme", theme);
    } catch {
      /* private mode */
    }
  }, [theme]);
  const setTheme = useCallback((t: ThemeId) => setThemeState(t), []);
  return <ThemeCtx.Provider value={{ theme, setTheme }}>{children}</ThemeCtx.Provider>;
}

export const useTheme = () => useContext(ThemeCtx);

/* ---------------- Toasts ---------------- */

interface Toast {
  id: number;
  message: string;
  kind: "info" | "error";
}
const ToastCtx = createContext<{ toast: (message: string, kind?: "info" | "error") => void }>({ toast: () => {} });
let toastSeq = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toast = useCallback((message: string, kind: "info" | "error" = "info") => {
    const id = toastSeq++;
    setToasts((t) => [...t, { id, message, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
  }, []);
  return (
    <ToastCtx.Provider value={{ toast }}>
      {children}
      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast${t.kind === "error" ? " error" : ""}`} role="status">
            {t.message}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);
