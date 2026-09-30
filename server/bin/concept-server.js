#!/usr/bin/env node
// concept-server CLI entry. Runs the TypeScript source via tsx in dev,
// or the compiled dist in production.
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const distCli = path.resolve(here, "../dist/cli.js");

async function run() {
  if (existsSync(distCli)) {
    await import(distCli);
    return;
  }
  // Dev: compile on the fly with tsx.
  const require = createRequire(import.meta.url);
  const tsx = require.resolve("tsx/cli");
  const { pathToFileURL } = await import("node:url");
  const srcCli = path.resolve(here, "../src/cli.ts");
  await import(pathToFileURL(tsx).href).catch(() => {
    console.error("error: concept-server needs a build (pnpm build) or tsx installed (code=missing_build)");
    process.exit(1);
  });
}

run().catch((err) => {
  console.error(`error: ${err.message} (code=internal)`);
  process.exit(1);
});
