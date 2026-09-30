# UX brief v2 — supersedes the three-mode design in SPEC.md ("Vault mode")

**Concept has exactly two views: Workspace and Board.** There is no separate Vault mode. The top bar has a two-option switch: Workspace | Board.

## Workspace = Notion x Obsidian in one surface
- **One sidebar that is the vault.** The page tree shows the real folders and Markdown files on disk (Retex records and unmanaged `.md` files too), with Notion-style behaviour: hover `+` to add child, drag to reorder/move, inline rename, icons, favourites, collapsible, quiet gray, small type. Databases appear in the same tree as collections (table icon). No separate "Databases/Pages" headings.
- **Every file opens as a beautiful page.** Notion-style editor: large title, properties shown as a tidy Notion properties block under the title (frontmatter: status, due, owner, tags, relations; click to edit), then the body. Slash menu `/`, `[[` picker, drag handles, block hover toolbar, callouts, toggles, tables, code, images. **`[[wiki links]]` render as real inline links** (never raw brackets), with hover preview. Checkboxes and bullets aligned on the text baseline. Tight, confident spacing.
- **"Source" toggle** (⌘/) flips the same page to raw Markdown for power users; a subtle raw-path breadcrumb replaces the ugly monospace file path line.
- **Obsidian side panel** (right, collapsible, ⌘⌥B): Backlinks, Outgoing links, Outline, Tags, Properties, and a **local graph** of the page; **Graph** full-screen from the sidebar footer or ⌘G (global, gray nodes, accent on focus, filter by folder/tag).
- Tabs across the top for open pages (Obsidian), ⌘O quick switcher, ⌘K command palette and search, ⌘P/⌘N new page, back/forward history.
- Databases open inside Workspace as a page of the same kind: title + view tabs (Table, List, Calendar, Gallery) with filters/sorts, inline cell editing, row opens as a page in a side peek or full page. Relations link to other rows.
- Home = a calm start page: recent pages, pinned, today's tasks, CRM pulse (pipeline by stage, follow-ups due). Not a dense card grid.

## Board = Trello x CRM
- Pick any database (Tasks, Deals, Projects…) or a folder/tag-based set; columns = its `status` options; cards drag smoothly (rank); add card inline; card opens in the same page peek used in Workspace (properties + body + checklist + comments + activity). Swimlanes by owner optional, filter bar, WIP-free. Board switcher in the header, pinned boards in the sidebar.
- Because cards are files, the same card is reachable from Workspace, graph and backlinks.

## Bar for polish
Apple-designer restraint: OLED black default, six themes, hairline borders, 14 px type, generous but not loose spacing, consistent 16 px icons, no chip clutter, no emoji decoration, no raw syntax leaking into rendered UI, every state designed. A first-time user must understand it without a tutorial: empty states explain the next action in one line. 375 px layout collapses the sidebar into a sheet and the panel into a bottom sheet.
