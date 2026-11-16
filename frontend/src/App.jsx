import { useCallback, useEffect, useMemo, useState } from "react";

const navigation = [
  { id: "overview", label: "Overview", icon: "◫" },
  { id: "companies", label: "Companies", icon: "⌂" },
  { id: "studio", label: "AI Email Studio", icon: "✳" },
  { id: "campaign", label: "Campaign & Send", icon: "↗" },
  { id: "followups", label: "Follow-ups", icon: "◷" },
  { id: "settings", label: "Settings", icon: "⚙" },
];

const statuses = [
  "PENDING", "DRAFTED", "SENT", "REPLIED", "FAILED",
  "NOT_INTERESTED", "OPTED_OUT", "ARCHIVED",
];

async function api(path, options = {}) {
  const response = await fetch(`/api${path}`, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.detail || `Request failed (${response.status})`);
  }
  return data;
}

function formatDate(value) {
  if (!value) return "—";
  return new Date(value).toLocaleString(undefined, {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
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
        api("/dashboard"),
        api("/contacts"),
        api("/drafts"),
        api("/followups"),
        api("/settings"),
      ]);
      setDashboard(overview);
      setContacts(contactRows);
      setDrafts(draftRows);
      setFollowups(followupRows);
      setSettings(config);
      setError("");
    } catch (requestError) {
      setError(requestError.message);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const run = async (operation, successMessage, thenRefresh = true) => {
    setBusy(true);
    setError("");
    setNotice(null);
    try {
      const result = await operation();
      if (thenRefresh) await refresh();
      setNotice(typeof successMessage === "function" ? successMessage(result) : successMessage);
      return result;
    } catch (requestError) {
      setError(requestError.message);
      return null;
    } finally {
      setBusy(false);
    }
  };

  const draftCount = drafts.filter((draft) => draft.status === "APPROVED").length;
  const selectedPage = navigation.find((item) => item.id === page);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">J<span>R</span></div>
          <div><strong>jobreach<span>.ai</span></strong><small>PERSONAL OUTREACH CRM</small></div>
        </div>
        <div className="nav-label">WORKSPACE</div>
        <nav aria-label="Main navigation">
          {navigation.map((item) => (
            <button key={item.id} aria-label={item.label} title={item.label} className={`nav-item ${page === item.id ? "active" : ""}`} onClick={() => setPage(item.id)}>
              <span className="nav-icon">{item.icon}</span><span>{item.label}</span>
              {item.id === "campaign" && draftCount > 0 && <span className="nav-count">{draftCount}</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className={`safe-card ${settings?.dry_run ? "" : "safe-card-live"}`}>
            <div className="safe-heading"><span className="status-dot" />{settings?.dry_run ? "SAFE MODE ON" : "LIVE SENDING"}</div>
            <p>{settings?.dry_run ? "Emails are preview-only. Nothing can be sent." : "Sending is enabled. Every send requires your approval."}</p>
          </div>
          <div className="user-chip"><div className="avatar">{settings?.sender_name?.charAt(0) || "J"}</div><div><strong>{settings?.sender_name || "Your profile"}</strong><small>{settings?.sender_email || "Configure sender settings"}</small></div></div>
        </div>
      </aside>

      <main className="main-panel">
        <header className="topbar">
          <div className="breadcrumbs"><span>Workspace</span><b>/</b><strong>{selectedPage?.label}</strong></div>
          <div className="top-actions">
            <span className="local-indicator"><i /> Local workspace</span>
            <button className="icon-button" title="Refresh data" aria-label="Refresh data" onClick={refresh}>↻</button>
          </div>
        </header>
        <div className="content">
          {error && <div className="alert alert-error" role="alert"><span>!</span><p>{error}</p><button onClick={() => setError("")}>×</button></div>}
          {notice && <div className="alert alert-success" role="status"><span>✓</span><p>{notice}</p><button onClick={() => setNotice(null)}>×</button></div>}
          {page === "overview" && <Overview dashboard={dashboard} onNavigate={setPage} />}
          {page === "companies" && <Companies contacts={contacts} busy={busy} run={run} />}
          {page === "studio" && <Studio contacts={contacts} busy={busy} run={run} />}
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
      <div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p>{description}</p></div>
      {action}
    </div>
  );
}

function Overview({ dashboard, onNavigate }) {
  const stats = dashboard?.stats;
  const metrics = [
    { label: "Total contacts", value: stats?.contacts ?? "—", icon: "⌂", tone: "mint", note: "In your outreach list" },
    { label: "Emails accepted", value: stats?.sent ?? "—", icon: "↗", tone: "blue", note: "Accepted by Gmail" },
    { label: "Replies marked", value: stats?.replies ?? "—", icon: "↩", tone: "yellow", note: "Matched or marked by you" },
    { label: "Pending contacts", value: stats?.pending ?? "—", icon: "◷", tone: "purple", note: "Ready for a first draft" },
  ];
  return (
    <>
      <PageHeading eyebrow="YOUR OUTREACH, AT A GLANCE" title="Good morning." description="A clear view of your job-search conversations and next steps."
        action={<button className="button button-primary" onClick={() => onNavigate("companies")}><span>＋</span> Add contacts</button>} />
      <div className="metric-grid">
        {metrics.map((metric) => <div className="metric-card" key={metric.label}>
          <div className={`metric-icon ${metric.tone}`}>{metric.icon}</div><div className="metric-label">{metric.label}</div>
          <div className="metric-value">{metric.value}</div><div className="metric-note">{metric.note}</div>
        </div>)}
      </div>
      <div className="overview-grid">
        <section className="panel recent-panel">
          <div className="panel-heading"><div><h2>Recent contacts</h2><p>Your latest companies and hiring contacts</p></div><button className="text-button" onClick={() => onNavigate("companies")}>View all <span>→</span></button></div>
          <ContactTable contacts={dashboard?.recent_contacts || []} compact />
          {dashboard && dashboard.recent_contacts.length === 0 && <EmptyState title="Your pipeline starts here" detail="Import a small, relevant contact list to get started." action={<button className="button button-secondary" onClick={() => onNavigate("companies")}>Import contacts</button>} />}
        </section>
        <aside className="right-column">
          <section className="panel guardrail-panel">
            <div className="panel-heading"><div><h2>Daily guardrails</h2><p>Responsible, one-at-a-time outreach</p></div><span className="shield-icon">✓</span></div>
            <div className="cap-number"><strong>{dashboard?.sent_today ?? "—"}</strong><span> / {dashboard?.daily_cap ?? "—"} emails today</span></div>
            <div className="progress-track"><div style={{ width: `${Math.min(100, (dashboard?.sent_today || 0) / (dashboard?.daily_cap || 1) * 100)}%` }} /></div>
            <div className="guardrail-notes"><span>✓</span> Approved draft required<span>✓</span> Human confirmation required</div>
            <p className="fine-print">Gmail acceptance doesn't guarantee inbox delivery. Always check for bounces and replies.</p>
          </section>
          <section className="panel quick-panel">
            <div className="panel-heading"><div><h2>Pipeline snapshot</h2><p>Keep your outreach moving</p></div></div>
            <div className="snapshot-row"><span><i className="snapshot-dot dot-green" />Approved drafts</span><b>{stats?.approved ?? "—"}</b></div>
            <div className="snapshot-row"><span><i className="snapshot-dot dot-red" />Failed attempts</span><b>{stats?.failed ?? "—"}</b></div>
            <div className="snapshot-row"><span><i className="snapshot-dot dot-gray" />Opted out</span><b>{stats?.opted_out ?? "—"}</b></div>
            <button className="button button-secondary full-button" onClick={() => onNavigate("campaign")}>Review campaign <span>→</span></button>
          </section>
        </aside>
      </div>
    </>
  );
}

function ContactTable({ contacts, compact = false }) {
  if (!contacts.length) return <div className="table-empty">No contacts to show yet.</div>;
  return (
    <div className="table-wrap">
      <table><thead><tr><th>COMPANY</th><th>CONTACT</th><th>ROLE</th><th>STATUS</th></tr></thead>
        <tbody>{contacts.slice(0, compact ? 7 : undefined).map((contact) => <tr key={contact.id}>
          <td><strong className="company-name">{contact.company_name}</strong>{!compact && <small className="table-subtext">#{contact.id}</small>}</td>
          <td>{contact.email}</td><td>{contact.role || "—"}</td><td><Badge>{contact.status}</Badge></td>
        </tr>)}</tbody>
      </table>
    </div>
  );
}

function Companies({ contacts, busy, run }) {
  const [filter, setFilter] = useState("All");
  const [file, setFile] = useState(null);
  const [selected, setSelected] = useState("");
  const [newStatus, setNewStatus] = useState("PENDING");
  const filtered = useMemo(() => filter === "All" ? contacts : contacts.filter((contact) => contact.status === filter), [contacts, filter]);
  const selectedContact = contacts.find((contact) => String(contact.id) === selected);
  const importFile = () => {
    if (!file) return;
    const form = new FormData();
    form.append("file", file);
    run(() => api("/contacts/import", { method: "POST", body: form }), (result) => `Imported ${result.added}; skipped ${result.skipped}.${result.errors.length ? ` ${result.errors.join(" · ")}` : ""}`);
  };
  return <>
    <PageHeading eyebrow="YOUR CONTACT DATABASE" title="Companies & contacts" description="Keep your outreach list organized, relevant, and easy to review." />
    <div className="split-grid">
      <section className="panel import-panel">
        <div className="panel-heading"><div><h2>Import companies</h2><p>Bring in a CSV or Excel contact list</p></div><span className="panel-number">01</span></div>
        <div className="import-drop">
          <div className="upload-icon">↑</div><strong>{file ? file.name : "Choose a contact file"}</strong>
          <span>CSV or XLSX · up to 10 MB</span>
          <label className="button button-secondary file-button">Browse files<input type="file" accept=".csv,.xlsx" onChange={(event) => setFile(event.target.files?.[0] || null)} /></label>
        </div>
        <button className="button button-primary full-button" disabled={!file || busy} onClick={importFile}>{busy ? "Importing…" : "Import contacts"}</button>
        <a className="download-link" href="/api/companies/template" download>↓ Download import template</a>
        <div className="field-note"><strong>Required:</strong> company_name, email <span>Optional: hr_name, role, company_context, job_url, source_url, location, notes</span></div>
      </section>
      <section className="panel update-panel">
        <div className="panel-heading"><div><h2>Update a contact</h2><p>Record a reply, opt-out, or next step</p></div><span className="panel-number">02</span></div>
        <label className="field-label">CONTACT</label>
        <select value={selected} onChange={(event) => setSelected(event.target.value)}><option value="">Choose a contact…</option>{contacts.map((contact) => <option key={contact.id} value={contact.id}>{contact.company_name} — {contact.email}</option>)}</select>
        <label className="field-label">NEW STATUS</label>
        <select value={newStatus} onChange={(event) => setNewStatus(event.target.value)}>{["PENDING", "REPLIED", "NOT_INTERESTED", "OPTED_OUT", "ARCHIVED"].map((status) => <option key={status}>{status}</option>)}</select>
        <button className="button button-secondary full-button" disabled={!selectedContact || busy} onClick={() => run(() => api(`/contacts/${selected}/status`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: newStatus }) }), "Contact status updated.")}>Save contact status</button>
        <p className="field-note">Opt-outs are permanent for sending. Respect every request to stop contact.</p>
      </section>
    </div>
    <section className="panel list-panel">
      <div className="panel-heading list-heading"><div><h2>Contact list <span className="inline-count">{filtered.length}</span></h2><p>Review and filter your full outreach pipeline</p></div>
        <select className="filter-select" value={filter} onChange={(event) => setFilter(event.target.value)}><option>All</option>{statuses.map((status) => <option key={status}>{status}</option>)}</select>
      </div>
      <ContactTable contacts={filtered} />
      {filtered.length === 0 && <EmptyState title="No contacts match this filter" detail="Try another status or import contacts above." />}
    </section>
  </>;
}

function Studio({ contacts, busy, run }) {
  const eligible = contacts.filter((contact) => !contact.opted_out && !["SENT", "REPLIED", "OPTED_OUT", "ARCHIVED"].includes(contact.status));
  const [contactId, setContactId] = useState("");
  const [context, setContext] = useState("");
  const [generated, setGenerated] = useState(null);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const activeContact = eligible.find((contact) => String(contact.id) === contactId);
  useEffect(() => {
    if (eligible.length && !eligible.some((contact) => String(contact.id) === contactId)) setContactId(String(eligible[0].id));
    if (!eligible.length) setContactId("");
  }, [contacts, eligible.length, contactId]);
  useEffect(() => {
    setContext(activeContact?.company_context || "");
    setGenerated(null);
  }, [contactId]);
  const generate = async () => {
    if (!activeContact) return;
    const result = await run(() => api(`/contacts/${contactId}/generate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ company_context: context }) }), "Draft generated. Review every claim before saving.", false);
    if (result) {
      setGenerated(result);
      setSubject(result.subject);
      setBody(result.body);
    }
  };
  return <>
    <PageHeading eyebrow="PERSONALIZED, NEVER AUTOMATIC" title="AI Email Studio" description="Generate a starting point from your profile and the facts you provide." />
    {!eligible.length ? <EmptyState title="No eligible contacts" detail="Import contacts or choose a contact that hasn't been sent to, opted out, or archived." /> : <div className="studio-grid">
      <section className="panel studio-input">
        <div className="panel-heading"><div><h2>Draft settings</h2><p>Keep it grounded in verified information</p></div><span className="panel-number">01</span></div>
        <label className="field-label">COMPANY CONTACT</label>
        <select value={contactId} onChange={(event) => setContactId(event.target.value)}>{eligible.map((contact) => <option key={contact.id} value={contact.id}>{contact.company_name} · {contact.role} · {contact.email}</option>)}</select>
        <div className="contact-summary"><div className="avatar">{activeContact?.company_name?.charAt(0) || "C"}</div><div><strong>{activeContact?.company_name}</strong><span>{activeContact?.email}</span></div><Badge>{activeContact?.status}</Badge></div>
        <label className="field-label" htmlFor="verified-context">VERIFIED COMPANY CONTEXT</label>
        <textarea id="verified-context" className="context-area" placeholder="Paste verified details from a job post or company site. Leave blank if you have none." value={context} onChange={(event) => setContext(event.target.value)} />
        <p className="field-note">Only include facts you personally verified. AI won't research the company.</p>
        <button className="button button-primary full-button" disabled={busy || !activeContact} onClick={generate}>{busy ? <><span className="spinner" /> Generating…</> : <><span>✳</span> Generate personalized draft</>}</button>
      </section>
      <section className="panel editor-panel">
        <div className="panel-heading"><div><h2>Review your draft</h2><p>Edit the message before saving it for approval</p></div><span className="panel-number">02</span></div>
        {generated ? <div className="draft-editor">
          <label className="field-label" htmlFor="draft-subject">SUBJECT</label><input id="draft-subject" value={subject} onChange={(event) => setSubject(event.target.value)} maxLength={500} />
          <label className="field-label" htmlFor="draft-body">EMAIL BODY</label><textarea id="draft-body" value={body} onChange={(event) => setBody(event.target.value)} />
          <div className="editor-bottom"><span>Generated text is a draft. Verify company-specific claims.</span><button className="button button-primary" disabled={busy || !subject.trim() || !body.trim()} onClick={() => run(() => api(`/contacts/${contactId}/drafts`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subject, body }) }), "Draft saved. Review and approve it in Campaign & Send.")}>Save for review <span>→</span></button></div>
        </div> : <EmptyState title="Your draft will appear here" detail="Choose a contact, add verified context, then generate an editable message." />}
      </section>
    </div>}
  </>;
}

function Campaign({ drafts, settings, busy, run }) {
  const [draftId, setDraftId] = useState("");
  const draft = drafts.find((item) => String(item.id) === draftId) || drafts[0];
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [typed, setTyped] = useState("");
  const [preview, setPreview] = useState(null);
  useEffect(() => {
    if (draft) {
      setDraftId((value) => value || String(draft.id));
      setSubject(draft.subject);
      setBody(draft.body);
      setReviewed(false);
      setTyped("");
      setPreview(null);
    }
  }, [draft?.id]);
  const selectDraft = (value) => {
    const item = drafts.find((entry) => String(entry.id) === value);
    setDraftId(value);
    setSubject(item?.subject || "");
    setBody(item?.body || "");
    setReviewed(false);
    setTyped("");
    setPreview(null);
  };
  const save = () => run(() => api(`/drafts/${draft.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subject, body }) }), "Draft updated. It must be approved again before sending.");
  const approve = () => run(() => api(`/drafts/${draft.id}/approve`, { method: "POST" }), "Draft approved. It has not been sent.");
  const showPreview = async () => {
    const result = await run(() => api(`/drafts/${draft.id}/preview`), "Preview ready.", false);
    if (result) setPreview(result);
  };
  const send = () => run(() => api(`/drafts/${draft.id}/send`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reviewed, typed_recipient: typed }) }), "Gmail accepted the message send request.");
  const approvedCount = drafts.filter((item) => item.status === "APPROVED").length;
  return <>
    <PageHeading eyebrow="REVIEW BEFORE EVERY SEND" title="Campaign review" description="One recipient at a time. Nothing is sent without your explicit confirmation." />
    {!drafts.length ? <EmptyState title="No drafts to review" detail="Create an email draft in AI Email Studio to begin." /> : <div className="campaign-layout">
      <section className="panel campaign-panel">
        <div className="panel-heading"><div><h2>Draft review</h2><p>{drafts.length} saved drafts · {approvedCount} approved</p></div><span className="panel-number">01</span></div>
        <label className="field-label">SELECT DRAFT</label>
        <select value={draft?.id || ""} onChange={(event) => selectDraft(event.target.value)}>{drafts.map((item) => <option key={item.id} value={item.id}>#{item.id} — {item.contact.company_name} — {item.status}</option>)}</select>
        {draft && <>
          <div className="recipient-card"><div className="avatar">{draft.contact.company_name.charAt(0)}</div><div><strong>{draft.contact.company_name}</strong><span>{draft.contact.email} · {draft.contact.role}</span></div><Badge>{draft.status}</Badge></div>
          <label className="field-label" htmlFor="campaign-subject">SUBJECT</label><input id="campaign-subject" value={subject} onChange={(event) => setSubject(event.target.value)} />
          <label className="field-label" htmlFor="campaign-body">EMAIL BODY</label><textarea id="campaign-body" className="campaign-body" value={body} onChange={(event) => setBody(event.target.value)} />
          <div className="button-row"><button className="button button-secondary" disabled={busy || !subject.trim() || !body.trim()} onClick={save}>Save edits</button>
            {draft.status !== "SENT" && <button className="button button-primary" disabled={busy || draft.contact.opted_out || ["SENT", "REPLIED", "OPTED_OUT", "NOT_INTERESTED", "ARCHIVED"].includes(draft.contact.status)} onClick={approve}>Approve draft</button>}
          </div>
        </>}
      </section>
      <aside className="send-aside">
        <section className={`panel send-card ${draft?.status === "APPROVED" ? "send-card-ready" : ""}`}>
          <div className="send-card-top"><span className="send-step">02</span><span className={draft?.status === "APPROVED" ? "ready-label" : "waiting-label"}>{draft?.status === "APPROVED" ? "READY FOR REVIEW" : "AWAITING APPROVAL"}</span></div>
          <h2>Send email</h2><p>A second confirmation protects against accidental sends.</p>
          {settings?.dry_run ? <div className="dry-run-notice"><strong>Preview only</strong><span>DRY_RUN is on. No email will be sent.</span></div> : <div className="live-notice"><strong>Live sending enabled</strong><span>Daily limit: {settings?.max_emails_per_day}. Per-run limit: {settings?.max_emails_per_run}.</span></div>}
          {draft?.status === "APPROVED" && <>
            <button className="button button-secondary full-button" disabled={busy} onClick={showPreview}>Preview send payload</button>
            {!settings?.dry_run && <>
              <label className="confirm-check"><input type="checkbox" checked={reviewed} onChange={(event) => setReviewed(event.target.checked)} /><span>I reviewed the recipient, message, relevance, and resume.</span></label>
              <label className="field-label" htmlFor="typed-recipient">TYPE <b>{draft.contact.email}</b> TO CONFIRM</label>
              <input id="typed-recipient" value={typed} onChange={(event) => setTyped(event.target.value)} autoComplete="off" />
              <button className="button button-danger full-button" disabled={busy || !reviewed || typed !== draft.contact.email} onClick={send}>Send this individual email <span>→</span></button>
            </>}
          </>}
          <div className="send-footnote">Follow-ups are reminders only. The app never sends unattended messages.</div>
        </section>
        {preview && <section className="panel preview-card"><div className="panel-heading"><div><h2>Send preview</h2><p>Review these details before proceeding</p></div><button className="icon-button" onClick={() => setPreview(null)} aria-label="Close preview">×</button></div><div className="preview-meta"><span>TO</span><strong>{preview.to}</strong><span>SUBJECT</span><strong>{preview.subject}</strong><span>ATTACHMENT</span><strong>{preview.resume || "No resume uploaded"}</strong></div><pre>{preview.body}</pre></section>}
      </aside>
    </div>}
  </>;
}

function FollowUps({ items, busy, run }) {
  const [syncMessage, setSyncMessage] = useState("");
  const sync = async () => {
    const result = await run(() => api("/replies/sync", { method: "POST" }), (data) => `Marked ${data.updated} possible reply match(es). Verify each in Gmail.`);
    if (result) setSyncMessage(`Updated ${result.updated} possible match(es).`);
  };
  return <>
    <PageHeading eyebrow="HUMAN-CHECKED REMINDERS" title="Follow-up tracker" description="Check the conversation in Gmail before considering a follow-up."
      action={<button className="button button-secondary" disabled={busy} onClick={sync}>↻ Sync possible replies</button>} />
    <div className="reminder-banner"><span>i</span><p><strong>Reminders only.</strong> Review replies, bounces, and opt-outs before any follow-up. JobReach never sends follow-ups automatically.</p></div>
    {syncMessage && <p className="inline-note">{syncMessage}</p>}
    {!items.length ? <EmptyState title="No follow-up reminders" detail="A reminder is created when an email is sent. Completed reminders disappear from this view." /> :
      <section className="panel followup-panel"><div className="panel-heading"><div><h2>Open reminders <span className="inline-count">{items.length}</span></h2><p>Sorted by scheduled follow-up time</p></div></div>
        <div className="followup-list">{items.map((item) => <article className="followup-row" key={item.id}>
          <div className="followup-date"><span>DUE</span><strong>{formatDate(item.followup_due_at)}</strong><small>Sent {formatDate(item.occurred_at)}</small></div>
          <div className="followup-contact"><strong>{item.contact.company_name}</strong><span>{item.contact.email} · {item.contact.role}</span><small>Check for replies or bounce notices in Gmail.</small></div>
          <button className="button button-secondary" disabled={busy} onClick={() => run(() => api(`/followups/${item.id}/complete`, { method: "POST" }), "Reminder marked reviewed.")}>Mark reviewed</button>
        </article>)}</div>
      </section>}
  </>;
}

function SettingsPage({ settings, busy, run }) {
  const [resume, setResume] = useState(null);
  const [testResult, setTestResult] = useState("");
  const uploadResume = () => {
    if (!resume) return;
    const form = new FormData();
    form.append("file", resume);
    run(() => api("/settings/resume", { method: "POST", body: form }), (result) => `Resume saved: ${result.resume_name}`);
  };
  const testAi = async () => {
    const result = await run(() => api("/settings/test-ai", { method: "POST" }), (data) => `AI connection successful: ${data.response}`, false);
    if (result) setTestResult(result.response);
  };
  return <>
    <PageHeading eyebrow="LOCAL CONFIGURATION" title="Settings & integrations" description="Manage your profile, resume, and connected services." />
    <div className="settings-grid">
      <section className="panel settings-panel"><div className="panel-heading"><div><h2>Sender profile</h2><p>Profile details used to personalize AI drafts</p></div><span className="panel-number">01</span></div>
        <div className="settings-profile"><div className="avatar avatar-large">{settings?.sender_name?.charAt(0) || "J"}</div><div><strong>{settings?.sender_name || "Not configured"}</strong><span>{settings?.sender_email}</span></div></div>
        <div className="profile-detail"><span>PROFILE SUMMARY</span><p>{settings?.profile_summary}</p></div><div className="profile-detail"><span>SKILLS</span><p>{settings?.skills}</p></div>
        <div className="config-note">Edit sender details in your local <code>.env</code> file, then restart the API.</div>
      </section>
      <section className="panel settings-panel"><div className="panel-heading"><div><h2>Resume manager</h2><p>PDF resume attached to approved emails</p></div><span className="panel-number">02</span></div>
        <div className="resume-card"><div className="pdf-icon">PDF</div><div><strong>{settings?.resume_name || "No resume uploaded"}</strong><span>{settings?.resume_name ? "Stored locally in the resumes folder" : "Upload a PDF resume to enable sending"}</span></div><span className={settings?.resume_name ? "connected-check" : "pending-dot"}>{settings?.resume_name ? "✓" : "!"}</span></div>
        <label className="field-label">UPLOAD A NEW RESUME</label><div className="resume-upload"><input type="file" accept=".pdf,application/pdf" onChange={(event) => setResume(event.target.files?.[0] || null)} /><button className="button button-secondary" disabled={!resume || busy} onClick={uploadResume}>Save resume</button></div>
        <div className="integration-divider" />
        <div className="panel-heading compact-heading"><div><h2>Gmail connection</h2><p>OAuth connection for one-at-a-time sending</p></div></div>
        <div className="integration-row"><div><strong>Google Gmail API</strong><span>OAuth client: credentials/client_secret.json</span></div><button className="button button-secondary" disabled={busy} onClick={() => run(() => api("/settings/gmail", { method: "POST" }), "Gmail OAuth connection successful.")}>Connect Gmail</button></div>
      </section>
      <section className="panel settings-panel"><div className="panel-heading"><div><h2>AI provider</h2><p>Configured locally; provider keys are never shown in the UI</p></div><span className="panel-number">03</span></div>
        <div className="provider-details"><div><span>PROVIDER</span><strong>{settings?.ai_provider}</strong></div><div><span>MODEL</span><strong>{settings?.ai_model}</strong></div><div className="provider-url"><span>ENDPOINT</span><strong>{settings?.ai_base_url}</strong></div></div>
        <button className="button button-secondary" disabled={busy} onClick={testAi}>Test AI connection</button>
        {testResult && <div className="test-result"><span>✓</span> Connection successful: {testResult}</div>}
      </section>
      <section className="panel settings-panel safety-settings"><div className="panel-heading"><div><h2>Sending safety</h2><p>Review the safeguards before enabling live sending</p></div><span className="panel-number">04</span></div>
        <div className="safety-toggle-row"><div><strong>{settings?.dry_run ? "Preview mode is active" : "Live sending is active"}</strong><span>{settings?.dry_run ? "No emails can be sent until DRY_RUN is changed in .env." : "Every individual send still requires review and confirmation."}</span></div><Badge>{settings?.dry_run ? "DRY_RUN ON" : "DRY_RUN OFF"}</Badge></div>
        <div className="limit-grid"><div><span>PER-RUN CAP</span><strong>{settings?.max_emails_per_run}</strong></div><div><span>DAILY CAP</span><strong>{settings?.max_emails_per_day}</strong></div><div><span>SEND SPACING</span><strong>{settings?.min_seconds_between_emails}s</strong></div></div>
        <div className="config-note">Keep limits low. Change <code>DRY_RUN=false</code> in <code>.env</code> only after using preview mode and verifying your Gmail setup.</div>
      </section>
    </div>
  </>;
}

function EmptyState({ title, detail, action }) {
  return <div className="empty-state"><div className="empty-icon">✳</div><strong>{title}</strong><p>{detail}</p>{action}</div>;
}

export default App;
