# Security Policy

## Supported Versions

Security fixes are released on the latest minor version of Concept (`main` branch and latest tagged release).

## Reporting a Vulnerability

Please do **not** open a public GitHub issue for security vulnerabilities.

Report vulnerabilities privately through GitHub's Private Vulnerability Reporting on this repository (Security → Advisories → Report a vulnerability).

Include:
- Affected component (`server`, `web`, or `macos`) and version
- Reproduction steps or proof of concept
- Impact assessment (e.g. path traversal, auth bypass, ACL bypass, credential exposure)

## Security Boundaries

- **Vault confinement:** All file reads, writes, moves, and deletes are confined to the workspace vault directory; symlinks and `..` traversal are rejected.
- **Credentials and secrets:** Git sync tokens are encrypted at rest using the server's persistent encryption key in the data volume and redacted from logs and API responses. Never commit `.env` files, tokens, or vault encryption keys.
- **Sessions and permissions:** Session tokens are stored hashed in SQLite; folder-level ACLs are enforced across pages, databases, search, SSE streams, and file operations.
- **Git remotes:** Only `https://`, `ssh://`, and SCP-style `user@host:path` remotes are accepted (`file://` is disabled unless `CONCEPT_ALLOW_FILE_REMOTES=1` is set for local testing).
