import { ArrowUpRight, BriefcaseBusiness, RefreshCw, Search, Sparkles, Target, UserRound } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { JobCard } from "../components/JobCard";
import { Button, EmptyState, FilterSelect, GlassCard, LoadingSkeleton, Modal, PageHeader, ProgressRing, SearchBar, SectionHeading, StatusBadge } from "../components/ui";
import { useWorkspace } from "../context/WorkspaceContext";
import { api, post } from "../lib/api";
import { formatShortDate, parseEvidence, parseReasonList } from "../lib/format";

export function Match() {
  const { notify, settings, refresh } = useWorkspace();
  const navigate = useNavigate();
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [minScore, setMinScore] = useState("0");
  const [sort, setSort] = useState("score");
  const [matchingId, setMatchingId] = useState(null);
  const [draftingId, setDraftingId] = useState(null);
  const [detail, setDetail] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api("/jobs?page_size=100&active=true");
      setJobs(response.jobs || []);
    } catch (error) {
      notify(error.message, "error");
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    load();
  }, [load]);

  const profileFields = [
    settings?.profile_summary,
    settings?.skills,
    settings?.target_roles,
    settings?.resume_name,
    settings?.linkedin || settings?.github,
    settings?.location,
  ];
  const completeness = Math.round((profileFields.filter(Boolean).length / profileFields.length) * 100);

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    const rows = jobs.filter((job) => {
      const haystack = `${job.title} ${job.company_name} ${job.location} ${job.description}`.toLowerCase();
      return (!term || haystack.includes(term)) && (job.match_score || 0) >= Number(minScore);
    });
    return rows.sort((a, b) => {
      if (sort === "score") return (b.match_score || 0) - (a.match_score || 0);
      return new Date(b.created_at || 0) - new Date(a.created_at || 0);
    });
  }, [jobs, minScore, query, sort]);

  const scored = jobs.filter((job) => job.match_score != null);
  const average = scored.length ? Math.round(scored.reduce((sum, job) => sum + job.match_score, 0) / scored.length) : 0;
  const strong = jobs.filter((job) => (job.match_score || 0) >= 75).length;
  const best = [...jobs].sort((a, b) => (b.match_score || 0) - (a.match_score || 0))[0];
  const profileSkills = String(settings?.skills || "").split(",").map((skill) => skill.trim()).filter(Boolean);
  const bestText = `${best?.title || ""} ${best?.description || ""}`.toLowerCase();
  const matchedSkills = profileSkills.filter((skill) => bestText.includes(skill.toLowerCase()));

  const handleMatch = async (job) => {
    setMatchingId(job.id);
    try {
      const result = await post(`/jobs/${job.id}/match`, {});
      setJobs((current) => current.map((item) => item.id === job.id ? result.job : item));
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
      notify("Tailored draft created. Review before approval.");
      navigate(`/studio?contact=${job.contact_id}&draft=${result.id}`);
    } catch (error) {
      notify(error.message, "error");
    } finally {
      setDraftingId(null);
    }
  };

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Match intelligence"
        title="Job match lab"
        description="See how each role aligns with your profile, then turn the strongest matches into tailored outreach."
        actions={(
          <>
            <Button variant="secondary" icon={RefreshCw} onClick={load}>Refresh scores</Button>
            <Link to="/discovery"><Button icon={BriefcaseBusiness}>Discover roles</Button></Link>
          </>
        )}
      />

      <div className="match-layout">
        <div className="match-sidebar">
          <GlassCard className="profile-card">
            <div className="profile-card-head">
              <span className="profile-avatar large"><UserRound size={24} /></span>
              <div><strong>{settings?.sender_name || "Your profile"}</strong><span>{settings?.target_roles || "Add your target roles"}</span></div>
            </div>
            <div className="profile-score">
              <ProgressRing value={completeness} size={108} />
              <div><strong>Profile signal</strong><span>{completeness}% complete</span><small>Stronger profiles produce more accurate matches and better drafts.</small></div>
            </div>
            <div className="tag-row">
              {String(settings?.skills || "").split(",").filter(Boolean).slice(0, 6).map((skill) => <span className="tag" key={skill.trim()}>{skill.trim()}</span>)}
              {!settings?.skills ? <span className="table-muted">Add skills in settings</span> : null}
            </div>
            <Link to="/settings" className="text-link">Improve profile <ArrowUpRight size={14} /></Link>
          </GlassCard>

          <GlassCard className="match-summary-card">
            <SectionHeading title="Match summary" />
            <div className="mini-stat"><span>Average score</span><strong>{average || "—"}</strong></div>
            <div className="mini-stat"><span>Strong matches</span><strong>{strong}</strong></div>
            <div className="mini-stat"><span>Scored roles</span><strong>{scored.length}</strong></div>
            {best ? (
              <div className="best-match">
                <span>Top opportunity</span>
                <strong>{best.title}</strong>
                <small>{best.company_name}</small>
                <StatusBadge status={`${best.match_score || 0} MATCH`} />
              </div>
            ) : null}
          </GlassCard>

          <GlassCard className="match-explain-card">
            <SectionHeading
              title="Why this role matches"
              description={best ? best.title : "Run a match to see the reasoning."}
            />
            {best ? (
              <>
                <ul className="reason-list">
                  {parseReasonList(best.match_reasons).map((reason, index) => <li key={`${reason}-${index}`}>{reason}</li>)}
                </ul>
                <div className="tag-row">
                  {matchedSkills.length ? matchedSkills.map((skill) => <span className="tag" key={skill}>{skill}</span>) : <span className="table-muted">Add more skills in settings for richer matching detail.</span>}
                </div>
                <div className="match-explain-foot">
                  <StatusBadge status={best.verified_at ? "VERIFIED" : "UNVERIFIED"} dot={false} />
                  <span>{formatShortDate(best.created_at)}</span>
                </div>
              </>
            ) : (
              <EmptyState compact icon={Target} title="No match yet" description="Score a role to see the signals behind it." />
            )}
          </GlassCard>
        </div>

        <div className="match-main">
          <GlassCard className="filter-card">
            <div className="filter-row">
              <SearchBar value={query} onChange={setQuery} placeholder="Search matched roles..." className="grow" />
              <FilterSelect
                label="Minimum"
                value={minScore}
                onChange={setMinScore}
                options={[
                  { value: "0", label: "Any score" },
                  { value: "50", label: "50+" },
                  { value: "70", label: "70+" },
                  { value: "85", label: "85+" },
                ]}
              />
              <FilterSelect
                label="Sort"
                value={sort}
                onChange={setSort}
                options={[
                  { value: "score", label: "Best match" },
                  { value: "newest", label: "Newest" },
                ]}
              />
            </div>
          </GlassCard>

          {loading ? <GlassCard><LoadingSkeleton rows={5} /></GlassCard> : filtered.length ? (
            <div className="job-grid single">
              {filtered.map((job) => (
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
          ) : (
            <GlassCard>
              <EmptyState
                icon={Target}
                title="No scored roles match this view"
                description="Run discovery for your companies or lower the minimum score to see more roles."
                action={<Link to="/discovery"><Button icon={Search}>Explore roles</Button></Link>}
              />
            </GlassCard>
          )}
        </div>
      </div>

      <Modal
        open={Boolean(detail)}
        onClose={() => setDetail(null)}
        title={detail?.title || "Role details"}
        description={detail ? `${detail.company_name} · ${detail.location || "Location flexible"}` : ""}
        width="720px"
        footer={(
          <>
            <Button variant="ghost" onClick={() => setDetail(null)}>Close</Button>
            <Button icon={Sparkles} loading={draftingId === detail?.id} onClick={() => handleDraft(detail)}>Create draft</Button>
          </>
        )}
      >
        {detail ? (
          <div className="job-detail">
            <div className="job-detail-top">
              <div>
                <StatusBadge status={detail.active ? "ACTIVE" : "CLOSED"} />
                <StatusBadge status={detail.verified_at ? "VERIFIED" : "UNVERIFIED"} />
              </div>
              <div className="job-detail-score"><strong>{detail.match_score ?? "—"}</strong><span>match score</span></div>
            </div>
            <div className="detail-grid">
              <div><span>Company</span><strong>{detail.company_name}</strong></div>
              <div><span>Location</span><strong>{detail.location || "Not specified"}</strong></div>
              <div><span>Source</span><strong>{detail.source || "Company careers"}</strong></div>
              <div><span>Verified</span><strong>{detail.verified_at ? formatShortDate(detail.verified_at) : "Not verified"}</strong></div>
            </div>
            <div className="detail-block"><span>Role description</span><p>{detail.description || "No description supplied."}</p></div>
            <div className="detail-block">
              <span>Match reasoning</span>
              <ul className="reason-list">{parseReasonList(detail.match_reasons).map((reason, index) => <li key={`${reason}-${index}`}>{reason}</li>)}</ul>
            </div>
            {parseEvidence(detail.evidence)?.skills?.length ? (
              <div className="tag-row">{parseEvidence(detail.evidence).skills.map((skill) => <span className="tag" key={skill}>{skill}</span>)}</div>
            ) : null}
            {detail.url ? <a className="text-link" href={detail.url} target="_blank" rel="noreferrer">Open original listing <ArrowUpRight size={14} /></a> : null}
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
