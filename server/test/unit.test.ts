import { test } from "node:test";
import assert from "node:assert/strict";
import { firstRank, moveRank, rankAfter, rankBefore, rankBetween, resequenceRanks, isRank } from "../src/vault/rank.js";
import { parseDoc, renderDoc, applyPropUpdates } from "../src/vault/frontmatter.js";
import { createZip, readZip } from "../src/zip.js";

test("rank: midpoint is strictly between its bounds", () => {
  assert.ok("" < rankBetween("4", "6") && rankBetween("4", "6") < "6");
  assert.equal(rankBetween("4", "6"), "5");
  assert.equal(rankBetween("5", "6"), "54");
  assert.equal(rankBetween("5", "50"), "504");
});

test("rank: 2000 sequential midpoints never collide and stay ordered", () => {
  let lo = "4";
  let hi = rankAfter("4");
  const seen = new Set<string>([lo, hi]);
  for (let i = 0; i < 2000; i++) {
    const mid = rankBetween(lo, hi);
    assert.ok(lo < mid && mid < hi, `midpoint ${mid} not between ${lo} and ${hi}`);
    assert.ok(!seen.has(mid), `collision at ${mid}`);
    assert.ok(isRank(mid), `non-canonical rank ${mid}`);
    seen.add(mid);
    // alternate inserting near the bottom to stress repeated extension
    if (i % 2 === 0) hi = mid;
    else lo = mid;
  }
});

test("rank: moveRank covers prepend, append and middle", () => {
  assert.equal(moveRank(undefined, undefined), "4"); // empty column
  // beforeId = the row below us (we go before it); afterId = the row above us.
  assert.ok(moveRank("4", undefined) < "4"); // prepend before '4'
  assert.ok(moveRank(undefined, "4") > "4"); // append after '4'
  const end = rankAfter("4");
  assert.ok(end > "4");
  assert.ok(moveRank("6", "4") > "4" && moveRank("6", "4") < "6"); // middle
});

test("rank: resequenceRanks produces canonical ordered ranks", () => {
  const ranks = resequenceRanks(50);
  for (let i = 1; i < ranks.length; i++) {
    assert.ok(ranks[i - 1] < ranks[i]);
    assert.ok(isRank(ranks[i]));
  }
});

test("rank: rankBefore generates rank below first", () => {
  const b = rankBefore("4");
  assert.ok(b < "4" && b !== "");
});

test("frontmatter: round-trip preserves unknown keys and ordering", () => {
  const raw = `---
title: Acme renewal
type: deal
status: Proposal
rank: "052"
owner: mike
custom_unknown_key: keep-me
another: 42
tags: [priority, vip]
archived: false
---
Body with [[links]] and \`code\`.
`;
  const doc = parseDoc(raw);
  assert.equal(doc.props.title, "Acme renewal");
  assert.equal(doc.props.custom_unknown_key, "keep-me");
  assert.equal(doc.props.another, 42);
  assert.deepEqual(doc.props.tags, ["priority", "vip"]);

  const updated = applyPropUpdates(doc.props, { status: "Won", new_prop: "x" });
  const out = renderDoc(updated, doc.body);
  const keys = Object.keys(parseDoc(out).props);
  assert.deepEqual(keys, [
    "title",
    "type",
    "status",
    "rank",
    "owner",
    "custom_unknown_key",
    "another",
    "tags",
    "archived",
    "new_prop",
  ]);
  assert.equal(parseDoc(out).props.status, "Won");
  assert.match(out, /Body with \[\[links\]\]/);
});

test("frontmatter: rank is serialized as a quoted string", () => {
  const out = renderDoc({ title: "T", type: "deal", rank: "04", status: "Inbox" }, "b");
  assert.match(out, /rank: ['"]04['"]/);
  const reparsed = parseDoc(out);
  assert.equal(reparsed.props.rank, "04");
  assert.equal(typeof reparsed.props.rank, "string");
});

test("frontmatter: files without frontmatter parse as plain body", () => {
  const doc = parseDoc("# Just markdown\n\nno properties here\n");
  assert.deepEqual(doc.props, {});
  assert.match(doc.body, /Just markdown/);
  assert.equal(renderDoc({}, "hello"), "hello");
});

test("frontmatter: malformed frontmatter degrades to empty props, body intact", () => {
  const raw = `---
title: [unclosed
---
body line
`;
  const doc = parseDoc(raw);
  assert.deepEqual(doc.props, {});
  assert.match(doc.body, /body line/);
});

test("zip: round-trip preserves entries and content", () => {
  const entries = [
    { path: "Pages/Welcome.md", data: Buffer.from("---\ntitle: Welcome\n---\nhi") },
    { path: "Data/deals/acme.md", data: Buffer.from("---\ntitle: Acme\nrank: \"4\"\n---\nbody") },
    { path: "Attachments/abc-photo.png", data: Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]) },
    { path: ".concept/workspace.json", data: Buffer.from(JSON.stringify({ name: "X", id: "ws" })) },
  ];
  const zip = createZip(entries);
  const parsed = readZip(zip);
  assert.equal(parsed.length, 4);
  for (const e of entries) {
    const got = parsed.find((p) => p.path === e.path);
    assert.ok(got, `missing ${e.path}`);
    assert.ok(Buffer.compare(got.data, e.data) === 0, `content mismatch for ${e.path}`);
  }
});

test("zip: readZip rejects non-zip data with a clear error", () => {
  assert.throws(() => readZip(Buffer.from("definitely not a zip file")), /Not a zip archive/);
});

test("frontmatter: applyPropUpdates removes keys set to null", () => {
  const props = { title: "T", extra: "x" };
  const next = applyPropUpdates(props, { extra: null, added: 1 });
  assert.equal(next.extra, undefined);
  assert.equal(next.added, 1);
  assert.equal(firstRank(), "4");
});
