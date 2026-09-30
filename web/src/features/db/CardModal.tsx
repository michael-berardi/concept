import { useEffect, useRef, useState } from "react";
import { api } from "@/api";
import type { ActivityEntry, Comment, Database, DbRow } from "@/api";
import { Icon } from "@/ui/icons";
import { EmptyState, ErrorState, Loading, Modal, useToast } from "@/ui/primitives";
import { BlockEditor } from "@/features/pages/BlockEditor";
import { PropertyEditor } from "./PropEditor";
import { relativeTime, dueTone } from "@/lib/format";
import { outline as outlineOf } from "@/lib/wiki";

/** Card modal: Trello-grade card surface backed by a Markdown file. */
export function CardModal({
  ws, db, row, onClose, onChanged,
}: {
  ws: string;
  db: Database;
  row: DbRow;
  onClose: () => void;
  onChanged: (row: DbRow) => void;
}) {
  const { toast } = useToast();
  const [draft, setDraft] = useState<Record<string, unknown>>(row.properties);
  const [body, setBody] = useState(row.body ?? "");
  const [comments, setComments] = useState<Comment[] | null>(null);
  const [activity, setActivity] = useState<ActivityEntry[] | null>(null);
  const [commentText, setCommentText] = useState("");
  const [hash, setHash] = useState(row.contentHash);
  const [err, setErr] = useState<unknown>(null);
  const [pane, setPane] = useState<"comments" | "activity">("comments");
  const commentInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    Promise.all([api.comments(ws, row.path), api.activity(ws, row.path, 12)])
      .then(([c, a]) => {
        setComments(c);
        setActivity(a);
      })
      .catch((e) => setErr(e));
  }, [ws, row.path]);

  const commit = async (key: string, value: unknown) => {
    const next = { ...draft, [key]: value };
    setDraft(next);
    try {
      const updated = await api.updateRow(ws, db.slug, row.id, { properties: next }, hash);
      setHash(updated.contentHash);
      onChanged(updated);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not save property", "error");
    }
  };

  const saveBody = async (md: string) => {
    setBody(md);
    try {
      const updated = await api.updateRow(ws, db.slug, row.id, { body: md }, hash);
      setHash(updated.contentHash);
      onChanged(updated);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not save description", "error");
    }
  };

  const toggleCheck = async (index: number) => {
    // Checklists are markdown task lists in the body: flip the nth "[ ]"/"[x]".
    let seen = -1;
    const next = body.replace(/^(\s*[-*+]\s+)\[([ xX])\]/gm, (m, pre: string, mark: string) => {
      seen++;
      if (seen !== index) return m;
      return pre + (mark.toLowerCase() === "x" ? "[ ]" : "[x]");
    });
    await saveBody(next);
  };

  const addComment = async () => {
    const text = commentText.trim();
    if (!text) return;
    setCommentText("");
    const c = await api.addComment(ws, row.path, text);
    setComments((cs) => [...(cs ?? []), c]);
  };

  const checklist = bodyTaskList(body);
  const titleProp = db.properties.find((p) => p.type === "title");
  const others = db.properties.filter((p) => p.type !== "title");

  return (
    <Modal
      onClose={onClose}
      width={720}
      title={
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Icon name="kanban" size={15} className="faint" />
          <span className="mono faint" style={{ fontSize: 11 }}>{row.path}</span>
        </span>
      }
    >
      {err ? <ErrorState error={err} /> : null}
      <div className="card-grid">
        <div style={{ minWidth: 0 }}>
          {titleProp ? (
            <input
              className="card-title"
              value={String(draft[titleProp.key] ?? "")}
              onChange={(e) => setDraft({ ...draft, [titleProp.key]: e.target.value })}
              onBlur={(e) => commit(titleProp.key, e.target.value)}
              aria-label="Card title"
            />
          ) : null}

          <Section label="Description">
            <div style={{ border: "1px solid var(--border)", borderRadius: 10, padding: "4px 14px", background: "var(--surface)" }}>
              <BlockEditor value={body} ws={ws} onChange={saveBody} placeholder="Add a description…" />
            </div>
          </Section>

          {checklist.length > 0 ? (
            <Section label={`Checklist · ${checklist.filter((c) => c.checked).length}/${checklist.length}`}>
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                {checklist.map((item, i) => (
                  <button key={i} className="side-item" onClick={() => toggleCheck(i)} style={{ height: 30 }}>
                    <Icon name={item.checked ? "check" : "minus"} size={15} className={item.checked ? "" : "faint"} style={{ color: item.checked ? "var(--ok)" : undefined }} />
                    <span className="label" style={{ textDecoration: item.checked ? "line-through" : undefined, color: item.checked ? "var(--text-3)" : undefined }}>
                      {item.text}
                    </span>
                  </button>
                ))}
              </div>
            </Section>
          ) : null}

          <Section>
            <div style={{ display: "flex", gap: 4, marginBottom: 10 }}>
              {(["comments", "activity"] as const).map((p) => (
                <button key={p} className="tb-btn" aria-pressed={pane === p} onClick={() => setPane(p)} style={{ textTransform: "capitalize" }}>
                  {p}
                </button>
              ))}
            </div>
            {pane === "comments" ? (
              comments === null ? (
                <Loading />
              ) : comments.length === 0 ? (
                <p className="faint" style={{ fontSize: 13, margin: "4px 0 10px" }}>No comments yet.</p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 12 }}>
                  {comments.map((c) => (
                    <div key={c.id} style={{ display: "flex", gap: 10 }}>
                      <div style={{ flex: 1, border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", background: "var(--surface)" }}>
                        <div style={{ fontSize: 12, marginBottom: 2 }}>
                          <strong style={{ fontWeight: 600 }}>{c.userName ?? c.userId}</strong>
                          <span className="faint" style={{ marginLeft: 8 }}>{relativeTime(c.createdAt)}</span>
                        </div>
                        <div style={{ fontSize: 13.5 }}>{c.body}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )
            ) : activity === null ? (
              <Loading />
            ) : activity.length === 0 ? (
              <p className="faint" style={{ fontSize: 13, margin: "4px 0 10px" }}>No activity recorded.</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 12 }}>
                {activity.map((a) => (
                  <div key={a.id} style={{ fontSize: 12.5, color: "var(--text-2)", display: "flex", gap: 8 }}>
                    <Icon name="clock" size={13} className="faint" />
                    <span>
                      <strong style={{ fontWeight: 550, color: "var(--text)" }}>{a.userName ?? a.userId}</strong> {a.action}
                      {a.detail ? ` — ${a.detail}` : ""}
                    </span>
                    <span className="faint" style={{ marginLeft: "auto" }}>{relativeTime(a.createdAt)}</span>
                  </div>
                ))}
              </div>
            )}
            {pane === "comments" ? (
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  ref={commentInput}
                  className="input"
                  style={{ flex: 1 }}
                  placeholder="Write a comment…"
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addComment()}
                />
                <button className="btn sm primary" onClick={addComment}>
                  Send
                </button>
              </div>
            ) : null}
          </Section>
        </div>

        <aside>
          <div className="side-label" style={{ padding: 0 }}>Properties</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {others.map((p) => {
              const tone = p.key === "due" ? dueTone(draft[p.key] as string) : "none";
              return (
                <label key={p.key} style={{ display: "block" }}>
                  <span className="faint" style={{ fontSize: 11.5, fontWeight: 550, display: "flex", gap: 5, alignItems: "center", marginBottom: 4 }}>
                    <Icon name={propIcon(p.type)} size={12} />
                    {p.name}
                    {tone === "overdue" ? <span style={{ color: "var(--danger)", marginLeft: "auto" }}>overdue</span> : tone === "today" ? <span style={{ color: "var(--warn)", marginLeft: "auto" }}>today</span> : null}
                  </span>
                  <div style={{ fontSize: 13.5 }}>
                    <PropertyEditor db={db} prop={p} value={draft[p.key]} onCommit={(v) => commit(p.key, v)} />
                  </div>
                </label>
              );
            })}
          </div>
        </aside>
      </div>
    </Modal>
  );
}

function Section({ label, children }: { label?: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 22 }}>
      {label ? (
        <div className="faint" style={{ fontSize: 11.5, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>
          {label}
        </div>
      ) : null}
      {children}
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
      return "hash" in {} ? "list" : "sort";
    case "multi_select":
    case "tags":
      return "tag";
    case "checkbox":
      return "check";
    default:
      return "pencil";
  }
}

function bodyTaskList(body: string): { text: string; checked: boolean }[] {
  const out: { text: string; checked: boolean }[] = [];
  let inFence = false;
  for (const line of body.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    if (inFence) continue;
    const m = line.match(/^\s*[-*+]\s+\[([ xX])\]\s+(.*)$/);
    if (m) out.push({ checked: m[1].toLowerCase() === "x", text: m[2] });
  }
  return out;
}

export { EmptyState, outlineOf };
