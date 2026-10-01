import { useEffect, useMemo, useState } from "react";
import { api } from "@/api";
import type { LinksResult, TagsResult } from "@/api";
import { Icon } from "@/ui/icons";
import { GraphView } from "@/features/vault/GraphView";
import { outline as outlineOf } from "@/lib/wiki";

/** Obsidian-style right panel: backlinks, outgoing links, outline, tags, local graph. */
export function PagePanel({
  ws, path, body, onOpen, onJump,
}: {
  ws: string;
  path: string;
  body: string;
  onOpen: (path: string) => void;
  onJump?: (heading: string) => void;
}) {
  const [links, setLinks] = useState<LinksResult | null>(null);
  const [tags, setTags] = useState<TagsResult | null>(null);

  useEffect(() => {
    setLinks(null);
    api.links(ws, path).then(setLinks).catch(() => setLinks({ outgoing: [], backlinks: [], unresolved: [] }));
  }, [ws, path]);

  useEffect(() => {
    api.tags(ws).then(setTags).catch(() => setTags(null));
  }, [ws]);

  const heads = useMemo(() => outlineOf(body), [body]);

  return (
    <aside className="page-panel" aria-label="Page panel">
      <Section title="Outline" count={heads.length}>
        {heads.length === 0 ? (
          <Empty>Add a heading to see the outline.</Empty>
        ) : (
          heads.map((h, i) => (
            <button key={i} className="panel-link" style={{ paddingLeft: 6 + (h.level - 1) * 12 }} onClick={() => onJump?.(h.text)}>
              <span className="label">{h.text}</span>
            </button>
          ))
        )}
      </Section>

      <Section title="Backlinks" count={links?.backlinks.length}>
        {links === null ? null : links.backlinks.length === 0 ? (
          <Empty>Nothing links here yet. Type [[ in another page to link it.</Empty>
        ) : (
          links.backlinks.map((b) => (
            <button key={b.path} className="panel-link" onClick={() => onOpen(b.path)}>
              <Icon name="page" size={13} className="icon" />
              <span className="label">{b.title}</span>
            </button>
          ))
        )}
      </Section>

      <Section title="Links" count={links?.outgoing.length}>
        {links === null ? null : links.outgoing.length === 0 ? (
          <Empty>No outgoing links.</Empty>
        ) : (
          links.outgoing.map((o) => (
            <button
              key={o.target}
              className="panel-link"
              disabled={!o.path}
              onClick={() => o.path && onOpen(o.path)}
              title={o.path ?? "Not created yet"}
            >
              <Icon name="link" size={13} className="icon" />
              <span className="label" style={{ opacity: o.path ? 1 : 0.5 }}>{o.target}</span>
            </button>
          ))
        )}
      </Section>

      <Section title="Tags" count={tags?.tags.length}>
        {tags && tags.tags.length > 0 ? (
          <div className="tag-cloud">
            {tags.tags.slice(0, 16).map((t) => (
              <span key={t.name} className="tag">
                #{t.name}
              </span>
            ))}
          </div>
        ) : (
          <Empty>No tags yet. Use #tags in a page.</Empty>
        )}
      </Section>

      <Section title="Graph">
        <div className="mini-graph">
          <GraphView ws={ws} scope="local" path={path} onOpen={onOpen} />
        </div>
      </Section>
    </aside>
  );
}

function Section({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
  return (
    <section className="panel-section">
      <div className="panel-head">
        <span>{title}</span>
        {count ? <span className="faint">{count}</span> : null}
      </div>
      {children}
    </section>
  );
}
const Empty = ({ children }: { children: React.ReactNode }) => <p className="panel-empty">{children}</p>;
