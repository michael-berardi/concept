<!-- update-contract: v1 -->
# Updates

Concept tells you when a newer release exists and makes updating one step.
Nothing installs automatically unless you turn it on.

## Mac app

Concept checks its signed [Sparkle](https://sparkle-project.org) appcast once a
day. When a newer version exists, the standard update window shows "Concept
<new> is now available—you have <current>", the release notes, and **Install
Update**, **Remind Me Later** and **Skip This Version**. A skipped version stays
quiet; a newer one notifies again. **Automatically download and install updates
in the future** starts unchecked.

**Settings → Updates** (⌘,):

- **Check for updates automatically**: on by default.
- **Install updates automatically**: off by default. When on, updates download
  in the background and install when you quit Concept.
- **Check Now**, next to the current version. The app menu also has
  **Check for Updates…**.

**Install Update** saves open drafts and waits for a running Git sync before it
relaunches. Sparkle verifies the download's EdDSA signature against the public
key inside the app before installing, and macOS checks the Developer ID
signature and notarization. If installation fails, the current version keeps
working. Sparkle deletes its download after installing and keeps no old copy.

Background checks are also off when Concept is started with
`CONCEPT_NO_UPDATE_CHECK=1` or under `CI`. Sparkle keeps its settings in the
app's preferences (`dev.concept.Concept`); deleting the app and those
preferences removes all update state.

## Self-hosted server

The server asks GitHub's public "latest release" record for this repository once
a day, in the background with a 4-second timeout, and caches the answer in
`update-check.json` in the data directory. Instance admins see a notice at the
top of the web app with the new version, the first lines of the release notes
and the command for their install:

- Docker: `git pull && docker compose up -d --build`
- Node from source: `git pull && pnpm install --frozen-lockfile && pnpm build`,
  then restart the server

**Later** hides the notice for a day. **Skip this version** hides it until a
newer release; this is stored in that browser only. The server never updates
itself.

`concept-server update --check` checks now and prints the result. It exits 0
when current, 10 when an update is available, and 1 with the cause when the
check failed.

`CONCEPT_NO_UPDATE_CHECK=1` turns the check off and deletes `update-check.json`
and the browser's notice state. The check is also off when `CI` is set.

## Privacy

Each check is one anonymous HTTPS GET with the fixed user agent
`concept-update-check`. It sends no account, vault, usage or machine data, and
Sparkle's system profiling stays off. A failed check is recorded with its cause
and tried again the next day, never in a loop.

## Publishing a Mac release

1. Once: run `macos/.build/artifacts/sparkle/Sparkle/bin/generate_keys --account concept`
   (after `swift build`). It stores the private key in the login keychain and
   prints the public key. Put the public key in `SUPublicEDKey` in
   `macos/Resources/Info.plist`. Keep a backup of the private key
   (`generate_keys --account concept -x <file>`): without it, existing installs
   cannot verify new releases.
2. `macos/scripts/bundle.sh` with `CONCEPT_SIGNING_IDENTITY` and
   `CONCEPT_NOTARY_PROFILE` refuses the placeholder key, signs and notarizes
   the app, and writes `dist/appcast.xml` with this version's CHANGELOG section.
3. Upload `Concept-macos-universal.zip` and `appcast.xml` to the `v<version>`
   GitHub release. The app reads `releases/latest/download/appcast.xml`.
