/** Database view filter / sort / group engine. Pure functions over row objects. */
import type { Filter, Sort, Property } from "@/api/types";

export type RowLike = {
  id: string;
  properties: Record<string, unknown>;
  rank?: string | null;
};

function isEmpty(v: unknown): boolean {
  return (
    v === undefined ||
    v === null ||
    v === "" ||
    (Array.isArray(v) && v.length === 0)
  );
}

function toComparable(v: unknown): string | number | null {
  if (isEmpty(v)) return null;
  if (typeof v === "number") return v;
  if (Array.isArray(v)) return v.join(", ");
  const s = String(v);
  const n = Number(s);
  return s !== "" && !Number.isNaN(n) && /^-?\d+(\.\d+)?$/.test(s.trim()) ? n : s;
}

/** Evaluate one filter against one row. */
export function matchesFilter(row: RowLike, f: Filter): boolean {
  const raw = row.properties[f.key];
  const v = toComparable(raw);
  switch (f.op) {
    case "eq":
      return v !== null && v === toComparable(f.value);
    case "neq":
      return v === null || v !== toComparable(f.value);
    case "contains":
      return v !== null && String(v).toLowerCase().includes(String(f.value ?? "").toLowerCase());
    case "gt":
      return v !== null && typeof v === "number" && typeof f.value === "number" && v > f.value;
    case "lt":
      return v !== null && typeof v === "number" && typeof f.value === "number" && v < f.value;
    case "gte":
      return v !== null && typeof v === "number" && typeof f.value === "number" && v >= f.value;
    case "lte":
      return v !== null && typeof v === "number" && typeof f.value === "number" && v <= f.value;
    case "empty":
      return isEmpty(raw);
    case "notempty":
      return !isEmpty(raw);
    default:
      return true;
  }
}

/** All filters are ANDed (each `{key,op,value}` must hold). */
export function matchesAll(row: RowLike, filters: Filter[] | undefined | null): boolean {
  if (!filters || filters.length === 0) return true;
  return filters.every((f) => matchesFilter(row, f));
}

export function applySorts<T extends RowLike>(rows: T[], sorts: Sort[] | undefined | null, propIndex?: Map<string, Property>): T[] {
  if (!sorts || sorts.length === 0) return rows;
  const out = [...rows];
  out.sort((ra, rb) => {
    for (const s of sorts) {
      const dir = s.dir === "desc" ? -1 : 1;
      const prop = propIndex?.get(s.key);
      const a = ra.properties[s.key];
      const b = rb.properties[s.key];
      // Empty values always sort last regardless of direction.
      const ea = isEmpty(a);
      const eb = isEmpty(b);
      if (ea && eb) continue;
      if (ea) return 1;
      if (eb) return -1;
      if (prop?.type === "number") {
        const d = Number(a) - Number(b);
        if (d !== 0) return d * dir;
        continue;
      }
      const sa = String(Array.isArray(a) ? a.join(",") : a);
      const sb = String(Array.isArray(b) ? b.join(",") : b);
      const c = sa.localeCompare(sb, undefined, { numeric: true, sensitivity: "base" });
      if (c !== 0) return c * dir;
    }
    return 0;
  });
  return out;
}

export type GroupKey = { key: string; label: string; value: string | null };

/** Group rows by a property; missing values form the null group placed first. */
export function groupRows<T extends RowLike>(
  rows: T[],
  groupBy: string | undefined,
  options?: { id: string; name?: string }[] | null,
): { value: string | null; label: string; rows: T[] }[] {
  if (!groupBy) return [{ value: null, label: "", rows }];
  const groups = new Map<string | null, T[]>();
  for (const r of rows) {
    const raw = r.properties[groupBy];
    const v = Array.isArray(raw) ? String(raw[0] ?? "") : raw === undefined || raw === null || raw === "" ? null : String(raw);
    const list = groups.get(v) ?? [];
    list.push(r);
    groups.set(v, list);
  }
  const order: { value: string | null; label: string }[] = [];
  const named = options ?? [];
  for (const o of named) {
    order.push({ value: o.id, label: o.name ?? o.id });
  }
  for (const v of groups.keys()) {
    if (v !== null && !named.some((o) => o.id === v)) order.push({ value: v, label: v });
  }
  if (groups.has(null)) order.unshift({ value: null, label: "No " + groupBy });
  return order.map((o) => ({ ...o, rows: groups.get(o.value) ?? ([] as T[]) }));
}

/** Full pipeline: filter -> sort. (Grouping is applied by the view.) */
export function applyView<T extends RowLike>(
  rows: T[],
  opts: { filters?: Filter[] | null; sorts?: Sort[] | null },
  propIndex?: Map<string, Property>,
): T[] {
  const filtered = rows.filter((r) => matchesAll(r, opts.filters));
  return applySorts(filtered, opts.sorts, propIndex);
}
