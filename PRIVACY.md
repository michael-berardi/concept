# Privacy

Concept has no telemetry, analytics, crash reporting, install ID or usage
tracking. Your vault stays in your folder or on your server. Besides Git sync
to remotes you configure, the only network request Concept makes on its own is
the daily update check.

## Update check

- **Mac app:** Sparkle fetches the signed appcast from this repository's latest
  GitHub release once a day.
- **Self-hosted server:** one request a day to GitHub's public "latest release"
  record for this repository.
- Each check is one anonymous HTTPS GET with the fixed user agent
  `concept-update-check`: no account, vault, usage, version or machine data.
  Sparkle's system profiling is off.
- The server keeps the result in one small file, `update-check.json` (mode
  0600), in its data directory. A failed check stores a short cause and runs
  again the next day. Sparkle keeps its state in the app's preferences.
- Skipping a version in the web app is stored in that browser's local storage.

### Turning it off

- Mac app: turn off **Check for updates automatically** in **Settings → Updates**.
- Server: set `CONCEPT_NO_UPDATE_CHECK=1`. This also deletes `update-check.json`
  and the browser's notice state. The check is off whenever `CI` is set.

See [updates](docs/updates.md) for how updates are offered and installed.

## Other network use

Everything else happens only when you set it up:

- **Git sync** fetches from and pushes to the remote URL you configure. Your
  token is sent only to that host. The server checks an enabled remote every 60
  seconds; turn sync off in workspace settings to stop it. Sync is off until you
  enable it and configure a remote.
- **The web app** talks only to the self-hosted server that serves it: the
  pages, edits and attachments you make. It loads no third-party font, script,
  analytics or crash-reporting service.
- **The Mac app** reads and writes the Markdown folder you open. ConceptKit also
  includes a REST client for a server you configure.

The only third parties that receive data are the ones you configure: your Git
host receives the vault contents you sync, and your self-hosted server receives
the content you send to it. GitHub receives the anonymous update check above.

## What is stored locally

**Mac app**

- Your pages, in the vault folder you open. Folders and files Concept creates
  use 0700/0600 permissions.
- Recent vault paths (`recentVaults`), pinned paths (`pinnedPaths-…`), the
  theme (`themeName`) and Sparkle's update settings, in the app's macOS
  `UserDefaults` (`dev.concept.Concept`).
- An optional sync token, in the macOS Keychain (`dev.concept.vault-sync`).

**Server** (`$CONCEPT_DATA_DIR`)

- `concept.db`: accounts, session hashes, ACLs, comments, activity, sync
  settings and the search index. Git tokens are encrypted at rest.
- `workspaces/`: one vault per workspace.
- `.instance-secret`: the generated encryption secret (only when `CONCEPT_SECRET`
  is unset), 0600.
- `admin-password.txt`: a generated seed password (only when `seed` generated
  one), 0600. It is never printed; delete it once you have saved the password.
- `update-check.json`: the last update check, 0600.
- New data directories, database files and vault files use 0700/0600
  permissions. Logs and error responses redact credential-like URLs, and CLI and
  startup logs do not print emails or data-directory paths.

**Browser**: theme and panel state, and a skipped update version, in
`localStorage` for your server's origin.

## How long it is kept

- Activity older than 90 days is pruned as new activity is logged.
- Pages you delete stay in the vault's `.trash/`, and deleted workspaces stay in
  `$CONCEPT_DATA_DIR/deleted-workspaces/`, until you remove them. Concept does
  not purge them automatically because they may hold content you still need.
- Sparkle deletes its download after installing and keeps no old copy.

## Removing everything

- **Server:** stop it and remove the data directory (or the `concept-data`
  Docker volume).
- **Mac app:** delete the vault folder and the app, run
  `defaults delete dev.concept.Concept` to clear its preferences, and delete the
  `dev.concept.vault-sync` Keychain item if you saved a token.
- **Browser:** clear site data for your server.
