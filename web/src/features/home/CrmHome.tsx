import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "@/api";
import type { DbRow } from "@/api";
import { Icon } from "@/ui/icons";
import { EmptyState, ErrorState, Loading } from "@/ui/primitives";
import { formatMoney, relativeTime } from "@/lib/format";
import { dueTone } from "@/lib/format";

const STAGES = ["Inbox", "Qualified", "Proposal", "Negotiation", "Won", "Lost"] as const;

export function CrmHome() {
  const { ws = "" } = useParams();
  const nav = useNavigate();
  const [deals, setDeals] = useState<DbRow[] | null>(null);
  const [tasks, setTasks] = useState<DbRow[] | null>(null);
  const [acts, setActs] = useState<DbRow[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let on = true;
    setError(null);
    Promise.all([api.rows(ws, "deals"), api.rows(ws, "tasks"), api.rows(ws, "activities")])
      .then(([d, t, a]) => {
        if (!on) return;
        setDeals(d.rows);
        setTasks(t.rows);
        setActs(a.rows);
      })
      .catch((e) => on && setError(e));
    return () => {
      on = false;
    };
  }, [ws, tick]);

  const pipeline = useMemo(() => {
    const byStage = new Map<string, { count: number; value: number }>();
    for (const s of STAGES) byStage.set(s, { count: 0, value: 0 });
    let open = 0;
    let won = 0;
    for (const d of deals ?? []) {
      const st = String(d.properties.status ?? "Inbox");
      const v = Number(d.properties.value ?? 0);
      const bucket = byStage.get(st);
      if (bucket) {
        bucket.count++;
        bucket.value += v;
      }
      if (st !== "Won" && st !== "Lost") open += v;
      if (st === "Won") won += v;
    }
    return { byStage, open, won };
  }, [deals]);

  const maxValue = Math.max(1, ...[...pipeline.byStage.values()].map((b) => b.value));

  const followUps = useMemo(() => {
    return (acts ?? [])
      .filter((a) => !a.properties.done)
      .sort((a, b) => String(a.properties.due ?? "9").localeCompare(String(b.properties.due ?? "9")))
      .slice(0, 5);
  }, [acts]);

  const upcomingTasks = useMemo(
    () =>
      (tasks ?? [])
        .filter((t) => t.properties.status !== "Done")
        .sort((a, b) => String(a.properties.due ?? "9").localeCompare(String(b.properties.due ?? "9")))
        .slice(0, 5),
    [tasks],
  );

  if (error) return <ErrorState error={error} retry={() => setTick((t) => t + 1)} />;
  if (!deals || !tasks || !acts) return <Loading />;

  return (
    <div style={{ maxWidth: 1080, margin: "0 auto", padding: "36px 28px 64px" }}>
      <header style={{ marginBottom: 30 }}>
        <div className="faint" style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase" }}>
          CRM
        </div>
        <h1 style={{ margin: "4px 0 0", fontSize: 24, fontWeight: 650, letterSpacing: "-0.02em" }}>Pipeline overview</h1>
      </header>

      {deals.length === 0 ? (
        <EmptyState
          icon="database"
          title="No deals yet"
          hint="Create the Deals database to start tracking a pipeline. Rows are Markdown files you can open in any editor."
          action={
            <Link className="btn primary" to={`/w/${ws}/db/deals`}>
              Open Deals
            </Link>
          }
        />
      ) : (
        <>
          <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12, marginBottom: 34 }}>
            <Stat label="Open pipeline" value={formatMoney(pipeline.open)} />
            <Stat label="Won" value={formatMoney(pipeline.won)} tone="ok" />
            <Stat
              label="Open deals"
              value={String([...pipeline.byStage.entries()].filter(([s]) => s !== "Won" && s !== "Lost").reduce((n, [, b]) => n + b.count, 0))}
            />
            <Stat label="Companies" value={String(new Set((deals ?? []).map((d) => d.properties.company).filter(Boolean)).size)} />
          </section>

          <section style={{ marginBottom: 40 }}>
            <h2 style={{ fontSize: 14, fontWeight: 600, margin: "0 0 14px" }}>Pipeline value by stage</h2>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {STAGES.map((s) => {
                const b = pipeline.byStage.get(s)!;
                return (
                  <button
                    key={s}
                    onClick={() => nav(`/w/${ws}/db/deals?view=board`)}
                    style={{ display: "grid", gridTemplateColumns: "110px 1fr 90px", alignItems: "center", gap: 14, textAlign: "left" }}
                  >
                    <span className="muted" style={{ fontSize: 12.5 }}>{s}</span>
                    <span style={{ height: 14, background: "var(--surface-2)", borderRadius: 4, overflow: "hidden", display: "block" }}>
                      <span
                        style={{
                          display: "block",
                          height: "100%",
                          width: `${Math.max(b.value > 0 ? 3 : 0, (b.value / maxValue) * 100)}%`,
                          background: s === "Won" ? "var(--ok)" : s === "Lost" ? "var(--surface-3)" : "var(--accent)",
                          opacity: s === "Lost" ? 0.5 : 1,
                          transition: "width 180ms ease-out",
                        }}
                      />
                    </span>
                    <span className="num muted" style={{ fontSize: 12.5, textAlign: "right" }}>
                      {b.count > 0 ? formatMoney(b.value) : "—"}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        </>
      )}

      <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 40 }}>
        <div>
          <h2 style={{ fontSize: 14, fontWeight: 600, margin: "0 0 12px" }}>Upcoming follow-ups</h2>
          {followUps.length === 0 ? (
            <p className="faint" style={{ fontSize: 13, margin: 0 }}>
              Nothing scheduled. Add activities in the Activities database.
            </p>
          ) : (
            followUps.map((a) => {
              const tone = dueTone(a.properties.due as string);
              return (
                <button
                  key={a.id}
                  onClick={() => nav(`/w/${ws}/db/activities`)}
                  style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "9px 0", borderBottom: "1px solid var(--border)", textAlign: "left" }}
                >
                  <Icon name={String(a.properties.type) === "Call" ? "comment" : String(a.properties.type) === "Email" ? "link" : "users"} size={15} className="faint" />
                  <span style={{ flex: 1, fontSize: 13.5 }}>{String(a.properties.title)}</span>
                  <span
                    className="num"
                    style={{
                      fontSize: 12,
                      color: tone === "overdue" ? "var(--danger)" : tone === "today" ? "var(--warn)" : "var(--text-3)",
                    }}
                  >
                    {relativeTime(`${a.properties.due}T09:00:00Z`)}
                  </span>
                </button>
              );
            })
          )}
        </div>
        <div>
          <h2 style={{ fontSize: 14, fontWeight: 600, margin: "0 0 12px" }}>Tasks in flight</h2>
          {upcomingTasks.length === 0 ? (
            <p className="faint" style={{ fontSize: 13, margin: 0 }}>No open tasks.</p>
          ) : (
            upcomingTasks.map((t) => {
              const tone = dueTone(t.properties.due as string);
              return (
                <button
                  key={t.id}
                  onClick={() => nav(`/w/${ws}/db/tasks`)}
                  style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "9px 0", borderBottom: "1px solid var(--border)", textAlign: "left" }}
                >
                  <Icon name="task" size={15} className="faint" />
                  <span style={{ flex: 1, fontSize: 13.5 }}>{String(t.properties.title)}</span>
                  <span
                    className="num"
                    style={{ fontSize: 12, color: tone === "overdue" ? "var(--danger)" : tone === "today" ? "var(--warn)" : "var(--text-3)" }}
                  >
                    {relativeTime(`${t.properties.due}T09:00:00Z`)}
                  </span>
                </button>
              );
            })
          )}
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "ok" }) {
  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 10, padding: "14px 16px", background: "var(--surface)" }}>
      <div className="faint" style={{ fontSize: 12, fontWeight: 550 }}>{label}</div>
      <div className="num" style={{ fontSize: 21, fontWeight: 650, letterSpacing: "-0.02em", marginTop: 4, color: tone === "ok" ? "var(--ok)" : undefined }}>
        {value}
      </div>
    </div>
  );
}
