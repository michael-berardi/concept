# Concept REST API

All endpoints are JSON under `/api` unless noted. Authentication is a session
cookie (from login/register) or a personal API token:

```
Authorization: Bearer cpt_xxxxxxxxxxxx
```

Errors always have a code and a message naming the cause:

```json
{ "error": { "code": "conflict", "message": "The page was modified by someone else",
             "current": { "path": "Pages/Roadmap.md", "contentHash": "…" } } }
```

Common codes: `bad_request`, `unauthorized`, `forbidden`, `not_found`,
`conflict`, `invalid_json`, `invalid_path`, `reserved_path`, `email_taken`,
`slug_taken`, `weak_password`.

Optimistic concurrency: every read returns a `contentHash` (sha256 of the file
bytes). Send it back on writes as `If-Match: <contentHash>` (or `If-Match: *`).
A stale hash yields `409 conflict` with the current version in
`error.current`.

---

## Health

### `GET /api/health`

```sh
curl localhost:8787/api/health
```

```json
{ "ok": true, "version": "0.1.0", "setupRequired": false }
```

`setupRequired` is `true` until the first user registers.

---

## Auth

### `POST /api/auth/register`

The first registered user becomes the instance admin. Afterwards registration
requires an invite token unless `CONCEPT_OPEN_SIGNUP=1`.

```sh
curl -X POST localhost:8787/api/auth/register \
  -H 'content-type: application/json' \
  -d '{"email":"mike@example.com","name":"Mike","password":"correct-horse","inviteToken":"ivt_…"}'
```

→ `201 {"user":{"id":"usr_…","email":"mike@example.com","name":"Mike","isAdmin":false}}`
and a `concept_session` cookie.

### `POST /api/auth/login`

```sh
curl -X POST localhost:8787/api/auth/login -c cookies.txt \
  -H 'content-type: application/json' \
  -d '{"email":"mike@example.com","password":"correct-horse"}'
```

### `POST /api/auth/logout`

Clears the session cookie and deletes the session row.

### `GET /api/me`

```json
{ "user": { "…": "…" },
  "workspaces": [ { "slug": "crm", "name": "CRM", "role": "owner" } ] }
```

### Personal API tokens

```
GET    /api/me/tokens          → { tokens: [{id,name,createdAt,lastUsedAt}] }
POST   /api/me/tokens {name}   → 201 { id, name, token }   # token shown once
DELETE /api/me/tokens/:id      → { ok: true }
```

```sh
curl -b cookies.txt -X POST localhost:8787/api/me/tokens \
  -H 'content-type: application/json' -d '{"name":"ci"}'
# {"id":"tok_…","name":"ci","token":"cpt_9j…"}
curl -H 'Authorization: Bearer cpt_9j…' localhost:8787/api/me
```

---

## Workspaces

A workspace is one vault directory on the server (`$CONCEPT_DATA_DIR/workspaces/<slug>`).

### `GET /api/workspaces` · `POST /api/workspaces`

```sh
curl -b cookies.txt -X POST localhost:8787/api/workspaces \
  -H 'content-type: application/json' \
  -d '{"name":"Acme HQ","template":"crm"}'
```

→ `201 {"slug":"acme-hq","name":"Acme HQ","template":"crm"}`

`template` is `"blank"` (a Welcome page) or `"crm"` (creates the Companies,
Contacts, Deals and Activities databases with relations and an empty state;
Deals stages are Inbox, Qualified, Proposal, Negotiation, Won, Lost).

### `GET/PATCH/DELETE /api/w/:ws`

```sh
curl -b cookies.txt localhost:8787/api/w/acme-hq
curl -b cookies.txt -X PATCH localhost:8787/api/w/acme-hq \
  -H 'content-type: application/json' -d '{"name":"Acme HQ (EU)"}'
curl -b cookies.txt -X DELETE localhost:8787/api/w/acme-hq   # owner only; vault is moved aside, not destroyed
```

### Members

```
GET    /api/w/:ws/members               → { members: [{id,email,name,role}] }
PATCH  /api/w/:ws/members/:userId  {role: "owner"|"admin"|"member"|"guest"}
DELETE /api/w/:ws/members/:userId
```

Roles: `owner` (full control), `admin` (settings, members, invites),
`member` (read/write everything not restricted by ACL), `guest`
(nothing unless granted by ACL).

### Invites

```
POST   /api/w/:ws/invites {email?, role, expiresInDays} → 201 { id, url, token, role, expiresAt }
GET    /api/w/:ws/invites
DELETE /api/w/:ws/invites/:id
POST   /api/invites/:token/accept                        → { ok, workspace, role }
```

```sh
curl -b cookies.txt -X POST localhost:8787/api/w/acme-hq/invites \
  -H 'content-type: application/json' -d '{"role":"member","expiresInDays":7}'
# → {"id":"inv_…","url":"/invite/ivt_…","token":"ivt_…","role":"member", …}
```

### Teams

```
GET    /api/w/:ws/teams                                  → { teams: [{id,name,memberIds}] }
POST   /api/w/:ws/teams {name}
PATCH  /api/w/:ws/teams/:id {name}
DELETE /api/w/:ws/teams/:id
PUT    /api/w/:ws/teams/:id/members/:userId
DELETE /api/w/:ws/teams/:id/members/:userId
```

### ACL (path-prefix permissions)

Levels: `none < view < comment < edit < admin`.
Subjects: `user`, `team`, `workspace` (everyone in the workspace).
Rules match by path prefix — a rule on `Pages/Public` covers the page
`Pages/Public.md` and everything under `Pages/Public/`. The most specific
prefix wins; on equal specificity user beats team beats workspace. The default
is `edit` for members, `admin` for owner/admin roles, `none` for guests.

```
GET    /api/w/:ws/acl                → { rules: [...] }
GET    /api/w/:ws/acl?path=Pages/X   → { path, level, rules }
PUT    /api/w/:ws/acl {path, subjectType, subjectId?, level}
DELETE /api/w/:ws/acl/:id
```

```sh
curl -b cookies.txt -X PUT localhost:8787/api/w/acme-hq/acl \
  -H 'content-type: application/json' \
  -d '{"path":"Pages/Public","subjectType":"team","subjectId":"team_…","level":"view"}'
```

---

## Content

### Tree

### `GET /api/w/:ws/tree`

Nested pages plus databases the caller may see:

```json
{
  "pages": [
    { "name": "Pages", "path": "Pages", "type": "page", "archived": false,
      "children": [ { "name": "Roadmap", "path": "Pages/Roadmap.md", "type": "page", "children": [] } ] }
  ],
  "databases": [ { "slug": "deals", "name": "Deals", "path": "Data/deals", "rowCount": 12, … } ]
}
```

### Pages

```
GET    /api/w/:ws/pages?parent=Pages/Roadmap.md
POST   /api/w/:ws/pages {title, parent?, body?, icon?}
GET    /api/w/:ws/pages/*path
PUT    /api/w/:ws/pages/*path {title?, properties?, body?}   (If-Match)
DELETE /api/w/:ws/pages/*path                                (moves to .trash/)
POST   /api/w/:ws/pages/*path/move {parent}                  (parent null = top level)
```

```sh
curl -b cookies.txt -X POST localhost:8787/api/w/acme-hq/pages \
  -H 'content-type: application/json' \
  -d '{"title":"Roadmap","body":"Q1 plan, see [[Welcome]]"}'
```

→ `201` with the full page:

```json
{ "path": "Pages/Roadmap.md", "title": "Roadmap", "icon": null,
  "parent": "Pages", "properties": { "title": "Roadmap", "type": "page", "created": "…" },
  "body": "Q1 plan, see [[Welcome]]", "contentHash": "9f2…", "updatedAt": 1735…,
  "backlinks": [], "permission": "edit", "archived": false }
```

Update with optimistic concurrency:

```sh
curl -b cookies.txt -X PUT localhost:8787/api/w/acme-hq/pages/Pages/Roadmap.md \
  -H 'content-type: application/json' -H 'If-Match: 9f2…' \
  -d '{"body":"Q1+Q2 plan, see [[Welcome]]","properties":{"owner":"mike"}}'
```

A stale `If-Match` returns `409` with `error.current.contentHash`.

Nested pages: create with `"parent": "Pages/Roadmap.md"` → file at
`Pages/Roadmap/Notes.md`. Delete moves the file to `.trash/<timestamp>-<name>.md`.

### Databases

```
GET    /api/w/:ws/databases                       → { databases: [schema…] }
POST   /api/w/:ws/databases {name, slug?, icon?, recordType?, template?, properties?, views?}
GET    /api/w/:ws/databases/:db                   → schema + views
PATCH  /api/w/:ws/databases/:db {name?, icon?, properties?, views?, recordType?}
DELETE /api/w/:ws/databases/:db                   (schema + rows to .trash/)
```

Built-in templates: `tasks`, `contacts`, `companies`, `deals`, `activities`,
`projects`.

```sh
curl -b cookies.txt -X POST localhost:8787/api/w/acme-hq/databases \
  -H 'content-type: application/json' -d '{"template":"deals"}'
```

Schemas are stored at `.concept/databases/<slug>.json` in the vault and are
plain files — edit them with any tool; the server picks changes up.

Property types: `title text number select multi_select status date checkbox
url email phone person relation created updated`.
View types: `table board list calendar gallery`.
Filters: `{key, op, value}` with op in `eq neq contains gt lt gte lte empty notempty`.

### Rows

One row = one Markdown file under `Data/<db-slug>/`. The row id is the file
stem. Core frontmatter: `title, type, status, rank, owner, company, value,
due, next_action, tags, archived` plus any schema property.

```
GET    /api/w/:ws/databases/:db/rows?view=&filter=&sort=&q=&limit=&cursor=&archived=1
POST   /api/w/:ws/databases/:db/rows {properties, body?}
GET    /api/w/:ws/databases/:db/rows/:id
PATCH  /api/w/:ws/databases/:db/rows/:id {properties?, body?}   (If-Match)
DELETE /api/w/:ws/databases/:db/rows/:id
POST   /api/w/:ws/databases/:db/rows/:id/move {status, beforeId?, afterId?}
```

```sh
curl -b cookies.txt -X POST localhost:8787/api/w/acme-hq/databases/deals/rows \
  -H 'content-type: application/json' \
  -d '{"properties":{"title":"Acme renewal","status":"Proposal","value":12000,"company":"[[Acme]]"},"body":"Follow up Monday."}'
```

```json
{ "id": "acme-renewal-e7024c", "path": "Data/deals/acme-renewal-e7024c.md",
  "properties": { "title": "Acme renewal", "status": "Proposal", "value": 12000,
                  "rank": "4", "type": "deal", "created": "…" },
  "rank": "4", "contentHash": "…", "updatedAt": … }
```

List with a saved view (filters/sorts/grouping from the schema):

```sh
curl -b cookies.txt 'localhost:8787/api/w/acme-hq/databases/deals/rows?view=board&limit=50'
# → { rows: […], nextCursor: 50, view: {…}, schema: {…} }
```

Inline filters and sorts (JSON):

```sh
curl -b cookies.txt --get 'localhost:8787/api/w/acme-hq/databases/deals/rows' \
  --data-urlencode 'filter=[{"key":"status","op":"eq","value":"Won"}]' \
  --data-urlencode 'sort=[{"key":"value","dir":"desc"}]'
```

#### Board move (drag and drop)

`status` is the target column. `afterId` is the row to land after, `beforeId`
the row to land before (either or both). The server recomputes the fractional
`rank`; only the moved row's file is written.

```sh
curl -b cookies.txt -X POST \
  localhost:8787/api/w/acme-hq/databases/deals/rows/acme-renewal-e7024c/move \
  -H 'content-type: application/json' \
  -d '{"status":"Won","afterId":"globex-pilot-91ab2c"}'
```

If a column contains non-canonical ranks (written by `retex` or a text
editor), the server transparently resequences that column first.

---

## Search, links, graph

```
GET /api/w/:ws/search?q=acme&type=page|record|<db-slug>
GET /api/w/:ws/backlinks?path=Pages/Welcome.md
GET /api/w/:ws/links?path=Pages/Roadmap.md      → { outgoing, backlinks, unresolved }
GET /api/w/:ws/tags                              → [{tag, count, paths}]
GET /api/w/:ws/graph?scope=global|local&path=&depth=
```

```sh
curl -b cookies.txt 'localhost:8787/api/w/acme-hq/search?q=renewal'
# { "results": [ { "path": "Data/deals/acme-renewal-e7024c.md", "title": "Acme renewal",
#                  "kind": "record", "db_slug": "deals", "snip": "Follow up…" } ] }
curl -b cookies.txt 'localhost:8787/api/w/acme-hq/graph?scope=local&path=Pages/Welcome.md&depth=1'
```

Search is SQLite FTS5 (prefix match per term, AND-combined), workspace-scoped
and ACL-filtered. Tags come from frontmatter `tags` plus inline `#tags` in the
body. Graph nodes are visible files; edges are resolved `[[wiki links]]`.

---

## Comments, attachments, activity

```
GET    /api/w/:ws/comments?path=Pages/Roadmap.md
POST   /api/w/:ws/comments {path, body}       (needs comment level)
DELETE /api/w/:ws/comments/:id                 (author or workspace admin)
POST   /api/w/:ws/attachments                  multipart form-data, field "file"
GET    /api/w/:ws/attachments/:id              (streams the file)
GET    /api/w/:ws/activity?path=&limit=        (newest first)
```

```sh
curl -b cookies.txt -F file=@photo.png localhost:8787/api/w/acme-hq/attachments
# → 201 {"id":"e7024c-photo.png","path":"Attachments/e7024c-photo.png","size":…}
```

Comments live in SQLite (they are workspace chatter, not vault content).
Attachments are files under `Attachments/` in the vault, so they sync with git.

---

## Vault mode (raw files)

```
GET    /api/w/:ws/vault/tree                   (all files incl. .concept; .git excluded)
GET    /api/w/:ws/vault/file/*path             → { path, content, contentHash, frontmatter, size, updatedAt }
PUT    /api/w/:ws/vault/file/*path             (raw text body; If-Match) 
DELETE /api/w/:ws/vault/file/*path             (to .trash/)
POST   /api/w/:ws/vault/move {from, to}
```

```sh
curl -b cookies.txt localhost:8787/api/w/acme-hq/vault/file/Pages/Roadmap.md
curl -b cookies.txt -X PUT localhost:8787/api/w/acme-hq/vault/file/Pages/Notes.md \
  -H 'content-type: text/plain' -H 'If-Match: …' --data-binary @Notes.md
```

Writes are raw: the file on disk is exactly the request body (frontmatter is
yours to manage). `.git`, `.trash` and dot-directories other than
`.concept/databases/*` are reserved.

## Export / import

```
GET  /api/w/:ws/export.zip        (zip of the vault, .git excluded)
POST /api/w/:ws/import            multipart field "file" (zip of Markdown)
```

Import skips `.git/`, `.trash/`, `.retex/` and `.concept/workspace.json`
(the server keeps its own workspace identity) and re-indexes afterwards.
Notion/Obsidian-style Markdown zips import as pages.

## Events (SSE)

```
GET /api/w/:ws/events        text/event-stream
```

Events: `change` `{type,paths,actor}`, `comment` `{type,path,actor}`,
`sync` `{type,status,detail}`, plus `ping` heartbeats every 25 s.

```
event: change
data: {"type":"change","paths":["Pages/Roadmap.md"],"actor":"Mike <mike@example.com>"}
```

## Retex

```
GET /api/w/:ws/retex/schema
```

Returns the Retex record contract derived from the databases:

```json
{ "properties": ["title","type","status","rank","owner","company","value","due","next_action","tags","archived"],
  "recordTypes": [ { "type": "deal", "database": "deals",
                     "statuses": ["Inbox","Qualified","Proposal","Negotiation","Won","Lost"],
                     "properties": ["title","status","value","company", …] } ],
  "boardLists": ["Inbox","Qualified","Proposal","Negotiation","Won","Lost","Todo","Doing","Review","Done"] }
```

The vault itself is Retex-compatible: `retex doctor --vault <workspace dir>`
passes, and `retex move/set/create` against the vault directory appear in
Concept within a moment (file watcher).

---

## Sync (git)

```
GET  /api/w/:ws/sync          → { remoteUrl, branch, enabled, hasToken }
PUT  /api/w/:ws/sync {remoteUrl, branch, token?, enabled}    (admin; token stored encrypted)
POST /api/w/:ws/sync/run                                     (commit + pull --rebase + push now)
GET  /api/w/:ws/sync/status   → { …, lastSyncAt, lastStatus, lastMessage, lastCommit, conflicts }
```

```sh
curl -b cookies.txt -X PUT localhost:8787/api/w/acme-hq/sync \
  -H 'content-type: application/json' \
  -d '{"remoteUrl":"https://github.com/acme/vault.git","branch":"main","token":"ghp_…","enabled":true}'
curl -b cookies.txt -X POST localhost:8787/api/w/acme-hq/sync/run
```

Behaviour: edits are committed ~10 s after the change with the acting user as
the git author; `fetch` + `rebase` + `push` run every 60 s and on demand. The
token is encrypted at rest (AES-256-GCM with `CONCEPT_SECRET`) and is only
used per-command — it is never written to `.git/config`. On a conflict the
server never loses data: the local version is preserved as
`<name>.conflict-<timestamp>.md`, the remote version is checked out in place,
and both are pushed. `GET …/sync/status` lists conflict copies so the UI can
surface them.
