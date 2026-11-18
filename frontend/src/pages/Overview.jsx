import {
  ArrowUpRight,
  BarChart3,
  BriefcaseBusiness,
  CalendarClock,
  CheckCircle2,
  CircleDashed,
  Inbox,
  Mail,
  Plus,
  Search,
  Send,
  Sparkles,
  Target,
  Users,
} from "lucide-react";
import { Link } from "react-router-dom";
import { useWorkspace } from "../context/WorkspaceContext";
import { formatDate, formatTimeAgo, greeting, titleCase } from "../lib/format";
import { Avatar, Button, EmptyState, GlassCard, MetricCard, PageHeader, ProgressRing, SectionHeading, StatusBadge } from "../components/ui";

const quickActions = [
  { label: "Find new companies", description: "Build a targeted list", icon: Search, to: "/companies", tone: "teal" },
  { label: "Discover roles", description: "Explore verified openings", icon: BriefcaseBusiness, to: "/discovery", tone: "blue" },
  { label: "Write an email", description: "Start with AI guidance", icon: Sparkles, to: "/studio", tone: "violet" },
  { label: "Review follow-ups", description: "Keep conversations warm", icon: CalendarClock, to: "/followups", tone: "amber" },
];

export function Overview() {
  const { user, dashboard, analytics, contacts, followups, auditLog, campaigns, settings } = useWorkspace();
  const stats = dashboard?.stats || {};
  const totals = analytics?.totals || {};
  const series = analytics?.series || [];
  const recentContacts = dashboard?.recent_contacts || contacts.slice(0, 5);
  const priorityFollowups = followups.filter((item) => !item.completed).slice(0, 4);
  const recentActivity = (auditLog || []).slice(0, 5);
  const followupSummary = dashboard?.followups || {};
  const sentSpark = series.slice(-12).map((item) => item.sent);
  const replySpark = series.slice(-12).map((item) => item.replies);
  const preparedSpark = series.slice(-12).map((item) => item.prepared);
  const pipeline = analytics?.pipeline || {};
  const pipelineTotal = Object.values(pipeline).reduce((sum, count) => sum + count, 0) || 1;
  const activeCampaigns = campaigns.filter((item) => item.status === "ACTIVE").length;
  const topCompanies = analytics?.companies?.slice(0, 4) || [];

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow={`${greeting()}, ${user?.name?.split(" ")[0] || "there"}`}
        title="Your outreach command center"
        description="A clear view of every conversation, role, and next best action — all in one place."
        actions={(
          <>
            <Link to="/analytics"><Button variant="secondary" icon={BarChart3}>View analytics</Button></Link>
            <Link to="/companies?new=1"><Button icon={Plus}>New outreach</Button></Link>
          </>
        )}
      />

      <div className="hero-grid">
        <GlassCard className="hero-card">
          <div className="hero-content">
            <span className="eyebrow"><Sparkles size={13} /> Today’s focus</span>
            <h2>{priorityFollowups.length ? "Keep the momentum going" : "Build your next opportunity"}</h2>
            <p>
              {priorityFollowups.length
                ? `${priorityFollowups.length} follow-up${priorityFollowups.length === 1 ? "" : "s"} need attention. Personalized, timely messages get the best response rates.`
                : "Your inbox is clear. Add a few high-fit companies and let AI help you start a thoughtful conversation."}
            </p>
            <div className="hero-actions">
              <Link to={priorityFollowups.length ? "/followups" : "/companies"}>
                <Button icon={priorityFollowups.length ? CalendarClock : Search}>
                  {priorityFollowups.length ? "Review follow-ups" : "Find companies"}
                </Button>
              </Link>
              <Link to="/studio" className="text-link">Open AI Email Studio <ArrowUpRight size={14} /></Link>
            </div>
          </div>
          <div className="hero-orbit" aria-hidden="true">
            <span className="orbit-ring ring-one" />
            <span className="orbit-ring ring-two" />
            <span className="orbit-core"><Sparkles size={26} /></span>
            <span className="orbit-chip chip-one"><Mail size={13} /> Personalized</span>
            <span className="orbit-chip chip-two"><CheckCircle2 size={13} /> Human approved</span>
          </div>
        </GlassCard>

        <GlassCard className="focus-card">
          <div className="focus-head">
            <div>
              <span className="eyebrow">Workspace health</span>
              <h3>{settings?.gmail_connected ? "Email connected" : "Connect your email"}</h3>
            </div>
            <span className={`pulse-dot ${settings?.gmail_connected ? "online" : "offline"}`} />
          </div>
          <div className="focus-meter">
            <ProgressRing value={dashboard?.daily_cap ? (dashboard.sent_today / dashboard.daily_cap) * 100 : 0} size={104} />
            <div>
              <strong>{dashboard?.sent_today ?? 0}<small> / {dashboard?.daily_cap ?? 0}</small></strong>
              <span>Daily sending limit</span>
              <StatusBadge status={dashboard?.dry_run ? "DRY_RUN" : "READY"} />
            </div>
          </div>
          <div className="focus-footer">
            <span>{activeCampaigns} active campaign{activeCampaigns === 1 ? "" : "s"}</span>
            <Link to="/settings" className="text-link">Manage sending <ArrowUpRight size={13} /></Link>
          </div>
        </GlassCard>
      </div>

      <div className="metric-grid">
        <MetricCard label="Companies tracked" value={totals.contacts ?? stats.contacts ?? 0} detail={`${recentContacts.length} updated recently`} icon={Users} tone="teal" spark={preparedSpark} />
        <MetricCard label="Emails sent" value={totals.sent ?? stats.sent ?? 0} detail={`${stats.sent_today ?? 0} today`} icon={Send} tone="blue" spark={sentSpark} />
        <MetricCard label="Replies" value={totals.replies ?? stats.replies ?? 0} detail={`${totals.replies ? Math.round((totals.replies / Math.max(totals.sent, 1)) * 100) : 0}% reply rate`} icon={Inbox} tone="violet" spark={replySpark} />
        <MetricCard label="Follow-ups due" value={totals.followups_due ?? followupSummary.due ?? 0} detail={`${totals.followups_upcoming ?? followupSummary.upcoming ?? 0} upcoming`} icon={CalendarClock} tone="amber" />
      </div>

      <div className="content-grid two-thirds">
        <GlassCard className="pipeline-card">
          <SectionHeading
            title="Outreach pipeline"
            description="Where every conversation stands right now"
            action={<Link to="/analytics" className="text-link">Open analytics <ArrowUpRight size={14} /></Link>}
          />
          <div className="pipeline-list">
            {[
              ["PENDING", "Ready to contact", "teal"],
              ["DRAFTED", "Drafts prepared", "violet"],
              ["SENT", "Awaiting reply", "blue"],
              ["REPLIED", "Conversations", "teal"],
              ["OPTED_OUT", "Opted out", "coral"],
            ].map(([key, label, tone]) => {
              const count = pipeline[key] || 0;
              return (
                <div className="pipeline-row" key={key}>
                  <span className={`pipeline-dot tone-${tone}`} />
                  <div className="pipeline-meta"><strong>{label}</strong><span>{count} contact{count === 1 ? "" : "s"}</span></div>
                  <div className="pipeline-bar"><span className={`tone-${tone}`} style={{ width: `${Math.max(4, (count / pipelineTotal) * 100)}%` }} /></div>
                  <strong className="pipeline-count">{count}</strong>
                </div>
              );
            })}
          </div>
          <div className="pipeline-footer">
            <div><span>Approved drafts</span><strong>{totals.approved ?? 0}</strong></div>
            <div><span>Verified roles</span><strong>{totals.verified_jobs ?? 0}</strong></div>
            <div><span>Active roles</span><strong>{totals.active_jobs ?? 0}</strong></div>
          </div>
        </GlassCard>

        <GlassCard className="activity-card">
          <SectionHeading title="Recent activity" description="Your latest workspace events" action={<Link to="/activity" className="text-link">View all <ArrowUpRight size={14} /></Link>} />
          {recentActivity.length ? (
            <div className="activity-list">
              {recentActivity.map((event, index) => (
                <div className="activity-item" key={event.id || index}>
                  <span className={`activity-icon tone-${event.action === "EMAIL_SENT" ? "teal" : event.action === "EMAIL_FAILED" ? "coral" : "blue"}`}>
                    {event.action === "EMAIL_SENT" ? <Send size={15} /> : event.action === "EMAIL_FAILED" ? <CircleDashed size={15} /> : <Sparkles size={15} />}
                  </span>
                  <div>
                    <strong>{titleCase(event.action || "Activity")}</strong>
                    <p>{event.details || event.company_name || "Workspace updated"}</p>
                  </div>
                  <time>{formatTimeAgo(event.created_at)}</time>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState compact icon={Sparkles} title="No activity yet" description="Your events will appear here as you build your outreach pipeline." />
          )}
        </GlassCard>
      </div>

      <div className="quick-grid">
        {quickActions.map((action) => {
          const Icon = action.icon;
          return (
            <Link to={action.to} className="quick-action" key={action.label}>
              <span className={`quick-icon tone-${action.tone}`}><Icon size={19} /></span>
              <span><strong>{action.label}</strong><small>{action.description}</small></span>
              <ArrowUpRight size={16} />
            </Link>
          );
        })}
      </div>

      <div className="content-grid two-thirds">
        <GlassCard>
          <SectionHeading title="Priority follow-ups" description="Conversations that deserve a timely nudge" action={<Link to="/followups" className="text-link">View queue <ArrowUpRight size={14} /></Link>} />
          {priorityFollowups.length ? (
            <div className="compact-list">
              {priorityFollowups.map((item) => (
                <div className="compact-row" key={item.id}>
                  <Avatar name={item.contact?.company_name || item.company_name} size="sm" />
                  <div><strong>{item.contact?.company_name || item.company_name || "Contact"}</strong><span>{item.contact?.role || item.role || "Follow-up"} · {item.due_at ? formatDate(item.due_at) : "Due now"}</span></div>
                  <StatusBadge status={item.completed ? "DONE" : "PENDING"} />
                </div>
              ))}
            </div>
          ) : (
            <EmptyState compact icon={CalendarClock} title="You’re all caught up" description="New follow-ups will appear here when a conversation is ready for a nudge." />
          )}
        </GlassCard>

        <GlassCard>
          <SectionHeading title="Top companies" description="Most active outreach this month" action={<Link to="/companies" className="text-link">All companies <ArrowUpRight size={14} /></Link>} />
          {topCompanies.length ? (
            <div className="compact-list">
              {topCompanies.map((company) => (
                <div className="compact-row" key={company.company}>
                  <Avatar name={company.company} size="sm" />
                  <div><strong>{company.company}</strong><span>{company.sent} sent · {company.replies} repl{company.replies === 1 ? "y" : "ies"}</span></div>
                  <span className="compact-stat">{company.sent + company.replies}</span>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState compact icon={Target} title="No company activity yet" description="Start outreach to see your strongest company relationships here." />
          )}
        </GlassCard>
      </div>
    </div>
  );
}
