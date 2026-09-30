import { useEffect, useMemo, useRef, useState } from "react";
import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation, type Simulation, type SimulationNodeDatum } from "d3-force";
import { api } from "@/api";
import type { GraphResult } from "@/api";
import { ErrorState, Loading } from "@/ui/primitives";
import { Icon } from "@/ui/icons";

interface Node {
  id: string;
  path: string;
  title: string;
  type: string;
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
}
interface Edge {
  source: string | Node;
  target: string | Node;
}

/** Force-directed graph on canvas: gray nodes, accent on focus. */
export function GraphView({
  ws, scope, path, onOpen,
}: {
  ws: string;
  scope: "local" | "global";
  path?: string;
  onOpen: (path: string) => void;
}) {
  const [data, setData] = useState<GraphResult | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [focus, setFocus] = useState<string | null>(path ? titleOf(path) : null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const simRef = useRef<Simulation<SimulationNodeDatum, undefined> | null>(null);
  const nodesRef = useRef<Node[]>([]);
  const sizeRef = useRef({ w: 800, h: 600 });

  useEffect(() => {
    let on = true;
    setError(null);
    api
      .graph(ws, scope, path, 2)
      .then((g) => on && setData(g))
      .catch((e) => on && setError(e));
    return () => {
      on = false;
    };
  }, [ws, scope, path]);

  useEffect(() => {
    if (!data) return;
    const nodes: Node[] = data.nodes.map((n) => ({ ...n }));
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const edges: Edge[] = data.edges
      .filter((e) => byId.has(e.source) && byId.has(e.target))
      .map((e) => ({ source: e.source, target: e.target }));
    nodesRef.current = nodes;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const { w, h } = sizeRef.current;
    const sim = forceSimulation(nodes as never)
      .force("charge", forceManyBody().strength(-160))
      .force("center", forceCenter(w / 2, h / 2))
      .force(
        "link",
        forceLink(edges as never)
          .id((d: unknown) => (d as Node).id)
          .distance(70),
      )
      .force("collide", forceCollide(14))
      .alpha(1);
    simRef.current = sim;

    const styles = getComputedStyle(document.documentElement);
    const color = () => ({
      node: styles.getPropertyValue("--text-3").trim() || "#888",
      text: styles.getPropertyValue("--text-2").trim() || "#aaa",
      line: styles.getPropertyValue("--border-strong").trim() || "#333",
      accent: styles.getPropertyValue("--accent").trim() || "#6c8cff",
    });

    const draw = () => {
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      if (canvas.width !== rect.width * dpr) {
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, rect.width, rect.height);
      const c = color();
      ctx.lineWidth = 1;
      for (const e of edges as { source: Node; target: Node }[]) {
        if (e.source.x === undefined || e.target.x === undefined) continue;
        const hot = focus && (e.source.id === focus || e.target.id === focus);
        ctx.strokeStyle = hot ? c.accent : c.line;
        ctx.globalAlpha = hot ? 0.9 : 0.5;
        ctx.beginPath();
        ctx.moveTo(e.source.x!, e.source.y!);
        ctx.lineTo(e.target.x!, e.target.y!);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      for (const n of nodes) {
        if (n.x === undefined || n.y === undefined) continue;
        const hot = focus === n.id;
        ctx.beginPath();
        ctx.arc(n.x, n.y, hot ? 6 : 4, 0, Math.PI * 2);
        ctx.fillStyle = hot ? c.accent : c.node;
        ctx.fill();
        if (n.type === "record") {
          ctx.strokeStyle = c.line;
          ctx.stroke();
        }
        if (hot || nodes.length < 60) {
          ctx.fillStyle = hot ? c.accent : c.text;
          ctx.font = "10.5px -apple-system, system-ui";
          ctx.fillText(n.title, n.x + 8, n.y + 3);
        }
      }
    };
    sim.on("tick", draw);
    draw();
    return () => {
      sim.stop();
      simRef.current = null;
    };
  }, [data, focus]);

  const hit = (clientX: number, clientY: number): Node | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    for (const n of nodesRef.current) {
      if (n.x === undefined || n.y === undefined) continue;
      if ((n.x - x) ** 2 + (n.y - y) ** 2 < 100) return n;
    }
    return null;
  };

  const summary = useMemo(() => `${data?.nodes.length ?? 0} notes · ${data?.edges.length ?? 0} links`, [data]);

  if (error) return <ErrorState error={error} />;
  if (!data) return <Loading />;

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <div className="db-toolbar">
        <Icon name="graph" size={13} className="faint" />
        <span style={{ fontSize: 12, fontWeight: 550 }}>{scope === "local" ? "Local" : "Global"}</span>
        <span className="faint" style={{ fontSize: 12 }}>{summary}</span>
      </div>
      <canvas
        ref={(el) => {
          canvasRef.current = el;
          if (el) sizeRef.current = { w: el.clientWidth || 800, h: el.clientHeight || 600 };
        }}
        style={{ flex: 1, width: "100%", cursor: "pointer" }}
        onClick={(e) => {
          const n = hit(e.clientX, e.clientY);
          if (n) {
            setFocus(n.id);
            if (!n.path.startsWith("wiki/")) onOpen(n.path);
          }
        }}
        onMouseMove={(e) => {
          const n = hit(e.clientX, e.clientY);
          if (n) setFocus(n.id);
        }}
      />
      {data.nodes.length === 0 ? (
        <div className="state">
          <h3>No links yet</h3>
          <p>Connect notes with [[wiki links]] and the graph fills in.</p>
        </div>
      ) : null}
    </div>
  );
}

function titleOf(path: string): string {
  return path.split("/").pop()?.replace(/\.md$/, "") ?? path;
}
