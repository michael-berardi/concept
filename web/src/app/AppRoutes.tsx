import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "@/layout/AppShell";
import { InviteAcceptScreen, LoginScreen, SetupScreen } from "@/features/auth/AuthScreens";
import { CrmHome } from "@/features/home/CrmHome";
import { PageView } from "@/features/pages/PageView";
import { DatabaseView } from "@/features/db/DatabaseView";
import { GraphPage } from "@/features/vault/GraphPage";
import { SettingsView } from "@/features/settings/SettingsView";
import { useSession } from "@/state/session";
import { Loading } from "@/ui/primitives";
import { BoardLens } from "@/features/home/BoardLens";

/** The authenticated workspace shell and its routes. */
export function AppRoutes() {
  const { me, health, loading, workspaces } = useSession();

  if (loading) {
    return (
      <div style={{ display: "grid", placeItems: "center", height: "100dvh" }}>
        <Loading />
      </div>
    );
  }

  if (health?.setupRequired && !me) return <SetupScreen />;
  if (!me) return <LoginScreen />;

  return (
    <Routes>
      <Route path="/setup" element={<Navigate to="/" replace />} />
      <Route path="/login" element={<Navigate to="/" replace />} />
      <Route path="/invite/:token" element={<InviteAcceptScreen />} />
      <Route path="/" element={<RootRedirect workspaces={workspaces} />} />
      <Route path="/w/:ws" element={<AppShell />}>
        <Route index element={<CrmHome />} />
        <Route path="board" element={<BoardLens />} />
        <Route path="page/*" element={<PageView />} />
        <Route path="db/:slug" element={<DatabaseView />} />
        <Route path="graph" element={<GraphPage />} />
        <Route path="settings" element={<Navigate to="members" replace />} />
        <Route path="settings/:tab" element={<SettingsRoute />} />
        <Route path="*" element={<Navigate to="." replace />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function SettingsRoute() {
  const tab = window.location.pathname.split("/").pop() ?? "members";
  return <SettingsView tab={tab} />;
}

function RootRedirect({ workspaces }: { workspaces: { slug: string }[] }) {
  if (workspaces.length === 0) {
    return (
      <div className="state" style={{ height: "100dvh" }}>
        <h3>No workspaces yet</h3>
        <p>Ask an admin to invite you, or create a workspace from the account menu.</p>
      </div>
    );
  }
  return <Navigate to={`/w/${workspaces[0].slug}`} replace />;
}
