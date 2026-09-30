/**
 * Fractional ordering keys ("rank") for kanban columns and lists.
 * Format: `<band>|<mantissa>` — band is one base-36 char, mantissa is base-36
 * digits (possibly empty). Keys compare as plain strings; a shorter string that
 * is a prefix of a longer one sorts first (the prefix rule), which guarantees
 * insertable room between any two keys. Canonical mantissas never end in "0";
 * non-canonical input is tolerated by the arithmetic but never produced.
 *
 * Sequenced appends/prepends have ~1200 constant-length steps per band ladder;
 * on `rank_overflow` the caller rebalances the whole column (recomputeRanks).
 */
const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";
const BASE = ALPHABET.length; // 36
const MID = ALPHABET[Math.floor(BASE / 2)]; // "i"
const MAX_MANISSA = 64;
const RANK_WIDTH = 13;

export class RankError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "RankError";
    this.code = code;
  }
}

function digit(ch: string): number {
  const d = ALPHABET.indexOf(ch);
  if (d < 0) throw new RankError("invalid_rank", `invalid_rank: bad character ${JSON.stringify(ch)} in rank`);
  return d;
}

function digitAt(s: string, i: number): number {
  return i < s.length ? digit(s[i]) : 0;
}

export function validateRank(rank: string): void {
  if (typeof rank !== "string" || !/^[0-9a-z]\|[0-9a-z]+$/.test(rank)) {
    throw new RankError("invalid_rank", `invalid_rank: expected "<band>|<base36>" got ${JSON.stringify(rank)}`);
  }
  if (rank.length > 2 + MAX_MANISSA) {
    throw new RankError("invalid_rank", `invalid_rank: mantissa longer than ${MAX_MANISSA}`);
  }
}

const allZ = (s: string) => s !== "" && /^[z]+$/.test(s);

/** The very first rank in a fresh column. */
export function rankFirst(): string {
  return "0|" + MID;
}

/** Smallest mantissa strictly greater than m (truncate-and-increment), or null if all "z". */
function successor(m: string): string | null {
  if (m === "") return "1";
  for (let i = m.length - 1; i >= 0; i--) {
    const d = digit(m[i]);
    if (d < BASE - 1) return m.slice(0, i) + ALPHABET[d + 1];
  }
  return null;
}

/** Largest mantissa strictly smaller than m (decrement-and-truncate), or null. */
function predecessor(m: string): string | null {
  for (let i = m.length - 1; i >= 0; i--) {
    const d = digit(m[i]);
    if (d > 1) return m.slice(0, i) + ALPHABET[d - 1];
    if (d === 1) {
      // m.slice(0, i) + "0" would be non-canonical: trim trailing zeros.
      let candidate = m.slice(0, i);
      while (candidate.endsWith("0")) candidate = candidate.slice(0, -1);
      return candidate === "" ? null : candidate;
    }
  }
  return null; // m is all zeros or empty
}

/**
 * Mantissa strictly between a and b (digit strings, a < b, either may be ""
 * meaning "unbounded on that side"). Canonical output (never ends in "0").
 */
export function midpoint(a: string, b: string): string {
  let out = "";
  for (let i = 0; i < MAX_MANISSA; i++) {
    const db = i < b.length ? digit(b[i]) : -1; // -1: b ended (no upper digit here)
    const da = digitAt(a, i);
    if (db === -1) {
      // Only a constrains: pick anything strictly above a's tail.
      const rest = a.slice(i);
      if (rest === "") return out + MID;
      const s = successor(rest);
      return s !== null ? out + s : out + rest + MID;
    }
    if (db - da >= 2) return out + ALPHABET[da + 1];
    if (db - da === 1) {
      const aTail = a.slice(i + 1);
      if (aTail === "") return out + ALPHABET[da] + MID;
      // Recurse on the tails: strictly between aTail and bTail.
      const inner = midpoint(aTail, b.slice(i + 1));
      return out + ALPHABET[da] + inner;
    }
    out += ALPHABET[da];
  }
  throw new RankError("rank_overflow", `rank_overflow: no room between ${JSON.stringify(a)} and ${JSON.stringify(b)}`);
}

/** Rank strictly between prev and next (either may be null). */
export function rankBetween(prev: string | null, next: string | null): string {
  if (prev) validateRank(prev);
  if (next) validateRank(next);
  if (prev && next && prev >= next) {
    throw new RankError("invalid_order", `invalid_order: prev ${prev} >= next ${next}`);
  }
  const result = rankBetweenInner(prev, next);
  if (result.length > 2 + MAX_MANISSA) {
    throw new RankError("rank_overflow", `rank_overflow: key between ${prev} and ${next} exceeds ${MAX_MANISSA} digits`);
  }
  return result;
}

function rankBetweenInner(prev: string | null, next: string | null): string {
  if (!prev && !next) return rankFirst();

  if (!prev) {
    // Prepend: ladder the mantissa down; step to the band below; deep-extend.
    const head = next![0];
    const nm = next!.slice(2);
    if (nm === "") {
      // next is a bare band "h|": any mantissa below it lives in the band below.
      if (head === "0") throw new RankError("rank_overflow", `rank_overflow: no room below ${next}`);
      return ALPHABET[ALPHABET.indexOf(head) - 1] + "|z";
    }
    const m = predecessor(nm);
    if (m !== null) return head + "|" + m;
    if (head !== "0") return ALPHABET[ALPHABET.indexOf(head) - 1] + "|z";
    const deep = midpoint("", nm);
    if (deep === "") throw new RankError("rank_overflow", `rank_overflow: no room below ${next}`);
    return head + "|" + deep;
  }
  if (!next) {
    // Append: ladder the mantissa up; open the next band; extend at the top.
    const head = prev[0];
    const m = successor(prev.slice(2));
    if (m !== null) return head + "|" + m;
    if (head !== ALPHABET[BASE - 1]) return ALPHABET[ALPHABET.indexOf(head) + 1] + "|1";
    return head + "|" + prev.slice(2) + MID;
  }
  const hp = prev[0];
  const hn = next[0];
  if (hp === hn) return hp + "|" + midpoint(prev.slice(2), next.slice(2));
  // Different bands: room always exists inside prev's band above prev.
  const m = successor(prev.slice(2));
  return m !== null ? hp + "|" + m : hp + "|" + prev.slice(2) + MID;
}

/**
 * Rebalance: evenly spaced ranks for a whole column.
 * `ids` in final visual order -> map id -> rank at (i+1)/(n+1) of the band.
 */
export function recomputeRanks(ids: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  const space = 36n ** BigInt(RANK_WIDTH); // 36^13 slots
  ids.forEach((id, i) => {
    const v = (space * BigInt(i + 1)) / BigInt(ids.length + 1);
    out[id] = "0|" + v.toString(BASE).padStart(RANK_WIDTH, "0");
  });
  return out;
}

/** Sort helper: ranks ascending (plain string compare). */
export function byRank(a: { rank?: string | null }, b: { rank?: string | null }): number {
  return (a.rank ?? "").localeCompare(b.rank ?? "");
}
