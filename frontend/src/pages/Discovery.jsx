import {
  ArrowUpRight,
  BriefcaseBusiness,
  Building2,
  MapPin,
  RefreshCw,
  Search,
  Sparkles,
  Target,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { JobCard } from "../components/JobCard";
import { Button, EmptyState, FilterSelect, GlassCard, LoadingSkeleton, Modal, PageHeader, SearchBar, StatusBadge } from "../components/ui";
import { useWorkspace } from "../context/WorkspaceContext";
import { api, post } from "../lib/api";
import { formatDate, parseEvidence } from "../lib/format";

export function Discovery() {
  const { notify, refresh } = useWorkspace();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [company, setCompany] = useState("");
  const [location, setLocation] = useState("");
  const [active, setActive] = useState("all");
  const [page, setPage] = useState(1);
  const [data, setData] = useState({ jobs: [], companies: [], total: 0, page_count: 1 });
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState(null);
  const [matchingId, setMatchingId] = useState(null);
  const [draftingId, setDraftingId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), page_size: "12" });
      if (query.trim()) params.set("query", query.trim());
      if (company) params.set("company", company);
      if (location.trim()) params.set("location", location.trim());
      if (active !== "all") params.set("active", active === "active" ? "true" : "false");
      const response = await api(`/jobs?${params.toString()}`);
      setData(response);
    } catch (error) {
      notify(error.message, "error");
    } finally {
      setLoading(false);
    }
  }, [active, company, location, notify, page, query]);

  useEffect(() => {
    const timer = window.setTimeout(load, 240);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    setPage(1);
  }, [query, company, location, active]);

  const summary = useMemo(() => {
    const jobs = data.jobs || [];
    const scores = jobs.map((job) => job.match_score).filter((score) => score != null);
    return {
      total: data.total || 0,
      active: jobs.filter((job) => job.active).length,
      verified: jobs.filter((job) => job.verified_at).length,
      average: scores.length ? Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length) : 0,
    };
  }, [data]);

  const handleMatch = async (job) => {
    setMatchingId(job.id);
    try {
      const result = await post(`/jobs/${job.id}/match`, {});
      setData((current) => ({
        ...current,
        jobs: current.jobs.map((item) => item.id === job.id ? result.job : item),
      }));
      if (detail?.id === job.id) setDetail(result.job);
      notify(`Match score updated to ${result.score}.`);
    } catch (error) {
      notify(error.message, "error");
    } finally {
      setMatchingId(null);
    }
  };

  const handleDraft = async (job) => {
    setDraftingId(job.id);
    try {
      const result = await post(`/jobs/${job.id}/generate`, {});
      await refresh();
      notify("AI draft created. Review it before approval.");
      navigate(`/studio?contact=${job.contact_id}&draft=${result.id}`);
    } catch (error) {
      notify(error.message, "error");
    } finally {
      setDraftingId(null);
    }
  };

  const evidence = parseEvidence(detail?.evidence);
  const companyOptions = [
    { value: "", label: "All companies" },
    ...(data.companies || []).map((name) => ({ value: name, label: name })),
  ];

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Role intelligence"
        title="Job discovery"
        description="Explore verified openings across your target companies and find the roles worth your attention."
        actions={(
          <>
            <Button variant="secondary" icon={RefreshCw} onClick={load}>Refresh</Button>
            <Link to="/companies"><Button icon={Building2}>Manage companies</Button></Link>
          </>
        )}
      />

      <div className="stat-strip">
        <div><span className="stat-icon tone-teal"><BriefcaseBusiness size={17} /></span><strong>{summary.total}</strong><small>Roles discovered</small></div>
        <div><span className="stat-icon tone-blue"><Target size={17} /></span><strong>{summary.active}</strong><small>Active on page</small></div>
        <div><span className="stat-icon tone-violet"><Sparkles size={17} /></span><strong>{summary.verified}</strong><small>Verified roles</small></div>
        <div><span className="stat-icon tone-amber"><Target size={17} /></span><strong>{summary.average || "—"}</strong><small>Average match</small></div>
      </div>

      <GlassCard className="filter-card">
        <div className="filter-row">
          <SearchBar value={query} onChange={setQuery} placeholder="Search role, company, or skill..." className="grow" />
          <FilterSelect label="Company" value={company} onChange={setCompany} options={companyOptions} />
          <FilterSelect
            label="Status"
            value={active}
            onChange={setActive}
            options={[
              { value: "all", label: "All roles" },
              { value: "active", label: "Active only" },
              { value: "closed", label: "Closed" },
            ]}
          />
          <label className="inline-field">
            <span>Location</span>
            <div className="inline-input"><MapPin size={14} /><input value={location} onChange={(event) => setLocation(event.target.value)} placeholder="Remote, city..." /></div>
          </label>
        </div>
      </GlassCard>

      {loading ? (
        <GlassCard><LoadingSkeleton rows={5} /></GlassCard>
      ) : data.jobs?.length ? (
        <>
          <div className="job-grid">
            {data.jobs.map((job) => (
              <JobCard
                key={job.id}
                job={job}
                onOpen={setDetail}
                onMatch={handleMatch}
                onDraft={handleDraft}
                matching={matchingId === job.id}
                drafting={draftingId === job.id}
              />
            ))}
          </div>
          <div className="table-pagination standalone">
            <span>Page {data.page || page} of {data.page_count || 1} · {data.total} roles</span>
            <div>
              <Button variant="ghost" size="sm" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>Previous</Button>
              <Button variant="ghost" size="sm" disabled={page >= (data.page_count || 1)} onClick={() => setPage((current) => current + 1)}>Next</Button>
            </div>
          </div>
        </>
      ) : (
        <GlassCard>
          <EmptyState
            icon={Search}
            title="No roles found yet"
            description="Discover roles from your company list, then refine by company, status, or location."
            action={<Link to="/companies"><Button icon={Building2}>Go to companies</Button></Link>}
          />
        </GlassCard>
      )}

      <Modal
        open={Boolean(detail)}
        onClose={() => setDetail(null)}
        title={detail?.title || "Role details"}
        description={detail ? `${detail.company_name} · ${detail.location || "Location flexible"}` : ""}
        width="760px"
        footer={(
          <>
            <Button variant="ghost" onClick={() => setDetail(null)}>Close</Button>
            <Button variant="secondary" icon={Target} loading={matchingId === detail?.id} onClick={() => handleMatch(detail)}>Run match</Button>
            <Button icon={Sparkles} loading={draftingId === detail?.id} onClick={() => handleDraft(detail)}>Create draft</Button>
          </>
        )}
      >
        {detail ? (
          <div className="job-detail">
            <div className="job-detail-top">
              <div><StatusBadge status={detail.active ? "ACTIVE" : "CLOSED"} /><StatusBadge status={detail.verified_at ? "VERIFIED" : "UNVERIFIED"} /></div>
              <div className="job-detail-score"><strong>{detail.match_score ?? "—"}</strong><span>match score</span></div>
            </div>
            <div className="detail-grid">
              <div><span>Company</span><strong>{detail.company_name}</strong></div>
              <div><span>Location</span><strong>{detail.location || "Not specified"}</strong></div>
              <div><span>Source</span><strong>{detail.source || "Company careers"}</strong></div>
              <div><span>Verified</span><strong>{detail.verified_at ? formatDate(detail.verified_at) : "Not verified"}</strong></div>
            </div>
            <div className="detail-block"><span>Role description</span><p>{detail.description || "No description supplied."}</p></div>
            {detail.match_reasons ? <div className="detail-block"><span>Match reasoning</span><p>{detail.match_reasons}</p></div> : null}
            {evidence?.skills?.length ? <div className="tag-row">{evidence.skills.map((skill) => <span className="tag" key={skill}>{skill}</span>)}</div> : null}
            <div className="detail-actions">
              {detail.url ? <a className="text-link" href={detail.url} target="_blank" rel="noreferrer">Open original listing <ArrowUpRight size={14} /></a> : null}
              <Link className="text-link" to={`/studio?contact=${detail.contact_id}`}>Open contact in studio <ArrowUpRight size={14} /></Link>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
