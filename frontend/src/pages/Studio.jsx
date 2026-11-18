import {
  AlertCircle,
  ArrowUpRight,
  Check,
  CheckCircle2,
  Clock,
  Eye,
  FileText,
  Mail,
  PenLine,
  Save,
  Send,
  ShieldCheck,
  Sparkles,
  UserRound,
  Wand2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Avatar,
  Button,
  EmptyState,
  GlassCard,
  Modal,
  PageHeader,
  SearchBar,
  SectionHeading,
  StatusBadge,
} from "../components/ui";
import { useWorkspace } from "../context/WorkspaceContext";
import { api, post, put } from "../lib/api";
import { formatDate } from "../lib/format";
import { generationModes } from "../lib/navigation";

export function Studio() {
  const { contacts, drafts, run, busy, notify, settings, refresh } = useWorkspace();
  const [searchParams] = useSearchParams();
  const appliedQuery = useRef("");
  const [search, setSearch] = useState("");
  const [selectedContactId, setSelectedContactId] = useState(null);
  const [selectedDraftId, setSelectedDraftId] = useState(null);
  const [mode, setMode] = useState("general");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [context, setContext] = useState("");
  const [generating, setGenerating] = useState(false);
  const [savingContext, setSavingContext] = useState(false);
  const [preview, setPreview] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const [typedRecipient, setTypedRecipient] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [sending, setSending] = useState(false);

  const eligibleContacts = useMemo(
    () => contacts.filter((contact) => !contact.opted_out),
    [contacts],
  );

  const filteredContacts = useMemo(() => {
    const term = search.trim().toLowerCase();
    return eligibleContacts.filter((contact) => !term || `${contact.company_name} ${contact.hr_name} ${contact.email} ${contact.role}`.toLowerCase().includes(term));
  }, [eligibleContacts, search]);

  useEffect(() => {
    if (selectedContactId || !eligibleContacts.length) return;
    setSelectedContactId(eligibleContacts[0].id);
  }, [eligibleContacts, selectedContactId]);

  useEffect(() => {
    if (!selectedContactId) return;
    const contact = contacts.find((item) => item.id === selectedContactId);
    setContext(contact?.company_context || "");
  }, [contacts, selectedContactId]);

  useEffect(() => {
    const requestedDraft = Number(searchParams.get("draft"));
    const requestedContact = Number(searchParams.get("contact"));
    const queryKey = `${requestedContact || ""}:${requestedDraft || ""}`;
    if (!queryKey || queryKey === ":" || appliedQuery.current === queryKey) return;
    if (requestedDraft) {
      const draft = drafts.find((item) => item.id === requestedDraft);
      if (draft) {
        setSelectedContactId(draft.contact_id);
        setSelectedDraftId(draft.id);
        setSubject(draft.subject);
        setBody(draft.body);
        appliedQuery.current = queryKey;
        return;
      }
    }
    if (requestedContact && contacts.some((contact) => contact.id === requestedContact)) {
      setSelectedContactId(requestedContact);
      const latest = drafts.find((draft) => draft.contact_id === requestedContact);
      setSelectedDraftId(latest?.id || null);
      appliedQuery.current = queryKey;
    }
  }, [contacts, drafts, searchParams]);

  const contactDrafts = useMemo(
    () => drafts.filter((draft) => draft.contact_id === selectedContactId),
    [drafts, selectedContactId],
  );

  useEffect(() => {
    if (!selectedContactId) return;
    if (selectedDraftId && contactDrafts.some((draft) => draft.id === selectedDraftId)) return;
    const latest = contactDrafts[0];
    setSelectedDraftId(latest?.id || null);
  }, [contactDrafts, selectedContactId, selectedDraftId]);

  const selectedContact = contacts.find((contact) => contact.id === selectedContactId) || null;
  const selectedDraft = drafts.find((draft) => draft.id === selectedDraftId) || null;
  const isApproved = selectedDraft?.status === "APPROVED";
  const isSent = ["SENT", "REPLIED"].includes(selectedContact?.status);
  const dirty = Boolean(
    selectedDraft
      ? subject !== selectedDraft.subject || body !== selectedDraft.body
      : subject.trim() || body.trim(),
  );

  useEffect(() => {
    if (!selectedDraft) {
      if (!selectedContactId) {
        setSubject("");
        setBody("");
      }
      return;
    }
    setSubject(selectedDraft.subject);
    setBody(selectedDraft.body);
  }, [selectedDraft, selectedContactId]);

  const selectContact = (contactId) => {
    setSelectedContactId(contactId);
    setSelectedDraftId(null);
    setSubject("");
    setBody("");
  };

  const newDraft = () => {
    setSelectedDraftId(null);
    setSubject("");
    setBody("");
  };

  const handleGenerate = async () => {
    if (!selectedContact) return;
    setGenerating(true);
    try {
      const result = await post(`/contacts/${selectedContact.id}/generate`, {
        company_context: context,
        mode,
      });
      setSubject(result.subject || "");
      setBody(result.body || "");
      setSelectedDraftId(null);
      notify("Draft generated. Review and personalize before saving.");
    } catch (error) {
      notify(error.message, "error");
    } finally {
      setGenerating(false);
    }
  };

  const handleSave = async () => {
    if (!selectedContact) return;
    if (!subject.trim() || !body.trim()) {
      notify("Add a subject and message before saving.", "error");
      return;
    }
    if (selectedDraftId) {
      const result = await run(
        () => put(`/drafts/${selectedDraftId}`, { subject, body }),
        "Draft saved.",
      );
      if (result) refresh();
    } else {
      const result = await run(
        () => post(`/contacts/${selectedContact.id}/drafts`, { subject, body }),
        "Draft saved to your queue.",
      );
      if (result?.id) setSelectedDraftId(result.id);
    }
  };

  const handleApprove = async () => {
    if (!selectedDraftId) {
      notify("Save the draft before approving it.", "error");
      return;
    }
    if (dirty) {
      notify("Save your latest edits before approval.", "error");
      return;
    }
    const result = await run(
      () => post(`/drafts/${selectedDraftId}/approve`, {}),
      "Draft approved. Preview the final email before sending.",
    );
    if (result) refresh();
  };

  const handleContextSave = async () => {
    if (!selectedContact) return;
    setSavingContext(true);
    const result = await run(
      () => put(`/contacts/${selectedContact.id}/context`, { company_context: context }),
      "Company context updated.",
    );
    setSavingContext(false);
    return result;
  };

  const handlePreview = async () => {
    if (!selectedDraftId) return;
    setPreviewLoading(true);
    try {
      const result = await api(`/drafts/${selectedDraftId}/preview`);
      setPreview(result);
    } catch (error) {
      notify(error.message, "error");
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleSend = async () => {
    if (!selectedDraft || !reviewed || typedRecipient.trim().toLowerCase() !== selectedContact.email.toLowerCase()) {
      notify("Review the message and type the recipient email exactly.", "error");
      return;
    }
    setSending(true);
    try {
      await post(`/drafts/${selectedDraft.id}/send`, {
        reviewed: true,
        typed_recipient: typedRecipient.trim(),
      });
      notify("Email sent and logged in your activity trail.");
      setSendOpen(false);
      setTypedRecipient("");
      setReviewed(false);
      await refresh();
    } catch (error) {
      notify(error.message, "error");
    } finally {
      setSending(false);
    }
  };

  const openSend = () => {
    if (!isApproved) {
      notify("Approve this draft before sending.", "error");
      return;
    }
    setTypedRecipient("");
    setReviewed(false);
    setSendOpen(true);
  };

  return (
    <div className="page-stack studio-page">
      <PageHeader
        eyebrow="AI email studio"
        title="Craft outreach that feels human"
        description="Generate a thoughtful first draft, add your judgment, then approve and send with confidence."
        actions={(
          <>
            <Button variant="secondary" icon={PenLine} onClick={newDraft}>New draft</Button>
            <Button variant="secondary" icon={Eye} loading={previewLoading} onClick={handlePreview} disabled={!selectedDraftId}>Preview</Button>
            <Button icon={Save} loading={busy} onClick={handleSave} disabled={!selectedContact}>Save draft</Button>
          </>
        )}
      />

      <div className="studio-layout">
        <GlassCard className="studio-contacts">
          <SectionHeading title="Recipients" description={`${eligibleContacts.length} eligible contacts`} />
          <SearchBar value={search} onChange={setSearch} placeholder="Find a contact..." />
          <div className="studio-contact-list">
            {filteredContacts.length ? filteredContacts.map((contact) => (
              <button
                type="button"
                key={contact.id}
                className={`studio-contact ${selectedContactId === contact.id ? "active" : ""}`.trim()}
                onClick={() => selectContact(contact.id)}
              >
                <Avatar name={contact.company_name} size="sm" />
                <span className="studio-contact-copy">
                  <strong>{contact.company_name}</strong>
                  <small>{contact.hr_name || contact.email}</small>
                </span>
                <StatusBadge status={contact.status} dot={false} />
              </button>
            )) : <EmptyState compact icon={UserRound} title="No eligible contacts" description="Add a company first, then return to the studio." />}
          </div>
          <div className="studio-queue">
            <div className="studio-queue-head"><span>Draft queue</span><strong>{contactDrafts.length}</strong></div>
            {contactDrafts.slice(0, 5).map((draft) => (
              <button
                type="button"
                key={draft.id}
                className={`queue-item ${selectedDraftId === draft.id ? "active" : ""}`.trim()}
                onClick={() => setSelectedDraftId(draft.id)}
              >
                <span className="queue-dot" />
                <span><strong>{draft.subject || "Untitled draft"}</strong><small>{formatDate(draft.created_at, { hour: undefined, minute: undefined })}</small></span>
                <StatusBadge status={draft.status} dot={false} />
              </button>
            ))}
          </div>
        </GlassCard>

        <GlassCard className="composer-card">
          {selectedContact ? (
            <>
              <div className="composer-head">
                <div className="composer-recipient">
                  <Avatar name={selectedContact.company_name} />
                  <div>
                    <strong>{selectedContact.company_name}</strong>
                    <span>{selectedContact.hr_name || "Hiring Team"} · {selectedContact.email}</span>
                  </div>
                </div>
                <div className="composer-status">
                  <StatusBadge status={selectedContact.status} />
                  {dirty ? <span className="dirty-pill">Unsaved changes</span> : null}
                </div>
              </div>

              <div className="mode-row">
                {generationModes.map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      type="button"
                      key={item.id}
                      className={`mode-chip ${mode === item.id ? "active" : ""}`.trim()}
                      onClick={() => setMode(item.id)}
                    >
                      <Icon size={14} /> {item.label}
                    </button>
                  );
                })}
              </div>

              <label className="composer-field">
                <span>Subject</span>
                <input value={subject} onChange={(event) => setSubject(event.target.value)} placeholder="A concise, personal subject line" maxLength={500} />
              </label>

              <label className="composer-field grow">
                <span>Message</span>
                <textarea value={body} onChange={(event) => setBody(event.target.value)} placeholder="Write a thoughtful message, or generate a first draft with AI..." maxLength={50000} />
                <small>{body.length.toLocaleString()} / 50,000 characters</small>
              </label>

              <div className="composer-actions">
                <Button variant="secondary" icon={Sparkles} loading={generating} onClick={handleGenerate} disabled={isSent || selectedContact.opted_out}>
                  {body ? "Regenerate" : "Generate with AI"}
                </Button>
                <div className="composer-action-right">
                  <Button variant="ghost" icon={Save} loading={busy} onClick={handleSave}>Save</Button>
                  <Button variant="secondary" icon={CheckCircle2} loading={busy} onClick={handleApprove} disabled={!selectedDraftId || isApproved || dirty}>
                    {isApproved ? "Approved" : "Approve"}
                  </Button>
                  <Button icon={Send} onClick={openSend} disabled={!isApproved || isSent || selectedContact.opted_out}>Send email</Button>
                </div>
              </div>
              {isApproved ? <div className="approval-note"><ShieldCheck size={15} /> Approved. Preview the exact email and confirm the recipient before sending.</div> : null}
            </>
          ) : (
            <EmptyState icon={Mail} title="Choose a recipient" description="Select a company from the left to start a thoughtful outreach draft." />
          )}
        </GlassCard>

        <div className="studio-aside">
          <GlassCard className="ai-panel">
            <div className="ai-panel-head">
              <span className="ai-orb"><Wand2 size={18} /></span>
              <div><strong>AI copilot</strong><span>{settings?.ai_model || "Profile-aware writing"}</span></div>
            </div>
            <p>Ground every draft in your real profile and the company context you provide. AI proposes; you decide.</p>
            <div className="ai-tips">
              <div><Check size={14} /><span>Use one clear reason for reaching out.</span></div>
              <div><Check size={14} /><span>Keep the first message under 150 words.</span></div>
              <div><Check size={14} /><span>Ask for a conversation, not a job.</span></div>
            </div>
            <div className="ai-meta">
              <div><FileText size={15} /><span>Resume</span><strong>{settings?.resume_name || "Not attached"}</strong></div>
              <div><ShieldCheck size={15} /><span>Sending</span><strong>{settings?.dry_run ? "Dry run" : "Manual approval"}</strong></div>
              <div><Clock size={15} /><span>Daily limit</span><strong>{settings?.max_emails_per_day ?? "—"}</strong></div>
            </div>
          </GlassCard>

          {selectedContact ? (
            <GlassCard className="context-panel">
              <SectionHeading title="Company context" description="Used by AI when generating this draft." />
              <textarea rows={7} value={context} onChange={(event) => setContext(event.target.value)} placeholder="What does the company do? Why are you a fit? Add only verified context." />
              <div className="context-actions">
                <span>{context.length.toLocaleString()} characters</span>
                <Button variant="secondary" size="sm" icon={Save} loading={savingContext} onClick={handleContextSave}>Save context</Button>
              </div>
            </GlassCard>
          ) : null}

          {selectedContact?.job_url ? (
            <a className="context-link" href={selectedContact.job_url} target="_blank" rel="noreferrer">
              <span><FileText size={16} /><strong>Referenced job</strong><small>{selectedContact.job_url}</small></span>
              <ArrowUpRight size={15} />
            </a>
          ) : null}
        </div>
      </div>

      <Modal
        open={Boolean(preview)}
        onClose={() => setPreview(null)}
        title="Send preview"
        description="This is the exact message that will be delivered, including the opt-out footer."
        width="680px"
        footer={(
          <>
            <Button variant="ghost" onClick={() => setPreview(null)}>Close</Button>
            <Button icon={Send} onClick={() => { setPreview(null); openSend(); }}>Confirm recipient</Button>
          </>
        )}
      >
        {preview ? (
          <div className="email-preview">
            <div className="email-preview-meta">
              <div><span>To</span><strong>{preview.to}</strong></div>
              <div><span>Company</span><strong>{preview.company}</strong></div>
              <div><span>Subject</span><strong>{preview.subject}</strong></div>
              <div><span>Resume</span><strong>{preview.resume || "Not attached"}</strong></div>
            </div>
            <pre>{preview.body}</pre>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={sendOpen}
        onClose={() => setSendOpen(false)}
        title="Confirm this send"
        description="Sending is irreversible. Confirm that you reviewed the message and recipient."
        width="520px"
        footer={(
          <>
            <Button variant="ghost" onClick={() => setSendOpen(false)}>Cancel</Button>
            <Button icon={Send} loading={sending} onClick={handleSend} disabled={!reviewed || typedRecipient.trim().toLowerCase() !== selectedContact?.email?.toLowerCase()}>Send email</Button>
          </>
        )}
      >
        <div className="send-confirm">
          <div className="send-warning"><AlertCircle size={18} /><p>Type <strong>{selectedContact?.email}</strong> to confirm the recipient.</p></div>
          <label className="field"><span>Recipient email</span><input value={typedRecipient} onChange={(event) => setTypedRecipient(event.target.value)} placeholder={selectedContact?.email} autoComplete="off" /></label>
          <label className="check-row">
            <input type="checkbox" checked={reviewed} onChange={(event) => setReviewed(event.target.checked)} />
            <span>I reviewed the subject, message, attachments, and opt-out footer.</span>
          </label>
          <div className="send-summary">
            <div><span>To</span><strong>{selectedContact?.email}</strong></div>
            <div><span>Subject</span><strong>{selectedDraft?.subject}</strong></div>
            <div><span>Status</span><StatusBadge status={selectedDraft?.status} /></div>
          </div>
        </div>
      </Modal>
    </div>
  );
}
