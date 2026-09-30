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
              <option value="member">member</option>
              <option value="admin">admin</option>
              <option value="guest">guest</option>
            </select>
            <button
              className="btn sm primary"
              onClick={async () => {
                try {
                  const inv = await api.createInvite(ws, { role, expiresInDays: 14 });
                  setInvites((xs) => [...(xs ?? []), inv]);
                  toast("Invite link created");
                } catch (e) {
                  toast(e instanceof Error ? e.message : "Invite failed", "error");
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
                await api.setMemberRole(ws, m.userId, e.target.value as Member["role"]);
                load();
              }}
            >
              {["owner", "admin", "member", "guest"].map((r) => (
                <option key={r} value={r} disabled={r === "owner"}>
                  {r}
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
              <span className="badge">{i.role}</span>
              <span className="faint" style={{ fontSize: 12 }}>expires {relativeTime(i.expiresAt)}</span>
              <button className="tb-btn" aria-label="Copy invite" onClick={() => { navigator.clipboard?.writeText(window.location.origin + i.url); toast("Invite link copied"); }}>
                <Icon name="layers" size={13} />
              </button>
              <button className="tb-btn" aria-label="Revoke invite" onClick={async () => { await api.deleteInvite(ws, i.id); setInvites((xs) => (xs ?? []).filter((x) => x.id !== i.id)); }}>
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
  const [teams, setTeams] = useState<Team[] | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
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
            await api.createTeam(ws, name);
            load();
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
            <button
              className="tb-btn"
              aria-label={`Add member to ${t.name}`}
              onClick={async () => {
                const candidate = members.find((m) => !t.memberIds.includes(m.userId));
                if (!candidate) return;
                await api.teamAddMember(ws, t.id, candidate.userId);
                load();
              }}
            >
              <Icon name="plus" size={13} />
            </button>
            <button
              className="tb-btn"
              aria-label={`Delete ${t.name}`}
              onClick={async () => {
                await api.deleteTeam(ws, t.id);
                load();
              }}
            >
              <Icon name="trash" size={13} />
            </button>
          </div>
          <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
            {t.memberIds.map((id) => {
              const m = members.find((x) => x.userId === id);
              return (
                <span key={id} className="pill" style={{ cursor: "pointer" }} title="Remove" onClick={async () => { await api.teamRemoveMember(ws, t.id, id); load(); }}>
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
  const [entries, setEntries] = useState<AclEntry[] | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [path, setPath] = useState("Pages/Sales");
  const [level, setLevel] = useState<AclEntry["level"]>("edit");
  const [subjectType, setSubjectType] = useState<AclEntry["subjectType"]>("team");
  const load = useCallback(() => {
    Promise.all([api.acl(ws), api.teams(ws)])
      .then(([a, t]) => {
        setEntries(a);
        setTeams(t);
      })
      .catch(setError);
  }, [ws]);
  useEffect(() => {
    load();
  }, [load]);
  if (error) return <ErrorState error={error} retry={load} />;
  if (!entries) return <Loading />;

  return (
    <>
      <Section title="Access by path" sub="Most specific prefix wins. Workspace default is edit for members, none for guests." />
      <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto auto", gap: 8, alignItems: "center", marginBottom: 14 }}>
        <input className="input" value={path} onChange={(e) => setPath(e.target.value)} placeholder="Pages/Sales" aria-label="Path prefix" />
        <select className="input" style={{ width: 110 }} value={subjectType} onChange={(e) => setSubjectType(e.target.value as typeof subjectType)} aria-label="Subject type">
          <option value="team">team</option>
          <option value="user">user</option>
          <option value="workspace">workspace</option>
        </select>
        <select className="input" style={{ width: 150 }} value={level} onChange={(e) => setLevel(e.target.value as typeof level)} aria-label="Level">
          {["none", "view", "comment", "edit", "admin"].map((l) => (
            <option key={l}>{l}</option>
          ))}
        </select>
        <button
          className="btn sm primary"
          onClick={async () => {
            const subjectId = subjectType === "team" ? teams[0]?.id ?? "" : "";
            await api.putAcl(ws, { path, subjectType, subjectId, level });
            load();
          }}
        >
          Add rule
        </button>
      </div>
      {entries.length === 0 ? (
        <p className="faint" style={{ fontSize: 13 }}>No explicit rules — workspace defaults apply.</p>
      ) : (
        entries.map((a) => (
          <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 0", borderBottom: "1px solid var(--border)" }}>
            <Icon name="shield" size={14} className="faint" />
            <code className="mono" style={{ flex: 1, fontSize: 12 }}>{a.path}</code>
            <span className="badge">{a.subjectType}: {a.subjectName ?? a.subjectId}</span>
            <span className="badge">{a.level}</span>
            <button className="tb-btn" aria-label="Delete rule" onClick={async () => { await api.deleteAcl(ws, a.id); load(); }}>
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
                toast(e instanceof Error ? e.message : "Sync failed", "error");
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
  const load = useCallback(() => api.tokens().then(setTokens).catch(() => setTokens([])), []);
  useEffect(() => {
    load();
  }, [load]);
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
            const t = await api.createToken("CLI");
            setTokens((xs) => [...(xs ?? []), t]);
            setSecret(t.secret ?? null);
          }}
        >
          <Icon name="plus" size={13} /> New token
        </button>
      }
    >
      {secret ? (
        <div className="mono" style={{ fontSize: 12.5, border: "1px solid var(--ok)", borderRadius: 8, padding: "8px 12px", marginBottom: 12, color: "var(--ok)" }}>
          {secret}
          <button className="tb-btn" style={{ marginLeft: 8 }} onClick={() => { navigator.clipboard?.writeText(secret); toast("Token copied"); }}>
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
            <button className="tb-btn" aria-label="Revoke token" onClick={async () => { await api.deleteToken(t.id); load(); }}>
              <Icon name="trash" size={13} />
            </button>
          </div>
        ))
      )}
    </Section>
  );
}
