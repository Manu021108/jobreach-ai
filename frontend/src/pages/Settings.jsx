import {
  AlertTriangle,
  ArrowUpRight,
  Bot,
  CheckCircle2,
  CreditCard,
  KeyRound,
  LockKeyhole,
  Mail,
  Save,
  ShieldCheck,
  Sparkles,
  Unplug,
  UserRound,
  AlertCircle,
  Wifi,
  WifiOff,
  ArrowRight,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Button,
  ConfirmDialog,
  GlassCard,
  Modal,
  PageHeader,
  ProgressRing,
  SectionHeading,
  StatusBadge,
} from "../components/ui";
import { useWorkspace } from "../context/WorkspaceContext";
import { api, post, put } from "../lib/api";
import { formatDate, money } from "../lib/format";

const TABS = [
  { id: "profile", label: "Profile", icon: UserRound },
  { id: "sending", label: "Sending & safety", icon: ShieldCheck },
  { id: "connections", label: "Connections", icon: Mail },
  { id: "billing", label: "Plan & billing", icon: CreditCard },
];

export function Settings() {
  const { settings, billing, user, setUser, run, busy, refresh, notify, signOut } = useWorkspace();
  const [tab, setTab] = useState("profile");
  const [form, setForm] = useState({
    full_name: "",
    phone: "",
    location: "",
    linkedin: "",
    github: "",
    summary: "",
    skills: "",
    target_roles: "",
  });
  const [dryRunConfirm, setDryRunConfirm] = useState(false);
  const [gmailConfirm, setGmailConfirm] = useState(false);
  const [testingAi, setTestingAi] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [freeUnlocking, setFreeUnlocking] = useState(false);
  const [llmStatus, setLlmStatus] = useState(null);
  const [checkingLlm, setCheckingLlm] = useState(false);
  const [showLlmGuide, setShowLlmGuide] = useState(false);

  useEffect(() => {
    if (!settings) return;
    setForm({
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

  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));

  const saveProfile = async () => {
    const result = await run(
      () => put("/profile", form),
      "Profile saved. AI drafts will use the updated context.",
    );
    if (result?.user) setUser(result.user);
  };

  const toggleDryRun = async () => {
    setDryRunConfirm(false);
    await run(
      () => put("/settings/dry-run", { dry_run: !settings?.dry_run }),
      settings?.dry_run ? "Dry-run disabled. Sends now require manual confirmation." : "Dry-run enabled. No email will actually be delivered.",
    );
  };

  const connectGmail = async () => {
    setConnecting(true);
    try {
      const result = await api("/settings/gmail", { method: "POST" });
      if (result?.authorization_url) window.location.href = result.authorization_url;
    } catch (error) {
      notify(error.message, "error");
    } finally {
      setConnecting(false);
    }
  };

  const disconnectGmail = async () => {
    setGmailConfirm(false);
    await run(() => post("/gmail/disconnect", {}), "Gmail disconnected.");
  };

  const testAi = async () => {
    setTestingAi(true);
    try {
      const result = await post("/settings/test-ai", {});
      notify(`AI connection healthy. Response: ${result.response || "READY"}`);
    } catch (error) {
      notify(error.message, "error");
    } finally {
      setTestingAi(false);
    }
  };

  const unlockDatabase = async () => {
    try {
      const result = await post("/billing/checkout", {});
      if (result?.url) window.location.href = result.url;
    } catch (error) {
      notify(error.message, "error");
    }
  };

  const unlockDatabaseFree = async () => {
    setFreeUnlocking(true);
    try {
      const result = await post("/billing/free-unlock", {});
      await refresh();
      notify(`All emails unlocked. Imported ${result.imported} contacts to Companies${result.skipped ? `, skipped ${result.skipped} existing` : ""}.`);
    } catch (error) {
      notify(error.message, "error");
    } finally {
      setFreeUnlocking(false);
    }
  };

  const checkLlmStatus = async () => {
    setCheckingLlm(true);
    try {
      const result = await api("/settings/llm-status");
      setLlmStatus(result);
      if (!result.available) {
        setShowLlmGuide(true);
      }
    } catch (error) {
      notify(error.message, "error");
    } finally {
      setCheckingLlm(false);
    }
  };

  useEffect(() => {
    if (tab === "connections") {
      checkLlmStatus();
    }
  }, [tab]);

  const profileFields = [form.summary, form.skills, form.target_roles, settings?.resume_name, form.linkedin || form.github, form.location];
  const completeness = Math.round((profileFields.filter(Boolean).length / profileFields.length) * 100);
  const onboarding = settings?.onboarding || {};

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Your workspace"
        title="Profile & settings"
        description="Keep your sender identity, safety controls, and integrations accurate so every action stays intentional."
        actions={<Button icon={Save} loading={busy} onClick={saveProfile} disabled={tab !== "profile"}>Save changes</Button>}
      />

      <div className="settings-layout">
        <GlassCard className="settings-nav">
          <div className="settings-identity">
            <span className="profile-avatar large">{form.full_name?.slice(0, 1)?.toUpperCase() || "J"}</span>
            <strong>{form.full_name || "Your profile"}</strong>
            <span>{user?.email}</span>
            <StatusBadge status={user?.is_verified ? "VERIFIED" : "UNVERIFIED"} />
          </div>
          <nav>
            {TABS.map((item) => {
              const Icon = item.icon;
              return (
                <button type="button" key={item.id} className={tab === item.id ? "active" : ""} onClick={() => setTab(item.id)}>
                  <Icon size={17} /><span>{item.label}</span>
                </button>
              );
            })}
          </nav>
          <div className="settings-signout">
            <button type="button" onClick={signOut}>Sign out of this device</button>
          </div>
        </GlassCard>

        <div className="settings-main">
          {tab === "profile" ? (
            <>
              <GlassCard>
                <SectionHeading title="Sender profile" description="This context grounds every AI draft you generate." />
                <div className="form-grid">
                  <label className="field"><span>Full name</span><input value={form.full_name} onChange={(event) => update("full_name", event.target.value)} placeholder="Your full name" /></label>
                  <label className="field"><span>Phone</span><input value={form.phone} onChange={(event) => update("phone", event.target.value)} placeholder="Optional" /></label>
                  <label className="field"><span>Location</span><input value={form.location} onChange={(event) => update("location", event.target.value)} placeholder="City, country" /></label>
                  <label className="field"><span>Target roles</span><input value={form.target_roles} onChange={(event) => update("target_roles", event.target.value)} placeholder="Product Designer, UX Researcher" /></label>
                  <label className="field"><span>LinkedIn</span><input value={form.linkedin} onChange={(event) => update("linkedin", event.target.value)} placeholder="https://linkedin.com/in/..." /></label>
                  <label className="field"><span>GitHub</span><input value={form.github} onChange={(event) => update("github", event.target.value)} placeholder="https://github.com/..." /></label>
                  <label className="field full"><span>Skills</span><input value={form.skills} onChange={(event) => update("skills", event.target.value)} placeholder="Comma-separated skills" /></label>
                  <label className="field full"><span>Professional summary</span><textarea rows={5} value={form.summary} onChange={(event) => update("summary", event.target.value)} placeholder="A concise summary of your experience, strengths, and what you're looking for." /></label>
                </div>
                <div className="form-footer">
                  <span>Changes apply to future drafts only.</span>
                  <Button icon={Save} loading={busy} onClick={saveProfile}>Save profile</Button>
                </div>
              </GlassCard>

              <div className="content-grid two-thirds">
                <GlassCard>
                  <SectionHeading title="Application assets" description="Resume and profile readiness" />
                  <div className="asset-row">
                    <span className="asset-icon"><UserRound size={19} /></span>
                    <div><strong>{settings?.resume_name || "No resume uploaded"}</strong><span>{settings?.resume_name ? "PDF ready for approved sends" : "Upload a PDF before sending"}</span></div>
                    <Link to="/resume"><Button variant="secondary" size="sm">Manage</Button></Link>
                  </div>
                  <div className="asset-row">
                    <span className="asset-icon"><Mail size={19} /></span>
                    <div><strong>{settings?.gmail_connected ? settings.gmail_email : "Gmail not connected"}</strong><span>{settings?.gmail_connected ? "OAuth connection active" : "Connect to send outreach"}</span></div>
                    <Button variant="secondary" size="sm" onClick={() => setTab("connections")}>Review</Button>
                  </div>
                </GlassCard>

                <GlassCard className="readiness-mini">
                  <ProgressRing value={completeness} size={96} />
                  <div>
                    <strong>Profile readiness</strong>
                    <span>{completeness}% complete</span>
                    <small>{onboarding.profile_complete ? "Profile requirements complete." : "Add summary, skills, and target roles for better drafts."}</small>
                  </div>
                </GlassCard>
              </div>
            </>
          ) : null}

          {tab === "sending" ? (
            <>
              <GlassCard>
                <SectionHeading title="Sending safety" description="These controls are enforced by the backend, not just the interface." />
                <div className="safety-toggle">
                  <div>
                    <strong>Dry-run mode</strong>
                    <p>When enabled, send actions are simulated and no email leaves your account.</p>
                  </div>
                  <button type="button" className={`switch ${settings?.dry_run ? "on" : ""}`.trim()} onClick={() => settings?.dry_run ? toggleDryRun() : setDryRunConfirm(true)} aria-label="Toggle dry-run mode">
                    <span />
                  </button>
                </div>
                <div className="safety-toggle">
                  <div><strong>Human approval required</strong><p>Every outbound message must be reviewed, approved, and confirmed by recipient email.</p></div>
                  <StatusBadge status="READY" />
                </div>
                <div className="safety-toggle">
                  <div><strong>Opt-out protection</strong><p>Opted-out contacts are excluded from all new drafts, campaigns, and sends.</p></div>
                  <StatusBadge status="ACTIVE" />
                </div>
              </GlassCard>

              <GlassCard>
                <SectionHeading title="Sending limits" description="Configured at the workspace level" />
                <div className="settings-stats">
                  <div><span>Daily cap</span><strong>{settings?.max_emails_per_day ?? "—"}</strong><small>emails per day</small></div>
                  <div><span>Per run</span><strong>{settings?.max_emails_per_run ?? "—"}</strong><small>emails per run</small></div>
                  <div><span>Minimum gap</span><strong>{settings?.min_seconds_between_emails ?? "—"}s</strong><small>between sends</small></div>
                  <div><span>Follow-up automation</span><strong>{settings?.followup_auto_draft_enabled ? "On" : "Off"}</strong><small>{settings?.followup_max_per_run ?? 0} per run</small></div>
                </div>
                <div className="safety-note"><AlertTriangle size={16} /><span>Limits protect deliverability and recipient trust. Changes require backend configuration by the workspace owner.</span></div>
              </GlassCard>
            </>
          ) : null}

          {tab === "connections" ? (
            <>
              <GlassCard>
                <SectionHeading title="Gmail connection" description="Sending and reply sync use your own Google account." />
                <div className="connection-card">
                  <span className={`connection-icon ${settings?.gmail_connected ? "connected" : ""}`}><Mail size={24} /></span>
                  <div>
                    <strong>{settings?.gmail_connected ? "Gmail is connected" : "Connect your Gmail account"}</strong>
                    <span>{settings?.gmail_connected ? settings.gmail_email : "OAuth authorization is required before sending."}</span>
                    {settings?.gmail_connected && settings.gmail_expires_at ? <small>Token expires {formatDate(settings.gmail_expires_at)}</small> : null}
                  </div>
                  {settings?.gmail_connected ? (
                    <Button variant="danger" icon={Unplug} onClick={() => setGmailConfirm(true)}>Disconnect</Button>
                  ) : (
                    <Button icon={Mail} loading={connecting} onClick={connectGmail}>Connect Gmail</Button>
                  )}
                </div>
                {settings?.gmail_needs_reconnect ? <div className="safety-note"><AlertTriangle size={16} /><span>Reconnection is required before the next send.</span></div> : null}
              </GlassCard>

              <GlassCard>
                <SectionHeading title="AI provider" description="Used for draft generation and job matching." />
                <div className="connection-card">
                  <span className={`connection-icon ${llmStatus?.available ? "connected" : "disconnected"}`}>
                    {llmStatus?.available ? <Wifi size={24} /> : <WifiOff size={24} />}
                  </span>
                  <div>
                    <strong>{settings?.ai_provider || "Configured provider"}</strong>
                    <span>{settings?.ai_model || "Model not reported"}</span>
                    <small>{settings?.ai_base_url || "Default endpoint"}</small>
                    {llmStatus !== null && (
                      <span className={llmStatus.available ? "status-available" : "status-unavailable"}>
                        {llmStatus.available ? "● Available" : "● Unavailable — using templates"}
                      </span>
                    )}
                  </div>
                  <Button variant="secondary" icon={Sparkles} loading={testingAi} onClick={testAi}>Test connection</Button>
                  <Button variant="secondary" size="sm" icon={AlertCircle} loading={checkingLlm} onClick={checkLlmStatus}>
                    {llmStatus === null ? "Check status" : "Refresh"}
                  </Button>
                </div>
                {!llmStatus?.available && llmStatus !== null && (
                  <div className="llm-unavailable-notice">
                    <AlertCircle size={18} />
                    <div>
                      <strong>Local LLM not available</strong>
                      <p>{llmStatus.message}</p>
                      <p className="fallback-notice">Fallback mode: Using template-based drafts with limited personalization.</p>
                    </div>
                  </div>
                )}
              </GlassCard>

              <GlassCard>
                <SectionHeading title="Privacy & data" description="Workspace boundaries" />
                <div className="privacy-list">
                  <div><LockKeyhole size={17} /><p>Contacts, drafts, resumes, and audit logs are scoped to your signed-in account.</p></div>
                  <div><ShieldCheck size={17} /><p>Unsubscribe links are signed and opt-outs are enforced before sending.</p></div>
                  <div><Mail size={17} /><p>Emails are sent through Gmail only after explicit human confirmation.</p></div>
                </div>
              </GlassCard>
            </>
          ) : null}

          {tab === "billing" ? (
            <>
              <GlassCard>
                <SectionHeading title="Current plan" description="Your workspace access and HR database entitlement." />
                <div className="billing-card">
                  <div className="billing-plan">
                    <span className="billing-icon"><CreditCard size={22} /></span>
                    <div><strong>{billing?.unlocked ? "HR Database unlocked" : "Starter workspace"}</strong><span>{billing?.unlocked ? "Verified HR contacts are available." : "Core outreach tools are available."}</span></div>
                    <StatusBadge status={billing?.unlocked ? "ACTIVE" : "READY"} />
                  </div>
                  {!billing?.unlocked ? (
                    <div className="billing-offer">
                      <div><strong>Unlock the verified HR database</strong><span>One-time purchase {money(billing?.amount_total, billing?.currency || "INR")}</span></div>
                      <div className="billing-offer-actions">
                        {billing?.free_unlock_enabled ? (
                          <Button variant="secondary" size="sm" icon={KeyRound} loading={freeUnlocking} onClick={unlockDatabaseFree}>Free access</Button>
                        ) : null}
                        <Button size="sm" icon={LockKeyhole} onClick={unlockDatabase}>Unlock database</Button>
                      </div>
                    </div>
                  ) : (
                    <div className="billing-activated"><CheckCircle2 size={17} /> Access activated {billing.activated_at ? formatDate(billing.activated_at) : ""}</div>
                  )}
                </div>
              </GlassCard>
              <GlassCard>
                <SectionHeading title="Billing history" description="Latest payment order" />
                {billing?.order ? (
                  <div className="settings-stats">
                    <div><span>Status</span><strong>{billing.order.status}</strong><small>payment state</small></div>
                    <div><span>Amount</span><strong>{billing.order.amount_total != null ? (billing.order.amount_total / 100).toLocaleString() : "—"}</strong><small>{billing.order.currency?.toUpperCase()}</small></div>
                    <div><span>Paid</span><strong>{billing.order.paid_at ? formatDate(billing.order.paid_at) : "Pending"}</strong><small>last order</small></div>
                  </div>
                ) : <p className="table-muted">No payment orders yet.</p>}
                <Link to="/unlock" className="text-link">Open HR database <ArrowUpRight size={14} /></Link>
              </GlassCard>
            </>
          ) : null}
        </div>
      </div>

      <ConfirmDialog
        open={dryRunConfirm}
        onClose={() => setDryRunConfirm(false)}
        onConfirm={toggleDryRun}
        title="Disable dry-run mode?"
        description="Emails can be delivered once approved and confirmed. Make sure your Gmail connection and sender profile are ready."
        confirmLabel="Disable dry run"
        tone="danger"
        loading={busy}
      />
      <ConfirmDialog
        open={gmailConfirm}
        onClose={() => setGmailConfirm(false)}
        onConfirm={disconnectGmail}
        title="Disconnect Gmail?"
        description="Sending and reply sync will stop until you reconnect. Existing drafts and contacts are preserved."
        confirmLabel="Disconnect Gmail"
        tone="danger"
        loading={busy}
      />
      <Modal
        open={showLlmGuide}
        onClose={() => setShowLlmGuide(false)}
        title="Local LLM Setup Required"
        description="Ollama is not running. Install it to enable AI-powered draft generation."
        width="640px"
        footer={(
          <>
            <Button variant="ghost" onClick={() => setShowLlmGuide(false)}>Close</Button>
            <a href="https://ollama.com/download" target="_blank" rel="noopener noreferrer">
              <Button icon={ArrowRight}>Download Ollama</Button>
            </a>
          </>
        )}
      >
        <div className="llm-guide">
          <p>Ollama is not installed or not running. Follow these steps:</p>
          <ol>
            {llmStatus?.installation_guide?.map((step, i) => (
              <li key={i}>{step}</li>
            ))}
          </ol>
          <p>After installation, click <strong>Refresh</strong> in the AI provider section to verify the connection.</p>
        </div>
      </Modal>
    </div>
  );
}
