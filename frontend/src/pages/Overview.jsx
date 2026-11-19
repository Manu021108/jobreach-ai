import {
  ArrowUpRight,
  BriefcaseBusiness,
  CalendarClock,
  CheckCircle2,
  CircleDashed,
  Inbox,
  Send,
  Sparkles,
  Users,
} from "lucide-react";
import { Link } from "react-router-dom";
import { ActivityFeed, Avatar, EmptyState, GlassCard, MetricCard, SectionHeading, StatusBadge } from "../components/ui";
import { useWorkspace } from "../context/WorkspaceContext";
import { formatTimeAgo, greeting, titleCase } from "../lib/format";

function nextAction(contact) {
  const status = String(contact?.status || "").toUpperCase();
  if (status === "REPLIED") return { label: "Reply in inbox", to: "/inbox" };
  if (status === "SENT") return { label: "Schedule follow-up", to: `/studio?contact=${contact.id}` };
  if (status === "DRAFTED" || status === "PENDING") return { label: "Review draft", to: `/studio?contact=${contact.id}` };
  if (status === "OPTED_OUT" || status === "ARCHIVED") return { label: "View company", to: "/companies" };
  return { label: "Open company", to: "/companies" };
}

export function Overview() {
  const { user, dashboard, analytics, followups, drafts, auditLog, settings } = useWorkspace();
  const stats = dashboard?.stats || {};
  const totals = analytics?.totals || {};
  const pipeline = analytics?.pipeline || {};
  const series = analytics?.series || [];
  const followupSummary = dashboard?.followups || {};
  const recentContacts = dashboard?.recent_contacts || [];
  const recentActivity = (auditLog || []).slice(0, 5);
  const now = Date.now();

  const dueFollowups = followups.filter(
    (item) => !item.completed && item.followup_due_at && new Date(item.followup_due_at).getTime() <= now,
  );
  const upcomingFollowups = followups.filter(
    (item) => !item.completed && item.followup_due_at && new Date(item.followup_due_at).getTime() > now,
  );
  const awaitingDrafts = drafts.filter((item) => item.status === "DRAFT" || item.status === "DRAFTED");
  const recentReplies = recentContacts.filter((item) => item.status === "REPLIED");
  const replyCount = pipeline.REPLIED ?? stats.replies ?? recentReplies.length;
  const interviewCount = stats.interviews ?? Object.entries(pipeline)
    .filter(([status]) => /interview/i.test(status))
    .reduce((sum, [, count]) => sum + (count || 0), 0);
  const replyRate = totals.sent ? Math.round((totals.replies / totals.sent) * 100) : 0;

  const sentSpark = series.slice(-12).map((item) => item.sent);
  const replySpark = series.slice(-12).map((item) => item.replies);

  const focusItems = [
    ...dueFollowups.slice(0, 2).map((item) => ({
      icon: CalendarClock,
      title: `Follow up with ${item.contact?.company_name || item.company_name || "contact"}`,
      detail: item.followup_due_at ? `Due ${formatTimeAgo(item.followup_due_at)}` : "Due now",
      to: "/followups",
    })),
    ...awaitingDrafts.slice(0, 2).map((item) => ({
      icon: CheckCircle2,
      title: `Approve draft for ${item.contact?.company_name || item.company_name || "contact"}`,
      detail: "AI draft ready for review",
      to: `/studio?draft=${item.id}`,
    })),
    ...recentReplies.slice(0, 1).map((item) => ({
      icon: Inbox,
      title: `New reply from ${item.company_name || "a contact"}`,
      detail: "Open the conversation",
      to: "/inbox",
    })),
    {
      icon: BriefcaseBusiness,
      title: `${totals.active_jobs ?? 0} active roles`,
      detail: "Review your job matches",
      to: "/match",
    },
  ].slice(0, 4);

  const topFollowup = dueFollowups[0] || followups.find((item) => !item.completed);
  const topCompany = topFollowup?.contact?.company_name || topFollowup?.company_name || "Contact";
  const topContact = topFollowup?.contact?.contact_name || topFollowup?.contact_name || topFollowup?.contact?.email || "";
  const firstName = user?.name?.split(" ")[0] || "there";

  return (
    <div className="dashboard">
      <header className="dashboard-head">
        <div className="dashboard-title">
          <p className="dashboard-kicker">{greeting()}, {firstName}</p>
          <h1>Your job search, organized.</h1>
          <p className="dashboard-sub">Everything that needs attention today, with the full outreach history one click away.</p>
        </div>
        <div className="dashboard-actions">
          <Link to="/activity" className="button button-ghost button-sm">This week&apos;s activity</Link>
        </div>
      </header>

      <section className="kpi-row" aria-label="Dashboard metrics">
        <MetricCard
          label="Emails sent"
          value={totals.sent ?? stats.sent ?? 0}
          detail={`${stats.sent_today ?? 0} sent today`}
          icon={Send}
          tone="blue"
          spark={sentSpark}
        />
        <MetricCard
          label="Replies received"
          value={totals.replies ?? stats.replies ?? 0}
          detail={`${replyRate}% reply rate`}
          icon={Inbox}
          tone="violet"
          spark={replySpark}
        />
        <MetricCard
          label="Interviews"
          value={interviewCount}
          detail={interviewCount ? "Marked in outreach statuses" : "No interviews recorded yet"}
          icon={Users}
          tone="teal"
        />
        <MetricCard
          label="Follow-ups due"
          value={totals.followups_due ?? followupSummary.due ?? dueFollowups.length}
          detail={`${totals.followups_upcoming ?? followupSummary.upcoming ?? upcomingFollowups.length} upcoming`}
          icon={CalendarClock}
          tone="amber"
        />
      </section>

      <div className="dashboard-grid">
        <div className="dashboard-primary">
          <GlassCard className="panel-card">
            <SectionHeading
              title="Outreach activity"
              description="Your most recently updated conversations"
              action={<Link to="/companies" className="section-link">View all <ArrowUpRight size={13} /></Link>}
            />
            {recentContacts.length ? (
              <div className="activity-table-wrap">
                <table className="activity-table">
                  <thead>
                    <tr>
                      <th>Company</th>
                      <th>Contact</th>
                      <th>Role</th>
                      <th>Status</th>
                      <th>Last activity</th>
                      <th>Next action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentContacts.slice(0, 6).map((contact) => {
                      const action = nextAction(contact);
                      return (
                        <tr key={contact.id}>
                          <td>
                            <div className="cell-company">
                              <Avatar name={contact.company_name || "Company"} size="sm" />
                              <span className="cell-copy">
                                <strong>{contact.company_name || "Company"}</strong>
                                <small>{contact.industry || "Tracked company"}</small>
                              </span>
                            </div>
                          </td>
                          <td><strong>{contact.contact_name || contact.email || "—"}</strong></td>
                          <td>{contact.role || "—"}</td>
                          <td><StatusBadge status={contact.status || "PENDING"} /></td>
                          <td>{formatTimeAgo(contact.updated_at || contact.created_at)}</td>
                          <td>
                            <Link to={action.to} className="next-action">{action.label}<ArrowUpRight size={13} /></Link>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState compact icon={Inbox} title="No outreach yet" description="Add a company to start building your outreach pipeline." />
            )}
          </GlassCard>

          <GlassCard className="panel-card">
            <SectionHeading
              title="Activity feed"
              description="Latest workspace events"
              action={<Link to="/activity" className="section-link">Open log <ArrowUpRight size={13} /></Link>}
            />
            <ActivityFeed
              items={recentActivity}
              iconFor={(item) => (item.action === "EMAIL_SENT" ? Send : item.action === "EMAIL_FAILED" ? CircleDashed : Sparkles)}
              titleFor={(item) => titleCase(item.action || "Activity")}
              detailFor={(item) => item.details || item.company_name || "Workspace updated"}
              timeFor={(item) => formatTimeAgo(item.created_at)}
            />
          </GlassCard>
        </div>

        <aside className="dashboard-side">
          <GlassCard className="panel-card focus-panel">
            <SectionHeading title="Today's focus" description="The next best actions for your search" />
            <div className="focus-stats">
              <div className="focus-stat"><strong>{dueFollowups.length}</strong><span>Follow-ups due</span></div>
              <div className="focus-stat"><strong>{awaitingDrafts.length}</strong><span>Drafts to approve</span></div>
              <div className="focus-stat"><strong>{replyCount}</strong><span>Recent replies</span></div>
            </div>
            <div className="focus-list">
              {focusItems.length ? focusItems.map((item, index) => {
                const Icon = item.icon;
                return (
                  <Link to={item.to} className="focus-item" key={`${item.title}-${index}`}>
                    <span className="focus-icon"><Icon size={15} /></span>
                    <span className="focus-copy"><strong>{item.title}</strong><small>{item.detail}</small></span>
                    <ArrowUpRight size={14} />
                  </Link>
                );
              }) : (
                <EmptyState compact icon={CheckCircle2} title="You're all caught up" description="New priorities will show up here automatically." />
              )}
            </div>
          </GlassCard>

          <GlassCard className="panel-card priority-card">
            <div className="priority-label">
              <span>Follow-up priority</span>
              <span className="priority-badge">HIGH</span>
            </div>
            <strong>{topFollowup ? `${dueFollowups.length || 1} conversation${(dueFollowups.length || 1) === 1 ? "" : "s"} need attention` : "No follow-ups due"}</strong>
            {topFollowup ? (
              <div className="priority-contact">
                <Avatar name={topCompany} size="sm" />
                <span className="cell-copy">
                  <strong>{topCompany}{topContact ? ` · ${topContact}` : ""}</strong>
                  <small>{topFollowup.occurred_at ? `Last contacted ${formatTimeAgo(topFollowup.occurred_at)}` : "Ready for a timely check-in"}</small>
                </span>
              </div>
            ) : null}
            <div className="priority-actions">
              <Link to="/followups" className="button button-secondary button-sm">Review queue</Link>
              <Link to={topFollowup ? `/studio?contact=${topFollowup.contact_id || topFollowup.id}` : "/studio"} className="button button-primary button-sm">Draft follow-up</Link>
            </div>
          </GlassCard>

          <GlassCard className="panel-card sending-card">
            <div className="sending-row">
              <span className={`pulse-dot ${settings?.gmail_connected ? "" : "off"}`} />
              <div>
                <strong>{settings?.gmail_connected ? "Gmail connected" : "Connect Gmail"}</strong>
                <small>{dashboard?.sent_today ?? 0} / {dashboard?.daily_cap ?? 0} sent today · {dashboard?.dry_run ? "Dry run" : "Manual approval"}</small>
              </div>
            </div>
            <Link to="/settings" className="section-link">Settings <ArrowUpRight size={12} /></Link>
          </GlassCard>
        </aside>
      </div>
    </div>
  );
}
