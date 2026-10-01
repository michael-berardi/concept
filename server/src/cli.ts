import { randomBytes } from "node:crypto";
import path from "node:path";
import { existsSync } from "node:fs";
import { openDb } from "./db.js";
import { loadConfig, workspaceRoot } from "./config.js";
import { SqliteIndexer } from "./index/indexer.js";
import { VaultEngine } from "./vault/engine.js";
import { hashPassword } from "./auth/access.js";
import { shortId, now } from "./ids.js";

const USAGE = `concept-server — self-hosted Concept server

USAGE
  concept-server serve                 Start the server (default)
  concept-server seed                  Create data dir, admin user, and a CRM workspace
  concept-server create-user <email> <name> <password> [--admin]
  concept-server reindex [workspace-slug]
  concept-server doctor                Check data dir, database, FTS5, git, workspaces

ENVIRONMENT
  CONCEPT_DATA_DIR    data directory (default ./data)
  PORT                HTTP port (default 8787)
  CONCEPT_SECRET      instance secret for token encryption (generated+persisted if unset)
  CONCEPT_OPEN_SIGNUP set to 1 to allow open registration without an invite
`;

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const cmd = argv[0] ?? "serve";
  const cfg = loadConfig();
  const db = openDb(path.join(cfg.dataDir, "concept.db"));
  const indexer = new SqliteIndexer(db);
  const engine = new VaultEngine(db, (slug) => path.join(workspaceRoot(cfg), slug));

  switch (cmd) {
    case "serve": {
      const { startServer } = await import("./server-main.js");
      startServer();
      return 0;
    }

    case "seed": {
      const email = process.env.CONCEPT_ADMIN_EMAIL ?? "admin@concept.local";
      const generated = !process.env.CONCEPT_ADMIN_PASSWORD;
      const password = process.env.CONCEPT_ADMIN_PASSWORD ?? randomBytes(12).toString("base64url");
      let user = db.prepare(`SELECT * FROM users WHERE email = ?`).get(email) as any;
      if (!user) {
        const id = shortId("usr");
        db.prepare(
          `INSERT INTO users (id, email, name, password_hash, is_admin, created_at) VALUES (?, ?, ?, ?, 1, ?)`,
        ).run(id, email, "Admin", hashPassword(password), now());
        user = { id, email, name: "Admin" };
        console.log(`Created admin user ${email}${generated ? ` with the generated password: ${password}` : " (password from CONCEPT_ADMIN_PASSWORD)"}`);
      } else {
        console.log(`Admin user ${email} already exists`);
      }
      let ws = db.prepare(`SELECT * FROM workspaces WHERE slug = ?`).get("crm") as any;
      if (!ws) {
        const wsId = shortId("ws");
        db.prepare(
          `INSERT INTO workspaces (id, slug, name, template, created_by, created_at) VALUES (?, 'crm', 'CRM', 'crm', ?, ?)`,
        ).run(wsId, user.id, now());
        db.prepare(`INSERT INTO members (workspace_id, user_id, role, created_at) VALUES (?, ?, 'owner', ?)`).run(
          wsId,
          user.id,
          now(),
        );
        engine.ensureVaultDirs("crm", "CRM", wsId);
        const actor = `${user.name} <${user.email}>`;
        engine.createCrmStarter({ id: wsId, slug: "crm" }, actor);
        engine.createPage(
          { id: wsId, slug: "crm" },
          {
            title: "Welcome to CRM",
            body: `This workspace ships the CRM starter: Companies, Contacts, Deals and Activities.\n\nTry \`retex doctor --vault <data-dir>/workspaces/crm\`.`,
          },
          actor,
        );
        const re = indexer.reindexWorkspace(wsId, engine.vaultDir("crm"));
        console.log(`Created workspace 'crm' (CRM starter, ${re.indexed} files indexed)`);
      } else {
        console.log(`Workspace 'crm' already exists`);
      }
      console.log(`Data dir: ${cfg.dataDir}`);
      return 0;
    }

    case "create-user": {
      const [, emailRaw, name, password, flag] = argv;
      const email = (emailRaw ?? "").trim().toLowerCase();
      if (!email || !password) {
        console.error("error: usage: concept-server create-user <email> <name> <password> [--admin]");
        return 2;
      }
      if (db.prepare(`SELECT id FROM users WHERE email = ?`).get(email)) {
        console.error(`error: user ${email} already exists (code=email_taken)`);
        return 1;
      }
      const id = shortId("usr");
      db.prepare(
        `INSERT INTO users (id, email, name, password_hash, is_admin, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(id, email, name || email.split("@")[0], hashPassword(password), flag === "--admin" ? 1 : 0, now());
      console.log(`Created user ${email} (id ${id}${flag === "--admin" ? ", admin" : ""})`);
      return 0;
    }

    case "reindex": {
      const slug = argv[1];
      const workspaces = slug
        ? (db.prepare(`SELECT id, slug FROM workspaces WHERE slug = ?`).all(slug) as any[])
        : (db.prepare(`SELECT id, slug FROM workspaces`).all() as any[]);
      if (slug && workspaces.length === 0) {
        console.error(`error: no workspace '${slug}' (code=not_found)`);
        return 1;
      }
      for (const ws of workspaces) {
        const re = indexer.reindexWorkspace(ws.id, engine.vaultDir(ws.slug));
        console.log(`reindexed ${ws.slug}: ${re.indexed} indexed, ${re.removed} removed`);
      }
      return 0;
    }

    case "doctor": {
      let failures = 0;
      const check = (name: string, ok: boolean, detail: string) => {
        console.log(`${ok ? "ok  " : "FAIL"}  ${name}: ${detail}`);
        if (!ok) failures++;
      };
      check("data-dir", existsSync(cfg.dataDir), cfg.dataDir);
      try {
        db.prepare(`SELECT 1`).get();
        check("database", true, path.join(cfg.dataDir, "concept.db"));
      } catch (e) {
        check("database", false, (e as Error).message);
      }
      try {
        db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS _doctor_fts USING fts5(x)`);
        db.prepare(`INSERT INTO _doctor_fts (x) VALUES ('hello')`);
        db.prepare(`SELECT * FROM _doctor_fts WHERE _doctor_fts MATCH 'hello'`).all();
        db.exec(`DROP TABLE IF EXISTS _doctor_fts`);
        check("fts5", true, "FTS5 available");
      } catch (e) {
        check("fts5", false, `FTS5 unavailable: ${(e as Error).message}`);
      }
      const gitVersion = await new Promise<string | null>((resolve) => {
        import("node:child_process").then(({ execFile }) => {
          execFile("git", ["--version"], (err, stdout) => resolve(err ? null : stdout.trim()));
        });
      });
      check("git", !!gitVersion, gitVersion ?? "git not found (git sync disabled)");
      const workspaces = db.prepare(`SELECT id, slug FROM workspaces`).all() as any[];
      for (const ws of workspaces) {
        const dir = engine.vaultDir(ws.slug);
        check(`workspace:${ws.slug}`, existsSync(dir), dir);
        if (existsSync(dir)) {
          const re = indexer.reindexWorkspace(ws.id, dir);
          check(`workspace:${ws.slug}:index`, true, `${re.indexed} files indexed, ${re.removed} removed`);
        }
      }
      console.log(failures === 0 ? "doctor: all checks passed" : `doctor: ${failures} check(s) failed`);
      return failures === 0 ? 0 : 1;
    }

    case "help":
    case "--help":
    case "-h":
      console.log(USAGE);
      return 0;

    default:
      console.error(`error: unknown command '${cmd}' (code=unknown_command)\n\n${USAGE}`);
      return 2;
  }
}

main()
  .then((code) => {
    if (code !== 0) process.exitCode = code;
  })
  .catch((err) => {
    console.error(`error: ${(err as Error).message} (code=internal)`);
    process.exitCode = 1;
  });
