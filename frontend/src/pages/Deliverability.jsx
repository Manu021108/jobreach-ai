import {
  AlertTriangle,
  ArrowUpRight,
  BarChart3,
  CheckCircle2,
  Clock,
  Download,
  Eye,
  Mail,
  RefreshCw,
  Search,
  Send,
  Shield,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Users,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Button,
  EmptyState,
  FilterSelect,
  GlassCard,
  LoadingSkeleton,
  MetricCard,
  PageHeader,
  ProgressBar,
  SectionHeading,
  StatusBadge,
} from "../components/ui";
import { useWorkspace } from "../context/WorkspaceContext";
import { api, get } from "../lib/api";
import { formatDate, formatShortDate, formatShortNumber, titleCase } from "../lib/format";

const CHART_THEMES = {
  dark: {
    colors: ["#45E6C4", "#68A9FF", "#A78BFA", "#F6C76B", "#FF8A8A"],
    grid: "rgba(255,255,255,0.06)",
    axis: "#8A9BB5",
    cursor: "rgba(255,255,255,0.03)",
    fill: 0.34,
  },
  light: {
    colors: ["#0D9F86", "#2F7FE0", "#7C5CE5", "#A87316", "#D95C5C"],
    grid: "rgba(15,29,51,0.09)",
    axis: "#5D708C",
    cursor: "rgba(15,29,51,0.04)",
    fill: 0.2,
  },
};

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tooltip">
      <strong>{formatShortDate(label)}</strong>
      {payload.map((item) => (
        <span key={item.dataKey} style={{ color: item.color }}>
          {titleCase(item.dataKey)}: <b>{item.value}</b>
        </span>
      ))}
    </div>
  );
}

export function Deliverability() {
  const { analytics, notify, theme } = useWorkspace();
  const palette = CHART_THEMES[theme] || CHART_THEMES.dark;
  const [period, setPeriod] = useState("30");
  const [data, setData] = useState(null);
  const [domainData, setDomainData] = useState(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (days) => {
    setLoading(true);
    try {
      const [statsRes, domainsRes] = await Promise.all([
        api(`/deliverability/stats?days=${days}`),
        api(`/deliverability/domain-reputations?limit=50`),
      ]);
      setData(statsRes);
      setDomainData(domainsRes);
    } catch (error) {
      notify(error.message, "error");
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    load(period);
  }, [load, period]);

  const stats = data || {};
  const domains = domainData?.domains || [];

  const sentSpark = (analytics?.series || []).slice(-12).map((item) => item.sent);
  const replySpark = (analytics?.series || []).slice(-12).map((item) => item.replies);

  const series = (data?.series || []).map((item) => ({
    date: item.date,
    sent: item.sent,
    delivered: item.delivered,
    bounced: item.bounced,
    opened: item.opened,
    clicked: item.clicked,
    label: formatShortDate(item.date),
  }));

  const replyRate = stats.sent ? Math.round((stats.opened / stats.delivered) * 100) : 0;
  const clickRate = stats.delivered ? Math.round((stats.clicked / stats.delivered) * 100) : 0;
  const bounceRate = stats.sent ? Math.round(((stats.bounced + stats.blocked) / stats.sent) * 100) : 0;
  const complaintRate = stats.sent ? Math.round((stats.complained / stats.sent) * 100) : 0;

  const funnel = [
    { label: "Sent", value: stats.sent, color: "#2F7FE0" },
    { label: "Delivered", value: stats.delivered, color: "#0D9F86" },
    { label: "Opened", value: stats.opened, color: "#7C5CE5" },
    { label: "Clicked", value: stats.clicked, color: "#A87316" },
    { label: "Bounced", value: stats.bounced, color: "#D95C5C" },
    { label: "Complaints", value: stats.complained, color: "#F6C76B" },
  ];

  const funnelMax = Math.max(...funnel.map((item) => item.value), 1);

  const exportReport = () => {
    const header = "date,sent,delivered,bounced,blocked,opened,clicked,complained,unsubscribed";
    const rows = series.map((item) => `${item.date},${item.sent},${item.delivered},${item.bounced},${item.blocked || 0},${item.opened},${item.clicked},${item.complained || 0},${item.unsubscribed || 0}`);
    const blob = new Blob([[header, ...rows].join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `jobreach-deliverability-${period}d.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
    notify("Deliverability report exported.");
  };

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Email Deliverability"
        title="Deliverability Analytics"
        description="Monitor sending health, domain reputation, and engagement to keep your outreach out of spam folders."
        actions={(
          <>
            <FilterSelect
              value={period}
              onChange={setPeriod}
              options={[
                { value: "7", label: "Last 7 days" },
                { value: "30", label: "Last 30 days" },
                { value: "90", label: "Last 90 days" },
              ]}
            />
            <Button variant="secondary" icon={Download} onClick={exportReport}>Export CSV</Button>
            <Button variant="secondary" icon={RefreshCw} loading={loading} onClick={() => load(period)}>Refresh</Button>
          </>
        )}
      />

      <div className="metric-grid">
        <MetricCard
          label="Emails sent"
          value={formatShortNumber(stats.sent || 0)}
          detail={`${period}-day window`}
          icon={Send}
          tone="blue"
          spark={series.slice(-12).map((item) => item.sent)}
        />
        <MetricCard
          label="Deliverability"
          value={`${((stats.delivered || 0) / Math.max(stats.sent || 1, 1)) * 100}%`}
          detail={`${stats.delivered || 0} of ${stats.sent || 0} delivered`}
          icon={CheckCircle2}
          tone="teal"
          trend={stats.sent ? ((stats.delivered || 0) / Math.max(stats.sent, 1)) * 100 : 0}
          spark={series.slice(-12).map((item) => item.delivered)}
        />
        <MetricCard
          label="Open rate"
          value={`${((stats.opened || 0) / Math.max(stats.delivered || 1, 1)) * 100}%`}
          detail={`${stats.opened || 0} opens from ${stats.delivered || 0} delivered`}
          icon={Eye}
          tone="violet"
          spark={series.slice(-12).map((item) => item.opened)}
        />
        <MetricCard
          label="Bounce rate"
          value={`${bounceRate}%`}
          detail={`${stats.bounced + stats.blocked} of ${stats.sent} bounced/blocked`}
          icon={AlertTriangle}
          tone={bounceRate > 5 ? "coral" : "amber"}
          spark={series.slice(-12).map((item) => item.bounced + (item.blocked || 0))}
        />
      </div>

      {loading ? <GlassCard><LoadingSkeleton rows={8} /></GlassCard> : (
        <>
          <div className="content-grid two-thirds">
            <GlassCard className="chart-card">
              <SectionHeading
                title="Sending volume & engagement"
                description="Daily sending volume with deliverability and engagement rates"
                action={
                  <span className="chart-legend">
                    <i className="tone-blue" /> Sent
                    <i className="tone-teal" /> Delivered
                    <i className="tone-violet" /> Opened
                    <i className="tone-coral" /> Bounced
                  </span>
                }
              />
              <div className="chart-wrap">
                <ResponsiveContainer width="100%" height={280}>
                  <AreaChart data={series} margin={{ top: 10, right: 12, left: -18, bottom: 0 }}>
                    <defs>
                      <linearGradient id="sentGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={palette.colors[1]} stopOpacity={palette.fill} />
                        <stop offset="100%" stopColor={palette.colors[1]} stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="deliveredGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={palette.colors[0]} stopOpacity={palette.fill} />
                        <stop offset="100%" stopColor={palette.colors[0]} stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="openedGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={palette.colors[2]} stopOpacity={palette.fill} />
                        <stop offset="100%" stopColor={palette.colors[2]} stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="bouncedGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={palette.colors[3]} stopOpacity={palette.fill} />
                        <stop offset="100%" stopColor={palette.colors[3]} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke={palette.grid} vertical={false} />
                    <XAxis dataKey="date" tickFormatter={formatShortDate} tick={{ fill: palette.axis, fontSize: 11 }} axisLine={false} tickLine={false} minTickGap={24} />
                    <YAxis tick={{ fill: palette.axis, fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
                    <Tooltip content={<ChartTooltip />} />
                    <Area type="monotone" dataKey="sent" stroke={palette.colors[1]} strokeWidth={2.2} fill="url(#sentGradient)" />
                    <Area type="monotone" dataKey="delivered" stroke={palette.colors[0]} strokeWidth={2.2} fill="url(#deliveredGradient)" />
                    <Area type="monotone" dataKey="opened" stroke={palette.colors[2]} strokeWidth={2.2} fill="url(#openedGradient)" />
                    <Area type="monotone" dataKey="bounced" stroke={palette.colors[3]} strokeWidth={2.2} fill="url(#bouncedGradient)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </GlassCard>

            <GlassCard className="chart-card">
              <SectionHeading title="Deliverability funnel" description="From sent to engaged" />
              <div className="funnel">
                {funnel.map((item) => (
                  <div className="funnel-row" key={item.label}>
                    <div><span>{item.label}</span><strong>{formatShortNumber(item.value)}</strong></div>
                    <div className="funnel-track"><span className="tone-custom" style={{ background: item.color, width: `${Math.max(3, (item.value / funnelMax) * 100)}%` }} /></div>
                  </div>
                ))}
              </div>
              <div className="funnel-footer">
                <div><span>Delivery rate</span><strong>{stats.sent ? Math.round((stats.delivered / stats.sent) * 100) : 0}%</strong></div>
                <div><span>Open rate</span><strong>{stats.delivered ? Math.round((stats.opened / stats.delivered) * 100) : 0}%</strong></div>
                <div><span>Click rate</span><strong>{stats.delivered ? Math.round((stats.clicked / stats.delivered) * 100) : 0}%</strong></div>
                <div><span>Bounce rate</span><strong>{bounceRate}%</strong></div>
                <div><span>Complaint rate</span><strong>{complaintRate}%</strong></div>
              </div>
            </GlassCard>
          </div>

          <div className="content-grid two-thirds">
            <GlassCard className="chart-card">
              <SectionHeading title="Bounce analysis" description="Breakdown by bounce type" />
              {stats.bounced || stats.blocked ? (
                <div className="bounce-breakdown">
                  <div className="bounce-row">
                    <span className="bounce-label"><span className="tone-coral" /> Hard bounces</span>
                    <strong>{stats.hard_bounced || 0}</strong>
                    <ProgressBar value={stats.sent ? Math.round((stats.hard_bounced / stats.sent) * 100) : 0} tone="coral" />
                  </div>
                  <div className="bounce-row">
                    <span className="bounce-label"><span className="tone-amber" /> Soft bounces</span>
                    <strong>{stats.soft_bounced || 0}</strong>
                    <ProgressBar value={stats.sent ? Math.round((stats.soft_bounced / stats.sent) * 100) : 0} tone="amber" />
                  </div>
                  <div className="bounce-row">
                    <span className="bounce-label"><span className="tone-coral" /> Blocked</span>
                    <strong>{stats.blocked || 0}</strong>
                    <ProgressBar value={stats.sent ? Math.round((stats.blocked / stats.sent) * 100) : 0} tone="coral" />
                  </div>
                  <div className="bounce-row">
                    <span className="bounce-label"><span className="tone-amber" /> Complaints</span>
                    <strong>{stats.complained || 0}</strong>
                    <ProgressBar value={stats.sent ? Math.round((stats.complained / stats.sent) * 100) : 0} tone="amber" />
                  </div>
                </div>
              ) : <EmptyState compact icon={CheckCircle2} title="No bounces" description="Great! All emails are being delivered." />}
            </GlassCard>

            <GlassCard className="chart-card">
              <SectionHeading title="Domain health" description="Track sender reputation across domains" />
              {domains.length ? (
                <div className="domain-table">
                  <table className="domain-table-inner">
                    <thead>
                      <tr>
                        <th>Domain</th>
                        <th>Score</th>
                        <th>Sent</th>
                        <th>Bounce %</th>
                        <th>Open %</th>
                        <th>Complaint %</th>
                      </tr>
                    </thead>
                    <tbody>
                      {domains.map((domain) => (
                        <tr key={domain.domain}>
                          <td className="domain-name">{domain.domain}</td>
                          <td>
                            <StatusBadge status={domain.reputation_score > 0.5 ? "GOOD" : domain.reputation_score > 0 ? "FAIR" : "POOR"} />
                          </td>
                          <td>{formatShortNumber(domain.total_sent)}</td>
                          <td>{domain.bounce_rate ? `${(domain.bounce_rate * 100).toFixed(1)}%` : "—"}</td>
                          <td>{domain.open_rate ? `${(domain.open_rate * 100).toFixed(1)}%` : "—"}</td>
                          <td>{domain.spam_complaint_rate ? `${(domain.spam_complaint_rate * 100).toFixed(2)}%` : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <EmptyState compact icon={Mail} title="No domain data yet" description="Send emails to build domain reputation history." />}
            </GlassCard>
          </div>

          <div className="content-grid two-thirds">
            <GlassCard>
              <SectionHeading title="Quick actions" description="Maintain healthy deliverability" />
              <div className="action-grid">
                <Link to="/settings" className="action-card">
                  <Send size={24} /><span>Check LLM status</span><small>Ensure AI drafts work</small>
                </Link>
                <Link to="/settings" className="action-card">
                  <Mail size={24} /><span>Verify Gmail</span><small>Check OAuth connection</small>
                </Link>
                <Link to="/companies" className="action-card">
                  <Users size={24} /><span>Review contacts</span><small>Remove bounced emails</small>
                </Link>
                <Link to="/campaigns" className="action-card">
                  <Send size={24} /><span>Review campaigns</span><small>Check sending cadence</small>
                </Link>
              </div>
            </GlassCard>

            <GlassCard>
              <SectionHeading title="Deliverability checklist" description="Best practices to stay in the inbox" />
              <ul className="checklist">
                <li><CheckCircle2 size={16} /> Use your own domain with proper SPF/DKIM/DMARC</li>
                <li><CheckCircle2 size={16} /> Warm up new domains gradually (start with 10-20/day)</li>
                <li><CheckCircle2 size={16} /> Keep bounce rate under 2%, complaint rate under 0.1%</li>
                <li><CheckCircle2 size={16} /> Always include unsubscribe link (auto-added by JobReach AI)</li>
                <li><CheckCircle2 size={16} /> Personalize every email - avoid generic templates</li>
                <li><CheckCircle2 size={16} /> Monitor domain reputation weekly</li>
                <li><CheckCircle2 size={16} /> Use template-based fallbacks when LLM is unavailable</li>
                <li><CheckCircle2 size={16} /> Respect daily sending limits and minimum gaps</li>
              </ul>
            </GlassCard>
          </div>
        </>
      )}
    </div>
  );
}