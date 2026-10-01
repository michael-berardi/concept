import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, ApiError } from "@/api";
import { Icon } from "@/ui/icons";
import { useSession } from "@/state/session";
import { useToast } from "@/ui/primitives";

function AuthFrame({ title, sub, children }: { title: string; sub: string; children: React.ReactNode }) {
  return (
    <div style={{ minHeight: "100dvh", display: "grid", placeItems: "center", padding: 24 }}>
      <div style={{ width: "100%", maxWidth: 360 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 28 }}>
          <svg width="28" height="28" viewBox="0 0 32 32" fill="none" aria-hidden="true">
            <rect width="32" height="32" rx="7" fill="var(--surface-2)" stroke="var(--border)" />
            <path d="M21.5 11.2A7 7 0 1 0 21.5 20.8" stroke="var(--text)" strokeWidth="2" strokeLinecap="round" />
            <circle cx="21.8" cy="16" r="1.7" fill="var(--accent)" />
          </svg>
          <span style={{ fontWeight: 650, fontSize: 16, letterSpacing: "-0.01em" }}>Concept</span>
        </div>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 650, letterSpacing: "-0.02em" }}>{title}</h1>
        <p className="muted" style={{ margin: "6px 0 22px", fontSize: 13.5 }}>{sub}</p>
        {children}
      </div>
    </div>
  );
}

function Field({ label, ...rest }: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label style={{ display: "block", marginBottom: 14 }}>
      <span className="faint" style={{ display: "block", fontSize: 12, marginBottom: 6, fontWeight: 550 }}>{label}</span>
      <input className="input" style={{ width: "100%" }} {...rest} />
    </label>
  );
}

function Err({ error }: { error: unknown }) {
  if (!error) return null;
  const code = (error as { code?: string }).code ?? "";
  const msg = error instanceof Error ? error.message.replace(/^[a-z_]+: /, "") : String(error);
  return (
    <div role="alert" style={{ display: "flex", gap: 8, alignItems: "center", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", marginBottom: 14, color: "var(--danger)", fontSize: 13 }}>
      <Icon name="inbox" size={14} />
      <span style={{ flex: 1 }}>{msg}</span>
      {code ? <span className="error-code">{code}</span> : null}
    </div>
  );
}

export function SetupScreen() {
  const nav = useNavigate();
  const { refresh } = useSession();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [wsName, setWsName] = useState("Studio");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.register({ email, name, password });
      await api.createWorkspace({ name: wsName, template: "crm" });
      await refresh();
      nav("/");
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthFrame title="Set up your server" sub="The first account becomes the instance admin. Your vault stays plain Markdown on disk.">
      <form onSubmit={submit}>
        <Err error={error} />
        <Field label="Name" value={name} onChange={(e) => setName(e.target.value)} required autoFocus placeholder="Ada Stone" />
        <Field label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="ada@studio.dev" />
        <Field label="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} placeholder="At least 8 characters" />
        <Field label="Workspace name" value={wsName} onChange={(e) => setWsName(e.target.value)} required />
        <button className="btn primary" style={{ width: "100%", height: 36 }} disabled={busy}>
          {busy ? "Creating…" : "Create admin account"}
        </button>
        <p className="faint" style={{ fontSize: 12, marginTop: 14 }}>
          A CRM starter (Companies, Contacts, Deals, Activities) is created with the workspace.
        </p>
      </form>
    </AuthFrame>
  );
}

export function LoginScreen() {
  const nav = useNavigate();
  const { refresh, health } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.login({ email, password });
      await refresh();
      nav("/");
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthFrame title="Sign in" sub={health ? `Concept server · v${health.version}` : "Concept server"}>
      <form onSubmit={submit}>
        <Err error={error} />
        <Field label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus placeholder="ada@studio.dev" />
        <Field label="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        <button className="btn primary" style={{ width: "100%", height: 36 }} disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </AuthFrame>
  );
}

export function InviteAcceptScreen() {
  const { token = "" } = useParams();
  const nav = useNavigate();
  const { refresh } = useSession();
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.register({ email, name, password, inviteToken: token });
      await refresh();
      toast("Invite accepted");
      nav("/");
    } catch (err) {
      setError(err instanceof ApiError ? err : err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthFrame title="Join the workspace" sub="You were invited to a Concept workspace. Create your account to accept.">
      <form onSubmit={submit}>
        <Err error={error} />
        <Field label="Name" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
        <Field label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <Field label="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
        <button className="btn primary" style={{ width: "100%", height: 36 }} disabled={busy}>
          {busy ? "Accepting…" : "Accept invite"}
        </button>
      </form>
    </AuthFrame>
  );
}
