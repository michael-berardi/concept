import { useNavigate, useParams } from "react-router-dom";
import { GraphView } from "./GraphView";
import { pageHref } from "@/layout/AppShell";

/** Full-screen global graph: the whole vault as quiet gray nodes. */
export function GraphPage() {
  const { ws = "" } = useParams();
  const nav = useNavigate();
  return (
    <div style={{ height: "100%", position: "relative" }}>
      <GraphView
        ws={ws}
        scope="global"
        onOpen={(p) => {
          if (/^Data\/[^/]+\/.+\.md$/.test(p) || p.endsWith(".md")) nav(pageHref(ws, p));
        }}
      />
    </div>
  );
}
