// Fills a running Concept server with a realistic demo workspace.
// Usage: BASE=http://localhost:8787 EMAIL=admin@concept.local PASSWORD=... node scripts/demo.mjs [workspace]
const BASE = process.env.BASE ?? "http://localhost:8787";
const ws = process.argv[2] ?? "crm";
let cookie = "";
async function call(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { "content-type": "application/json", cookie },
    body: body ? JSON.stringify(body) : undefined,
  });
  const sc = res.headers.get("set-cookie");
  if (sc) cookie = sc.split(";")[0];
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}
await call("POST", "/api/auth/login", {
  email: process.env.EMAIL ?? "admin@concept.local",
  password: process.env.PASSWORD ?? "concept-admin",
});
const page = (title, parent, body) => call("POST", `/api/w/${ws}/pages`, { title, parent, body });
const row = (db, properties, body) => call("POST", `/api/w/${ws}/databases/${db}/rows`, { properties, body });

const companies = ["Acme", "Northwind", "Globex", "Initech", "Umbrella"];
for (const c of companies) await row("companies", { title: c, tags: ["customer"] });
const people = [
  ["Ada Lovelace", "ada@acme.co", "Acme"], ["Grace Hopper", "grace@northwind.io", "Northwind"],
  ["Alan Turing", "alan@globex.com", "Globex"], ["Margaret Hamilton", "mh@initech.dev", "Initech"],
];
for (const [t, email, co] of people) await row("contacts", { title: t, email, company: `[[${co}]]`, owner: "ada" });
const deals = [
  ["Acme renewal", "Proposal", 12000, "2026-10-14", "Acme"],
  ["Northwind pilot", "Qualified", 4800, "2026-10-21", "Northwind"],
  ["Globex rollout", "Negotiation", 38000, "2026-11-02", "Globex"],
  ["Initech audit", "Inbox", 2500, "2026-11-10", "Initech"],
  ["Umbrella expansion", "Won", 21000, "2026-09-18", "Umbrella"],
  ["Acme training", "Inbox", 3200, "2026-11-20", "Acme"],
  ["Globex support", "Qualified", 9600, "2026-10-30", "Globex"],
];
for (const [t, status, value, due, co] of deals)
  await row("deals", { title: t, status, value, due, company: `[[${co}]]`, owner: "ada", tags: value > 10000 ? ["priority"] : [] },
    `Notes for [[${co}]]. Follow up weekly.\n\n- [x] Intro call\n- [ ] Send proposal\n- [ ] Legal review\n`);
for (const [t, a, b] of [["Call Ada about renewal", "Acme"], ["Email Globex pricing", "Globex"]])
  await row("activities", { title: t, company: `[[${a ?? b}]]`, due: "2026-10-05" });

await page("Projects", "Pages", "Everything in flight. See [[Aurora Launch]] and [[Weekly Sync]].");
await page("Aurora Launch", "Pages/Projects",
  "The launch plan for the [[Acme]] relaunch. Status is reviewed every Monday in [[Weekly Sync]].\n\n## Milestones\n\n- [x] Brand audit\n- [x] Concept prototype\n- [ ] Site build\n- [ ] Handoff\n\n## Notes\n\nThe deal side is tracked as [[Acme renewal]].\n\n> Ship the smallest thing that proves the direction, then refine.\n\n## Budget\n\n| Item | Estimate |\n| --- | --- |\n| Design | 8,000 |\n| Build | 14,000 |\n| QA | 2,500 |\n");
await page("Weekly Sync", "Pages/Projects", "## Agenda\n\n1. Review [[Aurora Launch]]\n2. Pipeline check: [[Globex rollout]]\n3. Hiring\n\n## Decisions\n\n- Keep the launch date.\n- Revisit pricing after the Globex call.\n");
await page("Studio Handbook", "Pages", "# How we work\n\nPlans live in [[Aurora Launch]]. Customers live in the CRM databases: [[Acme]], [[Globex]].\n\n## Principles\n\n- Plain files, plain language.\n- Everything linkable.\n- Ship, then refine.\n\n```sh\nretex board --vault .\n```\n");
await page("Reading list", "Pages/Ideas", "Books and essays to read: #reading #ideas\n\n- The Design of Everyday Things\n- A Pattern Language\n");
await page("Product ideas", "Pages/Ideas", "Loose thoughts. Related: [[Studio Handbook]]. #ideas\n");
console.log("demo content created in", ws);
