import { useEffect, useState } from "react";
import { api } from "@/api";
import { Icon } from "@/ui/icons";
import { formatDate } from "@/lib/format";
import type { Database, Property, RowProperties } from "@/api";

/** One property value renderer/editor used by table cells and the card modal. */

export function PropertyValue({ prop, value }: { prop: Property; value: unknown }) {
  switch (prop.type) {
    case "number":
      return <span className="num">{value === null || value === undefined || value === "" ? "—" : prop.format === "currency" ? formatCurrency(Number(value)) : String(value)}</span>;
    case "date":
      return <span className="num muted">{formatDate(value as string)}</span>;
    case "checkbox":
      return <Icon name={value ? "check" : "minus"} size={14} className={value ? "" : "faint"} />;
    case "status":
    case "select": {
      if (!value) return <span className="faint">—</span>;
      const opt = prop.options?.find((o) => o.id === value);
      return (
        <span className="pill" data-color={opt?.color ?? "gray"}>
          <span className="dot" />
          {opt?.name ?? String(value)}
        </span>
      );
    }
    case "multi_select": {
      const arr = Array.isArray(value) ? value : value ? [value] : [];
      if (arr.length === 0) return <span className="faint">—</span>;
      return (
        <span style={{ display: "inline-flex", gap: 4, flexWrap: "wrap" }}>
          {arr.map((v) => (
            <span key={String(v)} className="pill">
              {String(v)}
            </span>
          ))}
        </span>
      );
    }
    case "person":
      return value ? (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <Avatar name={String(value)} size={16} />
          <span className="muted">{String(value)}</span>
        </span>
      ) : (
        <span className="faint">—</span>
      );
    case "url":
      return value ? (
        <a href={String(value)} target="_blank" rel="noreferrer" style={{ color: "var(--accent)", textDecoration: "none" }}>
          {String(value).replace(/^https?:\/\//, "")}
        </a>
      ) : (
        <span className="faint">—</span>
      );
    case "email":
      return value ? <span className="muted">{String(value)}</span> : <span className="faint">—</span>;
    case "relation":
      return value ? (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
          <Icon name="cube" size={12} className="faint" />
          <span className="muted">{String(value)}</span>
        </span>
      ) : (
        <span className="faint">—</span>
      );
    default:
      return <span>{value ? String(value) : <span className="faint">—</span>}</span>;
  }
}

export function Avatar({ name, size = 18 }: { name: string; size?: number }) {
  const initials = name
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  const hue = [...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: `hsl(${hue} 32% 42%)`,
        color: "#fff",
        fontSize: size * 0.55,
        fontWeight: 600,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flex: "none",
      }}
      aria-label={name}
    >
      {initials}
    </span>
  );
}

function formatCurrency(n: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
}

export function PropertyEditor({
  db, prop, value, onCommit,
}: {
  db: Database;
  prop: Property;
  value: unknown;
  onCommit: (v: unknown) => void;
}) {
  switch (prop.type) {
    case "title":
    case "text":
    case "url":
    case "email":
    case "phone":
      return (
        <input
          className="cell-input"
          defaultValue={value === null || value === undefined ? "" : String(value)}
          key={String(value)}
          onBlur={(e) => {
            const v = e.target.value.trim();
            if (v !== (value ?? "")) onCommit(prop.type === "number" ? v : v || null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            e.stopPropagation();
          }}
        />
      );
    case "number":
      return (
        <input
          className="cell-input num"
          type="number"
          defaultValue={value === null || value === undefined ? "" : String(value)}
          key={String(value)}
          onBlur={(e) => onCommit(e.target.value === "" ? null : Number(e.target.value))}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            e.stopPropagation();
          }}
        />
      );
    case "date":
      return (
        <input
          className="cell-input num"
          type="date"
          value={(value as string) ?? ""}
          onChange={(e) => onCommit(e.target.value || null)}
          onKeyDown={(e) => e.stopPropagation()}
        />
      );
    case "checkbox":
      return <input type="checkbox" checked={!!value} onChange={(e) => onCommit(e.target.checked)} style={{ accentColor: "var(--accent)" }} />;
    case "status":
    case "select": {
      const opts = prop.options ?? [];
      return (
        <select
          className="cell-select"
          value={(value as string) ?? ""}
          onChange={(e) => onCommit(e.target.value || null)}
          onClick={(e) => e.stopPropagation()}
        >
          <option value="">—</option>
          {opts.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name ?? o.id}
            </option>
          ))}
        </select>
      );
    }
    case "multi_select": {
      const current = new Set((Array.isArray(value) ? value : value ? [value] : []).map(String));
      const opts = prop.options ?? [];
      const known = [...new Set([...opts.map((o) => o.id), ...current])];
      return (
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }} onClick={(e) => e.stopPropagation()}>
          {known.map((o) => (
            <button
              key={o}
              className="pill"
              style={{ opacity: current.has(o) ? 1 : 0.45, cursor: "pointer" }}
              onClick={() => {
                const next = new Set(current);
                if (next.has(o)) next.delete(o);
                else next.add(o);
                onCommit([...next]);
              }}
            >
              {o}
            </button>
          ))}
        </div>
      );
    }
    case "person": {
      return <PersonPicker value={value as string} onCommit={onCommit} />;
    }
    case "relation": {
      const target = prop.database ?? "";
      void target;
      return <RelationPicker value={value as string} onCommit={onCommit} />;
    }
    default:
      return <PropertyValue prop={prop} value={value} />;
  }
}

function PersonPicker({ value, onCommit }: { value?: string; onCommit: (v: unknown) => void }) {
  const people = ["Ada Stone", "Mike Okafor", "June Park"];
  return (
    <select className="cell-select" value={value ?? ""} onChange={(e) => onCommit(e.target.value || null)} onClick={(e) => e.stopPropagation()}>
      <option value="">—</option>
      {people.map((p) => (
        <option key={p}>{p}</option>
      ))}
    </select>
  );
}

function RelationPicker({ value, onCommit }: { value?: string; onCommit: (v: unknown) => void }) {
  const [options, setOptions] = useState<string[]>([]);
  useEffect(() => {
    // relations resolve against the companies db in mock/dev; the server search
    // endpoint is the authority in production.
    api
      .rows("", "companies")
      .then((r) => setOptions(r.rows.map((x) => String(x.properties.title))))
      .catch(() => setOptions([]));
  }, []);
  return (
    <select className="cell-select" value={value ?? ""} onChange={(e) => onCommit(e.target.value || null)} onClick={(e) => e.stopPropagation()}>
      <option value="">—</option>
      {options.map((o) => (
        <option key={o}>{o}</option>
      ))}
    </select>
  );
}

export function visibleProps(db: Database, view: { visible?: string[] } | undefined): Property[] {
  const all = db.properties.filter((p) => p.type !== "title");
  if (!view?.visible) return all;
  return db.properties.filter((p) => view.visible!.includes(p.key));
}

export function propsOf(db: Database): Property[] {
  return db.properties;
}

export function titleOf(props: RowProperties): string {
  return String(props.title ?? "Untitled");
}
