import {
  Activity as ActivityIcon,
  ArrowUpRight,
  CheckCircle2,
  Download,
  FileText,
  Mail,
  RefreshCw,
  Settings,
  ShieldCheck,
  Sparkles,
  Users,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Button,
  EmptyState,
  GlassCard,
  PageHeader,
  Tabs,
} from "../components/ui";
import { useWorkspace } from "../context/WorkspaceContext";
import { formatDate, formatTimeAgo, titleCase } from "../lib/format";
import { auditLabels } from "../lib/navigation";

const OUTREACH = new Set(["EMAIL_SENT", "EMAIL_FAILED", "EMAIL_RETRY_SCHEDULED", "DRAFT_CREATED", "DRAFT_APPROVED", "FOLLOWUP_REVIEWED", "CAMPAIGN_STARTED", "CAMPAIGN_PAUSED"]);
const CONTACTS = new Set(["CONTACTS_IMPORTED", "CONTACT_CREATED", "CONTACT_STATUS_CHANGED", "CONTACT_UPDATED"]);
const SAFETY = new Set(["OPT_OUT_DETECTED", "UNSUBSCRIBE_LINK_USED", "DRY_RUN_ENABLED", "DRY_RUN_DISABLED", "REPLY_MATCHED"]);

function iconFor(action) {
  if (action === "EMAIL_SENT") return Mail;
  if (action === "DRAFT_APPROVED" || action === "DRAFT_CREATED") return Sparkles;
  if (action === "CONTACTS_IMPORTED" || action === "CONTACT_CREATED") return Users;
  if (SAFETY.has(action)) return ShieldCheck;
  if (action?.startsWith("SETTINGS")) return Settings;
  if (action === "EMAIL_FAILED") return ActivityIcon;
  return FileText;
}

function toneFor(action) {
  if (action === "EMAIL_FAILED" || action === "OPT_OUT_DETECTED") return "coral";
  if (action === "EMAIL_SENT" || action === "DRAFT_APPROVED") return "teal";
  if (action === "DRAFT_CREATED" || action === "FOLLOWUP_REVIEWED") return "violet";
  if (SAFETY.has(action)) return "amber";
  return "blue";
}

export function Activity() {
  const { auditLog, refresh, busy, notify } = useWorkspace();
  const [tab, setTab] = useState("all");
  const [query, setQuery] = useState("");

  const counts = useMemo(() => ({
    all: auditLog.length,
    outreach: auditLog.filter((item) => OUTREACH.has(item.action)).length,
    contacts: auditLog.filter((item) => CONTACTS.has(item.action)).length,
    safety: auditLog.filter((item) => SAFETY.has(item.action)).length,
  }), [auditLog]);

  const visible = useMemo(() => {
    const term = query.trim().toLowerCase();
    return auditLog.filter((item) => {
      const matches = !term || `${item.action} ${item.details} ${item.company_name} ${item.contact_email}`.toLowerCase().includes(term);
      if (!matches) return false;
      if (tab === "outreach") return OUTREACH.has(item.action);
      if (tab === "contacts") return CONTACTS.has(item.action);
      if (tab === "safety") return SAFETY.has(item.action);
      return true;
    });
  }, [auditLog, query, tab]);

  const grouped = useMemo(() => {
    const groups = new Map();
    for (const item of visible) {
      const date = item.created_at ? new Date(item.created_at) : null;
      const key = date && !Number.isNaN(date.getTime())
        ? date.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })
        : "Earlier";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    }
    return [...groups.entries()];
  }, [visible]);

  const exportAudit = () => {
    const header = "created_at,action,company,email,details";
    const rows = auditLog.map((item) => [item.created_at, item.action, item.company_name, item.contact_email, item.details].map((value) => `"${String(value ?? "").replace(/"/g, '""')}"`).join(","));
    const blob = new Blob([[header, ...rows].join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "jobreach-activity.csv";
    anchor.click();
    URL.revokeObjectURL(url);
    notify("Activity log exported.");
  };

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Trust & transparency"
        title="Activity log"
        description="Every import, draft, approval, send, reply, and safety action is recorded for a clear audit trail."
        actions={(
          <>
            <Button variant="secondary" icon={Download} onClick={exportAudit}>Export log</Button>
            <Button variant="secondary" icon={RefreshCw} loading={busy} onClick={refresh}>Refresh</Button>
          </>
        )}
      />

      <div className="stat-strip">
        <div><span className="stat-icon tone-teal"><ActivityIcon size={17} /></span><strong>{counts.all}</strong><small>Recorded events</small></div>
        <div><span className="stat-icon tone-blue"><Mail size={17} /></span><strong>{counts.outreach}</strong><small>Outreach actions</small></div>
        <div><span className="stat-icon tone-violet"><Users size={17} /></span><strong>{counts.contacts}</strong><small>Contact changes</small></div>
        <div><span className="stat-icon tone-amber"><ShieldCheck size={17} /></span><strong>{counts.safety}</strong><small>Safety events</small></div>
      </div>

      <GlassCard className="activity-toolbar">
        <Tabs
          value={tab}
          onChange={setTab}
          items={[
            { value: "all", label: "All activity", count: counts.all },
            { value: "outreach", label: "Outreach", count: counts.outreach },
            { value: "contacts", label: "Contacts", count: counts.contacts },
            { value: "safety", label: "Safety", count: counts.safety },
          ]}
        />
        <SearchBar value={query} onChange={setQuery} placeholder="Search the audit trail..." />
      </GlassCard>

      {grouped.length ? (
        <div className="audit-timeline">
          {grouped.map(([date, items]) => (
            <div className="audit-day" key={date}>
              <div className="audit-day-label"><span>{date}</span><i /></div>
              <div className="audit-day-items">
                {items.map((item) => {
                  const Icon = iconFor(item.action);
                  const tone = toneFor(item.action);
                  return (
                    <GlassCard className="audit-item" key={item.id}>
                      <span className={`audit-icon tone-${tone}`}><Icon size={17} /></span>
                      <div className="audit-copy">
                        <div className="audit-title">
                          <strong>{auditLabels[item.action] || titleCase(item.action)}</strong>
                          <time title={formatDate(item.created_at)}>{formatTimeAgo(item.created_at)}</time>
                        </div>
                        <p>{item.details || "No additional details."}</p>
                        {item.company_name ? (
                          <div className="audit-meta">
                            <span>{item.company_name}</span>
                            {item.contact_email ? <span>{item.contact_email}</span> : null}
                            {item.contact_id ? <Link to={`/studio?contact=${item.contact_id}`}>Open contact <ArrowUpRight size={12} /></Link> : null}
                          </div>
                        ) : null}
                      </div>
                    </GlassCard>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <GlassCard>
          <EmptyState
            icon={ActivityIcon}
            title="No activity in this view"
            description="Workspace actions will appear here as soon as you import contacts, prepare drafts, or send outreach."
          />
        </GlassCard>
      )}

      <GlassCard className="audit-footer">
        <CheckCircle2 size={18} />
        <p>The audit trail is append-only in normal use. Each entry includes a timestamp and is scoped to your workspace.</p>
      </GlassCard>
    </div>
  );
}
