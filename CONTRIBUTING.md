# Contributing to Concept

Thank you for contributing to Concept.

## Repository Layout

- `server/` — Node.js + Hono + SQLite REST/SSE server over plain Markdown vaults
- `web/` — React + TipTap + dnd-kit web client (builds into `server/public`)
- `macos/` — Native SwiftUI macOS 14+ application (Swift 6)
- `docs/` — Vault format specification (`SPEC.md`), REST API reference (`API.md`), and self-hosting guide (`SELF-HOSTING.md`)

## Prerequisites

- Node.js 22.13+ and `pnpm` 10.27.0
- Swift 6 and macOS 14+ (for `macos/`)

## Local Setup and Verification

Build the web bundle before running server tests, as the server static-serving tests expect `server/public`:

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm -r test
pnpm --filter @concept/server typecheck
```

For the native Mac app:

```sh
cd macos
swift test -j 4
```

## Pull Requests

1. Keep changes focused and well-tested; add or update tests for every behavior change or bug fix.
2. Keep vaults plain Markdown with YAML frontmatter compatible with `docs/SPEC.md` and Retex.
3. Update `docs/API.md`, `README.md`, and `CHANGELOG.md` whenever user-facing behavior or endpoints change.
4. Do not commit personal paths, secrets, `.env` files, or build artifacts.
5. Run the full build and test suites locally before submitting.

## License

Contributions are licensed under the [MIT License](LICENSE).
