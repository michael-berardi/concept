# Changelog

All notable changes to Concept are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-11-26

### Added

- Mac app updates with Sparkle: one anonymous check a day, the standard update
  window (Install Update, Remind Me Later, Skip This Version), **Check for
  Updates…** in the app menu and **Settings → Updates**. Automatic installation
  is off until you turn it on. Updates are verified with an EdDSA signature
  before installing and relaunch only after drafts are saved.
- Self-hosted servers check the latest GitHub release once a day and show
  instance admins a notice with the upgrade command, **Later** and **Skip this
  version**. `concept-server update --check` reports the same (exit 0, 10 or 1).
  `CONCEPT_NO_UPDATE_CHECK=1` turns the check off. See `docs/updates.md`.
- `PRIVACY.md`: what goes over the network, what is stored locally and how to
  remove it. The README keeps a short summary.
- Regression tests that reject telemetry/analytics SDKs, tracking endpoints and
  third-party fonts in shipped code, and check owner-only file permissions.

### Changed

- `macos/scripts/bundle.sh` takes the version from `Resources/Info.plist`,
  embeds and signs Sparkle, refuses a release while `SUPublicEDKey` is the
  placeholder, and writes `dist/appcast.xml`.
- Docker builds, macOS bundles and the server set telemetry-off environment
  variables for any transitive tooling.

### Fixed

- New data directories, SQLite files, vault files and generated admin-password
  files are created with 0700/0600 permissions.
- The `seed` command no longer prints a generated admin password; it writes it
  to a 0600 file in the data directory.
- Activity history is pruned after 90 days by default
  (`CONCEPT_ACTIVITY_RETENTION_DAYS`; `0` keeps it all); internal error logs and
  responses redact credential-like URL strings, and CLI/startup logs no longer
  print emails or data-directory paths.

## [0.1.5] - 2026-11-25

### Added

- Board moves (`POST /api/w/:ws/databases/:db/rows/:id/move`) now support non-status groupings via `groupBy` and `group` (including `null` for the no-value column), saving card order and transparently resequencing columns with unranked or duplicate ranks.
- Keyboard navigation (`ArrowUp`, `ArrowDown`, `Enter`, `Tab`, `Escape`) and hover highlight in the `[[` wiki link picker alongside the `/` slash command menu, with unit tests in `web/src/features/pages/pickerNav.test.ts`.
- Standard open-source repository documentation (`SECURITY.md`, `CONTRIBUTING.md`, `CHANGELOG.md`) and updated `docs/API.md` for `groupBy`/`group` board moves.

### Fixed

- Git sync commits now set `GIT_AUTHOR_NAME`, `GIT_AUTHOR_EMAIL`, `GIT_COMMITTER_NAME`, and `GIT_COMMITTER_EMAIL` so host environment git variables never override the acting Concept user's authorship.
- Dragging a card to the no-value column on a status-grouped board continues to update the row's status instead of reverting silently.
- Resequencing duplicate canonical ranks across different status columns before neighbour comparison prevents spurious `400 invalid_move` errors when ordering cards inside a non-status board group.
- Slash/wiki picker keyboard handler ignores IME composition events (`isComposing`) and clamps active highlight bounds when search results change.

## [0.1.4] - 2026-11-19

### Fixed

- Shared a single SSE connection per workspace so pages no longer hang on a spinner after navigating between panels.
- Command palette: New page creates a page, graph and file results open, Escape closes it.
- Board: column `+` button adds a card, and failed moves no longer hide rows.
- Table: editing a checkbox or date no longer opens the card modal.
- Permissions and teams pickers allow selecting a team or person; failed actions display errors.

## [0.1.3] - 2026-11-10

### Added

- Universal (Apple Silicon + Intel) Developer ID-signed and notarized macOS app bundle (`Concept-macos-universal.zip`) with `SHA256SUMS`.

## [0.1.2] - 2026-10-16

### Fixed

- Working multi-stage Docker build with pinned `pnpm`, workspace `node_modules`, and accurate server version reporting.

## [0.1.1] - 2026-10-01

### Fixed

- Stat-based safety net in the vault file watcher so dropped OS file events never leave the SQLite index stale.

## [0.1.0] - 2026-10-01

### Added

- Initial public release of Concept: plain-Markdown pages, databases, boards, self-hosted server/web app, and native macOS app.
