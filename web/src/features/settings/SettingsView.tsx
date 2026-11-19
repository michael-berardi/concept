import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "@/api";
import type { AclEntry, Invite, Member, SyncConfig, SyncStatus, Team, Token } from "@/api";
import { Icon } from "@/ui/icons";
import { EmptyState, ErrorState, Loading, useToast } from "@/ui/primitives";
import { Avatar } from "@/features/db/PropEditor";
import { relativeTime } from "@/lib/format";

const TABS = [
  { id: "members", label: "Members", icon: "users" },
  { id: "teams", label: "Teams", icon: "layers" },
  { id: "permissions", label: "Permissions", icon: "shield" },
  { id: "sync", label: "Git sync", icon: "git" },
  { id: "tokens", label: "API tokens", icon: "link" },
] as const;

const ROLE_LABELS: Record<string, string> = { owner: "Owner", admin: "Admin", member: "Member", guest: "Guest" };
const LEVEL_LABELS: Record<string, string> = { none: "No access", view: "Can view", comment: "Can comment", edit: "Can edit", admin: "Admin" };
const SUBJECT_LABELS: Record<string, string> = { team: "Team", user: "Person", workspace: "Workspace" };

export function SettingsView({ tab }: { tab: string }) {
  const { ws = "" } = useParams();
  return (
    <div style={{ maxWidth: 860, margin: "0 auto", padding: "36px 24px 80px", display: "flex", gap: 40 }}>
      <nav style={{ width: 170, flex: "none" }} aria-label="Settings">
        <div className="side-label">Workspace settings</div>
        {TABS.map((t) => (
          <a key={t.id} href={`/w/${ws}/settings/${t.id}`} className={`side-item${tab === t.id ? " active" : ""}`} onClick={(e) => { e.preventDefault(); nav(`${t.id}`); }}>
            <Icon name={t.icon} size={15} className="icon" />
            <span className="label">{t.label}</span>
          </a>
        ))}
      </nav>
      <div style={{ flex: 1, minWidth: 0 }}>
        {tab === "members" ? <Members ws={ws} /> : null}
        {tab === "teams" ? <Teams ws={ws} /> : null}
        {tab === "permissions" ? <Permissions ws={ws} /> : null}
        {tab === "sync" ? <Sync ws={ws} /> : null}
        {tab === "tokens" ? <Tokens /> : null}
      </div>
    </div>
  );
}

function nav(id: string) {
  const ws = window.location.pathname.split("/")[2];
  window.history.pushState({}, "", `/w/${ws}/settings/${id}`);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

function errorText(e: unknown, fallback: string): string {
  return e instanceof Error ? e.message : fallback;
}

function Section({ title, sub, children, action }: { title: string; sub?: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 36 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 12 }}>
        <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>{title}</h2>
        {action}
      </div>
      {sub ? <p className="faint" style={{ fontSize: 12.5, margin: "-6px 0 12px" }}>{sub}</p> : null}
      {children}
    </section>
  );
}

function Members({ ws }: { ws: string }) {
  const { toast } = useToast();
  const [members, setMembers] = useState<Member[] | null>(null);
  const [invites, setInvites] = useState<Invite[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [role, setRole] = useState<"member" | "admin" | "guest">("member");

  const load = useCallback(() => {
    Promise.all([api.members(ws), api.invites(ws)])
      .then(([m, i]) => {
        setMembers(m);
        setInvites(i);
      })
      .catch(setError);
  }, [ws]);

  useEffect(() => {
    load();
  }, [load]);

  if (error) return <ErrorState error={error} retry={load} />;
  if (!members || !invites) return <Loading />;

  return (
    <>
      <Section
        title="Members"
        sub="Roles: owner manages everything, admin manages content, member edits, guest only sees shared paths."
        action={
          <div style={{ display: "flex", gap: 6, marginLeft: "auto" }}>
            <select className="input" style={{ height: 26 }} value={role} onChange={(e) => setRole(e.target.value as typeof role)} aria-label="Invite role">
              <option value="member">Member</option>
              <option value="admin">Admin</option>
              <option value="guest">Guest</option>
            </select>
            <button
              className="btn sm primary"
              onClick={async () => {
                try {
                  const inv = await api.createInvite(ws, { role, expiresInDays: 14 });
                  setInvites((xs) => [...(xs ?? []), inv]);
                  toast("Invite link created");
                } catch (e) {
                  toast(errorText(e, "Invite failed"), "error");
                }
              }}
            >
              <Icon name="invite" size={13} /> Invite
            </button>
          </div>
        }
      >
        {members.map((m) => (
          <div key={m.userId} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderBottom: "1px solid var(--border)" }}>
            <Avatar name={m.name} size={26} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 550 }}>{m.name}</div>
              <div className="faint" style={{ fontSize: 12 }}>{m.email}</div>
            </div>
            <select
              className="input"
              style={{ height: 26, width: 92 }}
              value={m.role}
              aria-label={`Role for ${m.name}`}
              onChange={async (e) => {
                try {
                  await api.setMemberRole(ws, m.userId, e.target.value as Member["role"]);
                  load();
                } catch (err) {
                  toast(errorText(err, "Could not change role"), "error");
                }
              }}
            >
              {["owner", "admin", "member", "guest"].map((r) => (
                <option key={r} value={r} disabled={r === "owner"}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </select>
          </div>
        ))}
      </Section>

      <Section title="Invite links" sub="Anyone with the link can join with the chosen role until it expires.">
        {invites.length === 0 ? (
          <p className="faint" style={{ fontSize: 13 }}>No open invites.</p>
        ) : (
          invites.map((i) => (
            <div key={i.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
              <Icon name="link" size={14} className="faint" />
              <code className="mono" style={{ flex: 1, fontSize: 12 }}>{window.location.origin}{i.url}</code>
              <span className="badge">{ROLE_LABELS[i.role] ?? i.role}</span>
              <span className="faint" style={{ fontSize: 12 }}>expires {relativeTime(i.expiresAt)}</span>
              <button
                className="tb-btn"
                aria-label="Copy invite"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(window.location.origin + i.url);
                    toast("Invite link copied");
                  } catch {
                    toast("Could not copy the invite link", "error");
                  }
                }}
              >
                <Icon name="layers" size={13} />
              </button>
              <button
                className="tb-btn"
                aria-label="Revoke invite"
                onClick={async () => {
                  try {
                    await api.deleteInvite(ws, i.id);
                    setInvites((xs) => (xs ?? []).filter((x) => x.id !== i.id));
                  } catch (e) {
                    toast(errorText(e, "Could not revoke invite"), "error");
                  }
                }}
              >
                <Icon name="trash" size={13} />
              </button>
            </div>
          ))
        )}
      </Section>
    </>
  );
}

function Teams({ ws }: { ws: string }) {
  const { toast } = useToast();
  const [teams, setTeams] = useState<Team[] | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [error, setError] = useState<unknown>(null);
  const load = useCallback(() => {
    Promise.all([api.teams(ws), api.members(ws)])
      .then(([t, m]) => {
        setTeams(t);
        setMembers(m);
      })
      .catch(setError);
  }, [ws]);
  useEffect(() => {
    load();
  }, [load]);
  if (error) return <ErrorState error={error} retry={load} />;
  if (!teams) return <Loading />;

  return (
    <Section
      title="Teams"
      sub="Groups of members that permissions can target."
      action={
        <button
          className="btn sm"
          style={{ marginLeft: "auto" }}
          onClick={async () => {
            const name = window.prompt("Team name");
            if (!name) return;
            try {
              await api.createTeam(ws, name);
              load();
            } catch (e) {
              toast(errorText(e, "Could not create team"), "error");
            }
          }}
        >
          <Icon name="plus" size={13} /> New team
        </button>
      }
    >
      {teams.length === 0 ? <EmptyState icon="users" title="No teams" hint="Create a team to scope permissions to a group." /> : null}
      {teams.map((t) => (
        <div key={t.id} style={{ border: "1px solid var(--border)", borderRadius: 10, padding: "12px 14px", marginBottom: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <strong style={{ fontSize: 13.5 }}>{t.name}</strong>
            <span className="faint" style={{ fontSize: 12 }}>{t.memberIds.length} members</span>
            <span style={{ flex: 1 }} />
            <select
              className="input"
              style={{ height: 26, width: 150 }}
              value={picks[t.id] ?? ""}
              onChange={(e) => setPicks((p) => ({ ...p, [t.id]: e.target.value }))}
              aria-label={`Member to add to ${t.name}`}
            >
              <option value="">Choose a member</option>
              {members
                .filter((m) => !t.memberIds.includes(m.userId))
                .map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.name}
                  </option>
                ))}
            </select>
            <button
              className="tb-btn"
              aria-label={`Add member to ${t.name}`}
              disabled={!picks[t.id]}
              onClick={async () => {
                const userId = picks[t.id];
                if (!userId) return;
                try {
                  await api.teamAddMember(ws, t.id, userId);
                  setPicks((p) => ({ ...p, [t.id]: "" }));
                  load();
                } catch (e) {
                  toast(errorText(e, "Could not add member"), "error");
                }
              }}
            >
              <Icon name="plus" size={13} />
            </button>
            <button
              className="tb-btn"
              aria-label={`Delete ${t.name}`}
              onClick={async () => {
                try {
                  await api.deleteTeam(ws, t.id);
                  load();
                } catch (e) {
                  toast(errorText(e, "Could not delete team"), "error");
                }
              }}
            >
              <Icon name="trash" size={13} />
            </button>
          </div>
          <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
            {t.memberIds.map((id) => {
              const m = members.find((x) => x.userId === id);
              return (
                <span
                  key={id}
                  className="pill"
                  style={{ cursor: "pointer" }}
                  title="Remove"
                  onClick={async () => {
                    try {
                      await api.teamRemoveMember(ws, t.id, id);
                      load();
                    } catch (e) {
                      toast(errorText(e, "Could not remove member"), "error");
                    }
                  }}
                >
                  {m?.name ?? id} · ×
                </span>
              );
            })}
          </div>
        </div>
      ))}
    </Section>
  );
}

function Permissions({ ws }: { ws: string }) {
  const { toast } = useToast();
  const [entries, setEntries] = useState<AclEntry[] | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [path, setPath] = useState("Pages/Sales");
  const [level, setLevel] = useState<AclEntry["level"]>("edit");
  const [subjectType, setSubjectType] = useState<AclEntry["subjectType"]>("team");
  const [subjectId, setSubjectId] = useState("");
  const load = useCallback(() => {
    Promise.all([api.acl(ws), api.teams(ws), api.members(ws)])
      .then(([a, t, m]) => {
        setEntries(a);
        setTeams(t);
        setMembers(m);
      })
      .catch(setError);
  }, [ws]);
  useEffect(() => {
    load();
  }, [load]);
  if (error) return <ErrorState error={error} retry={load} />;
  if (!entries) return <Loading />;

  const subjects =
    subjectType === "team"
      ? teams.map((t) => ({ id: t.id, name: t.name }))
      : subjectType === "user"
        ? members.map((m) => ({ id: m.userId, name: m.name }))
        : [];

  return (
    <>
      <Section title="Access by path" sub="Most specific prefix wins. Workspace default is edit for members, none for guests." />
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 14 }}>
        <input className="input" style={{ flex: "1 1 100%" }} value={path} onChange={(e) => setPath(e.target.value)} placeholder="Pages/Sales" aria-label="Path prefix" />
        <select
          className="input"
          style={{ width: 110 }}
          value={subjectType}
          onChange={(e) => {
            setSubjectType(e.target.value as typeof subjectType);
            setSubjectId("");
          }}
          aria-label="Subject type"
        >
          <option value="team">Team</option>
          <option value="user">Person</option>
          <option value="workspace">Workspace</option>
        </select>
        <select
          className="input"
          style={{ width: 170 }}
          value={subjectType === "workspace" ? "" : subjectId}
          disabled={subjectType === "workspace"}
          onChange={(e) => setSubjectId(e.target.value)}
          aria-label="Subject"
        >
          <option value="">{subjectType === "workspace" ? "Whole workspace" : subjectType === "team" ? "Choose a team" : "Choose a person"}</option>
          {subjects.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <select className="input" style={{ width: 150 }} value={level} onChange={(e) => setLevel(e.target.value as typeof level)} aria-label="Level">
          {["none", "view", "comment", "edit", "admin"].map((l) => (
            <option key={l} value={l}>
              {LEVEL_LABELS[l]}
            </option>
          ))}
        </select>
        <button
          className="btn sm primary"
          disabled={subjectType !== "workspace" && !subjectId}
          onClick={async () => {
            try {
              await api.putAcl(ws, { path, subjectType, subjectId: subjectType === "workspace" ? "" : subjectId, level });
              load();
            } catch (e) {
              toast(errorText(e, "Could not add rule"), "error");
            }
          }}
        >
          Add rule
        </button>
      </div>
      {entries.length === 0 ? (
        <p className="faint" style={{ fontSize: 13 }}>No rules yet.</p>
      ) : (
        entries.map((a) => (
          <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 0", borderBottom: "1px solid var(--border)" }}>
            <Icon name="shield" size={14} className="faint" />
            <code className="mono" style={{ flex: 1, fontSize: 12 }}>{a.path}</code>
            <span className="badge">{SUBJECT_LABELS[a.subjectType]}: {a.subjectName ?? a.subjectId}</span>
            <span className="badge">{LEVEL_LABELS[a.level] ?? a.level}</span>
            <button
              className="tb-btn"
              aria-label="Delete rule"
              onClick={async () => {
                try {
                  await api.deleteAcl(ws, a.id);
                  load();
                } catch (e) {
                  toast(errorText(e, "Could not delete rule"), "error");
                }
              }}
            >
              <Icon name="trash" size={13} />
            </button>
          </div>
        ))
      )}
    </>
  );
}

function Sync({ ws }: { ws: string }) {
  const { toast } = useToast();
  const [cfg, setCfg] = useState<SyncConfig | null>(null);
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const load = useCallback(() => {
    Promise.all([api.syncConfig(ws), api.syncStatus(ws)])
      .then(([c, s]) => {
        setCfg(c);
        setStatus(s);
      })
      .catch(setError);
  }, [ws]);
  useEffect(() => {
    load();
  }, [load]);
  if (error) return <ErrorState error={error} retry={load} />;
  if (!cfg || !status) return <Loading />;

  return (
    <>
      <Section title="Git sync" sub="The server commits changes as the acting user, then pull --rebase / push on a timer. Conflicts are preserved as .conflict-<timestamp> files.">
        <label style={{ display: "block", marginBottom: 12 }}>
          <span className="faint" style={{ fontSize: 12, display: "block", marginBottom: 5 }}>Remote URL</span>
          <input className="input" style={{ width: "100%" }} value={cfg.remoteUrl ?? ""} onChange={(e) => setCfg({ ...cfg, remoteUrl: e.target.value })} placeholder="git@github.com:you/vault.git" />
        </label>
        <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
          <label style={{ flex: 1 }}>
            <span className="faint" style={{ fontSize: 12, display: "block", marginBottom: 5 }}>Branch</span>
            <input className="input" style={{ width: "100%" }} value={cfg.branch ?? ""} onChange={(e) => setCfg({ ...cfg, branch: e.target.value })} placeholder="main" />
          </label>
          <label style={{ flex: 1 }}>
            <span className="faint" style={{ fontSize: 12, display: "block", marginBottom: 5 }}>Access token {cfg.hasToken ? "(stored)" : ""}</span>
            <input className="input" style={{ width: "100%" }} type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder={cfg.hasToken ? "leave blank to keep" : "ghp_…"} />
          </label>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 13 }}>
            <input type="checkbox" checked={cfg.enabled} onChange={(e) => setCfg({ ...cfg, enabled: e.target.checked })} style={{ accentColor: "var(--accent)" }} />
            Enabled
          </label>
          <span style={{ flex: 1 }} />
          <button
            className="btn sm"
            onClick={async () => {
              setBusy(true);
              try {
                await api.putSyncConfig(ws, { ...cfg, token: token || undefined });
                toast("Sync settings saved");
                setToken("");
              } catch (e) {
                toast(errorText(e, "Could not save sync settings"), "error");
              } finally {
                setBusy(false);
              }
            }}
            disabled={busy}
          >
            Save
          </button>
          <button
            className="btn sm primary"
            onClick={async () => {
              setBusy(true);
              try {
                const s = await api.syncRun(ws);
                setStatus(s);
                toast("Sync finished");
              } catch (e) {
                toast(errorText(e, "Sync failed"), "error");
              } finally {
                setBusy(false);
              }
            }}
            disabled={busy}
          >
            <Icon name="sync" size={13} /> {busy ? "Syncing…" : "Sync now"}
          </button>
        </div>
      </Section>

      <Section title="Status">
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", border: "1px solid var(--border)", borderRadius: 10 }}>
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: status.state === "clean" ? "var(--ok)" : status.state === "conflict" || status.state === "error" ? "var(--danger)" : "var(--warn)",
            }}
          />
          <span style={{ fontSize: 13.5, fontWeight: 550, textTransform: "capitalize" }}>{status.state}</span>
          <span className="faint" style={{ fontSize: 12.5 }}>{status.lastCommit ?? ""}</span>
          <span className="faint" style={{ fontSize: 12, marginLeft: "auto" }}>{relativeTime(status.lastSyncAt)}</span>
        </div>
        {status.conflicts?.length ? (
          <div style={{ marginTop: 10 }}>
            {status.conflicts.map((c) => (
              <div key={c.savedAs} className="mono" style={{ fontSize: 12, padding: "6px 10px", border: "1px solid var(--danger)", borderRadius: 8, marginBottom: 6, color: "var(--danger)" }}>
                {c.path} → {c.savedAs}
              </div>
            ))}
          </div>
        ) : null}
      </Section>
    </>
  );
}

function Tokens() {
  const { toast } = useToast();
  const [tokens, setTokens] = useState<Token[] | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const load = useCallback(() => {
    setError(null);
    api.tokens().then(setTokens).catch(setError);
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  if (error) return <ErrorState error={error} retry={load} />;
  if (!tokens) return <Loading />;
  return (
    <Section
      title="Personal API tokens"
      sub="Use as Authorization: Bearer cpt_… for scripts. The secret is shown once."
      action={
        <button
          className="btn sm"
          style={{ marginLeft: "auto" }}
          onClick={async () => {
            try {
              const t = await api.createToken("CLI");
              setTokens((xs) => [...(xs ?? []), t]);
              setSecret(t.secret ?? null);
            } catch (e) {
              toast(errorText(e, "Could not create token"), "error");
            }
          }}
        >
          <Icon name="plus" size={13} /> New token
        </button>
      }
    >
      {secret ? (
        <div className="mono" style={{ fontSize: 12.5, border: "1px solid var(--ok)", borderRadius: 8, padding: "8px 12px", marginBottom: 12, color: "var(--ok)" }}>
          {secret}
          <button
            className="tb-btn"
            style={{ marginLeft: 8 }}
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(secret);
                toast("Token copied");
              } catch {
                toast("Could not copy the token", "error");
              }
            }}
          >
            copy
          </button>
        </div>
      ) : null}
      {tokens.length === 0 ? (
        <p className="faint" style={{ fontSize: 13 }}>No tokens yet.</p>
      ) : (
        tokens.map((t) => (
          <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 0", borderBottom: "1px solid var(--border)" }}>
            <Icon name="link" size={14} className="faint" />
            <span style={{ flex: 1, fontSize: 13.5 }}>{t.name}</span>
            <code className="mono faint" style={{ fontSize: 12 }}>{t.prefix}…</code>
            <span className="faint" style={{ fontSize: 12 }}>{relativeTime(t.createdAt)}</span>
            <button
              className="tb-btn"
              aria-label="Revoke token"
              onClick={async () => {
                try {
                  await api.deleteToken(t.id);
                  load();
                } catch (e) {
                  toast(errorText(e, "Could not revoke token"), "error");
                }
              }}
            >
              <Icon name="trash" size={13} />
            </button>
          </div>
        ))
      )}
    </Section>
  );
}
