import { useMemo, useState } from "react";
import type { Database, DbRow } from "@/api";
import { Icon } from "@/ui/icons";
import { EmptyState } from "@/ui/primitives";
import { PropertyEditor, PropertyValue } from "./PropEditor";
import { formatMoney, formatDay } from "@/lib/format";
import { byRank } from "@/lib/rank";

/* ------------------------------ Table ------------------------------ */

export function TableView({
  ws, db, viewId, rows, onCommitProp, onOpenCard, onNewRow, onDeleteRow,
}: {
  ws?: string;
  db: Database;
  viewId: string;
  rows: DbRow[];
  onCommitProp: (row: DbRow, key: string, value: unknown) => void;
  onOpenCard: (row: DbRow) => void;
  onNewRow: () => void;
  onDeleteRow: (row: DbRow) => void;
}) {
  const view = db.views.find((v) => v.id === viewId);
  const cols = db.properties.filter((p) => p.type === "title" || !view?.visible || view.visible.includes(p.key));
  const sorted = useMemo(() => [...rows].sort(byRank), [rows]);
  const [menuRow, setMenuRow] = useState<string | null>(null);

  if (rows.length === 0) {
    return (
      <EmptyState
        icon="table"
        title="Empty table"
        hint="Rows are Markdown files — one file per record, readable everywhere."
        action={
          <button className="btn primary" onClick={onNewRow}>
            <Icon name="plus" size={14} /> New row
          </button>
        }
      />
    );
  }

  return (
    <div className="table-wrap">
      <table className="db-table" role="table">
        <thead>
          <tr>
            {cols.map((c) => (
              <th key={c.key}>
                <span style={{ display: "inline-flex", gap: 5, alignItems: "center" }}>
                  <Icon name={propIcon(c.type)} size={12} className="faint" />
                  {c.name}
                </span>
              </th>
            ))}
            <th style={{ width: 40 }} />
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={r.id} className="db-row" onClick={() => onOpenCard(r)}>
              {cols.map((c) => (
                <td key={c.key} onClick={(e) => c.type === "title" && onOpenCard(r)}>
                  <PropertyEditor ws={ws} db={db} prop={c} value={r.properties[c.key]} onCommit={(v) => onCommitProp(r, c.key, v)} />
                </td>
              ))}
              <td onClick={(e) => e.stopPropagation()} style={{ textAlign: "right", position: "relative" }}>
                <button className="tb-btn" style={{ height: 22, padding: "0 4px" }} aria-label="Row actions" onClick={() => setMenuRow(menuRow === r.id ? null : r.id)}>
                  <Icon name="more" size={14} />
                </button>
                {menuRow === r.id ? (
                  <div className="menu" style={{ position: "absolute", right: 8, top: 26, width: 160 }} onMouseLeave={() => setMenuRow(null)}>
                    <button className="menu-item" onClick={() => onOpenCard(r)}>
                      <Icon name="external" size={14} /> Open card
                    </button>
                    <button
                      className="menu-item danger"
                      onClick={() => {
                        setMenuRow(null);
                        onDeleteRow(r);
                      }}
                    >
                      <Icon name="trash" size={14} /> Delete
                    </button>
                  </div>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------ List ------------------------------ */

export function ListView({
  db, viewId, rows, onOpenCard, onNewRow,
}: {
  db: Database;
  viewId: string;
  rows: DbRow[];
  onOpenCard: (row: DbRow) => void;
  onNewRow: () => void;
}) {
  const view = db.views.find((v) => v.id === viewId);
  const visible = view?.visible ?? [];
  const showProps = db.properties.filter((p) => visible.includes(p.key));
  const sorted = useMemo(() => [...rows].sort(byRank), [rows]);

  if (rows.length === 0) {
    return <EmptyState icon="list" title="Nothing here yet" hint="This list fills up as records are added." action={<button className="btn primary" onClick={onNewRow}>New row</button>} />;
  }

  return (
    <div style={{ maxWidth: 860, margin: "0 auto", padding: "12px 4px" }}>
      {sorted.map((r) => (
        <button key={r.id} className="side-item" style={{ height: 48, borderBottom: "1px solid var(--border)", borderRadius: 0 }} onClick={() => onOpenCard(r)}>
          <Icon name="file" size={15} className="icon" />
          <span className="label" style={{ fontSize: 13.5, fontWeight: 500 }}>
            {String(r.properties.title ?? "Untitled")}
          </span>
          <span style={{ display: "flex", gap: 12, alignItems: "center" }}>
            {showProps.slice(0, 3).map((p) => (
              <span key={p.key} style={{ fontSize: 12 }} className="muted">
                <PropertyValue prop={p} value={r.properties[p.key]} />
              </span>
            ))}
          </span>
        </button>
      ))}
    </div>
  );
}

/* ------------------------------ Calendar ------------------------------ */

export function CalendarView({
  db, viewId, rows, onOpenCard,
}: {
  db: Database;
  viewId: string;
  rows: DbRow[];
  onOpenCard: (row: DbRow) => void;
}) {
  const view = db.views.find((v) => v.id === viewId);
  const dateKey = view?.calendarDate ?? "due";
  const [monthOffset, setMonthOffset] = useState(0);

  const base = new Date();
  const first = new Date(base.getFullYear(), base.getMonth() + monthOffset, 1);
  const startDow = (first.getDay() + 6) % 7; // Monday start
  const daysInMonth = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const todayKey = new Date().toISOString().slice(0, 10);

  const byDay = useMemo(() => {
    const map = new Map<string, DbRow[]>();
    for (const r of rows) {
      const d = r.properties[dateKey] as string | undefined;
      if (!d) continue;
      const key = String(d).slice(0, 10);
      map.set(key, [...(map.get(key) ?? []), r]);
    }
    return map;
  }, [rows, dateKey]);

  const cells: (string | null)[] = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push(`${first.getFullYear()}-${String(first.getMonth() + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
  }

  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <button className="tb-btn" onClick={() => setMonthOffset((m) => m - 1)} aria-label="Previous month">
          <Icon name="chevronUp" size={14} style={{ transform: "rotate(-90deg)" }} />
        </button>
        <strong style={{ fontSize: 13.5, minWidth: 140, textAlign: "center" }}>
          {first.toLocaleDateString("en-US", { month: "long", year: "numeric" })}
        </strong>
        <button className="tb-btn" onClick={() => setMonthOffset((m) => m + 1)} aria-label="Next month">
          <Icon name="chevronUp" size={14} style={{ transform: "rotate(90deg)" }} />
        </button>
        <span className="faint" style={{ fontSize: 12 }}>{byDay.size} dated records</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 1, background: "var(--border)", border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden" }}>
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
          <div key={d} className="faint" style={{ background: "var(--surface-2)", fontSize: 11, fontWeight: 600, padding: "6px 8px" }}>
            {d}
          </div>
        ))}
        {cells.map((key, i) => (
          <div key={i} style={{ background: "var(--surface)", minHeight: 92, padding: 6 }}>
            {key ? (
              <>
                <div className={`num faint`} style={{ fontSize: 11, marginBottom: 4, color: key === todayKey ? "var(--accent)" : undefined, fontWeight: key === todayKey ? 650 : 400 }}>
                  {Number(key.slice(8))}
                </div>
                {(byDay.get(key) ?? []).slice(0, 3).map((r) => (
                  <button key={r.id} className="cal-card" onClick={() => onOpenCard(r)} title={String(r.properties.title)}>
                    {String(r.properties.title)}
                  </button>
                ))}
                {(byDay.get(key)?.length ?? 0) > 3 ? <div className="faint" style={{ fontSize: 10.5, marginTop: 2 }}>+{(byDay.get(key)?.length ?? 0) - 3} more</div> : null}
              </>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------ Gallery ------------------------------ */

export function GalleryView({
  rows, onOpenCard, onNewRow,
}: {
  db: Database;
  rows: DbRow[];
  onOpenCard: (row: DbRow) => void;
  onNewRow: () => void;
}) {
  if (rows.length === 0) {
    return <EmptyState icon="gallery" title="No cards yet" hint="Gallery view shows a card per record with its cover and key properties." action={<button className="btn primary" onClick={onNewRow}>New row</button>} />;
  }
  return (
    <div className="gallery">
      {rows.map((r) => (
        <article key={r.id} className="card gallery-card" onClick={() => onOpenCard(r)} role="button" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && onOpenCard(r)}>
          <div className="gallery-cover" style={{ background: "var(--surface-2)", display: "grid", placeItems: "center" }}>
            <span style={{ fontSize: 22, fontWeight: 650, color: "var(--text-3)", letterSpacing: "-0.02em" }}>
              {String(r.properties.title ?? "?").slice(0, 1).toUpperCase()}
            </span>
          </div>
          <div style={{ padding: "10px 12px" }}>
            <div style={{ fontSize: 13.5, fontWeight: 500 }}>{String(r.properties.title ?? "Untitled")}</div>
            <div className="muted num" style={{ fontSize: 12, marginTop: 2 }}>
              {r.properties.value !== undefined && r.properties.value !== null ? formatMoney(Number(r.properties.value)) : formatDay(String(r.properties.due ?? "")) || ""}
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}

function propIcon(type: string): string {
  switch (type) {
    case "status":
    case "select":
      return "kanban";
    case "date":
      return "calendar";
    case "person":
      return "user";
    case "relation":
      return "cube";
    case "number":
      return "sort";
    case "multi_select":
      return "tag";
    case "checkbox":
      return "check";
    default:
      return "pencil";
  }
}
