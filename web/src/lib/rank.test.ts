import { describe, it, expect } from "vitest";
import { rankBetween, rankFirst, recomputeRanks, byRank, validateRank, RankError } from "./rank";

/** Append `n` items; on saturation rebalance the whole column (recompute) and continue. */
function appendMany(n: number, start: string[]): string[] {
  let ranks = [...start];
  let rebalances = 0;
  for (let i = 0; i < n; i++) {
    try {
      ranks.push(rankBetween(ranks[ranks.length - 1] ?? null, null));
    } catch (e) {
      if (!((e as RankError).code === "rank_overflow")) throw e;
      ranks = Object.values(recomputeRanks(ranks));
      rebalances++;
      ranks.push(rankBetween(ranks[ranks.length - 1], null));
    }
  }
  expect(rebalances).toBeGreaterThan(0);
  return ranks;
}

function assertStrictlyIncreasing(ranks: string[]): void {
  for (let i = 1; i < ranks.length; i++) {
    if (!(ranks[i - 1] < ranks[i])) {
      throw new Error(`order broken at ${i}: ${ranks[i - 1]} !< ${ranks[i]}`);
    }
  }
}

describe("rank", () => {
  it("rankFirst is a valid rank", () => {
    expect(rankFirst()).toBe("0|i");
    expect(() => validateRank(rankFirst())).not.toThrow();
  });

  it("appending 5000 keeps strict order and short keys via rebalance", () => {
    const ranks = appendMany(5000, [rankFirst()]);
    assertStrictlyIncreasing(ranks);
    expect(Math.max(...ranks.map((r) => r.length))).toBeLessThan(24);
  });

  it("prepending 5000 keeps strict order via rebalance", () => {
    let ranks = [rankFirst()];
    let rebalances = 0;
    for (let i = 0; i < 5000; i++) {
      try {
        ranks.unshift(rankBetween(null, ranks[0]));
      } catch (e) {
        if (!((e as RankError).code === "rank_overflow")) throw e;
        ranks = Object.values(recomputeRanks(ranks));
        rebalances++;
        ranks.unshift(rankBetween(null, ranks[0]));
      }
    }
    expect(rebalances).toBeGreaterThan(0);
    assertStrictlyIncreasing(ranks);
  });

  it("inserts in the middle of a dense column stay ordered and short", () => {
    let ranks = Array.from({ length: 100 }, (_, i) => String(i));
    ranks = Object.values(recomputeRanks(ranks));
    ranks = Array.from(ranks);
    for (let round = 0; round < 300; round++) {
      const i = Math.floor(Math.random() * ranks.length);
      const prev = i === 0 ? null : ranks[i - 1];
      const next = ranks[i];
      ranks.splice(i, 0, rankBetween(prev, next));
    }
    assertStrictlyIncreasing(ranks);
    expect(Math.max(...ranks.map((r) => r.length))).toBeLessThan(64);
  });

  it("handles adjacent bands (0|… to 1|…) and boundaries", () => {
    const prev = "0|" + "z".repeat(8);
    const next = "1|0";
    const r = rankBetween(prev, next);
    expect(prev < r && r < next).toBe(true);
    expect(rankBetween(null, "0|i")).toBe("0|h");
    expect(rankBetween("z|z", null)).toBe("z|zi");
  });

  it("throws coded errors for bad input", () => {
    expect(() => rankBetween("0|m", "0|m")).toThrow(/invalid_order/);
    expect(() => rankBetween("0|z", "0|m")).toThrow(/invalid_order/);
    expect(() => rankBetween("nope", null)).toThrow(/invalid_rank/);
    expect(() => rankBetween("0|", null)).toThrow(/invalid_rank/);
    try {
      rankBetween("0|!!", null);
      expect.unreachable();
    } catch (e) {
      expect((e as RankError).code).toBe("invalid_rank");
    }
  });

  it("recomputeRanks produces strictly increasing, evenly spaced ranks", () => {
    const map = recomputeRanks(["a", "b", "c"]);
    expect(map.a < map.b && map.b < map.c).toBe(true);
    const vals = Object.values(map);
    expect(vals[0].startsWith("0|")).toBe(true);
    // even spacing: equal gaps in the fixed-width band
    const toNum = (r: string) => {
      const m = r.slice(2);
      let v = 0n;
      for (const ch of m) v = v * 36n + BigInt(parseInt(ch, 36));
      return v;
    };
    expect(toNum(vals[1]) - toNum(vals[0])).toBe(toNum(vals[2]) - toNum(vals[1]));
    const objs = vals.map((rank) => ({ rank }));
    const sorted = [...objs].sort(byRank).map((o) => o.rank);
    expect(sorted).toEqual(vals);
  });

  it("byRank treats missing ranks as lowest", () => {
    expect(byRank({ rank: undefined }, { rank: "0|i" })).toBeLessThanOrEqual(0);
  });
});
