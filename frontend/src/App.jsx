import { useCallback, useEffect, useMemo, useState } from "react";

const navigation = [
  { id: "overview", label: "Overview", icon: "overview" },
  { id: "companies", label: "Companies", icon: "companies" },
  { id: "studio", label: "AI Email Studio", icon: "studio" },
  { id: "jobs", label: "Job Match", icon: "jobs" },
  { id: "campaign", label: "Campaign & Send", icon: "campaign" },
  { id: "followups", label: "Follow-ups", icon: "followups" },
  { id: "unlock", label: "Unlock", icon: "shield" },
  { id: "settings", label: "Profile & Settings", icon: "settings" },
];

const statuses = [
  "PENDING", "DRAFTED", "SENT", "REPLIED", "FAILED",
  "NOT_INTERESTED", "OPTED_OUT", "ARCHIVED",
];

const icons = {
  overview: <svg viewBox="0 0 24 24"><rect x="3" y="3" width="8" height="8" rx="2"/><rect x="13" y="3" width="8" height="5" rx="2"/><rect x="13" y="10" width="8" height="11" rx="2"/><rect x="3" y="13" width="8" height="8" rx="2"/></svg>,
  companies: <svg viewBox="0 0 24 24"><path d="M3 21h18M5 21V7a2 2 0 0 1 2-2h4v16M13 21V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v17"/><path d="M8 9h.01M8 13h.01M16 8h.01M16 12h.01M16 16h.01"/></svg>,
  studio: <svg viewBox="0 0 24 24"><path d="M12 3l1.8 4.8L18.6 9l-4.2 2.5L13 16l-1-4.5L7.8 9l4.4-1.2L12 3z"/><path d="M5 18l.8 2.2L8 21l-2.2.8L5 24l-.8-2.2L2 21l2.2-.8L5 18z"/></svg>,
  campaign: <svg viewBox="0 0 24 24"><path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/></svg>,
  jobs: <svg viewBox="0 0 24 24"><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 12h18"/></svg>,
  followups: <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>,
  settings: <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1 1 0 0 0 .2 1.1l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1 1 0 0 0-1.1-.2 1 1 0 0 0-.6.9V20a2 2 0 0 1-4 0v-.1a1 1 0 0 0-.7-.9 1 1 0 0 0-1.1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1 1 0 0 0 .2-1.1 1 1 0 0 0-.9-.6H4a2 2 0 0 1 0-4h.1a1 1 0 0 0 .9-.7 1 1 0 0 0-.2-1.1l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1 1 0 0 0 1.1.2h.1a1 1 0 0 0 .6-.9V4a2 2 0 0 1 4 0v.1a1 1 0 0 0 .6.9 1 1 0 0 0 1.1-.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1 1 0 0 0-.2 1.1v.1a1 1 0 0 0 .9.6H20a2 2 0 0 1 0 4h-.1a1 1 0 0 0-.9.6z"/></svg>,
  refresh: <svg viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/></svg>,
  plus: <svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>,
  send: <svg viewBox="0 0 24 24"><path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/></svg>,
  check: <svg viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5"/></svg>,
  upload: <svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M17 8l-5-5-5 5"/><path d="M12 3v12"/></svg>,
  download: <svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/></svg>,
  spark: <svg viewBox="0 0 24 24"><path d="M12 3l1.8 4.8L18.6 9l-4.2 2.5L13 16l-1-4.5L7.8 9l4.4-1.2L12 3z"/></svg>,
  mail: <svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg>,
  reply: <svg viewBox="0 0 24 24"><path d="M9 17l-5-5 5-5"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></svg>,
  inbox: <svg viewBox="0 0 24 24"><path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5 4h14l3 8v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6l3-8z"/></svg>,
  users: <svg viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>,
  shield: <svg viewBox="0 0 24 24"><path d="M12 3l8 4v5c0 5-3.5 8.5-8 9-4.5-.5-8-4-8-9V7l8-4z"/></svg>,
  arrow: <svg viewBox="0 0 24 24"><path d="M5 12h14"/><path d="M13 5l7 7-7 7"/></svg>,
  x: <svg viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12"/></svg>,
  logout: <svg viewBox="0 0 24 24"><path d="M10 17l5-5-5-5"/><path d="M15 12H3"/><path d="M13 3h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-6"/></svg>,
  file: <svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>,
};

function Icon({ name }) { return <span className="nav-icon" aria-hidden="true">{icons[name]}</span>; }

async function api(path, options = {}) {
  const response = await fetch(`/api${path}`, { credentials: "include", ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.detail || `Request failed (${response.status})`);
  return data;
}

function formatDate(value) {
  if (!value) return "—";
  return new Date(value).toLocaleString(undefined, {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

function Badge({ children }) {
  return <span className={`badge badge-${String(children).toLowerCase().replaceAll("_", "-")}`}>{children}</span>;
}

const authModes = [
  { id: "login", label: "Sign in" },
  { id: "register", label: "Register" },
  { id: "reset", label: "Reset" },
];

function Auth({ onAuthenticated, initialMode = "login", initialToken = "" }) {
  const [mode, setMode] = useState(initialMode);
  const [form, setForm] = useState({ name: "", email: "", password: "", token: initialToken });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const setField = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));
  const jsonPost = (path, body) => api(path, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true); setError(""); setMessage("");
    try {
      if (mode === "register") {
        const result = await jsonPost("/auth/register", { name: form.name, email: form.email, password: form.password });
        if (result.dev_verification_token) sessionStorage.setItem("jr_verification_token", result.dev_verification_token);
        setMode("login");
        setMessage(result.dev_verification_token
          ? `Account created. Sign in, then verify with token ${result.dev_verification_token}.`
          : "Account created. Sign in to continue verification.");
      } else if (mode === "login") {
        onAuthenticated(await jsonPost("/auth/login", { email: form.email, password: form.password }));
      } else if (mode === "reset") {
        const result = await jsonPost("/auth/reset-request", { email: form.email });
        setForm((current) => ({ ...current, token: result.dev_reset_token || "" }));
        setMode("reset-confirm");
        setMessage(result.dev_reset_token ? `Your password reset token is ${result.dev_reset_token}` : result.message);
      } else {
        const result = await jsonPost("/auth/reset-confirm", { token: form.token, password: form.password });
        setMode("login"); setMessage(result.message);
      }
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="auth-shell">
      <form className="auth-card" onSubmit={submit}>
        <div className="brand-mark auth-mark">JR</div>
        <h1 className="auth-title">Welcome to JobReach AI</h1>
        <p className="auth-subtitle">Create a student account, verify your email, and start matching real openings.</p>
        <div className="auth-tabs">
          {authModes.map((item) => (
            <button key={item.id} type="button" className={`auth-tab ${mode === item.id || (item.id === "reset" && mode === "reset-confirm") ? "active" : ""}`} onClick={() => { setMode(item.id); setError(""); setMessage(""); }}>
              {item.label}
            </button>
          ))}
        </div>
        {message && <div className="auth-message">{message}</div>}
        {error && <div className="alert alert-error" role="alert"><span>!</span><p>{error}</p></div>}
        {mode === "register" && (
          <>
            <label className="field-label">Full name</label>
            <input value={form.name} onChange={setField("name")} autoComplete="name" required />
          </>
        )}
        {(mode === "login" || mode === "register" || mode === "reset") && (
          <>
            <label className="field-label">Email</label>
            <input type="email" value={form.email} onChange={setField("email")} autoComplete="email" required />
          </>
        )}
        {(mode === "login" || mode === "register" || mode === "reset-confirm") && (
          <>
            <label className="field-label">{mode === "reset-confirm" ? "New password" : "Password"}</label>
            <input type="password" value={form.password} onChange={setField("password")} autoComplete={mode === "login" ? "current-password" : "new-password"} minLength={8} required />
          </>
        )}
        {mode === "reset-confirm" && (
          <>
            <label className="field-label">Reset token</label>
            <input value={form.token} onChange={setField("token")} required />
          </>
        )}
        <button className="button button-primary full-button auth-submit" disabled={busy} type="submit">
          {busy ? <><span className="spinner" /> Working…</> : mode === "login" ? "Sign in" : mode === "register" ? "Create account" : mode === "reset" ? "Send reset link" : "Set new password"}
        </button>
        {mode === "login" && <button className="button button-ghost full-button" type="button" onClick={() => { setMode("reset"); setError(""); setMessage(""); }}>Forgot password?</button>}
        <p className="auth-footnote">Local workspace · Your data stays on this device</p>
      </form>
    </div>
  );
}

function VerificationPanel({ user, initialToken = "", onVerified }) {
  const [token, setToken] = useState(initialToken || sessionStorage.getItem("jr_verification_token") || "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const post = (path, body) => api(path, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });

  const verify = async (event) => {
    event.preventDefault();
    setBusy(true); setError(""); setMessage("");
    try {
      await post("/auth/verify-email", { token });
      sessionStorage.removeItem("jr_verification_token");
      onVerified(await api("/auth/me"));
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  const resend = async () => {
    setBusy(true); setError(""); setMessage("");
    try {
      const result = await post("/auth/resend-verification", { email: user.email });
      if (result.dev_verification_token) {
        setToken(result.dev_verification_token);
        sessionStorage.setItem("jr_verification_token", result.dev_verification_token);
        setMessage(`New verification token: ${result.dev_verification_token}`);
      } else setMessage(result.message);
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="auth-shell">
      <form className="auth-card" onSubmit={verify}>
        <div className="brand-mark auth-mark">JR</div>
        <h1 className="auth-title">Verify your email</h1>
        <p className="auth-subtitle">Signed in as <strong>{user.email}</strong>. Verify your student email to unlock the workspace.</p>
        {message && <div className="auth-message">{message}</div>}
        {error && <div className="alert alert-error" role="alert"><span>!</span><p>{error}</p></div>}
        <label className="field-label">Verification token</label>
        <input value={token} onChange={(event) => setToken(event.target.value)} required />
        <button className="button button-primary full-button auth-submit" disabled={busy} type="submit">
          {busy ? <><span className="spinner" /> Working…</> : "Verify email"}
        </button>
        <button className="button button-ghost full-button" type="button" disabled={busy} onClick={resend}>Resend verification link</button>
        <button className="button button-ghost full-button" type="button" onClick={async () => { await api("/auth/logout", { method: "POST" }); onVerified(null); }}>Sign out</button>
      </form>
    </div>
  );
}

const onboardingFields = ["full_name", "phone", "location", "linkedin", "github", "summary", "skills", "target_roles"];

function Onboarding({ onCompleted }) {
  const [form, setForm] = useState({
    full_name: "", phone: "", location: "", linkedin: "", github: "",
    summary: "", skills: "", target_roles: "",
  });
  const [resume, setResume] = useState(null);
  const [resumeName, setResumeName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api("/profile").then((data) => {
      setForm(Object.fromEntries(onboardingFields.map((field) => [field, data[field] || ""])));
      if (data.resume_name) setResumeName(data.resume_name);
    }).catch(() => {});
  }, []);

  const setField = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));
  const jsonBody = () => ({
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form),
  });
  const profileReady = Boolean(form.full_name.trim() && form.summary.trim() && form.skills.trim() && form.target_roles.trim());

  const saveProfile = async () => {
    setBusy(true); setError("");
    try {
      const result = await api("/profile", jsonBody());
      if (result.onboarding?.completed) onCompleted(await api("/auth/me"));
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  const uploadResume = async () => {
    if (!resume) return;
    setBusy(true); setError("");
    try {
      const body = new FormData();
      body.append("file", resume);
      const result = await api("/profile/resume", { method: "POST", body });
      setResumeName(result.resume_name);
      if (result.onboarding?.completed) onCompleted(await api("/auth/me"));
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  const finish = async () => {
    setBusy(true); setError("");
    try {
      const result = await api("/onboarding/complete", { method: "POST" });
      onCompleted(result.user);
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  return (
    <form className="panel onboarding-card" onSubmit={(event) => event.preventDefault()}>
      <div className="panel-header"><div><h2 className="section-heading">Profile setup</h2><p className="panel-subtitle">Saved privately to your account; editable any time in Settings</p></div></div>
        {error && <div className="alert alert-error" role="alert"><span>!</span><p>{error}</p></div>}
        <div className="onboarding-grid">
          <label className="field-label">Full name<input value={form.full_name} onChange={setField("full_name")} required /></label>
          <label className="field-label">Phone<input value={form.phone} onChange={setField("phone")} /></label>
          <label className="field-label">Location<input value={form.location} onChange={setField("location")} /></label>
          <label className="field-label">LinkedIn<input value={form.linkedin} onChange={setField("linkedin")} /></label>
          <label className="field-label">GitHub<input value={form.github} onChange={setField("github")} /></label>
          <label className="field-label">Target roles<input value={form.target_roles} onChange={setField("target_roles")} placeholder="Web Developer, Django Developer" required /></label>
          <label className="field-label field-full">Profile summary<textarea rows="3" value={form.summary} onChange={setField("summary")} placeholder="Short introduction used in AI drafts" required /></label>
          <label className="field-label field-full">Skills<input value={form.skills} onChange={setField("skills")} placeholder="Django, React, Full-Stack Development" required /></label>
        </div>
        <label className="field-label">Resume (PDF)<input type="file" accept=".pdf,application/pdf" onChange={(event) => setResume(event.target.files?.[0] || null)} /></label>
        {resumeName && <div className="auth-message">{resumeName} uploaded.</div>}
        <div className="button-row">
          <button className="button button-secondary" disabled={busy || !profileReady} type="button" onClick={saveProfile}>Save profile</button>
          <button className="button button-secondary" disabled={busy || !resume} type="button" onClick={uploadResume}>Upload resume</button>
        </div>
      <button className="button button-primary full-button auth-submit" disabled={busy || !profileReady || !resumeName} type="button" onClick={finish}>
        {busy ? <><span className="spinner" /> Working…</> : "Finish setup"}
      </button>
    </form>
  );
}

function App() {
  const query = new URLSearchParams(window.location.search);
  const gmailNotice = query.get("gmail");
  const unlockNotice = query.get("unlock");
  const [page, setPage] = useState(gmailNotice ? "settings" : unlockNotice ? "unlock" : "overview");
  const [dashboard, setDashboard] = useState(null);
  const [contacts, setContacts] = useState([]);
  const [drafts, setDrafts] = useState([]);
  const [followups, setFollowups] = useState([]);
  const [settings, setSettings] = useState(null);
  const [billing, setBilling] = useState(null);
  const [hrDatabase, setHrDatabase] = useState(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const [error, setError] = useState("");
  const [user, setUser] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const authStart = {
    mode: query.get("reset") ? "reset-confirm" : "login",
    token: query.get("verify") || query.get("reset") || "",
  };

  useEffect(() => {
    api("/auth/me")
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setAuthReady(true));
  }, []);

  useEffect(() => {
    if (gmailNotice === "connected") setNotice("Gmail connected for your account.");
    if (gmailNotice === "error") setNotice(query.get("detail") || "Gmail connection failed. Please try again.");
    if (gmailNotice) window.history.replaceState({}, document.title, window.location.pathname);
  }, []);
  useEffect(() => {
    if (unlockNotice === "success") setNotice("Payment received. Your unlock will activate when Stripe confirms it.");
    if (unlockNotice === "cancel") setNotice("Checkout cancelled. You can unlock any time.");
    if (unlockNotice) window.history.replaceState({}, document.title, window.location.pathname);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [overview, contactRows, draftRows, followupRows, config, billingStatus, database] = await Promise.all([
        api("/dashboard"), api("/contacts"), api("/drafts"), api("/followups"), api("/settings"),
        api("/billing/entitlement"), api("/hr-database"),
      ]);
      setDashboard(overview);
      setContacts(contactRows);
      setDrafts(draftRows);
      setFollowups(followupRows);
      setSettings(config);
      setBilling(billingStatus);
      setHrDatabase(database);
      setError("");
    } catch (e) { setError(e.message); }
  }, []);

  useEffect(() => { if (user) refresh(); }, [user, refresh]);

  useEffect(() => {
    if (user?.is_verified && !user.onboarding_completed) setPage("settings");
  }, [user]);

  const signOut = async () => {
    try { await api("/auth/logout", { method: "POST" }); } catch { /* ignore */ }
    setUser(null); setDashboard(null); setContacts([]); setDrafts([]); setFollowups([]); setSettings(null); setBilling(null); setHrDatabase(null);
  };

  if (!authReady) return <div className="auth-loading">Loading JobReach AI…</div>;
  if (!user) {
    return (
      <Auth
        initialMode={authStart.mode}
        initialToken={authStart.token}
        onAuthenticated={(next) => {
          window.history.replaceState({}, document.title, window.location.pathname);
          setUser(next);
        }}
      />
    );
  }
  if (!user.is_verified) {
    return (
      <VerificationPanel
        user={user}
        initialToken={authStart.token}
        onVerified={(next) => {
          window.history.replaceState({}, document.title, window.location.pathname);
          setUser(next);
        }}
      />
    );
  }
  const run = async (operation, successMessage, thenRefresh = true) => {
    setBusy(true); setError(""); setNotice(null);
    try {
      const result = await operation();
      if (thenRefresh) await refresh();
      setNotice(typeof successMessage === "function" ? successMessage(result) : successMessage);
      return result;
    } catch (e) { setError(e.message); return null; }
    finally { setBusy(false); }
  };

  const draftCount = drafts.filter((d) => d.status === "APPROVED").length;
  const selectedPage = navigation.find((i) => i.id === page);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">JR</div>
          <div className="brand-text">
            <div className="brand-name">jobreach<span>.ai</span></div>
            <div className="brand-subtitle">Personal Outreach CRM</div>
          </div>
        </div>
        <div className="nav-label">Workspace</div>
        <nav className="sidebar-nav" aria-label="Main navigation">
          {navigation.map((item) => (
            <button key={item.id} className={`nav-item ${page === item.id ? "active" : ""}`} onClick={() => setPage(item.id)} aria-label={item.label} title={item.label}>
              <Icon name={item.icon} />
              <span>{item.label}</span>
              {item.id === "campaign" && draftCount > 0 && <span className="nav-count">{draftCount}</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className={`safe-card ${settings?.dry_run ? "" : "safe-card-live"}`}>
            <div className="safe-heading"><span className="status-dot" />{settings?.dry_run ? "Safe mode on" : "Live sending"}</div>
            <p>{settings?.dry_run ? "Emails are preview-only. Nothing can be sent." : "Sending is enabled. Every send requires your approval."}</p>
          </div>
          <div className="user-chip">
            <div className="avatar">{user.name?.charAt(0) || "J"}</div>
            <div className="user-meta">
              <strong>{user.name}</strong>
              <small>{user.email}</small>
            </div>
          </div>
        </div>
      </aside>

      <main className="main-panel">
        <header className="topbar">
          <div className="breadcrumbs"><span>Workspace</span><b>/</b><strong>{selectedPage?.label}</strong></div>
          <div className="top-actions">
            <span className="local-indicator"><i /> <span>Local workspace</span></span>
            <button className="icon-button" title="Sign out" aria-label="Sign out" onClick={signOut}><Icon name="logout" /></button>
            <button className="icon-button" title="Refresh data" aria-label="Refresh data" onClick={refresh}><Icon name="refresh" /></button>
          </div>
        </header>
        <div className="content">
          {error && <div className="alert alert-error" role="alert"><span>!</span><p>{error}</p><button onClick={() => setError("")} aria-label="Dismiss"><Icon name="x" /></button></div>}
          {notice && <div className="alert alert-success" role="status"><span>✓</span><p>{notice}</p><button onClick={() => setNotice(null)} aria-label="Dismiss"><Icon name="x" /></button></div>}
          {page === "overview" && <Overview dashboard={dashboard} onNavigate={setPage} />}
          {page === "companies" && <Companies contacts={contacts} settings={settings} busy={busy} run={run} onNavigate={setPage} />}
          {page === "studio" && <Studio contacts={contacts} busy={busy} run={run} />}
          {page === "jobs" && <JobMatch contacts={contacts} busy={busy} run={run} onNavigate={setPage} />}
          {page === "campaign" && <Campaign drafts={drafts} settings={settings} busy={busy} run={run} />}
          {page === "followups" && <FollowUps items={followups} busy={busy} run={run} />}
          {page === "unlock" && <UnlockPage database={hrDatabase} billing={billing} settings={settings} busy={busy} run={run} />}
          {page === "settings" && <SettingsPage settings={settings} busy={busy} run={run} onUserUpdate={setUser} onNavigate={setPage} />}
        </div>
        <footer className="footer"><span>JobReach AI</span><span>Private by design · Your data stays on this device</span></footer>
      </main>
    </div>
  );
}

function PageHeading({ eyebrow, title, description, action }) {
  return (
    <div className="page-heading">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1 className="page-title">{title}</h1>
        <p className="page-description">{description}</p>
      </div>
      {action}
    </div>
  );
}

function Overview({ dashboard, onNavigate }) {
  const stats = dashboard?.stats;
  const metrics = [
    { label: "Total contacts", value: stats?.contacts ?? "—", icon: "users", tone: "tone-mint", note: "In your outreach list" },
    { label: "Emails accepted", value: stats?.sent ?? "—", icon: "send", tone: "tone-blue", note: "Accepted by Gmail" },
    { label: "Replies marked", value: stats?.replies ?? "—", icon: "reply", tone: "tone-yellow", note: "Matched or marked by you" },
    { label: "Pending contacts", value: stats?.pending ?? "—", icon: "inbox", tone: "tone-purple", note: "Ready for a first draft" },
  ];
  return (
    <>
      <PageHeading
        eyebrow="Your outreach, at a glance"
        title="Overview"
        description="A clear view of your job-search conversations and next steps."
        action={<button className="button button-primary" onClick={() => onNavigate("companies")}><Icon name="plus" /> Add contacts</button>}
      />
      <div className="metric-grid">
        {metrics.map((m) => (
          <div className="panel metric-card" key={m.label}>
            <div className="metric-top"><div className={`metric-icon ${m.tone}`}><Icon name={m.icon} /></div></div>
            <div className="metric-label">{m.label}</div>
            <div className="metric-value">{m.value}</div>
            <div className="metric-note">{m.note}</div>
          </div>
        ))}
      </div>
      <div className="overview-grid">
        <section className="panel">
          <div className="panel-header">
            <div><h2 className="section-heading">Recent contacts</h2><p className="panel-subtitle">Your latest companies and hiring contacts</p></div>
            <button className="button button-ghost" onClick={() => onNavigate("companies")}>View all <Icon name="arrow" /></button>
          </div>
          <ContactTable contacts={dashboard?.recent_contacts || []} compact />
          {dashboard && dashboard.recent_contacts.length === 0 && <EmptyState title="Your pipeline starts here" detail="Import a small, relevant contact list to get started." action={<button className="button button-secondary" onClick={() => onNavigate("companies")}>Import contacts</button>} />}
        </section>
        <aside className="right-column">
          <section className="panel">
            <div className="panel-header"><div><h2 className="section-heading">Daily guardrails</h2><p className="panel-subtitle">Responsible, one-at-a-time outreach</p></div><div className="metric-icon tone-mint"><Icon name="shield" /></div></div>
            <div className="cap-number"><strong>{dashboard?.sent_today ?? "—"}</strong><span>/ {dashboard?.daily_cap ?? "—"} emails today</span></div>
            <div className="progress-track"><div style={{ width: `${Math.min(100, (dashboard?.sent_today || 0) / (dashboard?.daily_cap || 1) * 100)}%` }} /></div>
            <div className="guardrail-list">
              <div><Icon name="check" /> Approved draft required before sending</div>
              <div><Icon name="check" /> Human confirmation required for every send</div>
            </div>
            <p className="fine-print">Gmail acceptance doesn't guarantee inbox delivery. Always check for bounces and replies.</p>
          </section>
          <section className="panel">
            <div className="panel-header"><div><h2 className="section-heading">Pipeline snapshot</h2><p className="panel-subtitle">Keep your outreach moving</p></div></div>
            <div className="snapshot-row"><span><i className="snapshot-dot dot-green" />Approved drafts</span><b>{stats?.approved ?? "—"}</b></div>
            <div className="snapshot-row"><span><i className="snapshot-dot dot-red" />Failed attempts</span><b>{stats?.failed ?? "—"}</b></div>
            <div className="snapshot-row"><span><i className="snapshot-dot dot-gray" />Opted out</span><b>{stats?.opted_out ?? "—"}</b></div>
            <button className="button button-secondary full-button" style={{ marginTop: 8 }} onClick={() => onNavigate("campaign")}>Review campaign <Icon name="arrow" /></button>
          </section>
        </aside>
      </div>
    </>
  );
}

function ContactTable({ contacts, compact = false }) {
  if (!contacts.length) return <div className="table-empty">No contacts to show yet.</div>;
  return (
    <div className={`table-wrap ${compact ? "compact-table" : ""}`}>
      <table>
        <thead><tr><th>Company</th><th>Contact</th><th>Role</th><th>Status</th></tr></thead>
        <tbody>
          {contacts.slice(0, compact ? 7 : undefined).map((c) => (
            <tr key={c.id}>
              <td><div className="table-primary">{c.company_name}</div>{!compact && <span className="table-secondary">#{c.id}</span>}</td>
              <td>{c.email}</td>
              <td>{c.role || "—"}</td>
              <td><Badge>{c.status}</Badge></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function UnlockPage({ database, billing, settings, busy, run }) {
  const [filters, setFilters] = useState({ query: "", company: "", role: "", verified: "all" });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [result, setResult] = useState(database);
  useEffect(() => { setResult(database); setPage(1); }, [database]);
  const unlocked = Boolean(result?.unlocked || settings?.hr_database_unlocked || billing?.unlocked);
  const total = result?.total ?? database?.total ?? settings?.hr_database_count ?? 0;
  const verifiedTotal = result?.verified_total ?? settings?.hr_database_verified_count ?? total;
  const filteredTotal = result?.filtered_total ?? 0;
  const pageCount = result?.page_count ?? 0;
  const rows = result?.rows || [];
  const amount = billing?.amount_total ?? settings?.unlock_amount ?? 0;
  const currency = billing?.currency || settings?.unlock_currency || "INR";
  const price = `${currency} ${(amount / 100).toFixed(amount % 100 ? 2 : 0)}`;

  const buildParams = (nextPage, nextFilters, nextSize) => {
    const params = new URLSearchParams({ page: String(nextPage), page_size: String(nextSize) });
    if (nextFilters.query.trim()) params.set("query", nextFilters.query.trim());
    if (nextFilters.company.trim()) params.set("company", nextFilters.company.trim());
    if (nextFilters.role.trim()) params.set("role", nextFilters.role.trim());
    if (nextFilters.verified !== "all") params.set("verified", nextFilters.verified === "verified" ? "true" : "false");
    return params.toString();
  };
  const load = async (nextPage, nextFilters, nextSize) => {
    const response = await api(`/hr-database?${buildParams(nextPage, nextFilters, nextSize)}`);
    setResult(response);
    setPage(nextPage);
    return response;
  };
  const updateFilter = (key, value) => setFilters((current) => ({ ...current, [key]: value }));
  const applyFilters = () => run(() => load(1, filters, pageSize), null, false);
  const resetFilters = () => {
    const cleared = { query: "", company: "", role: "", verified: "all" };
    setFilters(cleared);
    run(() => load(1, cleared, pageSize), null, false);
  };
  const changePageSize = (value) => {
    const size = Number(value);
    setPageSize(size);
    run(() => load(1, filters, size), null, false);
  };
  const checkout = async () => {
    const response = await run(() => api("/billing/checkout", { method: "POST" }), "Opening Stripe checkout…", false);
    if (response?.url) window.location.assign(response.url);
  };
  const importContacts = (limit) => run(
    () => api("/hr-database/import", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: filters.query.trim(), company: filters.company.trim(), role: filters.role.trim(),
        verified: filters.verified === "all" ? null : filters.verified === "verified", limit,
      }),
    }),
    (response) => `Imported ${response.added} contacts; skipped ${response.skipped}.`,
  );

  return (
    <>
      <PageHeading eyebrow="One-time unlock" title="Unlock the HR database" description="Pay once to search and import the curated HR contact database into your private workspace." />
      <div className="settings-grid">
        <section className="panel">
          <div className="panel-header"><div><h2 className="section-heading">Bundled contact database</h2><p className="panel-subtitle">Lifetime access after a single Stripe payment</p></div><span className="panel-number">01</span></div>
          <div className="metric-grid">
            <div className="metric-card"><span>Total contacts</span><strong>{total.toLocaleString()}</strong></div>
            <div className="metric-card"><span>Verified</span><strong>{verifiedTotal.toLocaleString()}</strong></div>
            <div className="metric-card"><span>Your access</span><strong>{unlocked ? "Unlocked" : "Locked"}</strong></div>
          </div>
          {!unlocked && (
            <>
              <div className="locked-banner"><Icon name="shield" /><span>Preview only. Search, filters, emails, and pagination unlock after payment.</span></div>
              <button className="button button-primary full-button" style={{ marginTop: 10 }} disabled={busy} onClick={checkout}>Unlock for {price}</button>
            </>
          )}
          {unlocked && (
            <>
              <div className="auth-message">Unlocked. Search below or import contacts into your pipeline.</div>
              <div className="button-row" style={{ marginTop: 8 }}>
                <button className="button button-secondary" disabled={busy} onClick={() => importContacts(100)}>Import 100</button>
                <button className="button button-secondary" disabled={busy} onClick={() => importContacts(500)}>Import 500</button>
              </div>
            </>
          )}
          {billing?.order?.status && <div className="field-note"><strong>Latest payment:</strong> {billing.order.status}</div>}
        </section>
        <section className="panel">
          <div className="panel-header"><div><h2 className="section-heading">Search database</h2><p className="panel-subtitle">{unlocked ? "Filter by company, role, and verification status" : "Full search and emails unlock after payment"}</p></div><span className="panel-number">02</span></div>
          {unlocked ? (
            <>
              <div className="database-filters">
                <div><label className="field-label">Search all fields</label><input type="text" value={filters.query} onChange={(event) => updateFilter("query", event.target.value)} placeholder="Company, email, contact, or role" /></div>
                <div><label className="field-label">Company</label><input type="text" value={filters.company} onChange={(event) => updateFilter("company", event.target.value)} placeholder="Company name" /></div>
                <div><label className="field-label">Role</label><input type="text" value={filters.role} onChange={(event) => updateFilter("role", event.target.value)} placeholder="Designation" /></div>
                <div><label className="field-label">Verification</label><select value={filters.verified} onChange={(event) => updateFilter("verified", event.target.value)}><option value="all">All contacts</option><option value="verified">Verified only</option><option value="unverified">Unverified only</option></select></div>
              </div>
              <div className="button-row" style={{ marginTop: 8 }}>
                <button className="button button-secondary" disabled={busy} onClick={resetFilters}>Reset</button>
                <button className="button button-primary" disabled={busy} onClick={applyFilters}>Apply filters</button>
              </div>
              <div className="table-wrap" style={{ marginTop: 10 }}>
                <table>
                  <thead><tr><th>Company</th><th>Contact</th><th>Role</th><th>Status</th></tr></thead>
                  <tbody>
                    {rows.map((item, index) => (
                      <tr key={`${item.email}-${index}`}>
                        <td><div className="table-primary">{item.company_name}</div></td>
                        <td>{item.email}</td>
                        <td>{item.role || "—"}</td>
                        <td><Badge>{item.verified ? "Verified" : "Unverified"}</Badge></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {rows.length === 0 && <div className="table-empty">No contacts match these filters.</div>}
              <div className="pagination-row">
                <span>Showing {filteredTotal ? (page - 1) * pageSize + 1 : 0}–{Math.min(page * pageSize, filteredTotal)} of {filteredTotal.toLocaleString()} filtered ({total.toLocaleString()} total)</span>
                <div className="pagination-controls">
                  <select className="page-size-select" value={pageSize} onChange={(event) => changePageSize(event.target.value)}>
                    {[25, 50, 100].map((size) => <option key={size} value={size}>{size} / page</option>)}
                  </select>
                  <button className="button button-secondary" disabled={busy || page <= 1} onClick={() => run(() => load(page - 1, filters, pageSize), null, false)}>Previous</button>
                  <span>Page {page} / {Math.max(1, pageCount)}</span>
                  <button className="button button-secondary" disabled={busy || page >= pageCount} onClick={() => run(() => load(page + 1, filters, pageSize), null, false)}>Next</button>
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="locked-banner"><Icon name="shield" /><span>Database locked — preview only. Complete payment to view emails, filters, and paginated results.</span></div>
              <div className="table-wrap" style={{ marginTop: 10 }}>
                <table>
                  <thead><tr><th>Company</th><th>Role</th><th>Status</th></tr></thead>
                  <tbody>
                    {(result?.preview || []).map((item, index) => (
                      <tr key={`${item.company_name}-${index}`}>
                        <td><div className="table-primary">{item.company_name}</div></td>
                        <td>{item.role || "—"}</td>
                        <td><Badge>{item.verified ? "Verified" : "Unverified"}</Badge></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      </div>
    </>
  );
}

function Companies({ contacts, settings, busy, run, onNavigate }) {
  const [filter, setFilter] = useState("All");
  const [file, setFile] = useState(null);
  const [selected, setSelected] = useState("");
  const [newStatus, setNewStatus] = useState("PENDING");
  const filtered = useMemo(() => filter === "All" ? contacts : contacts.filter((c) => c.status === filter), [contacts, filter]);
  const selectedContact = contacts.find((c) => String(c.id) === selected);
  const importFile = () => {
    if (!file) return;
    const form = new FormData();
    form.append("file", file);
    run(() => api("/contacts/import", { method: "POST", body: form }), (r) => `Imported ${r.added}; skipped ${r.skipped}.${r.errors.length ? ` ${r.errors.join(" · ")}` : ""}`);
  };
  return (
    <>
      <PageHeading
        eyebrow="Your contact database"
        title="Companies & contacts"
        description="Keep your outreach list organized, relevant, and easy to review."
        action={!settings?.hr_database_unlocked && <button className="button button-secondary" onClick={() => onNavigate("unlock")}>Unlock HR database</button>}
      />
      <div className="split-grid">
        <section className="panel">
          <div className="panel-header"><div><h2 className="section-heading">Import companies</h2><p className="panel-subtitle">Bring in a CSV or Excel contact list</p></div><span className="panel-number">01</span></div>
          <div className="import-drop">
            <div className="upload-icon"><Icon name="upload" /></div>
            <strong>{file ? file.name : "Choose a contact file"}</strong>
            <span>CSV or XLSX · up to 10 MB</span>
            <label className="button button-secondary file-button">Browse files<input type="file" accept=".csv,.xlsx" onChange={(e) => setFile(e.target.files?.[0] || null)} /></label>
          </div>
          <button className="button button-primary full-button" style={{ marginTop: 8 }} disabled={!file || busy} onClick={importFile}>{busy ? "Importing…" : "Import contacts"}</button>
          <a className="download-link" href="/api/companies/template" download><Icon name="download" /> Download import template</a>
          <div className="field-note"><strong>Required:</strong> company_name, email <span>Optional: hr_name, role, company_context, job_url, source_url, location, notes</span></div>
        </section>
        <section className="panel">
          <div className="panel-header"><div><h2 className="section-heading">Update a contact</h2><p className="panel-subtitle">Record a reply, opt-out, or next step</p></div><span className="panel-number">02</span></div>
          <label className="field-label">Contact</label>
          <select value={selected} onChange={(e) => setSelected(e.target.value)}>
            <option value="">Choose a contact…</option>
            {contacts.map((c) => <option key={c.id} value={c.id}>{c.company_name} — {c.email}</option>)}
          </select>
          <label className="field-label">New status</label>
          <select value={newStatus} onChange={(e) => setNewStatus(e.target.value)}>
            {["PENDING", "REPLIED", "NOT_INTERESTED", "OPTED_OUT", "ARCHIVED"].map((s) => <option key={s}>{s}</option>)}
          </select>
          <button className="button button-secondary full-button" style={{ marginTop: 8 }} disabled={!selectedContact || busy} onClick={() => run(() => api(`/contacts/${selected}/status`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: newStatus }) }), "Contact status updated.")}>Save contact status</button>
          <p className="field-note">Opt-outs are permanent for sending. Respect every request to stop contact.</p>
        </section>
      </div>
      <section className="panel list-panel">
        <div className="panel-header">
          <div><h2 className="section-heading">Contact list <span className="inline-count">{filtered.length}</span></h2><p className="panel-subtitle">Review and filter your full outreach pipeline</p></div>
          <select className="filter-select" value={filter} onChange={(e) => setFilter(e.target.value)}><option>All</option>{statuses.map((s) => <option key={s}>{s}</option>)}</select>
        </div>
        <ContactTable contacts={filtered} />
        {filtered.length === 0 && <EmptyState title="No contacts match this filter" detail="Try another status or import contacts above." />}
      </section>
    </>
  );
}

function Studio({ contacts, busy, run }) {
  const eligible = contacts.filter((c) => !c.opted_out && !["SENT", "REPLIED", "OPTED_OUT", "ARCHIVED"].includes(c.status));
  const [contactId, setContactId] = useState("");
  const [context, setContext] = useState("");
  const [generated, setGenerated] = useState(null);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const activeContact = eligible.find((c) => String(c.id) === contactId);

  useEffect(() => {
    if (eligible.length && !eligible.some((c) => String(c.id) === contactId)) setContactId(String(eligible[0].id));
    if (!eligible.length) setContactId("");
  }, [contacts, eligible.length, contactId]);
  useEffect(() => { setContext(activeContact?.company_context || ""); setGenerated(null); }, [contactId]);

  const generate = async () => {
    if (!activeContact) return;
    const result = await run(() => api(`/contacts/${contactId}/generate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ company_context: context }) }), "Draft generated. Review every claim before saving.", false);
    if (result) { setGenerated(result); setSubject(result.subject); setBody(result.body); }
  };

  return (
    <>
      <PageHeading eyebrow="Personalized, never automatic" title="AI Email Studio" description="Generate a starting point from your profile and the facts you provide." />
      {!eligible.length ? <div className="panel"><EmptyState title="No eligible contacts" detail="Import contacts or choose a contact that hasn't been sent to, opted out, or archived." /></div> : (
        <div className="studio-grid">
          <section className="panel">
            <div className="panel-header"><div><h2 className="section-heading">Draft settings</h2><p className="panel-subtitle">Keep it grounded in verified information</p></div><span className="panel-number">01</span></div>
            <label className="field-label">Company contact</label>
            <select value={contactId} onChange={(e) => setContactId(e.target.value)}>
              {eligible.map((c) => <option key={c.id} value={c.id}>{c.company_name} · {c.role || "Contact"} · {c.email}</option>)}
            </select>
            <div className="contact-summary">
              <div className="avatar">{activeContact?.company_name?.charAt(0) || "C"}</div>
              <div><strong>{activeContact?.company_name}</strong><span>{activeContact?.email}</span></div>
              {activeContact && <Badge>{activeContact.status}</Badge>}
            </div>
            <label className="field-label" htmlFor="verified-context">Verified company context</label>
            <textarea id="verified-context" className="context-area" placeholder="Paste verified details from a job post or company site. Leave blank if you have none." value={context} onChange={(e) => setContext(e.target.value)} />
            <p className="field-note">Only include facts you personally verified. AI won't research the company.</p>
            <button className="button button-primary full-button" style={{ marginTop: 8 }} disabled={busy || !activeContact} onClick={generate}>
              {busy ? <><span className="spinner" /> Generating…</> : <><Icon name="spark" /> Generate personalized draft</>}
            </button>
          </section>
          <section className="panel">
            <div className="panel-header"><div><h2 className="section-heading">Review your draft</h2><p className="panel-subtitle">Edit the message before saving it for approval</p></div><span className="panel-number">02</span></div>
            {generated ? (
              <div className="draft-editor">
                <label className="field-label" htmlFor="draft-subject">Subject</label>
                <input id="draft-subject" value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={500} />
                <label className="field-label" htmlFor="draft-body">Email body</label>
                <textarea id="draft-body" value={body} onChange={(e) => setBody(e.target.value)} />
                <div className="editor-bottom">
                  <span>Generated text is a draft. Verify company-specific claims.</span>
                  <button className="button button-primary" disabled={busy || !subject.trim() || !body.trim()} onClick={() => run(() => api(`/contacts/${contactId}/drafts`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subject, body }) }), "Draft saved. Review and approve it in Campaign & Send.")}>Save for review <Icon name="arrow" /></button>
                </div>
              </div>
            ) : <EmptyState title="Your draft will appear here" detail="Choose a contact, add verified context, then generate an editable message." />}
          </section>
        </div>
      )}
    </>
  );
}

function JobMatch({ contacts, busy, run, onNavigate }) {
  const eligible = useMemo(
    () => contacts.filter((c) => !c.opted_out && !["SENT", "REPLIED", "OPTED_OUT", "NOT_INTERESTED", "ARCHIVED"].includes(c.status)),
    [contacts],
  );
  const [contactId, setContactId] = useState("");
  const [website, setWebsite] = useState("");
  const [jobs, setJobs] = useState([]);
  const [warnings, setWarnings] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [match, setMatch] = useState(null);
  const [draft, setDraft] = useState(null);
  const [savedId, setSavedId] = useState(null);
  const activeContact = eligible.find((c) => String(c.id) === String(contactId)) || eligible[0];

  useEffect(() => {
    if (!contactId && eligible.length) setContactId(String(eligible[0].id));
  }, [eligible, contactId]);

  useEffect(() => {
    if (!activeContact) return;
    setWebsite(activeContact.website || "");
    setSelectedId(""); setMatch(null); setDraft(null); setSavedId(null); setWarnings([]);
    api(`/contacts/${activeContact.id}/jobs`).then(setJobs).catch(() => setJobs([]));
  }, [activeContact?.id]);

  const selected = jobs.find((job) => String(job.id) === String(selectedId));
  let evidence = null;
  if (selected?.evidence) {
    try { evidence = JSON.parse(selected.evidence); } catch { evidence = null; }
  }

  const saveWebsite = () => run(
    () => api(`/contacts/${activeContact.id}/website`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ website }) }),
    "Official website saved.",
  );
  const discover = async () => {
    const result = await run(() => api(`/contacts/${activeContact.id}/jobs/discover`, { method: "POST" }), (r) => `${r.added} verified opening(s) found.`);
    if (result) { setJobs(result.jobs); setWarnings(result.warnings || []); }
  };
  const score = async () => {
    const result = await run(() => api(`/jobs/${selected.id}/match`, { method: "POST" }), "Skill match calculated.");
    if (result) { setMatch(result); setJobs((items) => items.map((item) => (item.id === result.job.id ? result.job : item))); }
  };
  const generate = async () => {
    const result = await run(() => api(`/jobs/${selected.id}/generate`, { method: "POST" }), "Tailored draft generated from the verified listing.");
    if (result) { setDraft({ subject: result.subject, body: result.body }); setSavedId(null); }
  };
  const saveDraft = async () => {
    const result = await run(() => api(`/jobs/${selected.id}/drafts`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draft) }), "Saved. Approve it in Campaign & Send.");
    if (result) setSavedId(result.id);
  };

  return (
    <>
      <PageHeading eyebrow="Verified jobs, tailored outreach" title="Job Match" description="Find current openings on official career sites, check the fit, and write an email grounded in real evidence." />
      {!eligible.length ? <div className="panel"><EmptyState title="No eligible contacts" detail="Import contacts first, then pick a company to research." /></div> : (
        <div className="job-layout">
          <div className="job-left">
            <section className="panel">
              <div className="panel-header"><div><h2 className="section-heading">01 · Identify the company</h2><p className="panel-subtitle">Company and website from your contact list</p></div><span className="panel-number">01</span></div>
              <label className="field-label">Company contact</label>
              <select value={activeContact?.id || ""} onChange={(e) => setContactId(e.target.value)}>
                {eligible.map((c) => <option key={c.id} value={c.id}>{c.company_name} — {c.email}</option>)}
              </select>
              <label className="field-label">Official website</label>
              <div className="website-row">
                <input value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://company.com" />
                <button className="button button-secondary" disabled={busy} onClick={saveWebsite}>Save</button>
              </div>
              <p className="field-note">Derived from the contact email when the sheet has no website. Correct it before searching.</p>
              <button className="button button-primary full-button" style={{ marginTop: 8 }} disabled={busy} onClick={discover}>
                {busy ? <><span className="spinner" /> Searching official sources…</> : <>Discover official openings</>}
              </button>
              {warnings.length > 0 && <div className="job-warnings">{warnings.map((warning) => <span key={warning}>{warning}</span>)}</div>}
            </section>
            <section className="panel">
              <div className="panel-header"><div><h2 className="section-heading">02 · Verified openings <span className="inline-count">{jobs.length}</span></h2><p className="panel-subtitle">Official careers pages and linked ATS boards</p></div></div>
              {!jobs.length ? <EmptyState title="No verified openings yet" detail="Run discovery above. Each result keeps its official source and check time." /> : (
                <div className="job-list">
                  {jobs.map((job) => (
                    <article key={job.id} className={`job-card ${String(job.id) === selectedId ? "job-card-active" : ""} ${job.active ? "" : "job-card-inactive"}`} onClick={() => { setSelectedId(String(job.id)); setMatch(null); setDraft(null); setSavedId(null); }}>
                      <div className="job-card-top"><strong>{job.title}</strong><span className={job.active ? "job-status-active" : "job-status-inactive"}>{job.active ? "Active" : "Inactive"}</span></div>
                      <div className="job-meta">{job.company_name}{job.location ? ` · ${job.location}` : ""} · {job.source}</div>
                      <a className="job-link" href={job.url} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>{job.url}</a>
                    </article>
                  ))}
                </div>
              )}
            </section>
          </div>
          <section className="panel job-detail">
            <div className="panel-header"><div><h2 className="section-heading">03 · Evidence, match & email</h2><p className="panel-subtitle">Nothing is sent without your approval</p></div><span className="panel-number">03</span></div>
            {!selected ? <EmptyState title="Select a verified opening" detail="Choose an opening to see its evidence, compare your skills, and draft an email." /> : (
              <>
                <div className="job-evidence">
                  <div><span>Official source</span><a href={selected.source_url} target="_blank" rel="noreferrer">{selected.source_url}</a></div>
                  <div><span>Verified</span><strong>{formatDate(selected.verified_at)}</strong></div>
                  <div><span>Evidence</span><strong>{evidence?.signal || selected.source}{evidence?.status_code ? ` · HTTP ${evidence.status_code}` : ""}</strong></div>
                  <details><summary>Listing description</summary><p>{selected.description || "No description was published on this page."}</p></details>
                </div>
                <button className="button button-secondary full-button" disabled={busy} onClick={score}>Match my skills</button>
                {match && (
                  <div className="match-block">
                    <div className="match-top"><strong>{match.score}% match</strong><span>based on your configured skills and target roles</span></div>
                    <div className="progress-track"><div style={{ width: `${match.score}%` }} /></div>
                    <div className="skill-tags">{match.matched.map((skill) => <span className="skill-tag" key={skill}>{skill}</span>)}{match.missing.map((skill) => <span className="skill-tag skill-tag-miss" key={skill}>{skill}</span>)}</div>
                    <p className="fine-print">{match.reasons.join(" · ")}</p>
                  </div>
                )}
                <button className="button button-primary full-button" disabled={busy} onClick={generate}>Generate tailored email</button>
                {draft && (
                  <div className="job-draft">
                    <label className="field-label">Subject</label>
                    <input value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} />
                    <label className="field-label">Email body</label>
                    <textarea className="job-body" value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} />
                    <button className="button button-secondary full-button" disabled={busy} onClick={saveDraft}>Save for review</button>
                    {savedId && <div className="test-result">Saved draft #{savedId}. <button className="button button-ghost" onClick={() => onNavigate("campaign")}>Open Campaign &amp; Send</button></div>}
                  </div>
                )}
              </>
            )}
          </section>
        </div>
      )}
    </>
  );
}

function Campaign({ drafts, settings, busy, run }) {
  const [draftId, setDraftId] = useState("");
  const draft = drafts.find((d) => String(d.id) === draftId) || drafts[0];
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [typed, setTyped] = useState("");
  const [preview, setPreview] = useState(null);

  useEffect(() => {
    if (draft) {
      setDraftId((v) => v || String(draft.id));
      setSubject(draft.subject); setBody(draft.body);
      setReviewed(false); setTyped(""); setPreview(null);
    }
  }, [draft?.id]);

  const selectDraft = (value) => {
    const item = drafts.find((d) => String(d.id) === value);
    setDraftId(value);
    setSubject(item?.subject || ""); setBody(item?.body || "");
    setReviewed(false); setTyped(""); setPreview(null);
  };
  const save = () => run(() => api(`/drafts/${draft.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subject, body }) }), "Draft updated. It must be approved again before sending.");
  const approve = () => run(() => api(`/drafts/${draft.id}/approve`, { method: "POST" }), "Draft approved. It has not been sent.");
  const showPreview = async () => { const r = await run(() => api(`/drafts/${draft.id}/preview`), "Preview ready.", false); if (r) setPreview(r); };
  const send = () => run(() => api(`/drafts/${draft.id}/send`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reviewed, typed_recipient: typed }) }), "Gmail accepted the message send request.");
  const approvedCount = drafts.filter((d) => d.status === "APPROVED").length;

  return (
    <>
      <PageHeading eyebrow="Review before every send" title="Campaign review" description="One recipient at a time. Nothing is sent without your explicit confirmation." />
      {!drafts.length ? <div className="panel"><EmptyState title="No drafts to review" detail="Create an email draft in AI Email Studio to begin." /></div> : (
        <div className="campaign-layout">
          <section className="panel">
            <div className="panel-header"><div><h2 className="section-heading">Draft review</h2><p className="panel-subtitle">{drafts.length} saved drafts · {approvedCount} approved</p></div><span className="panel-number">01</span></div>
            <label className="field-label">Select draft</label>
            <select value={draft?.id || ""} onChange={(e) => selectDraft(e.target.value)}>
              {drafts.map((d) => <option key={d.id} value={d.id}>#{d.id} — {d.contact.company_name} — {d.status}</option>)}
            </select>
            {draft && <>
              <div className="recipient-card">
                <div className="avatar">{draft.contact.company_name.charAt(0)}</div>
                <div><strong>{draft.contact.company_name}</strong><span>{draft.contact.email} · {draft.contact.role || "Contact"}</span></div>
                <Badge>{draft.status}</Badge>
              </div>
              <label className="field-label" htmlFor="campaign-subject">Subject</label>
              <input id="campaign-subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
              <label className="field-label" htmlFor="campaign-body">Email body</label>
              <textarea id="campaign-body" className="campaign-body" value={body} onChange={(e) => setBody(e.target.value)} />
              <div className="button-row">
                <button className="button button-secondary" disabled={busy || !subject.trim() || !body.trim()} onClick={save}>Save edits</button>
                {draft.status !== "SENT" && <button className="button button-primary" disabled={busy || draft.contact.opted_out || ["SENT","REPLIED","OPTED_OUT","NOT_INTERESTED","ARCHIVED"].includes(draft.contact.status)} onClick={approve}>Approve draft</button>}
              </div>
            </>}
          </section>
          <aside className="send-aside">
            <section className={`panel send-card ${draft?.status === "APPROVED" ? "send-card-ready" : ""}`}>
              <div className="send-card-top"><span className="send-step">02</span><span className={draft?.status === "APPROVED" ? "ready-label" : "waiting-label"}>{draft?.status === "APPROVED" ? "Ready for review" : "Awaiting approval"}</span></div>
              <h2>Send email</h2>
              <p>A second confirmation protects against accidental sends.</p>
              {settings?.dry_run ? <div className="dry-run-notice"><strong>Preview only</strong><span>DRY_RUN is on. No email will be sent.</span></div> : <div className="live-notice"><strong>Live sending enabled</strong><span>Daily limit: {settings?.max_emails_per_day}. Per-run limit: {settings?.max_emails_per_run}.</span></div>}
              {draft?.status === "APPROVED" && <>
                <button className="button button-secondary full-button" disabled={busy} onClick={showPreview}>Preview send payload</button>
                {!settings?.dry_run && <>
                  <label className="confirm-check"><input type="checkbox" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} /><span>I reviewed the recipient, message, relevance, and resume.</span></label>
                  <label className="field-label" htmlFor="typed-recipient">Type <strong>{draft.contact.email}</strong> to confirm</label>
                  <input id="typed-recipient" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
                  <button className="button button-danger full-button" style={{ marginTop: 8 }} disabled={busy || !reviewed || typed !== draft.contact.email} onClick={send}>Send this individual email <Icon name="arrow" /></button>
                </>}
              </>}
              <div className="send-footnote">Follow-ups are reminders only. The app never sends unattended messages.</div>
            </section>
            {preview && (
              <section className="panel preview-card">
                <div className="panel-header"><div><h2 className="section-heading">Send preview</h2><p className="panel-subtitle">Review these details before proceeding</p></div><button className="icon-button" onClick={() => setPreview(null)} aria-label="Close preview"><Icon name="x" /></button></div>
                <div className="preview-meta"><span>To</span><strong>{preview.to}</strong><span>Subject</span><strong>{preview.subject}</strong><span>Attachment</span><strong>{preview.resume || "No resume uploaded"}</strong></div>
                {preview.job && (
                  <div className="preview-job">
                    <span>Verified opening: <strong>{preview.job.title}</strong></span>
                    <a href={preview.job.url} target="_blank" rel="noreferrer">{preview.job.url}</a>
                    <span>Checked {formatDate(preview.job.verified_at)} · {preview.job.source}</span>
                  </div>
                )}
                <pre>{preview.body}</pre>
              </section>
            )}
          </aside>
        </div>
      )}
    </>
  );
}

function FollowUps({ items, busy, run }) {
  const [syncMessage, setSyncMessage] = useState("");
  const sync = async () => {
    const result = await run(() => api("/replies/sync", { method: "POST" }), (d) => `Marked ${d.updated} possible reply match(es). Verify each in Gmail.`);
    if (result) setSyncMessage(`Updated ${result.updated} possible match(es).`);
  };
  return (
    <>
      <PageHeading eyebrow="Human-checked reminders" title="Follow-up tracker" description="Check the conversation in Gmail before considering a follow-up." action={<button className="button button-secondary" disabled={busy} onClick={sync}><Icon name="refresh" /> Sync possible replies</button>} />
      <div className="reminder-banner"><span>i</span><p><strong>Reminders only.</strong> Review replies, bounces, and opt-outs before any follow-up. JobReach never sends follow-ups automatically.</p></div>
      {syncMessage && <p className="inline-note">{syncMessage}</p>}
      {!items.length ? <div className="panel"><EmptyState title="No follow-up reminders" detail="A reminder is created when an email is sent. Completed reminders disappear from this view." /></div> : (
        <section className="panel">
          <div className="panel-header"><div><h2 className="section-heading">Open reminders <span className="inline-count">{items.length}</span></h2><p className="panel-subtitle">Sorted by scheduled follow-up time</p></div></div>
          <div className="followup-list">
            {items.map((item) => (
              <article className="followup-row" key={item.id}>
                <div className="followup-date"><span>Due</span><strong>{formatDate(item.followup_due_at)}</strong><small>Sent {formatDate(item.occurred_at)}</small></div>
                <div className="followup-contact"><strong>{item.contact.company_name}</strong><span>{item.contact.email} · {item.contact.role || "Contact"}</span><small>Check for replies or bounce notices in Gmail.</small></div>
                <button className="button button-secondary" disabled={busy} onClick={() => run(() => api(`/followups/${item.id}/complete`, { method: "POST" }), "Reminder marked reviewed.")}>Mark reviewed</button>
              </article>
            ))}
          </div>
        </section>
      )}
    </>
  );
}

function SettingsPage({ settings, busy, run, onUserUpdate, onNavigate }) {
  const [resume, setResume] = useState(null);
  const [profile, setProfile] = useState(null);
  const [testResult, setTestResult] = useState("");
  useEffect(() => {
    if (!settings) return;
    setProfile({
      full_name: settings.sender_name || "",
      phone: settings.phone || "",
      location: settings.location || "",
      linkedin: settings.linkedin || "",
      github: settings.github || "",
      summary: settings.profile_summary || "",
      skills: settings.skills || "",
      target_roles: settings.target_roles || "",
    });
  }, [settings]);
  const setProfileField = (key) => (event) => setProfile((current) => ({ ...current, [key]: event.target.value }));
  const saveProfile = () => run(
    () => api("/profile", {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(profile),
    }),
    (result) => { onUserUpdate?.(result.user); return "Profile saved."; },
  );
  const uploadResume = () => {
    if (!resume) return;
    const form = new FormData();
    form.append("file", resume);
    run(() => api("/profile/resume", { method: "POST", body: form }), (r) => `Resume saved: ${r.resume_name}`);
  };
  const removeResume = () => run(() => api("/profile/resume", { method: "DELETE" }), "Resume removed.");
  const testAi = async () => {
    const result = await run(() => api("/settings/test-ai", { method: "POST" }), (d) => `AI connection successful: ${d.response}`, false);
    if (result) setTestResult(result.response);
  };
  const connectGmail = async () => {
    const result = await run(() => api("/gmail/oauth/start"), "Opening Google authorization…", false);
    if (result?.authorization_url) window.location.assign(result.authorization_url);
  };
  const disconnectGmail = () => run(() => api("/gmail/disconnect", { method: "POST" }), "Gmail disconnected.");
  const gmailConnected = Boolean(settings?.gmail_connected);
  const needsOnboarding = Boolean(settings?.onboarding && !settings.onboarding.completed);
  return (
    <>
      <PageHeading
        eyebrow={needsOnboarding ? "Getting started" : "Local configuration"}
        title={needsOnboarding ? "Set up your profile" : "Settings & integrations"}
        description={needsOnboarding ? "Complete your student profile and resume to personalize drafts and enable sending." : "Manage your profile, resume, and connected services."}
      />
      <div className="settings-grid">
        {needsOnboarding ? (
          <Onboarding onCompleted={(next) => onUserUpdate?.(next)} />
        ) : (
        <section className="panel">
          <div className="panel-header"><div><h2 className="section-heading">Student profile</h2><p className="panel-subtitle">Editable profile used to personalize AI drafts</p></div><span className="panel-number">01</span></div>
          <div className="settings-profile">
            <div className="avatar avatar-large">{profile?.full_name?.charAt(0) || "J"}</div>
            <div className="user-meta"><strong>{profile?.full_name || "Not configured"}</strong><small>{settings?.sender_email}</small></div>
          </div>
          <div className="onboarding-grid settings-profile-grid">
            <label className="field-label">Full name<input value={profile?.full_name || ""} onChange={setProfileField("full_name")} /></label>
            <label className="field-label">Phone<input value={profile?.phone || ""} onChange={setProfileField("phone")} /></label>
            <label className="field-label">Location<input value={profile?.location || ""} onChange={setProfileField("location")} /></label>
            <label className="field-label">LinkedIn<input value={profile?.linkedin || ""} onChange={setProfileField("linkedin")} /></label>
            <label className="field-label">GitHub<input value={profile?.github || ""} onChange={setProfileField("github")} /></label>
            <label className="field-label">Target roles<input value={profile?.target_roles || ""} onChange={setProfileField("target_roles")} /></label>
            <label className="field-label field-full">Profile summary<textarea rows="3" value={profile?.summary || ""} onChange={setProfileField("summary")} /></label>
            <label className="field-label field-full">Skills<input value={profile?.skills || ""} onChange={setProfileField("skills")} /></label>
          </div>
          <button className="button button-secondary" disabled={busy || !profile} onClick={saveProfile}>Save profile</button>
        </section>
        )}

        <section className="panel">
          <div className="panel-header"><div><h2 className="section-heading">Resume manager</h2><p className="panel-subtitle">PDF resume attached to approved emails</p></div><span className="panel-number">02</span></div>
          <div className="resume-card">
            <div className="pdf-icon">PDF</div>
            <div className="resume-meta"><strong>{settings?.resume_name || "No resume uploaded"}</strong><span>{settings?.resume_name ? "Stored privately in your account" : "Upload a PDF resume to enable sending"}</span></div>
            <span className={settings?.resume_name ? "status-ok" : "status-warn"}>{settings?.resume_name ? "Ready" : "Missing"}</span>
          </div>
          <label className="field-label">Upload a new resume</label>
          <div className="resume-upload">
            <input type="file" accept=".pdf,application/pdf" onChange={(e) => setResume(e.target.files?.[0] || null)} />
            <button className="button button-secondary" disabled={!resume || busy} onClick={uploadResume}>Save resume</button>
            {settings?.resume_name && <button className="button button-ghost" disabled={busy} onClick={removeResume}>Remove</button>}
          </div>
          <div className="integration-divider" />
          <div className="panel-header" style={{ marginBottom: 8 }}><div><h2 className="section-heading">Gmail connection</h2><p className="panel-subtitle">OAuth connection for one-at-a-time sending</p></div></div>
          <div className="integration-row">
            <div>
              <strong>Google Gmail API</strong>
              <span>{gmailConnected ? `Connected as ${settings?.gmail_email || "your Google account"}` : "Not connected"}</span>
            </div>
            <div className="gmail-actions">
              <span className={gmailConnected && !settings?.gmail_needs_reconnect ? "status-ok" : "status-warn"}>
                {gmailConnected ? (settings?.gmail_needs_reconnect ? "Reconnect needed" : "Connected") : "Not connected"}
              </span>
              <button className="button button-secondary" disabled={busy} onClick={connectGmail}>{gmailConnected ? "Reconnect" : "Connect Gmail"}</button>
              {gmailConnected && <button className="button button-ghost" disabled={busy} onClick={disconnectGmail}>Disconnect</button>}
            </div>
          </div>
        </section>

        <section className="panel">
          <div className="panel-header"><div><h2 className="section-heading">AI provider</h2><p className="panel-subtitle">Configured locally; provider keys are never shown in the UI</p></div><span className="panel-number">03</span></div>
          <div className="provider-details">
            <div><span>Provider</span><strong>{settings?.ai_provider || "—"}</strong></div>
            <div><span>Model</span><strong>{settings?.ai_model || "—"}</strong></div>
            <div className="provider-url"><span>Endpoint</span><strong>{settings?.ai_base_url || "—"}</strong></div>
          </div>
          <button className="button button-secondary" disabled={busy} onClick={testAi}>Test AI connection</button>
          {testResult && <div className="test-result">Connection successful: {testResult}</div>}
        </section>

        <section className="panel">
          <div className="panel-header"><div><h2 className="section-heading">Sending safety</h2><p className="panel-subtitle">Review the safeguards before enabling live sending</p></div><span className="panel-number">04</span></div>
          <div className="safety-toggle-row">
            <div><strong>{settings?.dry_run ? "Preview mode is active" : "Live sending is active"}</strong><span>{settings?.dry_run ? "No emails can be sent until DRY_RUN is changed in .env." : "Every individual send still requires review and confirmation."}</span></div>
            <Badge>{settings?.dry_run ? "DRY_RUN ON" : "DRY_RUN OFF"}</Badge>
          </div>
          <div className="limit-grid">
            <div><span>Per-run cap</span><strong>{settings?.max_emails_per_run ?? "—"}</strong></div>
            <div><span>Daily cap</span><strong>{settings?.max_emails_per_day ?? "—"}</strong></div>
            <div><span>Send spacing</span><strong>{settings?.min_seconds_between_emails ?? "—"}s</strong></div>
          </div>
          <div className="config-note">Keep limits low. Change <code>DRY_RUN=false</code> in <code>.env</code> only after using preview mode and verifying your Gmail setup.</div>
        </section>

        <section className="panel">
          <div className="panel-header"><div><h2 className="section-heading">Database unlock</h2><p className="panel-subtitle">One-time payment for the bundled HR contact database</p>
</div><span className="panel-number">05</span></div>
          <div className="provider-details">
            <div><span>Access</span><strong>{settings?.hr_database_unlocked ? "Unlocked" : "Locked"}</strong></div>
            <div><span>Database size</span><strong>{(settings?.hr_database_count ?? 0).toLocaleString()}</strong></div>
          </div>
          <button className="button button-secondary" onClick={() => onNavigate("unlock")}>Manage unlock</button>
        </section>
      </div>
    </>
  );
}

function EmptyState({ title, detail, action }) {
  return (
    <div className="empty-state">
      <div className="empty-icon"><Icon name="file" /></div>
      <strong>{title}</strong>
      <p>{detail}</p>
      {action}
    </div>
  );
}

export default App;
