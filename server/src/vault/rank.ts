/**
 * Fractional ordering keys ("rank") for board columns.
 *
 * Ranks are digit-only strings ("1", "34", "294", ...). Lexicographic string
 * order equals numeric order of 0.<digits>, so plain string comparison sorts a
 * column. Between any two ranks a fresh rank can be generated lazily, which
 * makes drag-and-drop an O(1) single-file write.
 *
 * Invariants kept by this module (required for midpoints to always exist):
 *  - a rank is never empty and never ends in the digit '0'
 *  - ranks only contain digits 0-9
 */
export const RANK_ALPHABET = "0123456789";

export function isRank(s: unknown): s is string {
  return typeof s === "string" && s.length > 0 && /^[0-9]+$/.test(s) && !s.endsWith("0");
}

/** First rank in an empty column. */
export function firstRank(): string {
  return "4";
}

/**
 * A rank strictly between a and b (a < b, lexicographically).
 * Appends digits lazily, so it always terminates and never returns ''.
 */
export function rankBetween(a: string, b: string): string {
  let out = "";
  let i = 0;
  for (;;) {
    const x = i < a.length ? Number(a[i]) : 0;
    const y = i < b.length ? Number(b[i]) : 9;
    if (y - x >= 2) return out + String(Math.floor((x + y) / 2));
    out += String(x);
    i++;
    // Loop is guaranteed to terminate: i grows every turn and once past both
    // strings x=0 vs y=9 gives a gap of 9. Length is bounded by |b| + 1.
  }
}

/** A rank greater than every existing rank (append to the end of a column). */
export function rankAfter(a: string | undefined): string {
  if (!a || !isRank(a)) return firstRank();
  // climb just above a: first differing digit vs "all nines"
  let i = 0;
  let out = "";
  for (;;) {
    const x = i < a.length ? Number(a[i]) : 0;
    if (9 - x >= 2) return out + String(Math.floor((x + 9) / 2));
    out += String(x);
    i++;
  }
}

/** A rank smaller than every existing rank (prepend to a column). */
export function rankBefore(b: string | undefined): string {
  if (!b || !isRank(b)) return firstRank();
  return rankBetween("", b);
}

function validRank(v: string | undefined | null): string | null {
  return v && isRank(v) ? v : null;
}

/**
 * Compute the rank for a row moving into `column` relative to its neighbours.
 * Returns the rank, or null if the caller must resequence the column first.
 */
export function moveRank(
  beforeRank: string | undefined, // rank of the row this row goes before (lower neighbour bound)
  afterRank: string | undefined, // rank of the row this row goes after (upper neighbour bound)
): string {
  const before = validRank(beforeRank);
  const after = validRank(afterRank);
  if (before && after) return rankBetween(after, before); // after < new < before
  if (before) return rankBefore(before);
  if (after) return rankAfter(after);
  return firstRank();
}

/**
 * Resequence an ordered list of ids to fresh, well-spaced ranks.
 * Used when a column contains non-canonical ranks (e.g. written by other tools).
 */
export function resequenceRanks(n: number): string[] {
  const out: string[] = [];
  let prev = "";
  for (let i = 0; i < n; i++) {
    const r = prev ? rankAfter(prev) : firstRank();
    out.push(r);
    prev = r;
  }
  return out;
}
