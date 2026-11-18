import {
  BarChart3,
  BriefcaseBusiness,
  CalendarClock,
  Download,
  Inbox,
  Mail,
  Send,
  Sparkles,
  Target,
  Users,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
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
} from "../components/ui";
import { useWorkspace } from "../context/WorkspaceContext";
import { api } from "../lib/api";
import { formatShortDate, titleCase } from "../lib/format";

const COLORS = ["#45E6C4", "#68A9FF", "#A78BFA", "#F6C76B", "#FF8A8A"];

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tooltip">
      <strong>{formatShortDate(label)}</strong>
      {payload.map((item) => (
        <span key={item.dataKey} style={{ color: item.color }}>{titleCase(item.dataKey)}: <b>{item.value}</b></span>
      ))}
    </div>
  );
}

export function Analytics() {
  const { analytics, campaigns, notify } = useWorkspace();
  const [period, setPeriod] = useState("30");
  const [data, setData] = useState(analytics);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (days) => {
    setLoading(true);
    try {
      const response = await api(`/analytics?days=${days}`);
      setData(response);
    } catch (error) {
      notify(error.message, "error");
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    if (period === "30" && analytics) {
      setData(analytics);
      return;
    }
    load(period);
  }, [analytics, load, period]);

  const totals = data?.totals || {};
  const series = (data?.series || []).map((item) => ({ ...item, label: formatShortDate(item.date) }));
  const replyRate = totals.sent ? Math.round((totals.replies / totals.sent) * 100) : 0;
  const responseRate = totals.sent ? Math.round((totals.replies / totals.sent) * 100) : 0;
  const pipeline = data?.pipeline || {};
  const draftPipeline = data?.draft_pipeline || {};
  const topCompanies = data?.companies || [];
  const funnel = [
    { label: "Companies", value: totals.contacts || 0, tone: "teal" },
    { label: "Drafts prepared", value: totals.drafts || 0, tone: "violet" },
    { label: "Approved", value: totals.approved || 0, tone: "blue" },
    { label: "Sent", value: totals.sent || 0, tone: "blue" },
    { label: "Replies", value: totals.replies || 0, tone: "teal" },
  ];
  const funnelMax = Math.max(...funnel.map((item) => item.value), 1);
  const pipelineData = Object.entries(pipeline).map(([name, value]) => ({ name: titleCase(name), value, key: name }));
  const draftData = Object.entries(draftPipeline).map(([name, value]) => ({ name: titleCase(name), value, key: name }));
  const campaignStats = useMemo(() => campaigns.reduce((result, campaign) => {
    result.total += 1;
    result.sent += campaign.counts?.sent || 0;
    result.approved += campaign.counts?.approved || 0;
    result.queued += campaign.counts?.queued || 0;
    return result;
  }, { total: 0, sent: 0, approved: 0, queued: 0 }), [campaigns]);

  const exportReport = () => {
    const header = "date,sent,replies,opt_outs,failed,prepared";
    const rows = series.map((item) => `${item.date},${item.sent},${item.replies},${item.opt_outs},${item.failed},${item.prepared}`);
    const blob = new Blob([[header, ...rows].join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `jobreach-analytics-${period}d.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
    notify("Analytics report exported.");
  };

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Outreach intelligence"
        title="Analytics"
        description="Understand what is working, where conversations stall, and which companies deserve more attention."
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
            <Button variant="secondary" icon={Download} onClick={exportReport}>Export report</Button>
          </>
        )}
      />

      <div className="metric-grid">
        <MetricCard label="Emails sent" value={totals.sent || 0} detail={`${period}-day window`} icon={Send} tone="blue" spark={series.slice(-12).map((item) => item.sent)} />
        <MetricCard label="Reply rate" value={`${replyRate}%`} detail={`${totals.replies || 0} replies received`} icon={Inbox} tone="teal" spark={series.slice(-12).map((item) => item.replies)} />
        <MetricCard label="Drafts prepared" value={totals.drafts || 0} detail={`${totals.approved || 0} approved`} icon={Sparkles} tone="violet" spark={series.slice(-12).map((item) => item.prepared)} />
        <MetricCard label="Follow-ups due" value={totals.followups_due || 0} detail={`${totals.followups_upcoming || 0} upcoming`} icon={CalendarClock} tone="amber" />
      </div>

      {loading ? <GlassCard><LoadingSkeleton rows={6} /></GlassCard> : (
        <>
          <div className="content-grid two-thirds">
            <GlassCard className="chart-card">
              <SectionHeading title="Outreach volume" description="Sent messages and replies over time" action={<span className="chart-legend"><i className="tone-blue" /> Sent <i className="tone-teal" /> Replies</span>} />
              <div className="chart-wrap">
                <ResponsiveContainer width="100%" height={280}>
                  <AreaChart data={series} margin={{ top: 10, right: 12, left: -18, bottom: 0 }}>
                    <defs>
                      <linearGradient id="sentGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#68A9FF" stopOpacity={0.34} />
                        <stop offset="100%" stopColor="#68A9FF" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="replyGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#45E6C4" stopOpacity={0.3} />
                        <stop offset="100%" stopColor="#45E6C4" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                    <XAxis dataKey="date" tickFormatter={formatShortDate} tick={{ fill: "#8A9BB5", fontSize: 11 }} axisLine={false} tickLine={false} minTickGap={24} />
                    <YAxis tick={{ fill: "#8A9BB5", fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
                    <Tooltip content={<ChartTooltip />} />
                    <Area type="monotone" dataKey="sent" stroke="#68A9FF" strokeWidth={2.2} fill="url(#sentGradient)" />
                    <Area type="monotone" dataKey="replies" stroke="#45E6C4" strokeWidth={2.2} fill="url(#replyGradient)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </GlassCard>

            <GlassCard className="chart-card">
              <SectionHeading title="Conversion funnel" description="From first contact to conversation" />
              <div className="funnel">
                {funnel.map((item) => (
                  <div className="funnel-row" key={item.label}>
                    <div><span>{item.label}</span><strong>{item.value}</strong></div>
                    <div className="funnel-track"><span className={`tone-${item.tone}`} style={{ width: `${Math.max(3, (item.value / funnelMax) * 100)}%` }} /></div>
                  </div>
                ))}
              </div>
              <div className="funnel-footer">
                <div><span>Response rate</span><strong>{responseRate}%</strong></div>
                <div><span>Opt-outs</span><strong>{totals.opted_out || 0}</strong></div>
                <div><span>Active roles</span><strong>{totals.active_jobs || 0}</strong></div>
              </div>
            </GlassCard>
          </div>

          <div className="content-grid two-thirds">
            <GlassCard className="chart-card">
              <SectionHeading title="Pipeline distribution" description="Contacts by current outreach status" />
              {pipelineData.length ? (
                <div className="chart-wrap">
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart data={pipelineData} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                      <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                      <XAxis dataKey="name" tick={{ fill: "#8A9BB5", fontSize: 11 }} axisLine={false} tickLine={false} interval={0} />
                      <YAxis tick={{ fill: "#8A9BB5", fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
                      <Tooltip content={<ChartTooltip />} cursor={{ fill: "rgba(255,255,255,0.03)" }} />
                      <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                        {pipelineData.map((entry, index) => <Cell key={entry.key} fill={COLORS[index % COLORS.length]} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : <EmptyState compact icon={BarChart3} title="No pipeline data yet" description="Start outreach to populate your funnel." />}
            </GlassCard>

            <GlassCard className="chart-card">
              <SectionHeading title="Draft velocity" description="Prepared drafts vs approved outreach" />
              {draftData.length ? (
                <div className="chart-wrap">
                  <ResponsiveContainer width="100%" height={260}>
                    <LineChart data={draftData} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                      <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                      <XAxis dataKey="name" tick={{ fill: "#8A9BB5", fontSize: 11 }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fill: "#8A9BB5", fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
                      <Tooltip content={<ChartTooltip />} />
                      <Legend wrapperStyle={{ color: "#8A9BB5", fontSize: 12 }} />
                      <Line type="monotone" dataKey="value" name="Drafts" stroke="#A78BFA" strokeWidth={2.4} dot={{ r: 3, fill: "#A78BFA" }} activeDot={{ r: 5 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              ) : <EmptyState compact icon={Sparkles} title="No drafts yet" description="Generate drafts in the studio or a campaign." />}
            </GlassCard>
          </div>

          <div className="content-grid two-thirds">
            <GlassCard>
              <SectionHeading title="Top companies" description="Where your outreach is gaining traction" />
              {topCompanies.length ? (
                <div className="company-performance">
                  {topCompanies.map((company, index) => (
                    <div className="company-performance-row" key={company.company}>
                      <span className="rank">{index + 1}</span>
                      <div className="company-performance-copy"><strong>{company.company}</strong><span>{company.sent} sent · {company.replies} repl{company.replies === 1 ? "y" : "ies"}</span></div>
                      <ProgressBar value={(company.replies / Math.max(company.sent, 1)) * 100} tone={index === 0 ? "teal" : "blue"} />
                    </div>
                  ))}
                </div>
              ) : <EmptyState compact icon={Users} title="No company performance yet" description="Company insights appear after outreach activity." />}
            </GlassCard>

            <GlassCard>
              <SectionHeading title="Campaign pulse" description="Active and completed campaign health" />
              <div className="analytics-mini-grid">
                <div><span>Campaigns</span><strong>{campaignStats.total}</strong></div>
                <div><span>Approved</span><strong>{campaignStats.approved}</strong></div>
                <div><span>Queued</span><strong>{campaignStats.queued}</strong></div>
                <div><span>Sent</span><strong>{campaignStats.sent}</strong></div>
              </div>
              <div className="analytics-note"><Target size={17} /><p>Keep campaigns small and specific. Personalized batches consistently outperform broad blasts.</p></div>
              <div className="analytics-note"><BriefcaseBusiness size={17} /><p>{totals.jobs || 0} roles tracked across your companies, with {totals.verified_jobs || 0} verified.</p></div>
              <div className="analytics-note"><Mail size={17} /><p>Every send is human-approved and respects opt-outs, daily caps, and dry-run mode.</p></div>
            </GlassCard>
          </div>
        </>
      )}
    </div>
  );
}
