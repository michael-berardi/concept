import { execFile } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

export interface GitResult {
  code: number;
  stdout: string;
  stderr: string;
}

export function git(
  vaultDir: string,
  args: string[],
  opts: { authorName?: string; authorEmail?: string; timeoutMs?: number } = {},
): Promise<GitResult> {
  const finalArgs = [...args];
  if (opts.authorName) {
    finalArgs.unshift("-c", `user.name=${opts.authorName}`);
  }
  if (opts.authorEmail) {
    finalArgs.unshift("-c", `user.email=${opts.authorEmail}`);
  }
  return new Promise((resolve) => {
    execFile(
      "git",
      finalArgs,
      { cwd: vaultDir, timeout: opts.timeoutMs ?? 120_000, maxBuffer: 32 * 1024 * 1024 },
      (err, stdout, stderr) => {
        const code = err ? ((err as any).code as number) ?? 1 : 0;
        resolve({ code, stdout: stdout?.toString() ?? "", stderr: stderr?.toString() ?? "" });
      },
    );
  });
}

/** Build a remote URL with the access token embedded for this one command. */
export function authedUrl(remoteUrl: string, token: string | null): string {
  if (!token) return remoteUrl;
  if (remoteUrl.startsWith("http://") || remoteUrl.startsWith("https://")) {
    const idx = remoteUrl.indexOf("://");
    return `${remoteUrl.slice(0, idx + 3)}concept:${encodeURIComponent(token)}@${remoteUrl.slice(idx + 3)}`;
  }
  return remoteUrl;
}

export function isRepo(vaultDir: string): boolean {
  return existsSync(path.join(vaultDir, ".git"));
}

export async function repoHasCommits(vaultDir: string): Promise<boolean> {
  const r = await git(vaultDir, ["rev-parse", "HEAD"]);
  return r.code === 0;
}

export function readAuthorFromGit(vaultDir: string): { name: string; email: string } {
  return { name: "Concept Server", email: "concept@local" };
}

export function readTextIfExists(file: string): string | null {
  return existsSync(file) ? readFileSync(file, "utf8") : null;
}

/**
 * Where the losing side of a conflict is preserved:
 * Data/deals/acme.md -> Data/deals/acme.conflict-1699999999999.md
 */
export function conflictCopyPath(relPath: string, timestamp: number): string {
  const ext = path.extname(relPath);
  const base = relPath.slice(0, relPath.length - ext.length);
  return `${base}.conflict-${timestamp}${ext || ".md"}`;
}

export function preserveConflictCopy(vaultDir: string, relPath: string, content: string): string {
  const dest = conflictCopyPath(relPath, Date.now());
  const abs = path.join(vaultDir, ...dest.split("/"));
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, content, "utf8");
  return dest;
}

export function listConflictCopies(vaultDir: string): string[] {
  const out: string[] = [];
  const walk = (rel: string) => {
    let entries: import("node:fs").Dirent[];
    try {
      entries = readdirSync(path.join(vaultDir, ...rel.split("/").filter(Boolean)), { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const child = rel === "" ? e.name : `${rel}/${e.name}`;
      if (e.isDirectory()) {
        if ([".git", ".retex", ".trash", "node_modules"].includes(e.name)) continue;
        walk(child);
      } else if (/\.conflict-\d+/.test(e.name)) {
        out.push(child);
      }
    }
  };
  walk("");
  return out.sort();
}
