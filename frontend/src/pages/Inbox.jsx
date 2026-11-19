import {
  ArrowUpRight,
  CheckCircle2,
  Inbox as InboxIcon,
  Mail,
  MessageSquareReply,
  RefreshCw,
  Send,
  Sparkles,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Avatar,
  Button,
  EmptyState,
  GlassCard,
  PageHeader,
  SearchBar,
  SectionHeading,
  StatusBadge,
  Tabs,
} from "../components/ui";
import { useWorkspace } from "../context/WorkspaceContext";
import { post } from "../lib/api";
import { formatDate, formatTimeAgo, titleCase } from "../lib/format";

export function Inbox() {
  const { inbox, run, busy, notify, refresh, settings } = useWorkspace();
  const [tab, setTab] = useState("all");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState(null);
  const [syncing, setSyncing] = useState(false);

  const counts = useMemo(() => ({
    all: inbox.length,
    replied: inbox.filter((item) => item.reply_detected).length,
    awaiting: inbox.filter((item) => !item.reply_detected && !item.contact?.opted_out).length,
    optedOut: inbox.filter((item) => item.contact?.opted_out).length,
  }), [inbox]);

  const visible = useMemo(() => {
    const term = query.trim().toLowerCase();
    return inbox.filter((item) => {
      const contact = item.contact || {};
      const matches = !term || `${contact.company_name} ${contact.hr_name} ${contact.email} ${item.last_subject}`.toLowerCase().includes(term);
      if (!matches) return false;
      if (tab === "replied") return item.reply_detected;
      if (tab === "awaiting") return !item.reply_detected && !contact.opted_out;
      if (tab === "optedout") return contact.opted_out;
      return true;
    });
  }, [inbox, query, tab]);

  useEffect(() => {
    if (selectedId && visible.some((item) => item.contact?.id === selectedId)) return;
    setSelectedId(visible[0]?.contact?.id || null);
  }, [selectedId, visible]);

  const selected = inbox.find((item) => item.contact?.id === selectedId) || null;
  const contact = selected?.contact || null;

  const syncReplies = async () => {
    setSyncing(true);
    try {
      const result = await post("/replies/sync", {});
      notify(result?.updated != null ? `Inbox synced: ${result.updated} conversation${result.updated === 1 ? "" : "s"} updated.` : "Inbox synced.");
      await refresh();
    } catch (error) {
      notify(error.message, "error");
    } finally {
      setSyncing(false);
    }
  };

  const markReviewed = async () => {
    const sentEvent = selected?.history?.find((event) => event.type === "SENT" && event.id);
    if (!sentEvent) {
      notify("This conversation has no sent follow-up to mark reviewed.", "error");
      return;
    }
    await run(() => post(`/followups/${sentEvent.id}/complete`, {}), "Conversation marked as reviewed.");
  };

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Conversation center"
        title="Inbox"
        description="Track replies, opt-outs, and every touchpoint without losing the human thread."
        actions={(
          <>
            <Button variant="secondary" icon={RefreshCw} loading={syncing} onClick={syncReplies}>Sync replies</Button>
            <Link to="/studio"><Button icon={Sparkles}>Open studio</Button></Link>
          </>
        )}
      />

      <div className="stat-strip">
        <div><span className="stat-icon tone-teal"><InboxIcon size={17} /></span><strong>{counts.all}</strong><small>Conversations</small></div>
        <div><span className="stat-icon tone-violet"><MessageSquareReply size={17} /></span><strong>{counts.replied}</strong><small>Replies detected</small></div>
        <div><span className="stat-icon tone-blue"><Send size={17} /></span><strong>{counts.awaiting}</strong><small>Awaiting reply</small></div>
        <div><span className="stat-icon tone-coral"><Mail size={17} /></span><strong>{counts.optedOut}</strong><small>Opted out</small></div>
      </div>

      <GlassCard className="inbox-shell">
        <div className="inbox-list">
          <div className="inbox-list-head">
            <SectionHeading title="Threads" description={`${settings?.gmail_connected ? "Gmail connected" : "Gmail not connected"}`} />
            <SearchBar value={query} onChange={setQuery} placeholder="Search conversations..." />
            <Tabs
              value={tab}
              onChange={setTab}
              items={[
                { value: "all", label: "All", count: counts.all },
                { value: "replied", label: "Replies", count: counts.replied },
                { value: "awaiting", label: "Awaiting", count: counts.awaiting },
                { value: "optedout", label: "Opt-outs", count: counts.optedOut },
              ]}
            />
          </div>
          <div className="thread-list">
            {visible.length ? visible.map((item) => {
              const row = item.contact || {};
              return (
                <button
                  type="button"
                  className={`thread-item ${selectedId === row.id ? "active" : ""}`.trim()}
                  key={row.id}
                  onClick={() => setSelectedId(row.id)}
                >
                  <Avatar name={row.company_name} size="sm" />
                  <span className="thread-copy">
                    <span className="thread-title"><strong>{row.company_name}</strong><time>{formatTimeAgo(item.last_event_at)}</time></span>
                    <span className="thread-subject">{item.last_subject || "No subject"}</span>
                    <span className="thread-preview">{item.last_event_details || titleCase(item.last_event_type || "Conversation updated")}</span>
                  </span>
                  <span className="thread-badges">
                    {item.reply_detected ? <StatusBadge status="REPLIED" dot={false} /> : null}
                    {row.opted_out ? <StatusBadge status="OPTED_OUT" dot={false} /> : null}
                  </span>
                </button>
              );
            }) : <EmptyState compact icon={InboxIcon} title="No conversations" description="Synced replies and sent outreach will appear here." />}
          </div>
        </div>

        <div className="inbox-detail">
          {selected ? (
            <>
              <div className="inbox-detail-head">
                <div className="inbox-contact">
                  <Avatar name={contact.company_name} />
                  <div><strong>{contact.company_name}</strong><span>{contact.hr_name || "Hiring Team"} · {contact.email}</span></div>
                </div>
                <div className="inbox-detail-actions">
                  <StatusBadge status={contact.status} />
                  <Link to={`/studio?contact=${contact.id}`}><Button size="sm" icon={Sparkles}>Draft follow-up</Button></Link>
                </div>
              </div>

              <div className="conversation">
                <div className="conversation-subject">
                  <span>Subject</span>
                  <strong>{selected.last_subject || "No subject recorded"}</strong>
                </div>
                <div className="timeline">
                  {(selected.history || []).map((event) => (
                    <div className="timeline-item" key={event.id}>
                      <span className={`timeline-dot tone-${event.type === "REPLIED" ? "teal" : event.type === "SENT" ? "blue" : event.type === "OPTED_OUT" ? "coral" : "violet"}`} />
                      <div>
                        <div className="timeline-title"><strong>{titleCase(event.type)}</strong><time>{formatDate(event.occurred_at)}</time></div>
                        <p>{event.details || "No additional details recorded."}</p>
                      </div>
                    </div>
                  ))}
                  {!selected.history?.length ? <EmptyState compact icon={Mail} title="No event history" description="This thread has no recorded outreach events yet." /> : null}
                </div>
              </div>

              <div className="inbox-reply-note">
                <CheckCircle2 size={17} />
                <p>{selected.reply_detected ? "A reply was detected. Continue the conversation thoughtfully from your own email client or open the studio to prepare a follow-up." : "No reply detected yet. Follow-up reminders are managed from the Follow-ups page."}</p>
              </div>
            </>
          ) : (
            <EmptyState icon={InboxIcon} title="Select a conversation" description="Choose a thread to view its timeline and next action." />
          )}
        </div>

        <aside className="inbox-aside">
          {contact ? (
            <>
              <SectionHeading title="Contact" />
              <div className="inbox-contact-card">
                <Avatar name={contact.company_name} size="lg" />
                <strong>{contact.company_name}</strong>
                <span>{contact.role || "Relevant opportunities"}</span>
                <StatusBadge status={contact.status} />
              </div>
              <div className="aside-details">
                <div><span>Email</span><strong>{contact.email}</strong></div>
                <div><span>Location</span><strong>{contact.location || "Not specified"}</strong></div>
                <div><span>Website</span><strong>{contact.website || "Not specified"}</strong></div>
                <div><span>Thread</span><strong>{selected?.thread_id || "Not linked"}</strong></div>
              </div>
              <div className="aside-actions">
                <Link to={`/studio?contact=${contact.id}`}><Button variant="secondary" size="sm" icon={Sparkles}>Open studio</Button></Link>
                <Button variant="ghost" size="sm" icon={CheckCircle2} loading={busy} onClick={markReviewed}>Mark reviewed</Button>
              </div>
              <div className="aside-drafts">
                <span>Recent drafts</span>
                {selected?.drafts?.length ? selected.drafts.map((draft) => (
                  <Link key={draft.id} to={`/studio?contact=${contact.id}&draft=${draft.id}`} className="aside-draft">
                    <span><strong>{draft.subject || "Untitled draft"}</strong><small>{formatDate(draft.created_at, { hour: undefined, minute: undefined })}</small></span>
                    <StatusBadge status={draft.status} dot={false} />
                  </Link>
                )) : <p className="table-muted">No drafts for this contact.</p>}
              </div>
              {contact.website ? <a href={contact.website} target="_blank" rel="noreferrer" className="text-link">Visit website <ArrowUpRight size={14} /></a> : null}
            </>
          ) : <p className="table-muted">Select a conversation to see contact context.</p>}
        </aside>
      </GlassCard>
    </div>
  );
}
