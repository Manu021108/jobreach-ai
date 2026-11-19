import {
  ArrowUpRight,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Pause,
  Play,
  Plus,
  Rocket,
  Send,
  ShieldCheck,
  Sparkles,
  Users,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  Avatar,
  Button,
  ConfirmDialog,
  EmptyState,
  GlassCard,
  LoadingSkeleton,
  Modal,
  PageHeader,
  ProgressBar,
  SearchBar,
  StatusBadge,
} from "../components/ui";
import { useWorkspace } from "../context/WorkspaceContext";
import { post } from "../lib/api";
import { formatDate } from "../lib/format";

const BLOCKED = new Set(["SENT", "REPLIED", "OPTED_OUT", "NOT_INTERESTED", "ARCHIVED"]);

export function Campaigns() {
  const {
    contacts,
    contactsPage,
    contactsLoading,
    campaigns,
    run,
    busy,
    notify,
    settings,
    loadContacts,
    lookupContacts,
  } = useWorkspace();
  const [searchParams, setSearchParams] = useSearchParams();
  const autoOpened = useRef(false);
  const [generateOpen, setGenerateOpen] = useState(false);
  const [selected, setSelected] = useState([]);
  const [contactSearch, setContactSearch] = useState("");
  const [debouncedContactSearch, setDebouncedContactSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [expanded, setExpanded] = useState([]);
  const [confirm, setConfirm] = useState(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedContactSearch(contactSearch.trim()), 280);
    return () => window.clearTimeout(timer);
  }, [contactSearch]);

  useEffect(() => {
    if (!generateOpen) return;
    loadContacts({ q: debouncedContactSearch, eligible: true, sort: "company", page_size: 25 });
  }, [debouncedContactSearch, generateOpen, loadContacts]);

  useEffect(() => {
    if (autoOpened.current) return;
    const ids = searchParams.get("contacts");
    if (!ids) return;
    autoOpened.current = true;
    setSearchParams({}, { replace: true });
    const parsed = ids.split(",").map(Number).filter(Boolean);
    if (!parsed.length) return;
    let cancelled = false;
    const hydrate = async () => {
      const result = await lookupContacts(parsed);
      if (cancelled) return;
      const valid = result.rows
        .filter((contact) => !contact.opted_out && !BLOCKED.has(contact.status))
        .map((contact) => contact.id);
      if (valid.length) {
        setSelected(valid);
        setGenerateOpen(true);
      }
    };
    hydrate();
    return () => {
      cancelled = true;
    };
  }, [lookupContacts, searchParams, setSearchParams]);

  const visibleCampaigns = useMemo(() => {
    if (filter === "all") return campaigns;
    if (filter === "active") return campaigns.filter((campaign) => ["QUEUED", "RUNNING", "ACTIVE"].includes(campaign.status));
    if (filter === "draft") return campaigns.filter((campaign) => campaign.status === "DRAFT");
    return campaigns.filter((campaign) => ["COMPLETED", "PAUSED"].includes(campaign.status));
  }, [campaigns, filter]);

  const totals = useMemo(() => campaigns.reduce((result, campaign) => {
    const counts = campaign.counts || {};
    result.campaigns += 1;
    result.generated += counts.generated || 0;
    result.approved += counts.approved || 0;
    result.sent += counts.sent || 0;
    return result;
  }, { campaigns: 0, generated: 0, approved: 0, sent: 0 }), [campaigns]);

  const toggleSelected = (id) => {
    setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  };

  const handleGenerate = async () => {
    if (!selected.length) {
      notify("Select at least one eligible contact.", "error");
      return;
    }
    const result = await run(
      () => post("/campaigns/generate", { contact_ids: selected }),
      (response) => `Campaign created: ${response.generated} draft${response.generated === 1 ? "" : "s"} generated${response.failed ? `, ${response.failed} failed` : ""}.`,
    );
    if (result) {
      setGenerateOpen(false);
      setSelected([]);
      setContactSearch("");
    }
  };

  const approveAll = async (campaign) => {
    const draftIds = campaign.entries.filter((entry) => entry.state === "GENERATED" && entry.draft_id).map((entry) => entry.draft_id);
    if (!draftIds.length) {
      notify("No generated drafts are waiting for approval.", "error");
      return;
    }
    await run(
      () => post(`/campaigns/${campaign.id}/approve`, { draft_ids: draftIds }),
      (response) => `${response.approved} draft${response.approved === 1 ? "" : "s"} approved.`,
    );
  };

  const queueCampaign = async (campaign) => {
    await run(() => post(`/campaigns/${campaign.id}/queue`, {}), "Campaign queued for controlled sending.");
  };

  const performConfirmed = async () => {
    if (!confirm) return;
    const { campaign, action } = confirm;
    setConfirm(null);
    if (action === "start") {
      await run(() => post(`/campaigns/${campaign.id}/start`, {}), "Campaign started. Sending respects your daily cap and safety controls.");
    } else {
      await run(() => post(`/campaigns/${campaign.id}/pause`, {}), "Campaign paused.");
    }
  };

  const toggleExpanded = (id) => {
    setExpanded((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  };

  const campaignAction = (campaign) => {
    if (["QUEUED", "RUNNING", "ACTIVE"].includes(campaign.status)) {
      return <Button variant="secondary" size="sm" icon={Pause} onClick={() => setConfirm({ campaign, action: "pause" })}>Pause</Button>;
    }
    if (campaign.status === "PAUSED") {
      return <Button size="sm" icon={Play} onClick={() => setConfirm({ campaign, action: "start" })}>Resume</Button>;
    }
    if (campaign.status === "DRAFT") {
      const approved = campaign.counts?.approved || 0;
      if (approved) {
        return <Button size="sm" icon={Rocket} onClick={() => queueCampaign(campaign)}>Queue</Button>;
      }
      return <Button variant="secondary" size="sm" icon={CheckCircle2} onClick={() => approveAll(campaign)}>Approve drafts</Button>;
    }
    return null;
  };

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Campaign manager"
        title="Scale thoughtful outreach"
        description="Group contacts, generate personalized drafts, approve every message, and control sending pace."
        actions={(
          <>
            <Button variant="secondary" icon={Users} onClick={() => setGenerateOpen(true)}>Build campaign</Button>
            <Link to="/studio"><Button icon={Sparkles}>Open studio</Button></Link>
          </>
        )}
      />

      <div className={`campaign-safety ${settings?.dry_run ? "" : "manual"}`.trim()}>
        <ShieldCheck size={18} />
        <div>
          <strong>{settings?.dry_run ? "Safe mode: dry run" : "Safe mode: manual approval"}</strong>
          <span>{settings?.dry_run ? "Sends are simulated. No email is delivered while dry run is enabled." : "Every email still needs explicit approval and confirmation before delivery."}</span>
        </div>
      </div>

      <div className="stat-strip">
        <div><span className="stat-icon tone-teal"><Rocket size={17} /></span><strong>{totals.campaigns}</strong><small>Total campaigns</small></div>
        <div><span className="stat-icon tone-violet"><Sparkles size={17} /></span><strong>{totals.generated}</strong><small>Drafts generated</small></div>
        <div><span className="stat-icon tone-blue"><CheckCircle2 size={17} /></span><strong>{totals.approved}</strong><small>Approved</small></div>
        <div><span className="stat-icon tone-amber"><Send size={17} /></span><strong>{totals.sent}</strong><small>Emails sent</small></div>
      </div>

      <GlassCard className="campaign-toolbar">
        <div className="campaign-tabs">
          {[
            ["all", "All campaigns"],
            ["active", "Active"],
            ["draft", "Needs approval"],
            ["done", "Completed & paused"],
          ].map(([value, label]) => (
            <button type="button" key={value} className={filter === value ? "active" : ""} onClick={() => setFilter(value)}>{label}</button>
          ))}
        </div>
        <span className="table-hint">{visibleCampaigns.length} campaign{visibleCampaigns.length === 1 ? "" : "s"}</span>
      </GlassCard>

      {visibleCampaigns.length ? (
        <div className="campaign-list">
          {visibleCampaigns.map((campaign) => {
            const counts = campaign.counts || {};
            const isExpanded = expanded.includes(campaign.id);
            return (
              <GlassCard className="campaign-card" key={campaign.id}>
                <div className="campaign-head">
                  <div className="campaign-title">
                    <span className={`campaign-glyph status-${campaign.status === "COMPLETED" ? "teal" : campaign.status === "PAUSED" ? "amber" : "blue"}`}><Rocket size={18} /></span>
                    <div>
                      <strong>{campaign.name}</strong>
                      <span>Created {formatDate(campaign.created_at)} · {counts.total || 0} contacts</span>
                    </div>
                  </div>
                  <div className="campaign-head-actions">
                    <StatusBadge status={campaign.status} />
                    {campaignAction(campaign)}
                    <button type="button" className="expand-button" onClick={() => toggleExpanded(campaign.id)} aria-label={isExpanded ? "Collapse campaign" : "Expand campaign"}>
                      {isExpanded ? <ChevronUp size={17} /> : <ChevronDown size={17} />}
                    </button>
                  </div>
                </div>

                <div className="campaign-progress">
                  <ProgressBar value={campaign.progress || 0} label={`${counts.sent || 0} of ${counts.total || 0} sent`} tone={campaign.status === "COMPLETED" ? "teal" : "blue"} />
                  <div className="campaign-counts">
                    <span><strong>{counts.generated || 0}</strong> generated</span>
                    <span><strong>{counts.approved || 0}</strong> approved</span>
                    <span><strong>{counts.queued || 0}</strong> queued</span>
                    <span><strong>{counts.failed || 0}</strong> failed</span>
                  </div>
                </div>

                {campaign.next_send_at ? <div className="campaign-note"><Clock size={14} /> Next controlled send {formatDate(campaign.next_send_at)}</div> : null}
                {campaign.last_error ? <div className="campaign-error">{campaign.last_error}</div> : null}

                {isExpanded ? (
                  <div className="campaign-entries">
                    <div className="campaign-entries-head"><span>Recipient</span><span>Draft</span><span>State</span><span /></div>
                    {campaign.entries.map((entry) => (
                      <div className="campaign-entry" key={entry.id}>
                        <div className="entry-company"><Avatar name={entry.company_name} size="sm" /><div><strong>{entry.company_name}</strong><span>{entry.email}</span></div></div>
                        <span className="entry-subject">{entry.subject || "No draft yet"}</span>
                        <StatusBadge status={entry.state} dot={false} />
                        <Link className="text-link" to={`/studio?contact=${entry.contact_id}${entry.draft_id ? `&draft=${entry.draft_id}` : ""}`}>Review <ArrowUpRight size={13} /></Link>
                      </div>
                    ))}
                  </div>
                ) : null}
              </GlassCard>
            );
          })}
        </div>
      ) : (
        <GlassCard>
          <EmptyState
            icon={Rocket}
            title="No campaigns in this view"
            description="Build a campaign from your eligible companies, generate drafts, and approve each message before sending."
            action={<Button icon={Plus} onClick={() => setGenerateOpen(true)}>Build campaign</Button>}
          />
        </GlassCard>
      )}

      <Modal
        open={generateOpen}
        onClose={() => setGenerateOpen(false)}
        title="Build a campaign"
        description="Select eligible companies. AI will generate one personalized draft per contact for your review."
        width="720px"
        footer={(
          <>
            <Button variant="ghost" onClick={() => setGenerateOpen(false)}>Cancel</Button>
            <Button icon={Sparkles} loading={busy} onClick={handleGenerate} disabled={!selected.length}>Generate {selected.length || ""} draft{selected.length === 1 ? "" : "s"}</Button>
          </>
        )}
      >
        <div className="campaign-picker">
          <SearchBar value={contactSearch} onChange={setContactSearch} placeholder="Search eligible contacts..." />
          <div className="picker-toolbar">
            <button type="button" disabled={contactsLoading || !contacts.length} onClick={() => setSelected(contacts.map((contact) => contact.id))}>Select loaded rows</button>
            <button type="button" onClick={() => setSelected([])}>Clear</button>
            <span>{selected.length} selected · {contactsPage.total || 0} matching</span>
          </div>
          <div className="picker-list">
            {contactsLoading ? <LoadingSkeleton rows={5} /> : contacts.length ? contacts.map((contact) => (
              <label className={`picker-row ${selected.includes(contact.id) ? "selected" : ""}`.trim()} key={contact.id}>
                <input type="checkbox" checked={selected.includes(contact.id)} onChange={() => toggleSelected(contact.id)} />
                <Avatar name={contact.company_name} size="sm" />
                <span><strong>{contact.company_name}</strong><small>{contact.hr_name || "Hiring Team"} · {contact.email}</small></span>
                <StatusBadge status={contact.status} dot={false} />
              </label>
            )) : <EmptyState compact icon={Users} title="No eligible contacts" description="Contacts already sent, replied, or opted out are excluded." />}
          </div>
        </div>
        <div className="safety-note"><CheckCircle2 size={16} /><span>Every generated draft still requires human approval. Nothing sends automatically until you queue and start a campaign.</span></div>
      </Modal>

      <ConfirmDialog
        open={Boolean(confirm)}
        onClose={() => setConfirm(null)}
        onConfirm={performConfirmed}
        title={confirm?.action === "start" ? "Start controlled sending?" : "Pause this campaign?"}
        description={confirm?.action === "start"
          ? "Approved emails will be sent gradually within your daily cap. You can pause again at any time."
          : "Sending will stop after the current message finishes. Queued drafts remain available."}
        confirmLabel={confirm?.action === "start" ? "Start campaign" : "Pause campaign"}
        tone={confirm?.action === "start" ? "primary" : "danger"}
        loading={busy}
      />
    </div>
  );
}
