# Concept — product and technical spec

Concept is an open-source workspace that fuses Notion (pages, databases) and Trello (boards) and adds a CRM. Your data is a folder of Markdown files (a **vault**, compatible with [Retex](https://github.com/michael-berardi/retex)). You can self-host a multi-team server, use the native macOS app on a local vault, or both. Git is the sync layer.

## Principles
1. **Files are the truth.** Every page and every database row is a Markdown file with YAML frontmatter. The SQLite database only holds an index and things that must not live in git (users, sessions, ACLs, comments cache).
2. **No lock-in.** `retex`, Obsidian, VS Code and `git` all work on the same vault.
3. **Self-hosting is one command** (`docker compose up`) or one binary-less `node` process. No external services required.
4. **No silent failures.** Every error has a code and a message that names its cause.

## Repo layout
```
server/   Node 22 + TypeScript + Hono + node:sqlite (REST + SSE + static web)
web/      React 19 + Vite + TypeScript SPA (built into server/public)
macos/    Swift package: ConceptKit (vault engine) + Concept (SwiftUI app)
docs/     this spec, API, vault format, self-hosting
```

## Vault format (Retex compatible)
```
<vault>/
  .concept/
    workspace.json          {"name": "...", "id": "..."}
    databases/<slug>.json   database schema + views (see below)
  Pages/<Title>.md          type: page   (nested pages: Pages/<Parent>/<Child>.md; parent page file optional)
  Data/<db-slug>/<row>.md   one row per file, type = database.recordType
  Attachments/<id>-<name>
  .retex/                   retex state (gitignored)
```
Row / page file:
```markdown
---
title: Acme renewal
type: deal
status: Proposal        # board column
rank: 0|hzzzzz:         # fractional ordering key within a column (string, lexicographic)
owner: mike
company: "[[Acme]]"
value: 12000
due: 2026-10-14
tags: [priority]
archived: false
---
Markdown body. Wiki links [[Other page]], task lists `- [ ]`, tables, code.
```
Core properties (Retex contract): `title, type, status, rank, owner, company, value, due, next_action, tags, archived`. Custom properties are any other frontmatter keys declared in the database schema.

Database schema `.concept/databases/<slug>.json`:
```json
{
  "slug": "deals", "name": "Deals", "icon": "💼", "recordType": "deal",
  "properties": [
    {"key": "title", "name": "Name", "type": "title"},
    {"key": "status", "name": "Stage", "type": "status", "options": [{"id":"Inbox","color":"gray"}, ...]},
    {"key": "value", "name": "Value", "type": "number", "format": "currency"},
    {"key": "company", "name": "Company", "type": "relation", "database": "companies"}
  ],
  "views": [
    {"id": "board", "name": "Pipeline", "type": "board", "groupBy": "status", "filters": [], "sorts": [], "visible": ["value","due"]},
    {"id": "table", "name": "Table", "type": "table", "filters": [], "sorts": [{"key":"due","dir":"asc"}]}
  ]
}
```
Property types: `title text number select multi_select status date checkbox url email phone person relation created updated`.
View types: `table board list calendar gallery`. Filter: `{key, op, value}` with op in `eq neq contains gt lt gte lte empty notempty`.

Built-in templates (created from UI "New database → template"): **Tasks** (Todo/Doing/Review/Done board), **Contacts**, **Companies**, **Deals** (stages Inbox, Qualified, Proposal, Negotiation, Won, Lost), **Activities**, **Projects**. A new workspace offers a "CRM starter" that creates Companies, Contacts, Deals, Activities with relations and sample-free empty state.

Card features (Trello side): checklists (Markdown task lists in body), labels (`tags`), assignees (`owner`, `assignees: []`), due dates, cover image (`cover`), attachments, comments, activity log, archive, card templates, WIP-free ordering via `rank`.

## Multi-team access (server)
- **Workspace** = one vault directory on the server. One server hosts many workspaces.
- **Users**: email + password (scrypt), session cookie, personal API tokens (`cpt_…`), first registered user becomes instance admin. Invite links (`/invite/<token>`) with role. Optional OIDC (generic, env-configured) is a stretch goal.
- **Workspace roles**: `owner`, `admin`, `member`, `guest`. Guests see only what is explicitly shared.
- **Teams**: named groups of members inside a workspace.
- **ACL** by path prefix (`Pages/Sales`, `Data/deals`) for subject = user | team | workspace, level = `none view comment edit admin`. Most specific prefix wins; workspace default is `edit` for members, `none` for guests.
- Every mutation is attributed (activity log and git commit author).
- **Concurrency**: REST uses optimistic concurrency (`contentHash` in responses, `If-Match` on writes → 409 `conflict` with the current version). Live updates via SSE. No CRDT; the editor shows a merge banner on conflict.

## Git sync (server and macOS)
- Workspace settings hold a remote URL and an access token (encrypted at rest with the instance secret).
- Server commits changed files (debounced 10 s) with the acting user as author, then `pull --rebase`/`push` every 60 s and on demand. Conflicts: never lose data — the losing side is saved as `<name>.conflict-<timestamp>.md` and surfaced in the UI and `/sync/status`.
- macOS app does the same against its local vault via the `git` CLI.

## Retex integration
- The vault is a valid Retex vault: `retex doctor --vault <dir>` passes, `retex board/query/search` work, cards moved by `retex move` appear in Concept (file watcher).
- Concept is the UI in front of Retex: the server watches the vault for external changes and re-indexes.
- Server endpoint `/api/w/:ws/retex/schema` returns the Retex record contract derived from the databases.

## REST API (all JSON, prefix `/api`, auth: session cookie or `Authorization: Bearer cpt_…`)
Errors: `{"error":{"code":"not_found","message":"…"}}` with proper HTTP status.

Auth / instance
- `GET  /api/health` → `{ok:true,version,setupRequired}`
- `POST /api/auth/register` {email,name,password,inviteToken?} (first user → instance admin; otherwise needs invite unless `CONCEPT_OPEN_SIGNUP=1`)
- `POST /api/auth/login` {email,password} · `POST /api/auth/logout` · `GET /api/me`
- `GET/POST/DELETE /api/me/tokens` personal API tokens (secret shown once)

Workspaces (`:ws` = slug)
- `GET /api/workspaces` · `POST /api/workspaces` {name,slug?,template?:"blank"|"crm"}
- `GET/PATCH/DELETE /api/w/:ws`
- `GET /api/w/:ws/members` · `PATCH/DELETE /api/w/:ws/members/:userId` {role}
- `POST /api/w/:ws/invites` {email?,role,expiresInDays} → `{url}` · `GET /api/w/:ws/invites` · `DELETE /api/w/:ws/invites/:id` · `POST /api/invites/:token/accept`
- `GET/POST /api/w/:ws/teams` · `PATCH/DELETE /api/w/:ws/teams/:id` · `PUT/DELETE /api/w/:ws/teams/:id/members/:userId`
- `GET /api/w/:ws/acl?path=` · `PUT /api/w/:ws/acl` {path,subjectType,subjectId,level} · `DELETE /api/w/:ws/acl/:id`

Content
- `GET /api/w/:ws/tree` → nested pages + databases the caller may see
- `GET /api/w/:ws/pages?parent=` · `POST /api/w/:ws/pages` {title,parent?,body?,icon?}
- `GET /api/w/:ws/pages/*path` → `{path,title,icon,properties,body,contentHash,updatedAt,backlinks:[…],permission}`
- `PUT /api/w/:ws/pages/*path` {title?,properties?,body?} (If-Match) · `DELETE` (moves to `.trash/`) · `POST …/move` {parent}
- `GET/POST /api/w/:ws/databases` · `GET/PATCH/DELETE /api/w/:ws/databases/:db` (schema + views)
- `GET /api/w/:ws/databases/:db/rows?view=&filter=&sort=&q=&limit=&cursor=` → `{rows:[{id,path,properties,rank,contentHash}],nextCursor}`
- `POST /api/w/:ws/databases/:db/rows` {properties,body?} · `GET/PATCH/DELETE /api/w/:ws/databases/:db/rows/:id`
- `POST /api/w/:ws/databases/:db/rows/:id/move` {status, beforeId?, afterId?} (board drag; recomputes `rank`)
- `GET /api/w/:ws/search?q=&type=` (FTS5) · `GET /api/w/:ws/backlinks?path=`
- `GET/POST /api/w/:ws/comments?path=` · `DELETE /api/w/:ws/comments/:id`
- `POST /api/w/:ws/attachments` (multipart) · `GET /api/w/:ws/attachments/:id`
- `GET /api/w/:ws/activity?path=&limit=`
- `GET /api/w/:ws/export.zip` (vault as zip) · `POST /api/w/:ws/import` (zip of Markdown; Notion/Obsidian-style)
- `GET /api/w/:ws/events` (SSE: `change`, `comment`, `sync`)

Sync
- `GET/PUT /api/w/:ws/sync` {remoteUrl,branch,token?,enabled} · `POST /api/w/:ws/sync/run` · `GET /api/w/:ws/sync/status`

## Web app (React)
Sidebar (workspaces switcher, search ⌘K, favourites, page tree, databases), block editor (slash menu, headings, lists, tasks, quotes, code, tables, callouts, images, wiki-link `[[` picker, Markdown round-trip), database views (table with inline editing, board with drag-and-drop, list, calendar, gallery, filters/sorts/group), card modal (properties, description editor, checklist, comments, activity), CRM home dashboard (pipeline value by stage, upcoming follow-ups), members/teams/permissions settings, git sync settings, command palette, dark/light, keyboard shortcuts, mobile layout at 375 px, empty and error states everywhere.

## macOS app (SwiftUI, macOS 14+)
`ConceptKit` (no UI): vault scan/watch (FSEvents), frontmatter parser/writer that preserves unknown keys and ordering, database schema, rank math, search index, git sync via `/usr/bin/git`, optional server mode (REST client). `Concept.app`: sidebar, page editor (Markdown source + live rendered preview), board (drag and drop), table, card sheet, ⌘K quick open, sync status + button, vault picker, Retex-compatible. Built with `swift build`; `scripts/bundle.sh` produces `Concept.app` and a zip.

## Quality bar
Unit tests in every package; API integration tests; Playwright-free visual verification via OverSeer browser screenshots at 375 px and 1920 px; `retex doctor` passes on a vault written by Concept; MIT license; no secrets in repo.

## Two views: Workspace and Board
Concept has exactly two views, switched in the top bar (⌘1 / ⌘2).

**Workspace — Notion × Obsidian.** One sidebar that is the vault: the real folders and Markdown files on disk (Retex records and unmanaged `.md` files included), databases listed as collections, hover `+` to add a child page, drag to move, favourites. Every file opens as a page: large title, a properties block (frontmatter) under it, then the body in a block editor (slash menu, `[[` picker, tables, tasks, code). `[[wiki links]]` render as real links, never raw brackets. A Source toggle shows the raw Markdown. A right panel (⌥⌘B) holds outline, backlinks, outgoing links, tags and a local graph; the full graph is ⌘G. Tabs, ⌘O quick switcher, ⌘K search.

**Board — Trello × CRM.** Pick a database (Tasks, Deals, Projects…); columns are its status options; cards drag smoothly (fractional `rank`); a card opens with properties, description, checklist, comments and activity. Because cards are files, the same card is reachable from Workspace, the graph and backlinks.

API additions used by Workspace: `GET /api/w/:ws/vault/tree`, `GET|PUT|DELETE /api/w/:ws/vault/file/*path`, `GET /api/w/:ws/graph`, `GET /api/w/:ws/tags`, `GET /api/w/:ws/links`.

## Design language
Quiet, precise, Apple-grade restraint with Tesla-like minimalism; the feel of a studio that obsesses over spacing and type.
- **OLED Black is the default**: true `#000` canvas, surfaces `#0a0a0a/#111`, hairline 1 px borders at ~8 % white, no drop shadows on dark (elevation via lighter surfaces), one accent used sparingly.
- Themes (all tokenised as CSS variables / Swift `Theme`): **OLED** (default), **Graphite** (soft dark gray, Obsidian-like), **Paper** (warm light), **Snow** (cool light), **Midnight** (deep blue-black), **Forest** (dark green-gray). System appearance aware; per-workspace accent.
- Type: SF Pro / system-ui stack, Inter fallback; 14 px base, 1.5 line-height, tabular numbers for money; editor max width ~720 px but vault/table/board views fill the viewport on wide monitors.
- Motion: 120–180 ms ease-out, reduced-motion respected; drag shadows subtle; no bounce.
- No chips or redundant labels, no dense card-grid clutter, no emoji-as-decoration defaults; icons are one consistent thin-stroke set.
- Every view designed for 375 px and 1920 px.
