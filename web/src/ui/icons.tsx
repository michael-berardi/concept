import type { CSSProperties } from "react";

/**
 * Thin-stroke icon set. One consistent 24px grid, 1.5px strokes, round caps,
 * no fills — rendered inline as SVG. No emoji anywhere in the UI.
 */
const paths: Record<string, string> = {
  search: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14ZM16.2 16.2 21 21",
  plus: "M12 5v14M5 12h14",
  minus: "M5 12h14",
  x: "M6 6l12 12M18 6L6 18",
  check: "M4.5 12.5l5 5L19.5 7",
  chevronRight: "M9 5l7 7-7 7",
  chevronDown: "M5 9l7 7 7-7",
  chevronUp: "M5 15l7-7 7 7",
  arrowRight: "M4 12h16m-6-6 6 6-6 6",
  arrowUpRight: "M7 17 17 7M9 7h8v8",
  folder: "M4 7a2 2 0 0 1 2-2h3.2l2 2.4H18a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7Z",
  file: "M7 3h7l4 4v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1ZM14 3v4h4M9.5 12h5M9.5 15.5h5",
  page: "M7 3h7l4 4v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1ZM14 3v4h4",
  database: "M5 6c0-1.5 3.1-2.7 7-2.7S19 4.5 19 6v12c0 1.5-3.1 2.7-7 2.7S5 19.5 5 18V6ZM5 6c0 1.5 3.1 2.7 7 2.7S19 7.5 19 6M5 12c0 1.5 3.1 2.7 7 2.7s7-1.2 7-2.7",
  board: "M4 5h16v14H4zM9 5v14M15 5v14",
  table: "M4 5h16v14H4zM4 10h16M4 15h16M10 5v14",
  list: "M5 7h2m3 0h9M5 12h2m3 0h9M5 17h2m3 0h9",
  calendar: "M5 6h14v14H5zM5 10h14M9 3.5V7m6-3.5V7",
  gallery: "M4 5h16v14H4zM4 15l4.5-4.5 3.5 3.5 3-3L20 15",
  home: "M4 11l8-7 8 7M6.5 9.5V20h11V9.5",
  settings: "M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4Zm8-3.2-.2-1.4 1.6-1.5-1.5-2.6-2.1.6-1.2-.8-.4-2.1h-3l-.4 2.1-1.2.8-2.1-.6L4.9 9.1l1.6 1.5-.2 1.4.2 1.4-1.6 1.5 1.5 2.6 2.1-.6 1.2.8.4 2.1h3l.4-2.1 1.2-.8 2.1.6 1.5-2.6-1.6-1.5.2-1.4Z",
  users: "M9 11a3.2 3.2 0 1 0 0-6.4A3.2 3.2 0 0 0 9 11Zm-5.4 8.4c.6-3 2.8-4.8 5.4-4.8s4.8 1.8 5.4 4.8M15.4 5.2a3.2 3.2 0 0 1 0 6.2M17.2 14.9c1.8.5 3 2 3.4 4.1",
  user: "M12 11a3.2 3.2 0 1 0 0-6.4A3.2 3.2 0 0 0 12 11Zm-6.4 8.4c.6-3 3-4.8 6.4-4.8s5.8 1.8 6.4 4.8",
  shield: "M12 3.5 5.5 6v6c0 4 2.8 7 6.5 8.5 3.7-1.5 6.5-4.5 6.5-8.5V6L12 3.5Z",
  sync: "M20 11a8 8 0 0 0-14.9-3M4 13a8 8 0 0 0 14.9 3M18.5 4v4h-4M5.5 20v-4h4",
  git: "M6.5 4.5a2 2 0 1 0 0 4 2 2 0 0 0 0-4ZM6.5 15.5a2 2 0 1 0 0 4 2 2 0 0 0 0-4Zm0-7v7M17.5 9.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm0 0c0 3-2.5 4-5 4.5s-4 1-4 3",
  graph: "M6 7.5a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4Zm12 0a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4ZM12 20.9a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4ZM7 6.5l4 12m6-12-4 12M8.2 6.2l7.6 0",
  tag: "M4.5 11.5 11 5h6.5a2 2 0 0 1 2 2v6.5L13 20a1.4 1.4 0 0 1-2 0l-6.5-6.5a1.4 1.4 0 0 1 0-2ZM15.5 8.5h.01",
  clock: "M12 4.5a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15ZM12 8v4.5l3 2",
  comment: "M5 5.5h14v10H10L5.5 19V5.5Z",
  more: "M6 12h.01M12 12h.01M18 12h.01",
  grip: "M9 6h.01M9 12h.01M9 18h.01M15 6h.01M15 12h.01M15 18h.01",
  trash: "M5 7h14M10 7V5h4v2m-7 0 .7 13h6.6L15 7M10 10.5v6M14 10.5v6",
  pencil: "M14.5 5.5 18 9l-9.5 9.5-4 1 1-4L15 6l-.5-.5ZM15 6l3 3",
  star: "m12 4.5 2.3 4.9 5.2.7-3.8 3.7.9 5.2-4.6-2.5-4.6 2.5.9-5.2L4.5 10l5.2-.7L12 4.5Z",
  panelLeft: "M4 5h16v14H4zM10 5v14",
  layers: "m12 4 8 4.5-8 4.5-8-4.5L12 4ZM4 13l8 4.5 8-4.5",
  inbox: "M4 13.5V18a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4.5M4 13.5 6.5 5h11L20 13.5M4 13.5h4.5l1 2.5h5l1-2.5H20",
  filter: "M5 6h14l-5.5 6.5V19l-3-1.8v-4.7L5 6Z",
  sort: "M7 5v14m0 0-3-3m3 3 3-3M17 19V5m0 0-3 3m3-3 3 3",
  command: "M9 9h6v6H9zM9 9H7a2 2 0 1 1 2-2v2Zm6 0h2a2 2 0 1 0-2-2v2Zm0 6h2a2 2 0 1 1-2 2v-2Zm-6 0H7a2 2 0 1 0 2 2v-2Z",
  sidebar: "M4 5h16v14H4zM9.5 5v14",
  link: "M10.5 13.5a3.5 3.5 0 0 0 5 0l3-3a3.5 3.5 0 0 0-5-5l-1.5 1.5m-2 6a3.5 3.5 0 0 1-5 0l-3-3a3.5 3.5 0 0 1 5-5L8.5 6.5",
  external: "M14 5h5v5m0-5-8 8M19 13.5V18a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h4.5",
  palette: "M12 4a8 8 0 1 0 0 16c1.2 0 2-.9 2-2 0-.6-.2-1-.6-1.4-.3-.4-.5-.8-.5-1.3 0-1.1.9-2 2-2h2.2A3.9 3.9 0 0 0 21 9.3C20.4 6.2 16.6 4 12 4ZM7.5 12.5h.01M9.5 8.5h.01M14 7.5h.01",
  cube: "m12 3.5 7.5 4.2v8.6L12 20.5l-7.5-4.2V7.7L12 3.5ZM12 12l7.5-4.3M12 12v8.5M12 12 4.5 7.7",
  quote: "M8.5 7C6.5 7 5 8.6 5 10.7c0 1.9 1.3 3.3 3 3.3.3 0 .6 0 .8-.1-.4 1.6-1.6 2.7-3.3 3.3M18.5 7c-2 0-3.5 1.6-3.5 3.7 0 1.9 1.3 3.3 3 3.3.3 0 .6 0 .8-.1-.4 1.6-1.6 2.7-3.3 3.3",
  code: "m8.5 8-4 4 4 4m7-8 4 4-4 4M13 5l-2.5 14",
  bold: "M7.5 5h5a3.5 3.5 0 0 1 0 7h-5v-7Zm0 7h5.8a3.5 3.5 0 0 1 0 7H7.5v-7Z",
  italic: "M10 5h7M7 19h7M14.5 5l-4 14",
  strikethrough: "M6.5 12h11M8.8 8.2C9.2 6.9 10.4 6 12 6c1.8 0 3.2 1 3.2 2.6M15.2 15.2C14.8 16.7 13.6 18 12 18c-1.9 0-3.3-1.1-3.3-2.8",
  task: "M4.5 6.5 6.5 8.5 10 5M4.5 15.5 6.5 17.5 10 14M13 6.5h7M13 15.5h7",
  heading: "M6 5v14M16 5v14M6 12h10",
  image: "M4 5h16v14H4zM4 15.5l4.5-4.5 3.5 3.5 3-3L20 16M15.5 8.5h.01",
  tabs: "M4 8h16v11H4zM4 8l1.5-3.5H9L10.5 8",
  book: "M5 5.5A2.5 2.5 0 0 1 7.5 3H19v15.5H7.5A2.5 2.5 0 0 0 5 21V5.5ZM19 15H7.5A2.5 2.5 0 0 0 5 17.5",
  eye: "M12 6c-4.5 0-7.6 3.2-9 6 1.4 2.8 4.5 6 9 6s7.6-3.2 9-6c-1.4-2.8-4.5-6-9-6Zm0 9a3 3 0 1 1 0-6 3 3 0 0 1 0 6Z",
  invite: "M15 9.5a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4ZM9 12.6c.6-2.6 3-4.1 6-4.1s5.4 1.5 6 4.1M3 8h6M6 5v6",
  archive: "M4 4h16v4H4zM5.5 8v11a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1V8M10 12h4",
  kanban: "M4.5 5h4v11h-4zM10 5h4v7h-4zM15.5 5h4v14h-4z",
};

export type IconName = keyof typeof paths | string;

export function Icon({
  name,
  size = 16,
  className,
  style,
  strokeWidth = 1.5,
}: {
  name: IconName;
  size?: number;
  className?: string;
  style?: CSSProperties;
  strokeWidth?: number;
}) {
  const d = paths[name] ?? paths.file;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  );
}
