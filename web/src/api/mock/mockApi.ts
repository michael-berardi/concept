/**
 * Dev-only in-memory API implementing the full Api surface against seeded data.
 * Loaded only when `?mock=1` (or localStorage concept.mock=1) — dynamic import
 * keeps this out of the production bundle path.
 */
import type { Api, RowMove } from "../apiTypes";
import type {
  AclEntry, ActivityEntry, Comment, Database, DbRow, GraphResult, Health, Invite,
  LinksResult, Member, PageRecord, Permission, Role, SearchResult, SyncConfig,
  SyncStatus, TagsResult, Team, Token, TreeNode, User, VaultFile, VaultFileRecord, Workspace,
} from "../types";
import { recomputeRanks } from "@/lib/rank";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
let seq = 100;
const uid = (p: string) => `${p}_${(seq++).toString(36)}`;

function iso(daysFromNow: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return d.toISOString();
}
function day(daysFromNow: number): string {
  return iso(daysFromNow).slice(0, 10);
}

function frontmatter(props: Record<string, unknown>, type: string): string {
  const lines = ["---"];
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0)) continue;
    if (Array.isArray(v)) lines.push(`${k}: [${v.join(", ")}]`);
    else if (typeof v === "string" && /[:#\[\]|]/.test(v)) lines.push(`${k}: "${v.replace(/"/g, '\\"')}"`);
    else lines.push(`${k}: ${v}`);
  }
  lines.push(`type: ${type}`, "archived: false", "---");
  return lines.join("\n");
}

/* ----------------------------- seed data ----------------------------- */

const ada: User = { id: "u_ada", email: "ada@studio.dev", name: "Ada Stone", isAdmin: true, avatarColor: "#6c8cff" };
const mike: User = { id: "u_mike", email: "mike@studio.dev", name: "Mike Okafor", avatarColor: "#67c98a" };
const june: User = { id: "u_june", email: "june@studio.dev", name: "June Park", avatarColor: "#e6b455" };
const users = [ada, mike, june];

const stages = ["Inbox", "Qualified", "Proposal", "Negotiation", "Won", "Lost"].map((id) => ({ id, color: "gray" }));

const databases: Database[] = [
  {
    slug: "deals",
    name: "Deals",
    icon: "",
    recordType: "deal",
    properties: [
      { key: "title", name: "Name", type: "title" },
      { key: "status", name: "Stage", type: "status", options: stages },
      { key: "value", name: "Value", type: "number", format: "currency" },
      { key: "company", name: "Company", type: "relation", database: "companies" },
      { key: "owner", name: "Owner", type: "person" },
      { key: "due", name: "Due", type: "date" },
      { key: "next_action", name: "Next action", type: "text" },
      { key: "tags", name: "Labels", type: "multi_select" },
    ],
    views: [
      { id: "board", name: "Pipeline", type: "board", groupBy: "status", visible: ["value", "due", "owner"] },
      { id: "table", name: "Table", type: "table", sorts: [{ key: "due", dir: "asc" }], visible: ["status", "value", "owner", "due"] },
      { id: "list", name: "List", type: "list", visible: ["value", "due"] },
    ],
  },
  {
    slug: "companies",
    name: "Companies",
    icon: "",
    recordType: "company",
    properties: [
      { key: "title", name: "Name", type: "title" },
      { key: "domain", name: "Domain", type: "url" },
      { key: "industry", name: "Industry", type: "select", options: [{ id: "Design" }, { id: "Software" }, { id: "Hardware" }] },
      { key: "tags", name: "Labels", type: "multi_select" },
    ],
    views: [
      { id: "gallery", name: "Gallery", type: "gallery", visible: ["industry"] },
      { id: "table", name: "Table", type: "table" },
    ],
  },
  {
    slug: "contacts",
    name: "Contacts",
    icon: "",
    recordType: "contact",
    properties: [
      { key: "title", name: "Name", type: "title" },
      { key: "email", name: "Email", type: "email" },
      { key: "company", name: "Company", type: "relation", database: "companies" },
      { key: "phone", name: "Phone", type: "phone" },
      { key: "tags", name: "Labels", type: "multi_select" },
    ],
    views: [{ id: "table", name: "Table", type: "table" }, { id: "list", name: "List", type: "list" }],
  },
  {
    slug: "tasks",
    name: "Tasks",
    icon: "",
    recordType: "task",
    properties: [
      { key: "title", name: "Name", type: "title" },
      { key: "status", name: "Status", type: "status", options: [{ id: "Todo" }, { id: "Doing" }, { id: "Review" }, { id: "Done" }] },
      { key: "due", name: "Due", type: "date" },
      { key: "priority", name: "Priority", type: "select", options: [{ id: "Low" }, { id: "Med" }, { id: "High" }] },
      { key: "tags", name: "Labels", type: "multi_select" },
    ],
    views: [
      { id: "board", name: "Board", type: "board", groupBy: "status", visible: ["due", "priority"] },
      { id: "calendar", name: "Calendar", type: "calendar", calendarDate: "due" },
      { id: "table", name: "Table", type: "table", sorts: [{ key: "due", dir: "asc" }] },
    ],
  },
  {
    slug: "activities",
    name: "Activities",
    icon: "",
    recordType: "activity",
    properties: [
      { key: "title", name: "Name", type: "title" },
      { key: "type", name: "Type", type: "select", options: [{ id: "Call" }, { id: "Email" }, { id: "Meeting" }] },
      { key: "company", name: "Company", type: "relation", database: "companies" },
      { key: "due", name: "When", type: "date" },
      { key: "done", name: "Done", type: "checkbox" },
    ],
    views: [{ id: "list", name: "List", type: "list", visible: ["type", "due"] }, { id: "table", name: "Table", type: "table" }],
  },
];

interface SeedRow {
  id: string;
  db: string;
  properties: Record<string, unknown>;
  body?: string;
  comments?: { userId: string; body: string; createdAt: string }[];
}

const dealBody = (next: string) => `## Context

Renewal conversation opened after the Q3 review. Decision expected by the end of the month.

### Next steps

- [ ] Send updated proposal
- [x] Confirm budget owner
- [ ] Schedule security review

> Anchor on the migration timeline; procurement wants a single annual invoice.

\`\`\`ts
const discount = annualOnly ? 0.12 : 0.06;
\`\`\`
`;

let seedRows: SeedRow[] = [
  { id: "rec_acme", db: "companies", properties: { title: "Acme", domain: "https://acme.co", industry: "Hardware", tags: ["priority"] } },
  { id: "rec_globex", db: "companies", properties: { title: "Globex", domain: "https://globex.io", industry: "Software" } },
  { id: "rec_initech", db: "companies", properties: { title: "Initech", domain: "https://initech.dev", industry: "Software", tags: ["partner"] } },
  { id: "rec_umbrella", db: "companies", properties: { title: "Umbrella Design", domain: "https://umbrella.studio", industry: "Design" } },
  { id: "rec_c1", db: "contacts", properties: { title: "Lena Hart", email: "lena@acme.co", company: "Acme", phone: "+1 415 555 0134", tags: ["champion"] } },
  { id: "rec_c2", db: "contacts", properties: { title: "Tom Ives", email: "tom@globex.io", company: "Globex" } },
  { id: "rec_c3", db: "contacts", properties: { title: "Sara Chen", email: "sara@initech.dev", company: "Initech" } },
  { id: "rec_d1", db: "deals", properties: { title: "Acme renewal", status: "Proposal", value: 12000, company: "Acme", owner: "Ada Stone", due: day(9), next_action: "Send proposal v2", tags: ["priority"] }, body: dealBody("x"), comments: [{ userId: "u_mike", body: "Procurement confirmed the annual window.", createdAt: iso(-1) }, { userId: "u_ada", body: "Proposal v2 drafted — attaching the security addendum next.", createdAt: iso(0) }] },
  { id: "rec_d2", db: "deals", properties: { title: "Globex platform", status: "Qualified", value: 24000, company: "Globex", owner: "Mike Okafor", due: day(21), next_action: "Technical deep dive" } },
  { id: "rec_d3", db: "deals", properties: { title: "Initech pilot", status: "Inbox", value: 4800, company: "Initech", owner: "June Park", due: day(4) } },
  { id: "rec_d4", db: "deals", properties: { title: "Umbrella retainer", status: "Negotiation", value: 9600, company: "Umbrella Design", owner: "Ada Stone", due: day(14), next_action: "Final terms call", tags: ["priority"] } },
  { id: "rec_d5", db: "deals", properties: { title: "Acme expansion", status: "Won", value: 7400, company: "Acme", owner: "Mike Okafor", due: day(-6) } },
  { id: "rec_d6", db: "deals", properties: { title: "Globex add-on", status: "Lost", value: 2100, company: "Globex", owner: "June Park", due: day(-12) } },
  { id: "rec_t1", db: "tasks", properties: { title: "Draft launch checklist", status: "Doing", due: day(2), priority: "High" } },
  { id: "rec_t2", db: "tasks", properties: { title: "Review vault spec comments", status: "Todo", due: day(3), priority: "Med" } },
  { id: "rec_t3", db: "tasks", properties: { title: "Ship graph view", status: "Review", due: day(1), priority: "High", tags: ["release"] } },
  { id: "rec_t4", db: "tasks", properties: { title: "Sync design tokens", status: "Done", due: day(-2), priority: "Low" } },
  { id: "rec_t5", db: "tasks", properties: { title: "Prepare CRM starter template", status: "Todo", due: day(6), priority: "Med" } },
  { id: "rec_t6", db: "tasks", properties: { title: "Quarterly offsite agenda", status: "Todo", due: day(17), priority: "Low" } },
  { id: "rec_a1", db: "activities", properties: { title: "Call with Lena Hart", type: "Call", company: "Acme", due: day(1), done: false } },
  { id: "rec_a2", db: "activities", properties: { title: "Email Globex security team", type: "Email", company: "Globex", due: day(0), done: false } },
  { id: "rec_a3", db: "activities", properties: { title: "Roadmap review at Initech", type: "Meeting", company: "Initech", due: day(5), done: false } },
];

const handbookBody = `The studio runs on files. Everything you read here lives in the vault as plain Markdown and stays readable in thirty years.

## How we work

- One vault per studio, one folder per project
- Pages for thinking, databases for tracking
- [[Aurora Launch]] is the current reference project
- Decisions are logged, never implied

## Voice

> Quiet, precise, unhurried. Say the thing once, say it well.

| Medium | Owner | Cadence |
| --- | --- | --- |
| Site | June | Monthly |
| Journal | Ada | Weekly |

\`\`\`sh
retex doctor --vault ./studio
\`\`\`
`;

const auroraBody = `The launch plan for the [[Acme]] relaunch. Status reviewed every Monday.

## Milestones

- [x] Brand audit
- [x] Concept prototype
- [ ] Site build
- [ ] Handoff

Open questions live in [[Weekly Sync]]. The deal side is tracked as [[Acme renewal]].

> Ship the smallest thing that proves the direction, then refine.
`;

const syncBody = `Standing agenda for [[Aurora Launch]] reviews.

- Metrics: pipeline value, cycle time
- Blockers first, then decisions
- Notes are pasted below the line

---

Last week: agreed to move the pricing page behind the waitlist.
`;

interface SeedPage {
  path: string;
  title: string;
  icon?: string;
  body: string;
  updatedAt: string;
  properties?: Record<string, unknown>;
}

const seedPages: SeedPage[] = [
  { path: "Pages/Studio Handbook.md", title: "Studio Handbook", body: handbookBody, updatedAt: iso(-3), properties: { status: "Evergreen", owner: "Ada Stone" } },
  { path: "Pages/Projects/Aurora Launch.md", title: "Aurora Launch", body: auroraBody, updatedAt: iso(-1), properties: { status: "In flight", due: day(12), owner: "June Park", tags: ["launch"] } },
  { path: "Pages/Projects/Weekly Sync.md", title: "Weekly Sync", body: syncBody, updatedAt: iso(0), properties: { status: "Recurring", owner: "Mike Okafor", due: day(2) } },
];

/* ------------------------------ store ------------------------------ */

interface Store {
  health: Health;
  session: User | null;
  users: User[];
  workspaces: Workspace[];
  databases: Database[];
  rows: SeedRow[];
  pages: SeedPage[];
  comments: Comment[];
  activity: ActivityEntry[];
  teams: Team[];
  acl: AclEntry[];
  invites: Invite[];
  tokens: Token[];
  sync: { config: SyncConfig; status: SyncStatus };
  vaultExtra: { path: string; content: string; updatedAt: string }[];
}

function defaultStore(): Store {
  const ranks = recomputeRanks(["1"]);
  void ranks;
  const dealRanks: Record<string, Record<string, string[]>> = {};
  return {
    health: { ok: true, version: "0.1.0-mock", setupRequired: false },
    session: null,
    users,
    workspaces: [{ id: "ws_studio", slug: "studio", name: "Studio", role: "owner", accent: "#6c8cff", createdAt: iso(-90) }],
    databases,
    rows: seedRows,
    pages: seedPages,
    comments: [],
    activity: [
      { id: uid("act"), userId: "u_ada", userName: "Ada Stone", action: "created", path: "Pages/Projects/Aurora Launch.md", createdAt: iso(-1) },
      { id: uid("act"), userId: "u_mike", userName: "Mike Okafor", action: "commented", path: "Data/deals/Acme renewal.md", detail: "Procurement confirmed", createdAt: iso(-1) },
      { id: uid("act"), userId: "u_june", userName: "June Park", action: "edited", path: "Pages/Studio Handbook.md", createdAt: iso(-3) },
    ],
    teams: [
      { id: "team_design", name: "Design", memberIds: ["u_june"] },
      { id: "team_sales", name: "Sales", memberIds: ["u_ada", "u_mike"] },
    ],
    acl: [{ id: "acl_1", path: "Pages/Projects", subjectType: "team", subjectId: "team_design", subjectName: "Design", level: "edit" }],
    invites: [],
    tokens: [],
    sync: {
      config: { remoteUrl: "git@github.com:studio/vault.git", branch: "main", enabled: true, hasToken: true },
      status: { state: "clean", lastSyncAt: iso(0), lastCommit: "f3a9c1e — deal ranks after move" },
    },
    vaultExtra: [
      { path: "Journal/2026-09-28.md", content: "# 2026-09-28\n\nSlow morning; the [[Aurora Launch]] build review went long.\n\n- [ ] Reply to Umbrella\n", updatedAt: iso(-2) },
      { path: "Attachments/.keep", content: "", updatedAt: iso(-90) },
    ],
  };
}

let store: Store = defaultStore();
const listeners = new Set<(ev: { type: string; path?: string }) => void>();
function emit(type: string, path?: string) {
  for (const l of listeners) l({ type, path });
}

function rankFor(db: string, groupKey: string | undefined, group: unknown): string {
  // stable pseudo-rank: per group, order by id sequence
  const g = String(group ?? "_");
  void db;
  void groupKey;
  void g;
  return "0|" + uid("r").slice(2).padEnd(13, "0").slice(0, 13);
}

function rowToDbRow(r: SeedRow): DbRow {
  const db = store.databases.find((d) => d.slug === r.db)!;
  const groupKey = db.views.find((v) => v.type === "board")?.groupBy;
  return {
    id: r.id,
    path: `Data/${r.db}/${r.properties.title}.md`,
    properties: { ...r.properties },
    rank: rankFor(r.db, groupKey, groupKey ? r.properties[groupKey] : undefined),
    contentHash: `h_${r.id}_${Object.values(r.properties).join("|").length}`,
    body: r.body,
    updatedAt: iso(0),
    tags: (r.properties.tags as string[]) ?? [],
  };
}

function findPage(path: string): SeedPage | undefined {
  return store.pages.find((p) => p.path.toLowerCase() === path.toLowerCase());
}

function recordFile(path: string): { row: SeedRow; db: Database } | null {
  const m = path.match(/^Data\/([^/]+)\/(.+)\.md$/i);
  if (!m) return null;
  const db = store.databases.find((d) => d.slug === m[1].toLowerCase());
  if (!db) return null;
  const row = store.rows.find((r) => r.db === db.slug && String(r.properties.title).toLowerCase() === m[2].toLowerCase());
  return row ? { row, db } : null;
}

function pageRecord(p: SeedPage): PageRecord {
  const backlinks = store.pages
    .filter((o) => o.path !== p.path && o.body.includes(`[[${p.title}]]`))
    .map((o) => ({ path: o.path, title: o.title }));
  return {
    path: p.path,
    title: p.title,
    icon: p.icon,
    properties: p.properties ?? {},
    body: p.body,
    contentHash: `h_${p.path.length}_${p.body.length}`,
    updatedAt: p.updatedAt,
    backlinks,
    permission: "edit",
  };
}

function wikiTargets(body: string): string[] {
  return [...body.matchAll(/\[\[([^\]]+)\]\]/g)].map((m) => m[1].trim());
}

/* ------------------------------ mock api ------------------------------ */

export function createMockApi(): Api {
  function bad(code: string, message: string): never {
    throw Object.assign(new Error(`${code}: ${message}`), { code, name: "ApiError" });
  }

  const api: Api = {
    async health() {
      await wait(80);
      return store.health;
    },
    async register(input) {
      await wait(150);
      if (store.users.some((u) => u.email === input.email)) bad("email_taken", "that email is already registered");
      const user: User = { id: uid("u"), email: input.email, name: input.name, isAdmin: store.users.length === 0 };
      store.users.push(user);
      store.session = user;
      return { user };
    },
    async login(input) {
      await wait(180);
      const user = store.users.find((u) => u.email.toLowerCase() === input.email.toLowerCase());
      if (!user || input.password.length < 4) bad("invalid_credentials", "email or password is incorrect");
      store.session = user;
      return { user };
    },
    async logout() {
      store.session = null;
    },
    async me() {
      await wait(60);
      return store.session;
    },
    async tokens() {
      return store.tokens;
    },
    async createToken(name) {
      const t: Token = { id: uid("tok"), name, prefix: "cpt_" + Math.random().toString(36).slice(2, 6), createdAt: iso(0), secret: "cpt_" + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2) };
      store.tokens.push(t);
      return t;
    },
    async deleteToken(id) {
      store.tokens = store.tokens.filter((t) => t.id !== id);
    },

    async workspaces() {
      await wait(60);
      return store.workspaces;
    },
    async createWorkspace(input) {
      const slug = (input.slug ?? input.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")).replace(/^-|-$/g, "");
      if (store.workspaces.some((w) => w.slug === slug)) bad("slug_taken", `workspace slug "${slug}" already exists`);
      const w: Workspace = { id: uid("ws"), slug, name: input.name, role: "owner", createdAt: iso(0) };
      store.workspaces.push(w);
      return w;
    },
    async updateWorkspace(ws, patch) {
      const w = store.workspaces.find((x) => x.slug === ws);
      if (!w) bad("not_found", `workspace ${ws} does not exist`);
      Object.assign(w, patch);
      return w;
    },
    async deleteWorkspace(ws) {
      store.workspaces = store.workspaces.filter((w) => w.slug !== ws);
    },

    async members() {
      return store.users.map((u) => ({ userId: u.id, email: u.email, name: u.name, role: u.id === "u_ada" ? ("owner" as Role) : ("member" as Role) }));
    },
    async setMemberRole(_ws, userId, role) {
      const u = store.users.find((x) => x.id === userId);
      if (!u) bad("not_found", `user ${userId} not found`);
      void role;
    },
    async removeMember(_ws, userId) {
      store.users = store.users.filter((u) => u.id !== userId);
    },
    async invites() {
      return store.invites;
    },
    async createInvite(_ws, input) {
      const inv: Invite = { id: uid("inv"), token: Math.random().toString(36).slice(2, 12), url: `/invite/${Math.random().toString(36).slice(2, 12)}`, email: input.email, role: input.role, expiresAt: iso(input.expiresInDays) };
      inv.url = `/invite/${inv.token}`;
      store.invites.push(inv);
      return inv;
    },
    async deleteInvite(_ws, id) {
      store.invites = store.invites.filter((i) => i.id !== id);
    },
    async acceptInvite(token) {
      const inv = store.invites.find((i) => i.token === token);
      if (!inv) bad("not_found", `invite ${token} not found or expired`);
      return { workspace: store.workspaces[0] };
    },
    async teams() {
      return store.teams;
    },
    async createTeam(_ws, name) {
      const t: Team = { id: uid("team"), name, memberIds: [] };
      store.teams.push(t);
      return t;
    },
    async renameTeam(_ws, id, name) {
      const t = store.teams.find((x) => x.id === id);
      if (!t) bad("not_found", `team ${id} not found`);
      t.name = name;
    },
    async deleteTeam(_ws, id) {
      store.teams = store.teams.filter((t) => t.id !== id);
    },
    async teamAddMember(_ws, id, userId) {
      store.teams.find((t) => t.id === id)?.memberIds.push(userId);
    },
    async teamRemoveMember(_ws, id, userId) {
      const t = store.teams.find((x) => x.id === id);
      if (t) t.memberIds = t.memberIds.filter((m) => m !== userId);
    },
    async acl() {
      return store.acl;
    },
    async putAcl(_ws, input) {
      const entry: AclEntry = { id: uid("acl"), ...input, subjectName: input.subjectType === "team" ? store.teams.find((t) => t.id === input.subjectId)?.name : store.users.find((u) => u.id === input.subjectId)?.name };
      store.acl.push(entry);
      return entry;
    },
    async deleteAcl(_ws, id) {
      store.acl = store.acl.filter((a) => a.id !== id);
    },

    async tree() {
      await wait(50);
      const root: TreeNode[] = [];
      const pages = [...store.pages].sort((a, b) => a.path.localeCompare(b.path));
      for (const p of pages) {
        const parts = p.path.replace(/^Pages\/?/, "").split("/");
        let level = root;
        let acc = "Pages";
        for (let i = 0; i < parts.length; i++) {
          acc += "/" + parts[i];
          const isLeaf = i === parts.length - 1;
          let node = level.find((n) => n.path === acc);
          if (!node) {
            node = { path: acc, title: isLeaf ? p.title : parts[i], type: isLeaf ? "page" : "folder", icon: p.icon };
            level.push(node);
          }
          if (!isLeaf) {
            node.children = node.children ?? [];
            level = node.children;
          }
        }
      }
      for (const d of store.databases) {
        root.push({ path: `Data/${d.slug}`, title: d.name, type: "database", icon: d.icon });
      }
      return root;
    },
    async page(_ws, path) {
      await wait(60);
      const p = findPage(path);
      if (p) return pageRecord(p);
      const rec = recordFile(path);
      if (rec) {
        return {
          path,
          title: String(rec.row.properties.title),
          properties: rec.row.properties,
          body: rec.row.body ?? "",
          contentHash: `h_${rec.row.id}`,
          backlinks: store.pages.filter((o) => o.body.includes(`[[${rec.row.properties.title}]]`)).map((o) => ({ path: o.path, title: o.title })),
          permission: "edit",
        };
      }
      bad("not_found", `page ${path} not found in vault`);
    },
    async createPage(_ws, input) {
      await wait(80);
      const parentPrefix = input.parent ? input.parent + "/" : "Pages/";
      const path = (input.parent ? parentPrefix : "Pages/") + `${input.title}.md`;
      if (findPage(path)) bad("already_exists", `page ${path} already exists`);
      const p: SeedPage = { path, title: input.title, icon: input.icon, body: input.body ?? "", updatedAt: iso(0), properties: (input as { properties?: Record<string, unknown> }).properties };
      store.pages.push(p);
      emit("change", path);
      return pageRecord(p);
    },
    async updatePage(_ws, path, patch) {
      await wait(60);
      const p = findPage(path);
      if (!p) bad("not_found", `page ${path} not found`);
      if (patch.title !== undefined) p.title = patch.title;
      if (patch.body !== undefined) p.body = patch.body;
      if (patch.icon !== undefined) p.icon = patch.icon;
      if (patch.properties) p.properties = { ...(p.properties ?? {}), ...patch.properties };
      p.updatedAt = iso(0);
      store.activity.unshift({ id: uid("act"), userId: "u_ada", userName: "Ada Stone", action: "edited", path, createdAt: iso(0) });
      emit("change", path);
      return pageRecord(p);
    },
    async deletePage(_ws, path) {
      store.pages = store.pages.filter((p) => p.path !== path);
      emit("change", path);
    },
    async movePage(_ws, path, parent) {
      const p = findPage(path);
      if (!p) bad("not_found", `page ${path} not found`);
      const title = p.path.split("/").pop()!;
      const target = (parent ? parent + "/" : "Pages/") + title;
      p.path = target;
      emit("change", target);
    },

    async databases() {
      await wait(40);
      return store.databases;
    },
    async database(_ws, slug) {
      const d = store.databases.find((x) => x.slug === slug);
      if (!d) bad("not_found", `database ${slug} not found`);
      return d;
    },
    async createDatabase(_ws, input) {
      const slug = input.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      if (store.databases.some((d) => d.slug === slug)) bad("slug_taken", `database "${slug}" already exists`);
      const d: Database = {
        slug,
        name: input.name,
        recordType: slug.replace(/s$/, ""),
        properties: [
          { key: "title", name: "Name", type: "title" },
          { key: "status", name: "Status", type: "status", options: [{ id: "Todo" }, { id: "Doing" }, { id: "Done" }] },
          { key: "tags", name: "Labels", type: "multi_select" },
        ],
        views: [
          { id: "board", name: "Board", type: "board", groupBy: "status" },
          { id: "table", name: "Table", type: "table" },
        ],
      };
      store.databases.push(d);
      emit("change", `Data/${slug}`);
      return d;
    },
    async updateDatabase(_ws, slug, patch) {
      const d = store.databases.find((x) => x.slug === slug);
      if (!d) bad("not_found", `database ${slug} not found`);
      return Object.assign(d, patch);
    },
    async deleteDatabase(_ws, slug) {
      store.databases = store.databases.filter((d) => d.slug !== slug);
    },
    async rows(_ws, db) {
      await wait(60);
      return { rows: store.rows.filter((r) => r.db === db).map(rowToDbRow) };
    },
    async createRow(_ws, db, input) {
      await wait(80);
      const row: SeedRow = { id: uid("rec"), db, properties: input.properties, body: input.body };
      store.rows.push(row);
      store.activity.unshift({ id: uid("act"), userId: "u_ada", userName: "Ada Stone", action: "created", path: `Data/${db}/${input.properties.title}.md`, createdAt: iso(0) });
      emit("change", `Data/${db}`);
      return rowToDbRow(row);
    },
    async updateRow(_ws, db, id, patch) {
      await wait(50);
      const row = store.rows.find((r) => r.id === id && r.db === db);
      if (!row) bad("not_found", `row ${id} not found in ${db}`);
      if (patch.properties) row.properties = { ...row.properties, ...patch.properties };
      if (patch.body !== undefined) row.body = patch.body;
      emit("change", `Data/${db}`);
      return rowToDbRow(row);
    },
    async deleteRow(_ws, db, id) {
      store.rows = store.rows.filter((r) => !(r.id === id && r.db === db));
      emit("change", `Data/${db}`);
    },
    async moveRow(_ws, db, id, move: RowMove) {
      await wait(60);
      const d = store.databases.find((x) => x.slug === db);
      if (!d) bad("not_found", `database ${db} not found`);
      const row = store.rows.find((r) => r.id === id);
      if (!row) bad("not_found", `row ${id} not found`);
      const groupKey = move.status !== undefined ? d!.views.find((v) => v.type === "board")?.groupBy ?? "status" : undefined;
      if (groupKey && move.status !== undefined) row.properties[groupKey] = move.status;
      emit("change", `Data/${db}`);
      return { rows: store.rows.filter((r) => r.db === db).map(rowToDbRow) };
    },

    async search(_ws, q) {
      await wait(90);
      const ql = q.toLowerCase();
      if (!ql) return [];
      const out: SearchResult[] = [];
      for (const p of store.pages) {
        if (p.title.toLowerCase().includes(ql) || p.body.toLowerCase().includes(ql)) {
          out.push({ path: p.path, title: p.title, type: "page", snippet: p.body.slice(Math.max(0, p.body.toLowerCase().indexOf(ql) - 24), 80) });
        }
      }
      for (const r of store.rows) {
        const t = String(r.properties.title ?? "");
        if (t.toLowerCase().includes(ql)) {
          out.push({ path: `Data/${r.db}/${t}.md`, title: t, type: r.db, dbSlug: r.db });
        }
      }
      return out;
    },
    async comments(_ws, path) {
      const row = recordFile(path);
      const page = findPage(path);
      const pid = page?.path ?? path;
      const own = store.comments.filter((c) => c.path === pid);
      const rowComments = (row?.row.comments ?? []).map((c, i) => ({ id: `${row!.row.id}_c${i}`, path, userId: c.userId, userName: store.users.find((u) => u.id === c.userId)?.name, body: c.body, createdAt: c.createdAt }));
      return [...own, ...rowComments];
    },
    async addComment(_ws, path, body) {
      const c: Comment = { id: uid("com"), path, userId: "u_ada", userName: "Ada Stone", body, createdAt: iso(0) };
      store.comments.push(c);
      const rec = recordFile(path);
      if (rec) rec.row.comments = [...(rec.row.comments ?? []), { userId: "u_ada", body, createdAt: iso(0) }];
      emit("comment", path);
      return c;
    },
    async deleteComment(_ws, id) {
      store.comments = store.comments.filter((c) => c.id !== id);
    },
    async activity(_ws, path, limit = 30) {
      return store.activity.filter((a) => !path || a.path === path).slice(0, limit);
    },

    async syncConfig() {
      return store.sync.config;
    },
    async putSyncConfig(_ws, cfg) {
      store.sync.config = { remoteUrl: cfg.remoteUrl, branch: cfg.branch, enabled: cfg.enabled, hasToken: cfg.hasToken || !!cfg.token };
      return store.sync.config;
    },
    async syncRun() {
      await wait(400);
      store.sync.status = { ...store.sync.status, lastSyncAt: iso(0) };
      return store.sync.status;
    },
    async syncStatus() {
      return store.sync.status;
    },

    async vaultTree() {
      await wait(40);
      const files: VaultFile[] = [];
      const ensureDir = (parts: string[], level: VaultFile[]) => {
        let acc = "";
        for (let i = 0; i < parts.length - 1; i++) {
          acc = acc ? `${acc}/${parts[i]}` : parts[i];
          let dir = level.find((f) => f.path === acc && f.type === "dir");
          if (!dir) {
            dir = { path: acc, type: "dir", children: [] };
            level.push(dir);
          }
          dir.children = dir.children ?? [];
          level = dir.children;
        }
        return level;
      };
      const add = (path: string, recordType?: string) => {
        const parts = path.split("/");
        const level = ensureDir(parts, files);
        level.push({ path, type: "file", title: parts[parts.length - 1], recordType });
      };
      for (const p of store.pages) add(p.path);
      for (const r of store.rows) add(`Data/${r.db}/${r.properties.title}.md`, store.databases.find((d) => d.slug === r.db)?.recordType);
      for (const e of store.vaultExtra) add(e.path);
      const sortLevel = (level: VaultFile[]) => {
        level.sort((a, b) => (a.type === b.type ? a.path.localeCompare(b.path) : a.type === "dir" ? -1 : 1));
        for (const f of level) if (f.children) sortLevel(f.children);
      };
      sortLevel(files);
      return files;
    },
    async vaultFile(_ws, path) {
      await wait(40);
      const page = findPage(path);
      if (page) {
        const fm = frontmatter({ title: page.title, ...(page.properties ?? {}) }, "page");
        return { path, content: `${fm}\n\n${page.body}`, contentHash: `vf_${page.body.length}`, updatedAt: page.updatedAt };
      }
      const rec = recordFile(path);
      if (rec) {
        const db = store.databases.find((d) => d.slug === rec.db.slug)!;
        const props: Record<string, unknown> = {};
        for (const prop of db.properties) props[prop.key] = rec.row.properties[prop.key];
        return { path, content: `${frontmatter(props, db.recordType)}\n\n${rec.row.body ?? ""}`, contentHash: `vf_${rec.row.id}`, updatedAt: iso(0) };
      }
      const extra = store.vaultExtra.find((e) => e.path === path);
      if (extra) return { path, content: extra.content, contentHash: `vf_${extra.path.length}`, updatedAt: extra.updatedAt };
      bad("not_found", `file ${path} not found in vault`);
    },
    async putVaultFile(_ws, path, content) {
      await wait(60);
      const extra = store.vaultExtra.find((e) => e.path === path);
      if (extra) {
        extra.content = content;
        extra.updatedAt = iso(0);
      } else {
        store.vaultExtra.push({ path, content, updatedAt: iso(0) });
      }
      emit("change", path);
      return { path, content, contentHash: `vf_${content.length}`, updatedAt: iso(0) };
    },
    async graph(_ws, scope, path, depth = 2) {
      await wait(80);
      const nodes: GraphResult["nodes"] = [];
      const edges: GraphResult["edges"] = [];
      const pageByTitle = new Map(store.pages.map((p) => [p.title, p]));
      const recordByTitle = new Map(store.rows.map((r) => [String(r.properties.title), r]));
      const addPageNode = (p: SeedPage) => {
        if (!nodes.some((n) => n.id === p.title)) {
          nodes.push({ id: p.title, path: p.path, title: p.title, type: "page", tags: [...p.body.matchAll(/#([\w-]+)/g)].map((m) => m[1]) });
        }
      };
      if (scope === "global") {
        for (const p of store.pages) addPageNode(p);
        for (const r of store.rows) {
          const t = String(r.properties.title);
          if (!nodes.some((n) => n.id === t)) nodes.push({ id: t, path: `Data/${r.db}/${t}.md`, title: t, type: "record" });
        }
        for (const p of store.pages) {
          for (const target of wikiTargets(p.body)) {
            if (nodes.some((n) => n.id === target)) edges.push({ source: p.title, target });
          }
        }
      } else {
        const p0 = path ? findPage(path) : store.pages[0];
        if (!p0) return { nodes: [], edges: [] };
        addPageNode(p0);
        const frontier = [p0.title];
        for (let d = 0; d < depth; d++) {
          const next: string[] = [];
          for (const t of frontier) {
            const p = pageByTitle.get(t);
            const targets = p ? wikiTargets(p.body) : [];
            for (const target of targets) {
              const rec = recordByTitle.get(target);
              if (rec) {
                if (!nodes.some((n) => n.id === target)) nodes.push({ id: target, path: `Data/${rec.db}/${target}.md`, title: target, type: "record" });
                edges.push({ source: t, target });
                next.push(target);
                continue;
              }
              const tp = pageByTitle.get(target);
              if (tp) {
                addPageNode(tp);
                edges.push({ source: t, target });
                next.push(target);
              } else if (!nodes.some((n) => n.id === target)) {
                nodes.push({ id: target, path: `wiki/${target}`, title: target, type: "file" });
                edges.push({ source: t, target });
              }
            }
          }
          frontier.length = 0;
          frontier.push(...next);
        }
      }
      return { nodes, edges };
    },
    async tags() {
      const counts = new Map<string, number>();
      for (const r of store.rows) {
        for (const t of ((r.properties.tags as string[]) ?? [])) counts.set(t, (counts.get(t) ?? 0) + 1);
      }
      for (const p of store.pages) {
        for (const m of p.body.matchAll(/(?:^|\s)#([\w-]+)/g)) counts.set(m[1], (counts.get(m[1]) ?? 0) + 1);
      }
      return { tags: [...counts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count) };
    },
    async links(_ws, path) {
      const p = findPage(path);
      const body = p?.body ?? "";
      const outgoing = wikiTargets(body).map((t) => ({
        target: t,
        title: t,
        resolved: pageByTitleSafe(t),
      }));
      return {
        outgoing,
        backlinks: store.pages.filter((o) => o.path !== path && o.body.includes(`[[${pathTitle(path)}]]`)).map((o) => ({ path: o.path, title: o.title })),
        unresolved: outgoing.filter((o) => !o.resolved).map((o) => o.target),
      };
    },

    onEvent(_ws, handler) {
      listeners.add(handler);
      return () => listeners.delete(handler);
    },
  };

  function pageByTitleSafe(title: string): boolean {
    return store.pages.some((p) => p.title === title) || store.rows.some((r) => String(r.properties.title) === title);
  }
  function pathTitle(path: string): string {
    return path.split("/").pop()?.replace(/\.md$/, "") ?? path;
  }

  return api;
}
