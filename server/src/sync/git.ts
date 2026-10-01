import { badRequest } from "../errors.js";
import { execFile } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

export interface GitResult {
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * Remotes an admin may configure. Leading `-`, whitespace and helper
 * transports (`ext::`, `fd::`) are refused so a remote can never be parsed as
 * a git option or run a command. `file://` and local paths are off unless
 * CONCEPT_ALLOW_FILE_REMOTES=1.
 */
export function validateRemoteUrl(url: string): string {
  const u = String(url).trim();
  const ok =
    /^https:\/\/[^\s\x00-\x1f]+$/.test(u) ||
    /^ssh:\/\/[^\s\x00-\x1f]+$/.test(u) ||
    /^[\w.-]+@[\w.-]+:[^\s\x00-\x1f]+$/.test(u) ||
    (process.env.CONCEPT_ALLOW_FILE_REMOTES === "1" && /^file:\/\/\/[^\s\x00-\x1f]+$/.test(u));
  if (!ok || u.startsWith("-")) {
    throw badRequest(
      "Remote URL must be https://…, ssh://… or user@host:path (no spaces, no leading '-')",
      "invalid_remote",
    );
  }
  return u;
}

/** Branch names: git ref-name subset, never starting with '-' or containing '..'. */
export function validateBranch(branch: string): string {
  const b = String(branch).trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._\/-]{0,100}$/.test(b) || b.includes("..") || b.endsWith("/") || b.endsWith(".lock")) {
    throw badRequest("Branch must be a plain git branch name such as main", "invalid_branch");
  }
  return b;
}

/** Raw bytes of `git <args>` (for binary-safe file contents). Null on failure. */
export function gitBuffer(vaultDir: string, args: string[]): Promise<Buffer | null> {
  return new Promise((resolve) => {
    execFile("git", args, { cwd: vaultDir, encoding: "buffer", maxBuffer: 256 * 1024 * 1024 }, (err, stdout) =>
      resolve(err ? null : (stdout as Buffer)),
    );
  });
}

/** Strip credentials from text before it reaches logs or API responses. */
export function redactSecrets(text: string): string {
  return text.replace(/(https?:\/\/)[^\s/@]+@/g, "$1***@");
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
      {
        cwd: vaultDir,
        timeout: opts.timeoutMs ?? 120_000,
        maxBuffer: 32 * 1024 * 1024,
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: "0",
          GIT_ALLOW_PROTOCOL: process.env.CONCEPT_ALLOW_FILE_REMOTES === "1" ? "https:ssh:file" : "https:ssh",
        },
      },
      (err, stdout, stderr) => {
        const code = err ? ((err as any).code as number) ?? 1 : 0;
        resolve({ code, stdout: redactSecrets(stdout?.toString() ?? ""), stderr: redactSecrets(stderr?.toString() ?? "") });
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

export function preserveConflictCopy(vaultDir: string, relPath: string, content: string | Buffer): string {
  const dest = conflictCopyPath(relPath, Date.now());
  const abs = path.join(vaultDir, ...dest.split("/"));
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, content);
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
