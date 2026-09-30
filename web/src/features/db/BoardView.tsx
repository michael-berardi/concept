import { useMemo, useState } from "react";
import {
  DndContext, DragOverlay, PointerSensor, useSensor, useSensors,
  useDroppable, useDraggable,
} from "@dnd-kit/core";
import type { DragEndEvent, DragStartEvent } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Database, DbRow, SelectOption } from "@/api";
import { api } from "@/api";
import { Icon } from "@/ui/icons";
import { Avatar } from "./PropEditor";
import { PropertyValue } from "./PropEditor";
import { byRank, rankBetween, recomputeRanks, RankError } from "@/lib/rank";
import { groupRows } from "@/lib/filters";
import { formatMoney, dueTone, relativeTime } from "@/lib/format";

interface BoardProps {
  ws: string;
  db: Database;
  viewId: string;
  rows: DbRow[];
  onRows: (rows: DbRow[]) => void;
  onOpenCard: (row: DbRow) => void;
  onNewRow: (group: string) => void;
}

/** Trello-quality board: columns from a group property, fractional ranks. */
export function BoardView({ ws, db, viewId, rows, onRows, onOpenCard, onNewRow }: BoardProps) {
  const view = db.views.find((v) => v.id === viewId) ?? db.views.find((v) => v.type === "board");
  const groupBy = view?.groupBy ?? db.properties.find((p) => p.type === "status")?.key ?? "status";
  const prop = db.properties.find((p) => p.key === groupBy);
  const options: SelectOption[] = prop?.options ?? [];
  const [active, setActive] = useState<DbRow | null>(null);
  const [localOrder, setLocalOrder] = useState<Record<string, DbRow[]> | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const visible = view?.visible ?? [];
  const showProps = db.properties.filter((p) => visible.includes(p.key));

  const groups = useMemo(() => {
    const ordered = localOrder ?? null;
    const base = groupRows(
      [...rows].sort(byRank),
      groupBy,
      options.map((o) => ({ id: o.id, name: o.name ?? o.id })),
    );
    if (!ordered) return base;
    return base.map((g) => ({ ...g, rows: ordered[g.value ?? "_none"] ?? g.rows }));
  }, [rows, groupBy, options, localOrder]);

  const handleDragStart = (e: DragStartEvent) => {
    setActive(rows.find((r) => r.id === e.active.id) ?? null);
  };

  const handleDragEnd = async (e: DragEndEvent) => {
    setActive(null);
    const { active: a, over } = e;
    if (!over || a.id === over.id) {
      setLocalOrder(null);
      return;
    }
    const targetGroupRaw = (over.data.current?.group as string | undefined) ?? null;
    const overRowId = over.data.current?.rowId as string | undefined;

    // Build per-group ordered lists from current visible order.
    const byGroup = new Map<string | null, DbRow[]>();
    for (const g of groups) byGroup.set(g.value, [...g.rows]);
    const sourceGroup = [...byGroup.entries()].find(([, list]) => list.some((r) => r.id === a.id))?.[0] ?? null;
    const targetGroup = targetGroupRaw !== undefined ? targetGroupRaw : sourceGroup;
    if (targetGroup === undefined) return;

    const source = byGroup.get(sourceGroup) ?? [];
    const target = byGroup.get(targetGroup) ?? [];
    const row = source.find((r) => r.id === a.id);
    if (!row) return;

    let next: DbRow[];
    if (sourceGroup === targetGroup) {
      const fromIdx = target.findIndex((r) => r.id === a.id);
      const overIdx = overRowId ? target.findIndex((r) => r.id === overRowId) : target.length - 1;
      if (fromIdx < 0 || overIdx < 0) return;
      target.splice(fromIdx, 1);
      target.splice(overIdx, 0, row);
      next = target;
    } else {
      source.splice(source.findIndex((r) => r.id === a.id), 1);
      const overIdx = overRowId ? target.findIndex((r) => r.id === overRowId) : target.length;
      if (overRowId && overIdx >= 0) {
        target.splice(overIdx, 0, { ...row, properties: { ...row.properties, [groupBy]: targetGroup ?? undefined } });
      } else {
        target.push({ ...row, properties: { ...row.properties, [groupBy]: targetGroup ?? undefined } });
      }
      next = target;
    }

    // Optimistic ranks within the target column.
    let optimistic = target;
    try {
      const ids = next.map((r) => r.id);
      const movedIdx = ids.indexOf(row.id);
      const prev = movedIdx > 0 ? next[movedIdx - 1] : null;
      const after = movedIdx < ids.length - 1 ? next[movedIdx + 1] : null;
      const rank = rankBetween(prev?.rank ?? null, after?.rank ?? null);
      optimistic = next.map((r) => (r.id === row.id ? { ...r, rank } : r));
    } catch (err) {
      if (!((err as RankError).code === "rank_overflow")) throw err;
      const ranks = recomputeRanks(next.map((r) => r.id));
      optimistic = next.map((r) => ({ ...r, rank: ranks[r.id] }));
    }

    // Snapshot for optimistic UI
    const snapshot = new Map<string, DbRow[]>();
    for (const [k, v] of byGroup) snapshot.set(k ?? "_none", v);
    snapshot.set(sourceGroup ?? "_none", sourceGroup === targetGroup ? optimistic : source);
    snapshot.set(targetGroup ?? "_none", optimistic);
    setLocalOrder(Object.fromEntries([...snapshot.entries()].map(([k, v]) => [k, v])));

    try {
      const res = await api.moveRow(ws, db.slug, row.id, {
        status: (targetGroup ?? undefined) as string | undefined,
        beforeId: null,
        afterId: null,
      });
      onRows(res.rows);
    } catch {
      onRows(rows); // revert to authoritative state on failure
    } finally {
      setLocalOrder(null);
    }
  };

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="board" role="list">
        {groups.map((g) => (
          <BoardColumn
            key={String(g.value)}
            ws={ws}
            db={db}
            groupValue={g.value}
            label={g.label}
            rows={g.rows}
            showProps={showProps}
            groupBy={groupBy}
            onOpenCard={onOpenCard}
            onNewRow={onNewRow}
          />
        ))}
        <button className="board-add" onClick={() => onNewRow(options[0]?.id ?? "")}>
          <Icon name="plus" size={14} />
          <span className="hide-mobile">Add column view</span>
        </button>
      </div>
      <DragOverlay dropAnimation={null}>
        {active ? (
          <div style={{ width: 272 }}>
            <CardFace row={active} db={db} showProps={showProps} dragging onOpenCard={() => {}} />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

function BoardColumn({
  ws, db, groupValue, label, rows, showProps, groupBy, onOpenCard, onNewRow,
}: {
  ws: string;
  db: Database;
  groupValue: string | null;
  label: string;
  rows: DbRow[];
  showProps: Database["properties"];
  groupBy: string;
  onOpenCard: (r: DbRow) => void;
  onNewRow: (group: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: "col:" + String(groupValue), data: { group: groupValue } });
  return (
    <section
      ref={setNodeRef}
      className={`board-col${isOver ? " drop" : ""}`}
      aria-label={label}
    >
      <header style={{ display: "flex", alignItems: "center", gap: 8, padding: "2px 4px 10px" }}>
        <span className="faint" style={{ fontSize: 12, fontWeight: 600 }}>{label}</span>
        <span className="faint num" style={{ fontSize: 11.5 }}>{rows.length}</span>
        <span style={{ flex: 1 }} />
        <button className="tb-btn" style={{ height: 22, padding: "0 4px" }} aria-label={`Add card to ${label}`} onClick={() => onNewRow(groupValue ?? "")}>
          <Icon name="plus" size={14} />
        </button>
      </header>
      <SortableContext items={rows.map((r) => r.id)} strategy={verticalListSortingStrategy}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {rows.map((r) => (
            <SortableCard key={r.id} row={r} db={db} groupValue={groupValue} groupBy={groupBy} showProps={showProps} onOpenCard={onOpenCard} ws={ws} />
          ))}
        </div>
      </SortableContext>
      {rows.length === 0 ? (
        <div
          className="faint"
          style={{ fontSize: 12, border: "1px dashed var(--border)", borderRadius: 8, padding: "18px 12px", textAlign: "center" }}
        >
          Drop cards here
        </div>
      ) : null}
    </section>
  );
}

function SortableCard({
  row, db, groupValue, groupBy, showProps, onOpenCard,
}: {
  row: DbRow;
  db: Database;
  groupValue: string | null;
  groupBy: string;
  showProps: Database["properties"];
  onOpenCard: (r: DbRow) => void;
  ws: string;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: row.id,
    data: { group: groupValue, rowId: row.id },
  });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.35 : 1,
      }}
    >
      <CardFace row={row} db={db} showProps={showProps} onOpenCard={() => onOpenCard(row)} groupBy={groupBy} />
    </div>
  );
}

function CardFace({
  row, db, showProps, dragging, onOpenCard, groupBy,
}: {
  row: DbRow;
  db: Database;
  showProps: Database["properties"];
  dragging?: boolean;
  onOpenCard: () => void;
  groupBy?: string;
}) {
  const tone = dueTone(row.properties.due as string);
  const tags = (row.properties.tags as string[]) ?? [];
  return (
    <article
      className="card"
      data-dragging={dragging || undefined}
      onClick={onOpenCard}
      onKeyDown={(e) => e.key === "Enter" && onOpenCard()}
      role="button"
      tabIndex={0}
      style={{ cursor: dragging ? "grabbing" : "pointer" }}
    >
      {row.cover ? <div className="card-cover" style={{ backgroundImage: `url(${row.cover})` }} /> : null}
      <div style={{ display: "flex", gap: 6, alignItems: "flex-start" }}>
        <div style={{ flex: 1, fontSize: 13.5, fontWeight: 500, lineHeight: 1.4 }}>{String(row.properties.title ?? "Untitled")}</div>
        <span className="card-grip faint" aria-hidden="true">
          <Icon name="grip" size={13} />
        </span>
      </div>
      {tags.length > 0 ? (
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 8 }}>
          {tags.map((t) => (
            <span key={t} className="pill">
              {t}
            </span>
          ))}
        </div>
      ) : null}
      {showProps.length > 0 ? (
        <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 10, flexWrap: "wrap" }}>
          {showProps
            .filter((p) => p.key !== groupBy && p.key !== "tags" && row.properties[p.key] !== null && row.properties[p.key] !== undefined && row.properties[p.key] !== "")
            .slice(0, 3)
            .map((p) => (
              <span key={p.key} style={{ fontSize: 12 }} className={p.key === "due" && tone === "overdue" ? "" : "muted"}>
                {p.key === "due" ? (
                  <span style={{ color: tone === "overdue" ? "var(--danger)" : tone === "today" ? "var(--warn)" : undefined }}>
                    <Icon name="clock" size={11} style={{ marginRight: 4, verticalAlign: "-1px" }} />
                    {relativeTime(`${row.properties.due}T09:00:00Z`)}
                  </span>
                ) : (
                  <PropertyValue prop={p} value={row.properties[p.key]} />
                )}
              </span>
            ))}
        </div>
      ) : null}
      {row.properties.owner ? (
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
          <Avatar name={String(row.properties.owner)} size={20} />
        </div>
      ) : null}
    </article>
  );
}

export function boardSummary(db: Database, rows: DbRow[]): string {
  const groupBy = db.views.find((v) => v.type === "board")?.groupBy ?? "status";
  void groupBy;
  const total = rows.reduce((n, r) => n + Number(r.properties.value ?? 0), 0);
  return formatMoney(total);
}
