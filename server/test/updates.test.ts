import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  UpdateChecker,
  UPDATE_CACHE_FILE,
  UPDATE_CHECK_INTERVAL_MS,
  UPGRADE_COMMANDS,
  isNewerVersion,
  parseVersion,
  repositorySlug,
  shortNotes,
  upgradeCommand,
} from "../src/updates.js";
import { Client, makeApp } from "./helpers.js";

const T0 = 1_800_000_000_000;

function tempDir(): string {
  return mkdtempSync(path.join(tmpdir(), "concept-updates-"));
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const release = (tag: string, extra: Record<string, unknown> = {}) => ({
  tag_name: tag,
  html_url: `https://example.test/concept/releases/tag/${tag}`,
  body: "New board views\nFaster sync\n\nMore",
  draft: false,
  prerelease: false,
  ...extra,
});

function checker(dir: string, handler: () => Response | Promise<Response>, clock = { now: T0 }, extra = {}) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const instance = new UpdateChecker({
    dataDir: dir,
    currentVersion: "0.2.0",
    repository: "example/concept",
    apiUrl: "https://api.example.test/",
    command: UPGRADE_COMMANDS.docker,
    now: () => clock.now,
    fetchImpl: (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      return handler();
    }) as typeof fetch,
    ...extra,
  });
  return { instance, calls };
}

test("versions: newer, equal, older, prerelease and garbage", () => {
  assert.deepEqual(parseVersion("v0.2.0"), [0, 2, 0]);
  assert.equal(isNewerVersion("v0.3.0", "0.2.0"), true);
  assert.equal(isNewerVersion("0.10.0", "0.9.9"), true);
  assert.equal(isNewerVersion("1.0.0", "0.99.99"), true);
  assert.equal(isNewerVersion("0.2.0", "v0.2.0"), false);
  assert.equal(isNewerVersion("v0.1.9", "0.2.0"), false);
  assert.equal(isNewerVersion("v0.3.0-beta.1", "0.2.0"), false);
  assert.equal(isNewerVersion("0.3", "0.2.0"), false);
  assert.equal(isNewerVersion("nightly", "0.2.0"), false);
  assert.equal(isNewerVersion(null, "0.2.0"), false);
  assert.equal(isNewerVersion("0.3.0", "test"), false);
});

test("release notes become a few plain-text lines", () => {
  assert.equal(
    shortNotes("## [0.3.0]\n\n### Added\n\n- **Board** views\n* Faster `sync`\nPlain line\n- a\n- b\n- c"),
    "• Board views\n• Faster sync\nPlain line\n• a\n• b",
  );
  assert.equal(shortNotes("x".repeat(2000))?.length, 600);
  assert.equal(shortNotes("### Only a heading"), undefined);
  assert.equal(shortNotes(null), undefined);
});

test("repository comes from package metadata; command follows the install kind", () => {
  assert.match(repositorySlug(), /^[\w.-]+\/concept$/);
  assert.equal(upgradeCommand(true), UPGRADE_COMMANDS.docker);
  assert.equal(upgradeCommand(false), UPGRADE_COMMANDS.source);
});

test("check: one anonymous GET, cached for 24 hours in one 0600 file", async () => {
  const dir = tempDir();
  const clock = { now: T0 };
  try {
    const { instance, calls } = checker(dir, () => json(release("v0.3.0")), clock);
    const status = await instance.check();
    assert.equal(status.available, true);
    assert.equal(status.version, "0.3.0");
    assert.equal(status.current, "0.2.0");
    assert.equal(status.releaseUrl, "https://example.test/concept/releases/tag/v0.3.0");
    assert.equal(status.notes, "New board views\nFaster sync\nMore");
    assert.equal(status.command, UPGRADE_COMMANDS.docker);
    assert.equal(status.error, null);

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://api.example.test/repos/example/concept/releases/latest");
    assert.deepEqual(calls[0].init?.headers, { "user-agent": "concept-update-check", accept: "application/vnd.github+json" });
    assert.equal(calls[0].init?.method, undefined, "plain GET");
    assert.equal(calls[0].init?.body, undefined, "no payload");
    assert.ok(calls[0].init?.signal, "request has a timeout");

    clock.now += UPDATE_CHECK_INTERVAL_MS - 1;
    await instance.check();
    assert.equal(calls.length, 1, "same-day check reuses the cache");
    clock.now += 2;
    await instance.check();
    assert.equal(calls.length, 2, "a day later the check runs again");

    assert.deepEqual(readdirSync(dir), [UPDATE_CACHE_FILE], "one cache file, no temp files");
    const file = path.join(dir, UPDATE_CACHE_FILE);
    assert.equal(statSync(file).mode & 0o777, 0o600);
    assert.deepEqual(Object.keys(JSON.parse(readFileSync(file, "utf8"))).sort(), ["checkedAt", "latest", "notes", "releaseUrl"]);
    assert.ok(statSync(file).size < 1024, "cache stays tiny");

    // A restarted server reads the cache instead of asking again.
    const restarted = checker(dir, () => json(release("v0.3.0")), clock);
    assert.equal((await restarted.instance.check()).version, "0.3.0");
    assert.equal(restarted.calls.length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("check: equal, older, draft and prerelease releases give no notice", async () => {
  for (const record of [
    release("v0.2.0"),
    release("v0.1.5"),
    release("v9.9.9", { draft: true }),
    release("v9.9.9-rc.1", { prerelease: true }),
    release("latest"),
  ]) {
    const dir = tempDir();
    try {
      const status = await checker(dir, () => json(record)).instance.check();
      assert.equal(status.available, false, record.tag_name);
      assert.equal(status.version, null);
      assert.equal(status.error, null);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

test("check: failure is cached with its cause, keeps the last release, never loops", async () => {
  const dir = tempDir();
  const httpDir = tempDir();
  const clock = { now: T0 };
  let fail = false;
  try {
    const { instance, calls } = checker(dir, () => {
      if (fail) throw new Error("network down");
      return json(release("v0.3.0"));
    }, clock);
    await instance.check();
    fail = true;
    clock.now += UPDATE_CHECK_INTERVAL_MS + 1;
    const failed = await instance.check();
    assert.equal(failed.error, "update check failed: network down");
    assert.equal(failed.version, "0.3.0", "last known release is kept");
    clock.now += 60_000;
    assert.equal((await instance.check()).error, failed.error);
    assert.equal(calls.length, 2, "no retry within the day");
    assert.match(readFileSync(path.join(dir, UPDATE_CACHE_FILE), "utf8"), /network down/);

    const http = await checker(httpDir, () => json({ message: "rate limited" }, 403)).instance.check();
    assert.equal(http.error, "update check failed: GitHub returned HTTP 403");
    assert.deepEqual(readdirSync(dir), [UPDATE_CACHE_FILE]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(httpDir, { recursive: true, force: true });
  }
});

test("check: concurrent callers share one request", async () => {
  const dir = tempDir();
  try {
    const { instance, calls } = checker(dir, () => json(release("v0.3.0")));
    const [a, b] = await Promise.all([instance.check(), instance.check()]);
    assert.equal(calls.length, 1);
    assert.equal(a.version, b.version);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("opt-out: no request, no notice, and the cache file is removed", async () => {
  const dir = tempDir();
  try {
    writeFileSync(path.join(dir, UPDATE_CACHE_FILE), JSON.stringify({ checkedAt: T0, latest: "0.3.0" }));
    const { instance, calls } = checker(dir, () => json(release("v0.3.0")), { now: T0 }, { disabled: true });
    assert.equal(existsSync(path.join(dir, UPDATE_CACHE_FILE)), false);
    const status = await instance.check({ force: true });
    assert.equal(status.enabled, false);
    assert.equal(status.available, false);
    assert.equal(status.error, null);
    assert.equal(calls.length, 0);
    assert.deepEqual(readdirSync(dir), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("api: /api/updates is for instance admins only", async () => {
  const dir = tempDir();
  const env = await makeApp({
    openSignup: true,
    updates: checker(dir, () => json(release("v0.3.0"))).instance,
  });
  try {
    const anonymous = await fetch(`${env.baseUrl}/api/updates`);
    assert.equal(anonymous.status, 401);

    const admin = new Client(env.baseUrl);
    await admin.register("admin@example.test");
    const res = await admin.get("/api/updates");
    assert.equal(res.status, 200);
    assert.equal(res.json.available, true);
    assert.equal(res.json.version, "0.3.0");
    assert.equal(res.json.command, UPGRADE_COMMANDS.docker);

    const member = new Client(env.baseUrl);
    await member.register("member@example.test");
    assert.equal((await member.get("/api/updates")).status, 403);
  } finally {
    await env.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

/** Runs `concept-server update --check` against a local fake release API. */
async function cliCheck(
  respond: (res: import("node:http").ServerResponse) => void,
  extraEnv: Record<string, string> = {},
  seedCache = false,
) {
  const seen: { url?: string; ua?: string }[] = [];
  const server = createServer((req, res) => {
    seen.push({ url: req.url, ua: req.headers["user-agent"] });
    respond(res);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const dataDir = tempDir();
  if (seedCache) writeFileSync(path.join(dataDir, UPDATE_CACHE_FILE), JSON.stringify({ checkedAt: T0, latest: "0.3.0" }));
  const cli = path.resolve(import.meta.dirname ?? ".", "../src/cli.ts");
  try {
    return await new Promise<{ code: number; out: string; seen: typeof seen; files: string[] }>((resolve) => {
      execFile(
        process.execPath,
        ["--import", "tsx", cli, "update", "--check"],
        {
          env: {
            ...process.env,
            CI: "",
            CONCEPT_NO_UPDATE_CHECK: "",
            CONCEPT_DATA_DIR: dataDir,
            CONCEPT_UPDATE_API: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
            npm_package_version: "0.2.0",
            ...extraEnv,
          },
          timeout: 60_000,
        },
        (err, stdout, stderr) => {
          const code = err ? (typeof err.code === "number" ? err.code : 1) : 0;
          const files = readdirSync(dataDir).filter((f) => f.startsWith("update-check"));
          resolve({ code, out: `${stdout}${stderr}`, seen, files });
        },
      );
    });
  } finally {
    server.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
}

test("cli: update --check exits 10 with the notice, 0 when current, 1 with the cause", async () => {
  const sendJson = (body: unknown, status = 200) => (res: import("node:http").ServerResponse) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };

  const available = await cliCheck(sendJson(release("v0.3.0")));
  assert.equal(available.code, 10, available.out);
  assert.match(available.out, /^Concept 0\.3\.0 is available — you have 0\.2\.0\.$/m);
  assert.match(available.out, /^Update: git pull && /m);
  assert.equal(available.seen.length, 1);
  assert.match(available.seen[0].url ?? "", /^\/repos\/[\w.-]+\/concept\/releases\/latest$/);
  assert.equal(available.seen[0].ua, "concept-update-check");
  assert.deepEqual(available.files, [UPDATE_CACHE_FILE]);

  const current = await cliCheck(sendJson(release("v0.2.0")));
  assert.equal(current.code, 0, current.out);
  assert.match(current.out, /Concept 0\.2\.0 is up to date\./);

  const failed = await cliCheck(sendJson({ message: "boom" }, 500));
  assert.equal(failed.code, 1, failed.out);
  assert.match(failed.out, /update check failed: GitHub returned HTTP 500/);

  const off = await cliCheck(sendJson(release("v0.3.0")), { CONCEPT_NO_UPDATE_CHECK: "1" }, true);
  assert.equal(off.code, 0, off.out);
  assert.match(off.out, /Update checks are off/);
  assert.equal(off.seen.length, 0);
  assert.deepEqual(off.files, [], "opt-out removes the cache file");

  const ci = await cliCheck(sendJson(release("v0.3.0")), { CI: "true" });
  assert.equal(ci.seen.length, 0, "CI never contacts the release API");
});
