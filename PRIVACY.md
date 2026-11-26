# Privacy

Concept has no telemetry or usage tracking. Your vault stays in your folder or
on your server. Besides Git sync to remotes you configure, the only network
request Concept makes on its own is the daily update check.

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

## Turning it off

- Mac app: turn off **Check for updates automatically** in **Settings → Updates**.
- Server: set `CONCEPT_NO_UPDATE_CHECK=1`. This also deletes `update-check.json`
  and the browser's notice state. The check is off whenever `CI` is set.

See [updates](docs/updates.md) for how updates are offered and installed.
