import {
  ArrowUpRight,
  Brain,
  Filter,
  RefreshCw,
  Search,
  Sparkles,
  Target,
  TrendingUp,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { JobCard } from "../components/JobCard";
import {
  Button,
  EmptyState,
  FilterSelect,
  GlassCard,
  LoadingSkeleton,
  Modal,
  PageHeader,
  ProgressBar,
  SectionHeading,
  StatusBadge,
} from "../components/ui";
import { useWorkspace } from "../context/WorkspaceContext";
import { api, post } from "../lib/api";
import { formatShortDate, parseEvidence, parseReasonList } from "../lib/format";

const MIN_SIM_OPTIONS = [
  { value: "0", label: "Any similarity" },
  { value: "0.3", label: "30%+" },
  { value: "0.5", label: "50%+" },
  { value: "0.7", label: "70%+" },
  { value: "0.85", label: "85%+" },
];

const SORT_OPTIONS = [
  { value: "score", label: "Best match" },
  { value: "newest", label: "Newest" },
];

export function SemanticMatch() {
  const { notify, settings, refresh } = useWorkspace();
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [minScore, setMinScore] = useState("0.3");
  const [sort, setSort] = useState("score");
  const [rebuilding, setRebuilding] = useState(false);
  const [detail, setDetail] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api(`/match/semantic?limit=100&min_similarity=${minScore}`);
      setJobs(response.matches || []);
    } catch (error) {
      notify(error.message, "error");
    } finally {
      setLoading(false);
    }
  }, [minScore, notify]);

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
      const haystack = `${job.job.title} ${job.job.company_name} ${job.job.location} ${job.job.description}`.toLowerCase();
      return (!term || haystack.includes(term)) && (job.semantic_score || 0) >= Number(minScore) * 100;
    });
    return rows.sort((a, b) => {
      if (sort === "score") return (b.semantic_score || 0) - (a.semantic_score || 0);
      return new Date(b.job.created_at || 0) - new Date(a.job.created_at || 0);
    });
  }, [jobs, minScore, query, sort]);

  const scored = jobs.filter((job) => job.semantic_score != null);
  const average = scored.length ? Math.round(scored.reduce((sum, job) => sum + job.semantic_score, 0) / scored.length) : 0;
  const strong = jobs.filter((job) => (job.semantic_score || 0) >= 75).length;

  const rebuildEmbeddings = async () => {
    setRebuilding(true);
    try {
      const result = await post("/admin/rebuild-embeddings", {});
      notify(`Embeddings rebuilt: ${result.processed} processed, ${result.failed} failed.`);
      await load();
    } catch (error) {
      notify(error.message, "error");
    } finally {
      setRebuilding(false);
    }
  };

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Semantic Intelligence"
        title="Semantic Job Match"
        description="AI-powered semantic matching using vector embeddings to find roles that truly align with your profile."
        actions={(
          <>
            <Button variant="secondary" icon={RefreshCw} onClick={load}>Refresh scores</Button>
            <Button variant="secondary" icon={Brain} loading={rebuilding} onClick={rebuildEmbeddings}>Rebuild embeddings</Button>
            <Link to="/match"><Button icon={Target}>Keyword Match</Button></Link>
          </>
        )}
      />

      <div className="match-layout">
        <div className="match-sidebar">
          <GlassCard className="profile-card">
            <div className="profile-card-head">
              <span className="profile-avatar large"><Brain size={24} /></span>
              <div><strong>{settings?.sender_name || "Your profile"}</strong><span>{settings?.target_roles || "Add your target roles"}</span></div>
            </div>
            <div className="profile-score">
              <ProgressBar value={completeness} size={108} />
              <div><strong>Profile completeness</strong><span>{completeness}%</span><small>Complete your profile for better semantic matches.</small></div>
            </div>
            <div className="tag-row">
              {String(settings?.skills || "").split(",").filter(Boolean).slice(0, 6).map((skill) => <span className="tag" key={skill.trim()}>{skill.trim()}</span>)}
              {!settings?.skills ? <span className="table-muted">Add skills in settings</span> : null}
            </div>
            <Link to="/settings" className="text-link">Improve profile <ArrowUpRight size={14} /></Link>
          </GlassCard>

          <GlassCard className="match-summary-card">
            <SectionHeading title="Semantic match summary" />
            <div className="mini-stat"><span>Average score</span><strong>{average || "—"}</strong></div>
            <div className="mini-stat"><span>Strong matches</span><strong>{strong}</strong></div>
            <div className="mini-stat"><span>Scored roles</span><strong>{scored.length}</strong></div>
            {best ? (
              <div className="best-match">
                <span>Top opportunity</span>
                <strong>{best.job.title}</strong>
                <small>{best.job.company_name}</small>
                <StatusBadge status={`${best.semantic_score} SEMANTIC`} />
              </div>
            ) : null}
          </GlassCard>

          <GlassCard className="match-explain-card">
            <SectionHeading
              title="Why this role matches"
              description={best ? best.job.title : "Run a match to see the reasoning."}
            />
            {best ? (
              <>
                <ul className="reason-list">
                  {parseReasonList(best.job.match_reasons).map((reason, index) => <li key={`${reason}-${index}`}>{reason}</li>)}
                </ul>
                <div className="tag-row">
                  {matchedSkills.length ? matchedSkills.map((skill) => <span className="tag" key={skill}>{skill}</span>) : <span className="table-muted">Add more skills in settings for richer matching detail.</span>}
                </div>
                <div className="match-explain-foot">
                  <StatusBadge status={best.job.verified_at ? "VERIFIED" : "UNVERIFIED"} dot={false} />
                  <span>{formatShortDate(best.job.created_at)}</span>
                </div>
              </>
            ) : (
              <EmptyState compact icon={Target} title="No match yet" description="Build your resume embedding to see semantic matches." />
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
                options={MIN_SIM_OPTIONS}
              />
              <FilterSelect
                label="Sort"
                value={sort}
                onChange={setSort}
                options={SORT_OPTIONS}
              />
            </div>
          </GlassCard>

          {loading ? <GlassCard><LoadingSkeleton rows={5} /></GlassCard> : filtered.length ? (
            <div className="job-grid single">
              {filtered.map((job) => (
                <JobCard
                  key={job.job.id}
                  job={job.job}
                  onOpen={setDetail}
                  onMatch={() => notify("Semantic match doesn't need keyword re-scoring", "info")}
                  onDraft={() => {
                    if (!job.job.contact_id) {
                      notify("Create a contact for this company before generating an outreach draft.", "error");
                      return;
                    }
                    post(`/jobs/${job.job.id}/generate`, {}).then((result) => {
                      refresh();
                      notify("AI draft created. Review it before approval.");
                      window.location.href = `/studio?contact=${job.job.contact_id}&draft=${result.id}`;
                    }).catch((error) => {
                      notify(error.message, "error");
                    });
                  }}
                  matching={false}
                  drafting={false}
                  semanticScore={job.semantic_score}
                />
              ))}
            </div>
          ) : (
            <GlassCard>
              <EmptyState
                icon={Target}
                title="No scored roles match this view"
                description="Build your resume embedding in settings, then run embedding rebuild."
                action={<Button icon={Brain} loading={rebuilding} onClick={rebuildEmbeddings}>Rebuild embeddings</Button>}
              />
            </GlassCard>
          )}

          <div className="table-pagination standalone">
            <span>Showing {filtered.length} of {jobs.length} matches</span>
          </div>
        </div>
      </div>

      <Modal
        open={Boolean(detail)}
        onClose={() => setDetail(null)}
        title={detail?.job?.title || "Role details"}
        description={detail ? `${detail.job.company_name} · ${detail.job.location || "Location flexible"}` : ""}
        width="760px"
        footer={(
          <>
            <Button variant="ghost" onClick={() => setDetail(null)}>Close</Button>
            <Button variant="secondary" icon={Target} loading={false} onClick={() => handleMatch(detail)}>Run keyword match</Button>
            {detail?.job?.contact_id ? <Button icon={Sparkles} loading={false} onClick={() => handleDraft(detail)}>Create draft</Button> : null}
          </>
        )}
      >
        {detail ? (
          <div className="job-detail">
            <div className="job-detail-top">
              <div><StatusBadge status={detail.job.active ? "ACTIVE" : "CLOSED"} /><StatusBadge status={detail.job.verified_at ? "VERIFIED" : "UNVERIFIED"} /></div>
              <div className="job-detail-score"><strong>{detail.semantic_score ?? "—"}</strong><span>semantic score</span></div>
            </div>
            <div className="detail-grid">
              <div><span>Company</span><strong>{detail.job.company_name}</strong></div>
              <div><span>Location</span><strong>{detail.job.location || "Not specified"}</strong></div>
              <div><span>Source</span><strong>{detail.job.source || "Company careers"}</strong></div>
              <div><span>Keyword score</span><strong>{detail.job.match_score ?? "—"}</strong></div>
              <div><span>Verified</span><strong>{detail.job.verified_at ? formatShortDate(detail.job.verified_at) : "Not verified"}</strong></div>
            </div>
            <div className="detail-block"><span>Role description</span><p>{detail.job.description || "No description supplied."}</p></div>
            <div className="detail-block"><span>Keyword reasoning</span><p>{detail.job.match_reasons || "No keyword reasoning available."}</p></div>
            <div className="detail-block"><span>Semantic reasoning</span><p>This role was matched using vector embeddings based on semantic similarity between your resume and the job description. The score reflects how closely the job aligns with your skills, experience, and target roles.</p></div>
            {detail.job.url ? <a className="text-link" href={detail.job.url} target="_blank" rel="noreferrer">Open original listing <ArrowUpRight size={14} /></a> : null}
            {detail.job.contact_id ? <Link className="text-link" to={`/studio?contact=${detail.job.contact_id}`}>Open contact in studio <ArrowUpRight size={14} /></Link> : null}
          </div>
        ) : null}
      </Modal>
    </div>
  );
}