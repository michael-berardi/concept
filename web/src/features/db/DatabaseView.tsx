import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api, ApiError } from "@/api";
import type { Database, DbRow, Filter, Sort } from "@/api";
import { Icon } from "@/ui/icons";
import { ErrorState, Loading, Menu, useMenu, useToast } from "@/ui/primitives";
import { applyView } from "@/lib/filters";
import { rankBetween } from "@/lib/rank";
import { BoardView } from "./BoardView";
import { TableView, ListView, CalendarView, GalleryView } from "./Views";
import { CardModal } from "./CardModal";

export function DatabaseView() {
  const { ws = "", slug = "" } = useParams();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const { toast } = useToast();
  const [db, setDb] = useState<Database | null>(null);
  const [rows, setRows] = useState<DbRow[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [tick, setTick] = useState(0);
  const [filters, setFilters] = useState<Filter[] | null>(null);
  const [sorts, setSorts] = useState<Sort[] | null>(null);
  const [q, setQ] = useState("");
  const filterMenu = useMenu();
  const sortMenu = useMenu();
  const viewMenu = useMenu();

  useEffect(() => {
    let on = true;
    setError(null);
    Promise.all([api.database(ws, slug), api.rows(ws, slug)])
      .then(([d, r]) => {
        if (!on) return;
        setDb(d);
        setRows(r.rows);
        if (!params.get("view") && d.views[0]) {
          setParams({ view: d.views[0].id }, { replace: true });
        }
      })
      .catch((e) => on && setError(e));
    return () => {
      on = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ws, slug, tick]);

  const activeViewId = params.get("view") ?? db?.views[0]?.id ?? "";
  const activeView = db?.views.find((v) => v.id === activeViewId);
  const openCardPath = params.get("card");

  const visibleRows = useMemo(() => {
    if (!db) return [];
    return applyView(rows, { filters, sorts, }, new Map(db.properties.map((p) => [p.key, p]))).filter((r) =>
      q.trim()
        ? String(r.properties.title ?? "").toLowerCase().includes(q.trim().toLowerCase())
        : true,
    );
  }, [rows, filters, sorts, q, db]);

  const commitProp = useCallback(
    async (row: DbRow, key: string, value: unknown) => {
      try {
        const updated = await api.updateRow(ws, slug, row.id, { properties: { ...row.properties, [key]: value } }, row.contentHash);
        setRows((rs) => rs.map((r) => (r.id === row.id ? updated : r)));
      } catch (e) {
        toast(e instanceof Error ? e.message : "Update failed", "error");
      }
    },
    [ws, slug, toast],
  );

  const newRow = useCallback(
    async (group?: string) => {
      if (!db) return;
      const titleProp = db.properties.find((p) => p.type === "title");
      if (!titleProp) return;
      const name = window.prompt("Name", "Untitled");
      if (!name) return;
      const props: Record<string, unknown> = { [titleProp.key]: name };
      const groupBy = activeView?.groupBy ?? db.properties.find((p) => p.type === "status")?.key;
      const groupProp = db.properties.find((p) => p.key === groupBy);
      if (group) props[groupBy ?? "status"] = group;
      void groupProp;
      try {
        const created = await api.createRow(ws, slug, { properties: props });
        setRows((rs) => [...rs, created]);
        if (activeView?.type === "board" || !activeView) {
          setParams({ view: activeViewId, card: created.path });
        }
      } catch (e) {
        toast(e instanceof Error ? e.message : "Could not create row", "error");
      }
    },
    [db, ws, slug, activeView, activeViewId, setParams, toast],
  );

  const deleteRow = useCallback(
    async (row: DbRow) => {
      try {
        await api.deleteRow(ws, slug, row.id);
        setRows((rs) => rs.filter((r) => r.id !== row.id));
      } catch (e) {
        toast(e instanceof Error ? e.message : "Delete failed", "error");
      }
    },
    [ws, slug, toast],
  );

  if (error) return <ErrorState error={error} retry={() => setTick((t) => t + 1)} />;
  if (!db) return <Loading />;

  const openRow = visibleRows.find((r) => r.path === openCardPath) ?? rows.find((r) => r.path === openCardPath);

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <div className="db-toolbar">
        <div style={{ display: "flex", alignItems: "center", gap: 2, minWidth: 0 }}>
          <Icon name="database" size={15} className="faint" />
          <strong style={{ fontSize: 13.5, fontWeight: 600, marginRight: 8, whiteSpace: "nowrap" }}>{db.name}</strong>
          <div style={{ display: "flex", gap: 2, overflowX: "auto" }}>
            {db.views.map((v) => (
              <button
                key={v.id}
                className="tb-btn"
                aria-pressed={v.id === activeViewId}
                onClick={() => setParams({ view: v.id })}
                style={{ gap: 5 }}
              >
                <Icon name={viewIcon(v.type)} size={13} />
                <span className="hide-mobile">{v.name}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="spacer" />
        <input className="input" style={{ width: 160, height: 28 }} placeholder="Filter by name" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search rows" />
        <button className={`tb-btn${filters?.length ? " is-on" : ""}`} onClick={(e) => filterMenu.toggle(e.currentTarget)} aria-label="Filters">
          <Icon name="filter" size={14} />
          <span className="hide-mobile">Filter{filters?.length ? ` · ${filters.length}` : ""}</span>
        </button>
        <button className={`tb-btn${sorts?.length ? " is-on" : ""}`} onClick={(e) => sortMenu.toggle(e.currentTarget)} aria-label="Sort">
          <Icon name="sort" size={14} />
          <span className="hide-mobile">Sort</span>
        </button>
        <button className="btn sm primary" onClick={() => newRow(activeView?.type === "board" ? "" : undefined)}>
          <Icon name="plus" size={13} /> New
        </button>
      </div>

      <Menu
        open={filterMenu.open}
        onClose={filterMenu.close}
        anchor={filterMenu.anchor}
        width={280}
        items={[
          ...(filters ?? []).map((f, i) => ({
            label: `${f.key} ${f.op} ${f.value ?? ""}`,
            icon: "filter",
            onSelect: () => setFilters((fs) => (fs ?? []).filter((_, j) => j !== i)),
          })),
          ...(filters?.length ? [{ separator: true } as const] : []),
          ...db.properties
            .filter((p) => ["status", "select", "checkbox", "number", "date"].includes(p.type))
            .flatMap((p) => [
              {
                label: `${p.name} is not empty`,
                icon: "plus",
                onSelect: () => setFilters((fs) => [...(fs ?? []), { key: p.key, op: "notempty" as const }]),
              },
              ...(p.options?.slice(0, 4) ?? []).map((o) => ({
                label: `${p.name} = ${o.name ?? o.id}`,
                icon: "plus",
                onSelect: () => setFilters((fs) => [...(fs ?? []), { key: p.key, op: "eq" as const, value: o.id }]),
              })),
            ]),
          {
            label: "Clear all filters",
            icon: "x",
            danger: true,
            onSelect: () => setFilters([]),
          },
        ]}
      />
      <Menu
        open={sortMenu.open}
        onClose={sortMenu.close}
        anchor={sortMenu.anchor}
        width={260}
        items={[
          ...(sorts ?? []).map((s, i) => ({
            label: `${s.key} ${s.dir}`,
            icon: "sort",
            onSelect: () => setSorts((ss) => (ss ?? []).filter((_, j) => j !== i)),
          })),
          ...(sorts?.length ? [{ separator: true } as const] : []),
          ...db.properties.map((p) => ({
            label: `Sort by ${p.name} ascending`,
            icon: "plus",
            onSelect: () => setSorts((ss) => [...(ss ?? []), { key: p.key, dir: "asc" as const }]),
          })),
          {
            label: "Clear sort",
            icon: "x",
            danger: true,
            onSelect: () => setSorts([]),
          },
        ]}
      />

      <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
        {activeView?.type === "board" ? (
          <BoardView
            ws={ws}
            db={db}
            viewId={activeView.id}
            rows={visibleRows}
            onRows={setRows}
            onOpenCard={(r) => setParams({ view: activeViewId, card: r.path })}
            onNewRow={(group) => newRow(group)}
          />
        ) : activeView?.type === "list" ? (
          <ListView db={db} viewId={activeView.id} rows={visibleRows} onOpenCard={(r) => setParams({ view: activeViewId, card: r.path })} onNewRow={() => newRow()} />
        ) : activeView?.type === "calendar" ? (
          <CalendarView db={db} viewId={activeView.id} rows={visibleRows} onOpenCard={(r) => setParams({ view: activeViewId, card: r.path })} />
        ) : activeView?.type === "gallery" ? (
          <GalleryView db={db} rows={visibleRows} onOpenCard={(r) => setParams({ view: activeViewId, card: r.path })} onNewRow={() => newRow()} />
        ) : (
          <div style={{ padding: "8px 16px 40px" }}>
            <TableView
              ws={ws}
              db={db}
              viewId={activeView?.id ?? ""}
              rows={visibleRows}
              onCommitProp={commitProp}
              onOpenCard={(r) => setParams({ view: activeViewId, card: r.path })}
              onNewRow={() => newRow()}
              onDeleteRow={deleteRow}
            />
          </div>
        )}
      </div>

      {openRow ? (
        <CardModal
          ws={ws}
          db={db}
          row={openRow}
          onClose={() => {
            const next = new URLSearchParams(params);
            next.delete("card");
            setParams(next);
          }}
          onChanged={(updated) => setRows((rs) => rs.map((r) => (r.id === updated.id ? updated : r)))}
        />
      ) : null}
    </div>
  );
}

function viewIcon(type: string): string {
  switch (type) {
    case "board":
      return "board";
    case "table":
      return "table";
    case "list":
      return "list";
    case "calendar":
      return "calendar";
    case "gallery":
      return "gallery";
    default:
      return "table";
  }
}

export { ApiError, rankBetween };
