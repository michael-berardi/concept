/**
 * Built-in database templates. A new database can start from one of these;
 * a new workspace can start "blank" or with the "crm" starter set.
 */

export interface DbProperty {
  key: string;
  name: string;
  type:
    | "title"
    | "text"
    | "number"
    | "select"
    | "multi_select"
    | "status"
    | "date"
    | "checkbox"
    | "url"
    | "email"
    | "phone"
    | "person"
    | "relation"
    | "created"
    | "updated";
  options?: { id: string; color?: string }[];
  format?: string;
  database?: string;
}

export interface DbView {
  id: string;
  name: string;
  type: "table" | "board" | "list" | "calendar" | "gallery";
  groupBy?: string;
  filters?: { key: string; op: string; value?: unknown }[];
  sorts?: { key: string; dir: "asc" | "desc" }[];
  visible?: string[];
}

export interface DatabaseSchema {
  slug: string;
  name: string;
  icon?: string;
  recordType: string;
  properties: DbProperty[];
  views: DbView[];
}

export const RETEX_DEAL_STAGES = [
  "Inbox",
  "Qualified",
  "Proposal",
  "Negotiation",
  "Won",
  "Lost",
] as const;

const taskStatuses = ["Todo", "Doing", "Review", "Done"].map((id, i) => ({
  id,
  color: ["gray", "blue", "amber", "green"][i],
}));

const dealStatuses = RETEX_DEAL_STAGES.map((id) => ({ id }));

function schema(t: Omit<DatabaseSchema, "views"> & { views?: DbView[] }): DatabaseSchema {
  return {
    views: [
      { id: "table", name: "Table", type: "table", filters: [], sorts: [] },
      ...(t.properties.some((p) => p.type === "status")
        ? [
            {
              id: "board",
              name: "Board",
              type: "board" as const,
              groupBy: "status",
              filters: [],
              sorts: [{ key: "rank", dir: "asc" as const }],
            },
          ]
        : []),
    ],
    ...t,
  };
}

export const TEMPLATES: Record<string, DatabaseSchema> = {
  tasks: schema({
    slug: "tasks",
    name: "Tasks",
    icon: "circle-check",
    recordType: "task",
    properties: [
      { key: "title", name: "Name", type: "title" },
      { key: "status", name: "Status", type: "status", options: taskStatuses },
      { key: "owner", name: "Assignee", type: "person" },
      { key: "due", name: "Due", type: "date" },
      { key: "tags", name: "Labels", type: "multi_select" },
      { key: "archived", name: "Archived", type: "checkbox" },
    ],
  }),
  contacts: schema({
    slug: "contacts",
    name: "Contacts",
    icon: "user",
    recordType: "contact",
    properties: [
      { key: "title", name: "Name", type: "title" },
      { key: "email", name: "Email", type: "email" },
      { key: "phone", name: "Phone", type: "phone" },
      { key: "company", name: "Company", type: "relation", database: "companies" },
      { key: "owner", name: "Owner", type: "person" },
      { key: "tags", name: "Tags", type: "multi_select" },
      { key: "archived", name: "Archived", type: "checkbox" },
    ],
  }),
  companies: schema({
    slug: "companies",
    name: "Companies",
    icon: "building",
    recordType: "company",
    properties: [
      { key: "title", name: "Name", type: "title" },
      { key: "url", name: "Website", type: "url" },
      { key: "owner", name: "Owner", type: "person" },
      { key: "tags", name: "Tags", type: "multi_select" },
      { key: "archived", name: "Archived", type: "checkbox" },
    ],
  }),
  deals: schema({
    slug: "deals",
    name: "Deals",
    icon: "target",
    recordType: "deal",
    properties: [
      { key: "title", name: "Name", type: "title" },
      { key: "status", name: "Stage", type: "status", options: dealStatuses },
      { key: "value", name: "Value", type: "number", format: "currency" },
      { key: "company", name: "Company", type: "relation", database: "companies" },
      { key: "contact", name: "Contact", type: "relation", database: "contacts" },
      { key: "owner", name: "Owner", type: "person" },
      { key: "due", name: "Close date", type: "date" },
      { key: "next_action", name: "Next action", type: "text" },
      { key: "tags", name: "Tags", type: "multi_select" },
      { key: "archived", name: "Archived", type: "checkbox" },
    ],
    views: [
      { id: "table", name: "Table", type: "table", filters: [], sorts: [] },
      {
        id: "board",
        name: "Pipeline",
        type: "board",
        groupBy: "status",
        filters: [],
        sorts: [{ key: "rank", dir: "asc" }],
        visible: ["value", "due", "owner"],
      },
    ],
  }),
  activities: schema({
    slug: "activities",
    name: "Activities",
    icon: "activity",
    recordType: "activity",
    properties: [
      { key: "title", name: "Name", type: "title" },
      { key: "status", name: "Status", type: "status", options: taskStatuses },
      { key: "company", name: "Company", type: "relation", database: "companies" },
      { key: "contact", name: "Contact", type: "relation", database: "contacts" },
      { key: "deal", name: "Deal", type: "relation", database: "deals" },
      { key: "owner", name: "Owner", type: "person" },
      { key: "due", name: "When", type: "date" },
      { key: "archived", name: "Archived", type: "checkbox" },
    ],
  }),
  projects: schema({
    slug: "projects",
    name: "Projects",
    icon: "folder",
    recordType: "project",
    properties: [
      { key: "title", name: "Name", type: "title" },
      { key: "status", name: "Status", type: "status", options: taskStatuses },
      { key: "owner", name: "Owner", type: "person" },
      { key: "due", name: "Due", type: "date" },
      { key: "tags", name: "Tags", type: "multi_select" },
      { key: "archived", name: "Archived", type: "checkbox" },
    ],
  }),
};

export const CRM_STARTER = ["companies", "contacts", "deals", "activities"] as const;

export function templateSchema(name: string): DatabaseSchema | null {
  return TEMPLATES[name] ?? null;
}
