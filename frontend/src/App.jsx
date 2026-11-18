import { useCallback, useEffect, useMemo, useState } from "react";

const navigation = [
  { id: "overview", label: "Overview", icon: "overview" },
  { id: "companies", label: "Companies", icon: "companies" },
  { id: "studio", label: "AI Email Studio", icon: "studio" },
  { id: "jobs", label: "Job Match", icon: "jobs" },
  { id: "campaign", label: "Campaign & Send", icon: "campaign" },
  { id: "followups", label: "Follow-ups", icon: "followups" },
  { id: "settings", label: "Settings", icon: "settings" },
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
  file: <svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>,
};

function Icon({ name }) { return <span className="nav-icon" aria-hidden="true">{icons[name]}</span>; }

async function api(path, options = {}) {
  const response = await fetch(`/api${path}`, options);
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

function App() {
  const [page, setPage] = useState("overview");
  const [dashboard, setDashboard] = useState(null);
  const [contacts, setContacts] = useState([]);
  const [drafts, setDrafts] = useState([]);
  const [followups, setFollowups] = useState([]);
  const [settings, setSettings] = useState(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try {
      const [overview, contactRows, draftRows, followupRows, config] = await Promise.all([
        api("/dashboard"), api("/contacts"), api("/drafts"), api("/followups"), api("/settings"),
      ]);
      setDashboard(overview);
      setContacts(contactRows);
      setDrafts(draftRows);
      setFollowups(followupRows);
      setSettings(config);
      setError("");
    } catch (e) { setError(e.message); }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

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
            <div className="avatar">{settings?.sender_name?.charAt(0) || "J"}</div>
            <div className="user-meta">
              <strong>{settings?.sender_name || "Your profile"}</strong>
              <small>{settings?.sender_email || "Configure sender settings"}</small>
            </div>
          </div>
        </div>
      </aside>

      <main className="main-panel">
        <header className="topbar">
          <div className="breadcrumbs"><span>Workspace</span><b>/</b><strong>{selectedPage?.label}</strong></div>
          <div className="top-actions">
            <span className="local-indicator"><i /> <span>Local workspace</span></span>
            <button className="icon-button" title="Refresh data" aria-label="Refresh data" onClick={refresh}><Icon name="refresh" /></button>
          </div>
        </header>
        <div className="content">
          {error && <div className="alert alert-error" role="alert"><span>!</span><p>{error}</p><button onClick={() => setError("")} aria-label="Dismiss"><Icon name="x" /></button></div>}
          {notice && <div className="alert alert-success" role="status"><span>✓</span><p>{notice}</p><button onClick={() => setNotice(null)} aria-label="Dismiss"><Icon name="x" /></button></div>}
          {page === "overview" && <Overview dashboard={dashboard} onNavigate={setPage} />}
          {page === "companies" && <Companies contacts={contacts} busy={busy} run={run} />}
          {page === "studio" && <Studio contacts={contacts} busy={busy} run={run} />}
          {page === "jobs" && <JobMatch contacts={contacts} busy={busy} run={run} onNavigate={setPage} />}
          {page === "campaign" && <Campaign drafts={drafts} settings={settings} busy={busy} run={run} />}
          {page === "followups" && <FollowUps items={followups} busy={busy} run={run} />}
          {page === "settings" && <SettingsPage settings={settings} busy={busy} run={run} />}
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

function Companies({ contacts, busy, run }) {
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
      <PageHeading eyebrow="Your contact database" title="Companies & contacts" description="Keep your outreach list organized, relevant, and easy to review." />
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

function SettingsPage({ settings, busy, run }) {
  const [resume, setResume] = useState(null);
  const [testResult, setTestResult] = useState("");
  const uploadResume = () => {
    if (!resume) return;
    const form = new FormData();
    form.append("file", resume);
    run(() => api("/settings/resume", { method: "POST", body: form }), (r) => `Resume saved: ${r.resume_name}`);
  };
  const testAi = async () => {
    const result = await run(() => api("/settings/test-ai", { method: "POST" }), (d) => `AI connection successful: ${d.response}`, false);
    if (result) setTestResult(result.response);
  };
  return (
    <>
      <PageHeading eyebrow="Local configuration" title="Settings & integrations" description="Manage your profile, resume, and connected services." />
      <div className="settings-grid">
        <section className="panel">
          <div className="panel-header"><div><h2 className="section-heading">Sender profile</h2><p className="panel-subtitle">Profile details used to personalize AI drafts</p></div><span className="panel-number">01</span></div>
          <div className="settings-profile">
            <div className="avatar avatar-large">{settings?.sender_name?.charAt(0) || "J"}</div>
            <div className="user-meta"><strong>{settings?.sender_name || "Not configured"}</strong><small>{settings?.sender_email}</small></div>
          </div>
          <div className="profile-detail"><span>Profile summary</span><p>{settings?.profile_summary || "—"}</p></div>
          <div className="profile-detail"><span>Skills</span><p>{settings?.skills || "—"}</p></div>
          <div className="config-note">Edit sender details in your local <code>.env</code> file, then restart the API.</div>
        </section>

        <section className="panel">
          <div className="panel-header"><div><h2 className="section-heading">Resume manager</h2><p className="panel-subtitle">PDF resume attached to approved emails</p></div><span className="panel-number">02</span></div>
          <div className="resume-card">
            <div className="pdf-icon">PDF</div>
            <div className="resume-meta"><strong>{settings?.resume_name || "No resume uploaded"}</strong><span>{settings?.resume_name ? "Stored locally in the resumes folder" : "Upload a PDF resume to enable sending"}</span></div>
            <span className={settings?.resume_name ? "status-ok" : "status-warn"}>{settings?.resume_name ? "Ready" : "Missing"}</span>
          </div>
          <label className="field-label">Upload a new resume</label>
          <div className="resume-upload">
            <input type="file" accept=".pdf,application/pdf" onChange={(e) => setResume(e.target.files?.[0] || null)} />
            <button className="button button-secondary" disabled={!resume || busy} onClick={uploadResume}>Save resume</button>
          </div>
          <div className="integration-divider" />
          <div className="panel-header" style={{ marginBottom: 8 }}><div><h2 className="section-heading">Gmail connection</h2><p className="panel-subtitle">OAuth connection for one-at-a-time sending</p></div></div>
          <div className="integration-row">
            <div><strong>Google Gmail API</strong><span>OAuth client: credentials/client_secret.json</span></div>
            <button className="button button-secondary" disabled={busy} onClick={() => run(() => api("/settings/gmail", { method: "POST" }), "Gmail OAuth connection successful.")}>Connect Gmail</button>
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
