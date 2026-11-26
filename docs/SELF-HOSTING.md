# Self-hosting Concept

Concept is one Node process plus a data directory. No external services, no
native addons, no background workers.

## One command with Docker

```sh
docker compose up -d
```

Run this from the cloned repository with Docker Compose installed.
Then open `http://localhost:8787`. The first registered user becomes the
instance admin.

The compose file builds the image from this repository (web + server, see
`Dockerfile`), stores everything in the `concept-data` volume, and health-checks
`/api/health`. The generated encryption secret persists in the data volume.
If you set `CONCEPT_SECRET` instead, keep the same value across restarts;
generating a new value on each run makes stored Git tokens unreadable.

## Run without Docker

Requirements: **Node 22.13+**, **pnpm 10.27.0** and **git** (for sync).
Node 22.13+ enables the built-in SQLite module without an experimental flag.

```sh
# from the repository root
pnpm install --frozen-lockfile
pnpm build                         # web -> server/public; server -> server/dist

# create an admin user and the CRM starter workspace
cd server
CONCEPT_DATA_DIR=./data node dist/cli.js seed

# run
CONCEPT_DATA_DIR=./data PORT=8787 node dist/index.js
```

Without `CONCEPT_ADMIN_PASSWORD`, the seed command writes the generated password
to `$CONCEPT_DATA_DIR/admin-password.txt` (0600) instead of printing it. Read it
there, then delete the file if you no longer need it. You can set
`CONCEPT_ADMIN_EMAIL` and `CONCEPT_ADMIN_PASSWORD` when seeding instead.
Keep the same data directory for both commands; use an absolute path in a service.

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
The CLI is also available as `node server/dist/cli.js` as `node server/bin/concept-server.js` after building.

## Configuration (environment)

| Variable               | Default                  | Meaning                                              |
| ---------------------- | ------------------------ | ---------------------------------------------------- |
| `CONCEPT_DATA_DIR`     | `./data`                 | SQLite database + `workspaces/<slug>` vaults         |
| `PORT`                 | `8787`                   | HTTP port                                            |
| `CONCEPT_HOST`         | `0.0.0.0`                | Bind address                                         |
| `CONCEPT_SECRET`       | generated + persisted    | Encrypts git tokens at rest (AES-256-GCM). Keep it stable; losing it invalidates stored tokens. |
| `CONCEPT_OPEN_SIGNUP`  | `0`                      | `1` = register without an invite                     |
| `CONCEPT_PUBLIC_DIR`   | `<package>/public`       | Static web app directory                             |
| `CONCEPT_SYNC_DEBOUNCE_MS` | `10000`              | Delay before an edit is committed to git             |
| `CONCEPT_SYNC_INTERVAL_MS` | `60000`              | Pull --rebase / push cadence                         |
| `CONCEPT_WATCH_DEBOUNCE_MS` | `300`               | File-watcher settle time before re-indexing          |
| `CONCEPT_ACTIVITY_RETENTION_DAYS` | `90`          | Days of activity history kept; `0` keeps it all      |

## Data layout

```
$CONCEPT_DATA_DIR/
  concept.db                 SQLite: users, sessions, ACLs, comments, index, FTS5
  .instance-secret           generated secret (only if CONCEPT_SECRET unset), 0600
  admin-password.txt         generated seed password (only when seed generated one), 0600
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

Per workspace under **Settings → Sync** (or `PUT /api/w/:ws/sync`). Sync is off
until you enable it and configure a remote; nothing is fetched or pushed before then.

- commits are debounced (10 s) and attributed to the acting user;
- `fetch` + `rebase` + `push` run every 60 s and on demand;
- the access token is encrypted at rest and passed to git per-command
  (never written to `.git/config`);
- conflicts keep both sides: the local version is preserved as
  `<name>.conflict-<timestamp>.md`, the remote version is checked out, and the
  conflict copies are listed by `GET /api/w/:ws/sync/status`.

The vault gets a `.gitignore` with `.retex/`, `.trash/` and `.DS_Store`. New data
directories and vault files are created with 0700/0600 permissions. Each new
activity entry prunes activity older than `CONCEPT_ACTIVITY_RETENTION_DAYS`
(default 90; `0` keeps it all); there is no automatic purge
of vault backups or `.trash/`, so delete those yourself when you want them gone.

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
2. Pull the new code and rebuild (`docker compose up -d --build`, or `pnpm install --frozen-lockfile && pnpm build`), then restart. Migrations run automatically on
   start (`CREATE TABLE IF NOT EXISTS`-style, additive only).
3. `concept-server doctor` should report all checks passed.
