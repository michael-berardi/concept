import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useOutletContext, useParams } from "react-router-dom";
import { api } from "@/api";
import type { ActivityEntry, Database, DbRow } from "@/api";
import { Icon } from "@/ui/icons";
import { ErrorState, Loading } from "@/ui/primitives";
import { dueTone, formatDate, formatMoney, relativeTime } from "@/lib/format";
import { pageHref } from "@/layout/AppShell";

interface Loaded {
  dbs: Database[];
  rows: Record<string, DbRow[]>;
  recent: ActivityEntry[];
}

const stem = (p: string) => p.split("/").pop()!.replace(/\.md$/, "");

/** Calm start page: what changed, what is due, and where the pipeline stands. */
export function CrmHome() {
  const { ws = "" } = useParams();
  const nav = useNavigate();
  const outlet = useOutletContext<{ newPage: () => void }>();
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    let on = true;
    (async () => {
      try {
        const dbs = await api.databases(ws);
        const entries = await Promise.all(dbs.map(async (d) => [d.slug, (await api.rows(ws, d.slug)).rows] as const));
        const recent = await api.activity(ws, undefined, 12);
        if (on) setData({ dbs, rows: Object.fromEntries(entries), recent });
      } catch (e) {
        if (on) setError(e);
      }
    })();
    return () => {
      on = false;
    };
  }, [ws]);

  const due = useMemo(() => {
    if (!data) return [];
    const out: { row: DbRow; db: Database }[] = [];
    for (const db of data.dbs)
      for (const row of data.rows[db.slug] ?? []) {
        const status = String(row.properties.status ?? "");
        if (row.properties.due && !["Won", "Lost", "Done"].includes(status)) out.push({ row, db });
      }
    return out.sort((a, b) => String(a.row.properties.due).localeCompare(String(b.row.properties.due))).slice(0, 8);
  }, [data]);

  const pipeline = useMemo(() => {
    const db = data?.dbs.find((d) => d.properties.some((p) => p.key === "value") && d.properties.some((p) => p.type === "status"));
    if (!db || !data) return null;
    const statusProp = db.properties.find((p) => p.type === "status")!;
    const stages = (statusProp.options ?? []).map((o) => o.id);
    const rows = data.rows[db.slug] ?? [];
    const per = stages.map((s) => {
      const r = rows.filter((x) => x.properties.status === s);
      return { stage: s, count: r.length, value: r.reduce((n, x) => n + Number(x.properties.value ?? 0), 0) };
    });
    const open = per.filter((p) => !["Won", "Lost"].includes(p.stage)).reduce((n, p) => n + p.value, 0);
    return { db, per, open, max: Math.max(1, ...per.map((p) => p.value)) };
  }, [data]);

  if (error) return <ErrorState error={error} />;
  if (!data) return <Loading />;

  const empty = !data.dbs.some((d) => (data.rows[d.slug] ?? []).length > 0) && data.recent.length === 0;
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  return (
    <div className="home">
      <h1 className="home-title">{greeting}</h1>

      {pipeline && pipeline.per.some((p) => p.count > 0) ? (
        <section className="home-sec">
          <div className="home-head">
            <h2>Pipeline</h2>
            <Link to={`/w/${ws}/board?db=${pipeline.db.slug}`} className="home-link">Open board</Link>
          </div>
          <div className="home-big num">{formatMoney(pipeline.open)}<span> open</span></div>
          <div className="funnel">
            {pipeline.per.map((p) => (
              <div className="funnel-row" key={p.stage}>
                <span className="funnel-k">{p.stage}</span>
                <span className="funnel-bar"><i style={{ width: `${(p.value / pipeline.max) * 100}%` }} /></span>
                <span className="funnel-v num">{p.value ? formatMoney(p.value) : "—"}</span>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {empty ? (
        <section className="home-sec">
          <p className="home-lead">Your workspace is empty. Start with a page, add your first deal, or invite your team.</p>
          <div className="home-actions">
            <button className="btn primary" onClick={() => outlet.newPage()}>New page</button>
            <Link className="btn" to={`/w/${ws}/db/deals`}>Add a deal</Link>
            <Link className="btn" to={`/w/${ws}/settings/members`}>Invite people</Link>
          </div>
        </section>
      ) : null}

      {empty ? null : (<>
      <section className="home-sec">
        <div className="home-head"><h2>Coming up</h2></div>
        {due.length === 0 ? (
          <p className="home-empty">Nothing due. Add a due date to a card and it shows up here.</p>
        ) : (
          due.map(({ row, db }) => (
            <button key={row.id} className="home-row" onClick={() => nav(pageHref(ws, row.path))}>
              <Icon name={db.icon === "target" ? "kanban" : "page"} size={14} className="faint" />
              <span className="home-row-t">{String(row.properties.title)}</span>
              <span className="faint">{db.name}</span>
              <span className={`num due ${dueTone(String(row.properties.due))}`}>{formatDate(String(row.properties.due))}</span>
            </button>
          ))
        )}
      </section>

      <section className="home-sec">
        <div className="home-head"><h2>Recently changed</h2></div>
        {data.recent.length === 0 ? (
          <p className="home-empty">Pages you edit appear here.</p>
        ) : (
          dedupe(data.recent).map((a) => (
            <button key={a.id} className="home-row" onClick={() => a.path && nav(pageHref(ws, a.path))}>
              <Icon name="page" size={14} className="faint" />
              <span className="home-row-t">{a.path ? stem(a.path) : a.action}</span>
              <span className="faint">{a.userName}</span>
              <span className="faint">{relativeTime(a.createdAt)}</span>
            </button>
          ))
        )}
      </section>
      </>)}
    </div>
  );
}

function dedupe(list: ActivityEntry[]): ActivityEntry[] {
  const seen = new Set<string>();
  return list.filter((a) => (a.path && !seen.has(a.path) ? (seen.add(a.path), true) : false)).slice(0, 8);
}
