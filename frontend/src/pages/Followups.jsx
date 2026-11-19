import {
  ArrowUpRight,
  CalendarClock,
  CheckCircle2,
  Clock,
  Mail,
  Play,
  RefreshCw,
  Search,
  Sparkles,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Avatar,
  Button,
  EmptyState,
  GlassCard,
  PageHeader,
  SearchBar,
  StatusBadge,
  Tabs,
} from "../components/ui";
import { useWorkspace } from "../context/WorkspaceContext";
import { post } from "../lib/api";
import { formatDate, formatTimeAgo } from "../lib/format";

export function Followups() {
  const { followups, run, busy, notify } = useWorkspace();
  const [tab, setTab] = useState("all");
  const [query, setQuery] = useState("");
  const [running, setRunning] = useState(false);

  const now = Date.now();
  const isDue = (item) => item.followup_due_at && new Date(item.followup_due_at).getTime() <= now;

  const counts = useMemo(() => ({
    all: followups.length,
    due: followups.filter(isDue).length,
    upcoming: followups.filter((item) => !isDue(item)).length,
    withDraft: followups.filter((item) => item.followup_draft_id).length,
  }), [followups]);

  const visible = useMemo(() => {
    const term = query.trim().toLowerCase();
    return followups.filter((item) => {
      const contact = item.contact || {};
      const matchesQuery = !term || `${contact.company_name} ${contact.hr_name} ${contact.email} ${contact.role}`.toLowerCase().includes(term);
      if (!matchesQuery) return false;
      if (tab === "due") return isDue(item);
      if (tab === "upcoming") return !isDue(item);
      if (tab === "drafts") return Boolean(item.followup_draft_id);
      return true;
    });
  }, [followups, query, tab]);

  const runAutomation = async () => {
    setRunning(true);
    try {
      const result = await post("/followups/run", {});
      notify(result?.processed != null ? `Follow-up review complete: ${result.processed} processed.` : "Follow-up automation completed.");
    } catch (error) {
      notify(error.message, "error");
    } finally {
      setRunning(false);
    }
  };

  const markReviewed = async (item) => {
    await run(
      () => post(`/followups/${item.id}/complete`, {}),
      "Follow-up marked as reviewed.",
    );
  };

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Relationship rhythm"
        title="Follow-ups"
        description="Keep every conversation warm with timely, human-reviewed follow-ups — never automatic noise."
        actions={(
          <>
            <Button variant="secondary" icon={RefreshCw} loading={running} onClick={runAutomation}>Run automation</Button>
            <Link to="/campaigns"><Button icon={CalendarClock}>Campaign manager</Button></Link>
          </>
        )}
      />

      <div className="stat-strip">
        <div><span className="stat-icon tone-amber"><Clock size={17} /></span><strong>{counts.due}</strong><small>Due now</small></div>
        <div><span className="stat-icon tone-blue"><CalendarClock size={17} /></span><strong>{counts.upcoming}</strong><small>Upcoming</small></div>
        <div><span className="stat-icon tone-violet"><Sparkles size={17} /></span><strong>{counts.withDraft}</strong><small>Drafts ready</small></div>
        <div><span className="stat-icon tone-teal"><Mail size={17} /></span><strong>{counts.all}</strong><small>Open follow-ups</small></div>
      </div>

      <GlassCard className="followup-toolbar">
        <Tabs
          value={tab}
          onChange={setTab}
          items={[
            { value: "all", label: "All open", count: counts.all },
            { value: "due", label: "Due now", count: counts.due },
            { value: "upcoming", label: "Upcoming", count: counts.upcoming },
            { value: "drafts", label: "Draft ready", count: counts.withDraft },
          ]}
        />
        <SearchBar value={query} onChange={setQuery} placeholder="Search follow-ups..." />
      </GlassCard>

      {visible.length ? (
        <div className="followup-list">
          {visible.map((item) => {
            const contact = item.contact || {};
            const due = isDue(item);
            return (
              <GlassCard className={`followup-card ${due ? "due" : ""}`.trim()} key={item.id}>
                <div className="followup-main">
                  <Avatar name={contact.company_name} />
                  <div className="followup-copy">
                    <div className="followup-title">
                      <strong>{contact.company_name}</strong>
                      <StatusBadge status={due ? "DUE" : "UPCOMING"} />
                      {item.followup_draft_id ? <StatusBadge status="DRAFT" dot={false} /> : null}
                    </div>
                    <span>{contact.hr_name || "Hiring Team"} · {contact.email}</span>
                    <p>Original message sent {formatTimeAgo(item.occurred_at)}. Follow-up {due ? "is due now" : `scheduled for ${formatDate(item.followup_due_at)}`}.</p>
                  </div>
                </div>
                <div className="followup-actions">
                  {item.followup_draft_id ? (
                    <Link to={`/studio?contact=${contact.id}&draft=${item.followup_draft_id}`}>
                      <Button variant="secondary" size="sm" icon={Sparkles}>Review draft</Button>
                    </Link>
                  ) : (
                    <Link to={`/studio?contact=${contact.id}`}>
                      <Button variant="secondary" size="sm" icon={Mail}>Open studio</Button>
                    </Link>
                  )}
                  <Button variant="ghost" size="sm" icon={CheckCircle2} loading={busy} onClick={() => markReviewed(item)}>Mark reviewed</Button>
                </div>
              </GlassCard>
            );
          })}
        </div>
      ) : (
        <GlassCard>
          <EmptyState
            icon={CalendarClock}
            title="No follow-ups in this view"
            description="When a sent conversation becomes due for a nudge, it will appear here with a ready-to-review draft when available."
            action={<Link to="/campaigns"><Button icon={Play}>Start outreach</Button></Link>}
          />
        </GlassCard>
      )}

      <GlassCard className="safety-banner">
        <span className="safety-icon"><CheckCircle2 size={20} /></span>
        <div>
          <strong>Human review stays in the loop</strong>
          <p>Follow-up automation prepares reminders and drafts only when enabled. Every outbound email still requires approval and respects opt-outs, daily caps, and your dry-run setting.</p>
        </div>
        <Link to="/settings" className="text-link">Review safety settings <ArrowUpRight size={14} /></Link>
      </GlassCard>
    </div>
  );
}
