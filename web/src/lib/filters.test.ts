import { describe, it, expect } from "vitest";
import { matchesFilter, matchesAll, applySorts, groupRows, applyView } from "./filters";
import type { Filter, Sort } from "@/api/types";

const rows = [
  { id: "1", properties: { title: "Acme renewal", status: "Proposal", value: 12000, due: "2026-10-14", tags: ["priority"] } },
  { id: "2", properties: { title: "Globex audit", status: "Won", value: 800, tags: [] } },
  { id: "3", properties: { title: "Initech setup", status: "Inbox", value: null } },
  { id: "4", properties: { title: "No stage yet" } },
];

describe("filters", () => {
  const f = (key: string, op: Filter["op"], value?: unknown): Filter => ({ key, op, value });

  it("eq/neq/contains operate on comparable values", () => {
    expect(matchesFilter(rows[0], f("status", "eq", "Proposal"))).toBe(true);
    expect(matchesFilter(rows[1], f("status", "eq", "Proposal"))).toBe(false);
    expect(matchesFilter(rows[2], f("status", "neq", "Proposal"))).toBe(true);
    expect(matchesFilter(rows[0], f("title", "contains", "renew"))).toBe(true);
    expect(matchesFilter(rows[0], f("title", "contains", "RENEW"))).toBe(true);
  });

  it("numeric comparisons require numbers on both sides", () => {
    expect(matchesFilter(rows[0], f("value", "gt", 1000))).toBe(true);
    expect(matchesFilter(rows[1], f("value", "gt", 1000))).toBe(false);
    expect(matchesFilter(rows[2], f("value", "gt", 1000))).toBe(false);
    expect(matchesFilter(rows[0], f("value", "lte", 12000))).toBe(true);
  });

  it("empty/notempty see arrays and nulls", () => {
    expect(matchesFilter(rows[2], f("value", "empty"))).toBe(true);
    expect(matchesFilter(rows[0], f("value", "empty"))).toBe(false);
    expect(matchesFilter(rows[1], f("tags", "empty"))).toBe(true);
    expect(matchesFilter(rows[0], f("tags", "notempty"))).toBe(true);
  });

  it("matchesAll ANDs filters", () => {
    expect(matchesAll(rows[0], [f("status", "eq", "Proposal"), f("value", "gte", 1000)])).toBe(true);
    expect(matchesAll(rows[0], [f("status", "eq", "Proposal"), f("value", "gte", 20000)])).toBe(false);
    expect(matchesAll(rows[0], [])).toBe(true);
    expect(matchesAll(rows[0], undefined)).toBe(true);
  });
});

describe("sorts", () => {
  it("sorts asc/desc with empties last", () => {
    const s: Sort[] = [{ key: "value", dir: "asc" }];
    expect(applySorts(rows, s).map((r) => r.id)).toEqual(["2", "1", "3", "4"]);
    const d: Sort[] = [{ key: "value", dir: "desc" }];
    expect(applySorts(rows, d).map((r) => r.id)).toEqual(["1", "2", "3", "4"]);
  });

  it("multi-key sorts apply in order", () => {
    const s: Sort[] = [
      { key: "status", dir: "asc" },
      { key: "value", dir: "desc" },
    ];
    expect(applySorts(rows, s).map((r) => r.id)).toEqual(["3", "1", "2", "4"]);
  });
});

describe("grouping", () => {
  it("groups by status following option order, null group first", () => {
    const groups = groupRows(rows, "status", [
      { id: "Won" },
      { id: "Proposal" },
      { id: "Inbox" },
    ]);
    expect(groups.map((g) => g.value)).toEqual([null, "Won", "Proposal", "Inbox"]);
    const won = groups.find((g) => g.value === "Won")!;
    expect(won.rows.map((r) => r.id)).toEqual(["2"]);
    expect(groups[0].rows.map((r) => r.id)).toEqual(["4"]);
    expect(groups[0].label).toBe("No status");
  });

  it("unknown values append after named options", () => {
    const extra = [...rows, { id: "4", properties: { status: "Dropped" } }];
    const groups = groupRows(extra, "status", [{ id: "Won" }]);
    expect(groups.map((g) => g.value)).toEqual([null, "Won", "Proposal", "Inbox", "Dropped"]);
  });

  it("no groupBy returns single bucket", () => {
    expect(groupRows(rows, undefined)).toHaveLength(1);
  });
});

describe("applyView pipeline", () => {
  it("filters then sorts (empties last regardless of direction)", () => {
    const out = applyView(
      rows,
      { filters: [{ key: "value", op: "notempty" }], sorts: [{ key: "due", dir: "asc" }] },
    );
    expect(out.map((r) => r.id)).toEqual(["1", "2"]);
  });
});
