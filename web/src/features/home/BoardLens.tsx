import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "@/api";
import type { Database, DbRow } from "@/api";
import { ErrorState, Loading, EmptyState } from "@/ui/primitives";
import { Icon } from "@/ui/icons";
import { BoardView } from "@/features/db/BoardView";
import { CardModal } from "@/features/db/CardModal";
import { useSearchParams } from "react-router-dom";

/** The Board lens: the workspace's primary board database, one click away. */
export function BoardLens() {
  const { ws = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const nav = useNavigate();
  const [databases, setDatabases] = useState<Database[] | null>(null);
  const [slug, setSlug] = useState<string | null>(params.get("db"));
  const [rows, setRows] = useState<DbRow[] | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    let on = true;
    api
      .databases(ws)
      .then((dbs) => {
        if (!on) return;
        setDatabases(dbs);
        if (!slug) {
          const first = dbs.find((d) => d.views.some((v) => v.type === "board")) ?? dbs[0];
          if (first) setSlug(first.slug);
        }
      })
      .catch((e) => on && setError(e));
    return () => {
      on = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ws]);

  useEffect(() => {
    if (!slug) return;
    setRows(null);
    api
      .rows(ws, slug)
      .then((r) => setRows(r.rows))
      .catch((e) => setError(e));
  }, [ws, slug]);

  if (error) return <ErrorState error={error} />;
  if (!databases || !slug || !rows) return <Loading />;

  const db = databases.find((d) => d.slug === slug);
  if (!db) {
    return <EmptyState icon="board" title="No databases yet" hint="Create a database from the sidebar to use the board lens." />;
  }
  const boardView = db.views.find((v) => v.type === "board");
  const openCardPath = params.get("card");
  const openRow = rows.find((r) => r.path === openCardPath);

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <div className="db-toolbar">
        <Icon name="board" size={15} className="faint" />
        <strong style={{ fontSize: 13.5 }}>{db.name}</strong>
        <span className="faint" style={{ fontSize: 12 }}>· {boardView?.name ?? "Board"}</span>
        <div className="spacer" />
        <select
          className="input"
          style={{ height: 28, width: 170 }}
          value={slug}
          aria-label="Board database"
          onChange={(e) => {
            setSlug(e.target.value);
            setParams({ db: e.target.value });
          }}
        >
          {databases.map((d) => (
            <option key={d.slug} value={d.slug}>
              {d.name}
            </option>
          ))}
        </select>
        <button className="tb-btn" onClick={() => nav(`/w/${ws}/db/${slug}?view=board`)}>
          Open full view
        </button>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
        <BoardView
          ws={ws}
          db={db}
          viewId={boardView?.id ?? ""}
          rows={rows}
          onRows={setRows}
          onOpenCard={(r) => setParams({ db: slug, card: r.path })}
          onNewRow={() => {}}
        />
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
          onChanged={(updated) => setRows((rs) => (rs ?? []).map((r) => (r.id === updated.id ? updated : r)))}
        />
      ) : null}
    </div>
  );
}
