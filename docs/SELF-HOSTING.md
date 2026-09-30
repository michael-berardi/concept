# Self-hosting Concept

Concept is one Node process plus a data directory. No external services, no
native addons, no background workers.

## One command with Docker

```sh
CONCEPT_SECRET=$(openssl rand -base64 32) docker compose up -d
```

Then open `http://localhost:8787`. The first registered user becomes the
instance admin.

The compose file builds the image from this repository (web + server, see
`Dockerfile`), stores everything in the `concept-data` volume, and health-checks
`/api/health`.

## Run without Docker

Requirements: **Node 22.5+** and **git** (for sync). No other dependencies.

```sh
# from the repository root
pnpm install
pnpm --filter @concept/web build     # builds the SPA into server/public
pnpm --filter @concept/server build  # tsc -> server/dist

# create an admin user and the CRM starter workspace
cd server
CONCEPT_DATA_DIR=/var/lib/concept CONCEPT_SECRET=$(openssl rand -base64 32) \
  node dist/cli.js seed

# run
CONCEPT_DATA_DIR=/var/lib/concept PORT=8787 node dist/index.js
```

For development: `pnpm --filter @concept/server dev` (tsx watch, reloads on
change). The web app is served from `server/public`; rebuild the web package to
update it.

## CLI

```
concept-server serve                       # start the server (default)
concept-server seed                        # admin user + CRM starter workspace
concept-server create-user <email> <name> <password> [--admin]
concept-server reindex [workspace-slug]    # rebuild the search/index store
concept-server doctor                      # check data dir, SQLite+FTS5, git, workspaces
```

`doctor` exits non-zero if any check fails, so it is safe to use in monitoring.
The CLI is also available as `node server/dist/cli.js` or via
`pnpm --filter @concept/server exec concept-server`.

## Configuration (environment)

| Variable               | Default                  | Meaning                                              |
| ---------------------- | ------------------------ | ---------------------------------------------------- |
| `CONCEPT_DATA_DIR`     | `./data`                 | SQLite database + `workspaces/<slug>` vaults         |
| `PORT`                 | `8787`                   | HTTP port                                            |
| `CONCEPT_HOST`         | `0.0.0.0`                | Bind address                                         |
| `CONCEPT_SECRET`       | generated + persisted    | Encrypts git tokens at rest (AES-256-GCM). Set it in production; losing it invalidates stored tokens. |
| `CONCEPT_OPEN_SIGNUP`  | `0`                      | `1` = register without an invite                     |
| `CONCEPT_PUBLIC_DIR`   | `<package>/public`       | Static web app directory                             |
| `CONCEPT_SYNC_DEBOUNCE_MS` | `10000`              | Delay before an edit is committed to git             |
| `CONCEPT_SYNC_INTERVAL_MS` | `60000`              | Pull --rebase / push cadence                         |
| `CONCEPT_WATCH_DEBOUNCE_MS` | `300`               | File-watcher settle time before re-indexing          |

## Data layout

```
$CONCEPT_DATA_DIR/
  concept.db                 SQLite: users, sessions, ACLs, comments, index, FTS5
  .instance-secret           generated secret (only if CONCEPT_SECRET unset)
  workspaces/<slug>/         one vault per workspace (plain Markdown + .concept/)
    .concept/workspace.json  {"name": "…", "id": "…"}
    .concept/databases/<slug>.json
    Pages/, Data/<db>/, Attachments/, .trash/
```

The vaults are plain files: back them up with anything, edit them with
Obsidian/VS Code/`retex`, push them with git. The SQLite file is a derived
index plus users/auth — `concept-server reindex` rebuilds the index part at
any time. Files deleted through the API go to `.trash/` first.

## Git sync

Per workspace under **Settings → Sync** (or `PUT /api/w/:ws/sync`):

- commits are debounced (10 s) and attributed to the acting user;
- `fetch` + `rebase` + `push` run every 60 s and on demand;
- the access token is encrypted at rest and passed to git per-command
  (never written to `.git/config`);
- conflicts keep both sides: the local version is preserved as
  `<name>.conflict-<timestamp>.md`, the remote version is checked out, and the
  conflict copies are listed by `GET /api/w/:ws/sync/status`.

The vault gets a `.gitignore` with `.retex/`, `.trash/` and `.DS_Store`.

## Retex compatibility

Vaults written by Concept are valid Retex vaults:

```sh
retex doctor --vault /var/lib/concept/workspaces/crm   # passes
retex board  --vault …                                 # the deals pipeline
retex move   --vault … "Acme renewal" Won              # appears in Concept live
```

External edits (retex, git pulls, editors) are re-indexed automatically via
the built-in recursive file watcher.

## Security notes

- Passwords: scrypt (N=16384, r=8, p=1) with per-user salt.
- Sessions: HttpOnly cookie, 30 days; API tokens are `cpt_…`, stored hashed.
- Registration is invite-only after the first user unless
  `CONCEPT_OPEN_SIGNUP=1`.
- All content endpoints enforce workspace roles and path-prefix ACLs,
  including tree, search, graph and vault file endpoints.
- Put the server behind a TLS-terminating proxy (Caddy, nginx, Traefik) for
  anything reachable from the internet; the server itself speaks plain HTTP.

## Upgrading

1. Back up `$CONCEPT_DATA_DIR` (or snapshot the volume).
2. Pull the new image / code and restart. Migrations run automatically on
   start (`CREATE TABLE IF NOT EXISTS`-style, additive only).
3. `concept-server doctor` should report all checks passed.
