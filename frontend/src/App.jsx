import { useEffect, useState } from "react";
import { Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { AppLayout } from "./components/layout/AppLayout";
import { WorkspaceProvider } from "./context/WorkspaceContext";
import { api } from "./lib/api";
import { Activity } from "./pages/Activity";
import { Analytics } from "./pages/Analytics";
import { Auth, VerifyEmail } from "./pages/Auth";
import { Campaigns } from "./pages/Campaigns";
import { Companies } from "./pages/Companies";
import { Deliverability } from "./pages/Deliverability";
import { Discovery } from "./pages/Discovery";
import { Followups } from "./pages/Followups";
import { Inbox } from "./pages/Inbox";
import { Legal } from "./pages/Legal";
import { Match } from "./pages/Match";
import { NotFound } from "./pages/NotFound";
import { Onboarding } from "./pages/Onboarding";
import { Overview } from "./pages/Overview";
import { Resume } from "./pages/Resume";
import { SemanticMatch } from "./pages/SemanticMatch";
import { Settings } from "./pages/Settings";
import { Studio } from "./pages/Studio";
import { Unlock } from "./pages/Unlock";

function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const params = new URLSearchParams(location.search);

  useEffect(() => {
    api("/auth/me")
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setAuthReady(true));
  }, []);

  if (!authReady) {
    return (
      <div className="auth-loading">
        <span className="loading-orb"><span /></span>
        <strong>Opening JobReach AI</strong>
        <p>Preparing your workspace…</p>
      </div>
    );
  }

  if (!user) {
    if (location.pathname === "/legal") return <Legal standalone />;
    return (
      <Auth
        initialMode={params.get("reset") ? "reset-confirm" : "login"}
        initialToken={params.get("verify") || params.get("reset") || ""}
        onAuthenticated={(nextUser) => {
          setUser(nextUser);
          navigate("/", { replace: true });
        }}
      />
    );
  }

  if (!user.is_verified) {
    return (
      <VerifyEmail
        user={user}
        initialToken={params.get("verify") || ""}
        onVerified={(nextUser) => {
          setUser(nextUser);
          if (nextUser) navigate("/", { replace: true });
        }}
      />
    );
  }

  if (!user.onboarding_completed) {
    return <Onboarding user={user} onCompleted={(nextUser) => setUser(nextUser)} />;
  }

  return (
    <WorkspaceProvider user={user} setUser={setUser}>
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="/" element={<Overview />} />
          <Route path="/companies" element={<Companies />} />
          <Route path="/discovery" element={<Discovery />} />
          <Route path="/match" element={<Match />} />
          <Route path="/semantic" element={<SemanticMatch />} />
          <Route path="/studio" element={<Studio />} />
          <Route path="/campaigns" element={<Campaigns />} />
          <Route path="/followups" element={<Followups />} />
          <Route path="/inbox" element={<Inbox />} />
          <Route path="/analytics" element={<Analytics />} />
          <Route path="/activity" element={<Activity />} />
          <Route path="/deliverability" element={<Deliverability />} />
          <Route path="/resume" element={<Resume />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/unlock" element={<Unlock />} />
          <Route path="/legal" element={<Legal />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </WorkspaceProvider>
  );
}

export default App;
