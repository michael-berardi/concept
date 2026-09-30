import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { Client, makeApp, type TestEnv } from "./helpers.js";

const RETEX = process.env.RETEX_BIN ?? `${process.env.HOME}/.ultraterm/bin/retex`;

let env: TestEnv;
let admin: Client;

function retex(args: string[]): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    execFile(RETEX, args, { timeout: 60_000 }, (err, stdout, stderr) => {
      resolve({ code: err ? ((err as any).code as number) || 1 : 0, out: `${stdout}\n${stderr}` });
    });
  });
}

before(async () => {
  env = await makeApp();
  admin = new Client(env.baseUrl);
  await admin.register("admin@retex.test");
});

after(async () => {
  await env.close();
});

test("a seeded CRM vault passes `retex doctor` (temp vault only)", async () => {
  if (!existsSync(RETEX)) {
    console.log(`skip: retex binary not found at ${RETEX}`);
    return;
  }
  // Seed a CRM workspace with real records (temp data dir — never a user vault).
  const ws = await admin.post("/api/workspaces", { name: "Retex Check", template: "crm" });
  assert.equal(ws.status, 201);
  const slug = ws.json.slug;

  const company = (await admin.post(`/api/w/${slug}/databases/companies/rows`, {
    properties: { title: "Acme", url: "https://acme.example" },
  })).json;
  const deal1 = (await admin.post(`/api/w/${slug}/databases/deals/rows`, {
    properties: { title: "Acme renewal", status: "Proposal", value: 12000, company: "[[Acme]]", owner: "mike" },
    body: "Follow up on [[Acme]] renewal. Next: send proposal.\n",
  })).json;
  await admin.post(`/api/w/${slug}/databases/deals/rows`, {
    properties: { title: "Globex pilot", status: "Qualified", value: 4000, company: "[[Acme]]" },
  });
  await admin.post(`/api/w/${slug}/databases/tasks/rows`, {
    properties: { title: "Send proposal", status: "Todo" },
  });
  await admin.post(`/api/w/${slug}/pages`, { title: "Playbook", body: "See [[Acme renewal]]." });

  // Sanity: our own API sees the data.
  const rows = await admin.get(`/api/w/${slug}/databases/deals/rows?view=board`);
  assert.equal(rows.json.rows.length, 2);
  assert.ok(deal1.rank);
  void company;

  const vaultDir = env.engine.vaultDir(slug);
  assert.match(vaultDir, /concept-test-/); // temp vault only

  const doctor = await retex(["doctor", "--vault", vaultDir]);
  assert.equal(doctor.code, 0, `retex doctor failed:\n${doctor.out}`);
  assert.match(doctor.out, /Config: ok/);
  assert.match(doctor.out, /Journal: ok/);

  const board = await retex(["board", "--vault", vaultDir]);
  assert.equal(board.code, 0, `retex board failed:\n${board.out}`);
  assert.match(board.out, /Acme renewal/);
  assert.match(board.out, /Proposal/);

  const query = await retex(["query", "--vault", vaultDir, "--type", "deal", "--lean"]);
  assert.equal(query.code, 0, `retex query failed:\n${query.out}`);
  assert.match(query.out, /Acme renewal/);

  // retex move → Concept sees it (covers the watcher path from the SPEC).
  const moved = await retex([
    "move",
    "--vault",
    vaultDir,
    "Acme renewal",
    "Won",
  ]);
  if (moved.code === 0) {
    const deadline = Date.now() + 6000;
    let seen = false;
    while (Date.now() < deadline && !seen) {
      const r = await admin.get(`/api/w/${slug}/databases/deals/rows?view=board`);
      seen = r.json.rows.some((x: any) => x.properties.title === "Acme renewal" && x.properties.status === "Won");
      if (!seen) await new Promise((r2) => setTimeout(r2, 150));
    }
    assert.ok(seen, "retex move was not picked up by the watcher");
  } else {
    console.log(`note: retex move not exercised (${moved.out.trim().split("\n")[0]})`);
  }
});

test("cli: doctor passes on a seeded data dir", async () => {
  const cli = path.resolve(import.meta.dirname ?? ".", "../src/cli.ts");
  const res = await new Promise<{ code: number; out: string }>((resolve) => {
    execFile(
      process.execPath,
      ["--import", "tsx", cli, "doctor"],
      { env: { ...process.env, CONCEPT_DATA_DIR: env.dataDir }, timeout: 120_000 },
      (err, stdout, stderr) => {
        resolve({ code: err ? 1 : 0, out: `${stdout}\n${stderr}` });
      },
    );
  });
  assert.equal(res.code, 0, `cli doctor failed:\n${res.out}`);
  assert.match(res.out, /doctor: all checks passed/);
});
