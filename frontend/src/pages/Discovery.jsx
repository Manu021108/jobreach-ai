import {
  ArrowUpRight,
  Bell,
  BriefcaseBusiness,
  Check,
  Clock3,
  Filter,
  Globe2,
  MapPin,
  Play,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Target,
  Trash2,
  Wallet,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { JobCard } from "../components/JobCard";
import {
  Button,
  ConfirmDialog,
  EmptyState,
  FilterSelect,
  GlassCard,
  LoadingSkeleton,
  Modal,
  PageHeader,
  SearchBar,
  SectionHeading,
  StatusBadge,
} from "../components/ui";
import { useWorkspace } from "../context/WorkspaceContext";
import { api, post, remove } from "../lib/api";
import { formatDate, parseEvidence } from "../lib/format";

const SOURCE_OPTIONS = [
  { value: "remotive", label: "Remotive" },
  { value: "arbeitnow", label: "Arbeitnow" },
  { value: "remoteok", label: "RemoteOK" },
  { value: "greenhouse", label: "Greenhouse" },
  { value: "lever", label: "Lever" },
  { value: "careers_page", label: "Career sites" },
];

const EXPERIENCE_OPTIONS = [
  { value: "", label: "Any experience" },
  { value: "FRESHER", label: "Fresher" },
  { value: "ENTRY", label: "Entry level" },
  { value: "FRESHER,ENTRY", label: "Fresher + entry" },
  { value: "MID", label: "Mid level" },
  { value: "SENIOR", label: "Senior" },
];

function csv(value) {
  if (Array.isArray(value)) return value.join(",");
  return String(value || "").split(",").map((item) => item.trim()).filter(Boolean).join(",");
}

function sourceLabel(source) {
  return SOURCE_OPTIONS.find((item) => item.value === source)?.label || source || "Job portal";
}

function salaryLabel(job) {
  if (!job.salary_min && !job.salary_max) return "Salary not listed";
  const symbol = { USD: "$", EUR: "€", GBP: "£", INR: "₹" }[job.salary_currency] || "";
  const short = (value) => (value >= 1000 ? `${Math.round(value / 1000)}k` : String(value));
  const suffix = job.salary_period && job.salary_period !== "year" ? ` / ${job.salary_period}` : "";
  if (job.salary_min && job.salary_max && job.salary_min !== job.salary_max) {
    return `${symbol}${short(job.salary_min)}–${symbol}${short(job.salary_max)}${suffix}`;
  }
  return `${symbol}${short(job.salary_max || job.salary_min)}${suffix}`;
}

function isFresh(job) {
  if (!job.posted_at) return false;
  const age = Date.now() - new Date(job.posted_at).getTime();
  return Number.isFinite(age) && age >= 0 && age <= 7 * 24 * 60 * 60 * 1000;
}

export function Discovery() {
  const {
    notify,
    refresh,
    settings,
    jobAlerts,
    jobNotifications,
    refreshJobNotifications,
    markJobNotificationRead,
  } = useWorkspace();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [company, setCompany] = useState("");
  const [location, setLocation] = useState("");
  const [skills, setSkills] = useState("");
  const [experience, setExperience] = useState("");
  const [salaryMin, setSalaryMin] = useState("");
  const [fresherOnly, setFresherOnly] = useState(false);
  const [selectedSources, setSelectedSources] = useState(SOURCE_OPTIONS.map((item) => item.value));
  const [postedWithin, setPostedWithin] = useState("");
  const [sort, setSort] = useState("newest");
  const [active, setActive] = useState("all");
  const [page, setPage] = useState(1);
  const [data, setData] = useState({ jobs: [], companies: [], total: 0, page_count: 1 });
  const [loading, setLoading] = useState(true);
  const [discovering, setDiscovering] = useState(false);
  const [discoveryResult, setDiscoveryResult] = useState(null);
  const [detail, setDetail] = useState(null);
  const [matchingId, setMatchingId] = useState(null);
  const [draftingId, setDraftingId] = useState(null);
  const [alertOpen, setAlertOpen] = useState(false);
  const [alertForm, setAlertForm] = useState({ name: "" });
  const [runningAlert, setRunningAlert] = useState(null);
  const [deletingAlert, setDeletingAlert] = useState(null);

  useEffect(() => {
    if (!skills && settings?.skills) setSkills(settings.skills);
  }, [settings, skills]);

  const filterParams = useMemo(() => ({
    query,
    company,
    location,
    skills,
    experience,
    salary_min: salaryMin,
    fresher_only: fresherOnly,
    sources: csv(selectedSources),
    posted_within_days: postedWithin,
    sort,
  }), [company, experience, fresherOnly, location, postedWithin, query, salaryMin, selectedSources, skills, sort]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), page_size: "12" });
      Object.entries(filterParams).forEach(([key, value]) => {
        if (value === "" || value === false || value == null) return;
        params.set(key, typeof value === "boolean" ? String(value) : String(value));
      });
      if (active !== "all") params.set("active", active === "active" ? "true" : "false");
      const response = await api(`/jobs?${params.toString()}`);
      setData(response);
    } catch (error) {
      notify(error.message, "error");
    } finally {
      setLoading(false);
    }
  }, [active, filterParams, notify, page]);

  useEffect(() => {
    const timer = window.setTimeout(load, 240);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    setPage(1);
  }, [filterParams, active]);

  const summary = useMemo(() => {
    const rows = data.jobs || [];
    const scores = rows.map((job) => job.match_score).filter((score) => score != null);
    return {
      total: data.total || 0,
      active: rows.filter((job) => job.active).length,
      fresh: rows.filter(isFresh).length,
      average: scores.length ? Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length) : 0,
    };
  }, [data]);

  const toggleSource = (value) => {
    setSelectedSources((current) => current.includes(value)
      ? current.filter((item) => item !== value)
      : [...current, value]);
  };

  const runDiscovery = async () => {
    if (!selectedSources.length) {
      notify("Select at least one job source.", "error");
      return;
    }
    setDiscovering(true);
    try {
      const result = await post("/jobs/discover", {
        ...filterParams,
        salary_min: salaryMin ? Number(salaryMin) : null,
        posted_within_days: postedWithin ? Number(postedWithin) : null,
        include_companies: true,
      });
      setDiscoveryResult(result);
      await load();
      await refreshJobNotifications();
      notify(`Discovery complete: ${result.new_jobs} new, ${result.updated_jobs} refreshed.`);
    } catch (error) {
      notify(error.message, "error");
    } finally {
      setDiscovering(false);
    }
  };

  const openAlertModal = () => {
    setAlertForm({
      name: `${skills ? `${csv(skills).split(",")[0]} ` : ""}opportunities`,
      skills,
      location,
      experience,
      salary_min: salaryMin,
      fresher_only: fresherOnly,
      sources: csv(selectedSources),
    });
    setAlertOpen(true);
  };

  const saveAlert = async () => {
    try {
      await post("/job-alerts", {
        ...alertForm,
        salary_min: alertForm.salary_min ? Number(alertForm.salary_min) : null,
        sources: csv(alertForm.sources),
      });
      setAlertOpen(false);
      await refresh();
      notify("Job alert saved. New matches will appear in notifications.");
    } catch (error) {
      notify(error.message, "error");
    }
  };

  const runAlert = async (alert) => {
    setRunningAlert(alert.id);
    try {
      const result = await post(`/job-alerts/${alert.id}/run`, {});
      await load();
      await refresh();
      await refreshJobNotifications();
      notify(`Alert complete: ${result.new_jobs} new role${result.new_jobs === 1 ? "" : "s"}.`);
    } catch (error) {
      notify(error.message, "error");
    } finally {
      setRunningAlert(null);
    }
  };

  const toggleAlert = async (alert) => {
    try {
      await api(`/job-alerts/${alert.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !alert.active }),
      });
      await refresh();
      notify(alert.active ? "Job alert paused." : "Job alert resumed.");
    } catch (error) {
      notify(error.message, "error");
    }
  };

  const deleteAlert = async () => {
    if (!deletingAlert) return;
    try {
      await remove(`/job-alerts/${deletingAlert.id}`);
      await refresh();
      notify("Job alert deleted.");
    } catch (error) {
      notify(error.message, "error");
    } finally {
      setDeletingAlert(null);
    }
  };

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
    if (!job.contact_id) {
      notify("Create a contact for this company before generating an outreach draft.", "error");
      return;
    }
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
        description="Find fresh roles across official career pages and public job boards, then turn the best matches into outreach."
        actions={(
          <>
            <Button variant="secondary" icon={RefreshCw} onClick={() => refreshJobNotifications()}>Refresh alerts</Button>
            <Button variant="secondary" icon={Plus} onClick={openAlertModal}>Create alert</Button>
            <Button icon={Sparkles} loading={discovering} onClick={runDiscovery}>Run AI discovery</Button>
          </>
        )}
      />

      <GlassCard className="discovery-hero">
        <div className="discovery-hero-copy">
          <span className="discovery-hero-icon"><Sparkles size={18} /></span>
          <div>
            <strong>Search beyond your contact list</strong>
            <p>Discovery checks official Greenhouse, Lever, and career-site feeds plus public job boards, then stores only real listings it can verify.</p>
          </div>
        </div>
        <div className="discovery-hero-actions">
          <span className="discovery-source-label"><Globe2 size={14} /> Sources</span>
          <div className="source-chips">
            {SOURCE_OPTIONS.map((source) => {
              const selected = selectedSources.includes(source.value);
              return (
                <button
                  type="button"
                  key={source.value}
                  className={`source-chip ${selected ? "active" : ""}`.trim()}
                  onClick={() => toggleSource(source.value)}
                >
                  {selected ? <Check size={12} /> : <Plus size={12} />}
                  {source.label}
                </button>
              );
            })}
          </div>
        </div>
      </GlassCard>

      {discoveryResult ? (
        <GlassCard className="discovery-result">
          <div className="discovery-result-head">
            <div><strong>Last discovery run</strong><span>{discoveryResult.total_found} found · {discoveryResult.matched} matched · {discoveryResult.new_jobs} new</span></div>
            <StatusBadge status={discoveryResult.new_jobs ? "SUCCESS" : "READY"} />
          </div>
          {discoveryResult.warnings?.length ? (
            <ul className="discovery-warnings">
              {discoveryResult.warnings.slice(0, 4).map((warning) => <li key={warning}>{warning}</li>)}
            </ul>
          ) : null}
        </GlassCard>
      ) : null}

      <div className="stat-strip">
        <div><span className="stat-icon tone-teal"><BriefcaseBusiness size={17} /></span><strong>{summary.total}</strong><small>Roles discovered</small></div>
        <div><span className="stat-icon tone-blue"><Target size={17} /></span><strong>{summary.active}</strong><small>Active on page</small></div>
        <div><span className="stat-icon tone-violet"><Clock3 size={17} /></span><strong>{summary.fresh}</strong><small>Fresh this week</small></div>
        <div><span className="stat-icon tone-amber"><Sparkles size={17} /></span><strong>{summary.average || "—"}</strong><small>Average match</small></div>
      </div>

      <GlassCard className="filter-card discovery-filters">
        <div className="filter-row">
          <SearchBar value={query} onChange={setQuery} placeholder="Search role, company, or skill..." className="grow" />
          <FilterSelect label="Company" value={company} onChange={setCompany} options={companyOptions} />
          <FilterSelect label="Status" value={active} onChange={setActive} options={[
            { value: "all", label: "All roles" },
            { value: "active", label: "Active only" },
            { value: "closed", label: "Closed" },
          ]} />
          <FilterSelect label="Experience" value={experience} onChange={setExperience} options={EXPERIENCE_OPTIONS} />
        </div>
        <div className="filter-row secondary">
          <label className="inline-field"><span>Skills</span><div className="inline-input"><Filter size={14} /><input value={skills} onChange={(event) => setSkills(event.target.value)} placeholder="Python, React, ML..." /></div></label>
          <label className="inline-field"><span>Location</span><div className="inline-input"><MapPin size={14} /><input value={location} onChange={(event) => setLocation(event.target.value)} placeholder="Remote, city..." /></div></label>
          <label className="inline-field"><span>Minimum salary</span><div className="inline-input"><Wallet size={14} /><input type="number" min="0" value={salaryMin} onChange={(event) => setSalaryMin(event.target.value)} placeholder="80000" /></div></label>
          <FilterSelect label="Freshness" value={postedWithin} onChange={setPostedWithin} options={[
            { value: "", label: "Any time" },
            { value: "7", label: "Last 7 days" },
            { value: "30", label: "Last 30 days" },
          ]} />
          <FilterSelect label="Sort" value={sort} onChange={setSort} options={[
            { value: "newest", label: "Newest first" },
            { value: "posted", label: "Recently posted" },
            { value: "match", label: "Best match" },
            { value: "salary", label: "Highest salary" },
          ]} />
          <label className="check-field">
            <input type="checkbox" checked={fresherOnly} onChange={(event) => setFresherOnly(event.target.checked)} />
            <span>Fresher / entry level</span>
          </label>
        </div>
      </GlassCard>

      <div className="discovery-alerts-grid">
        <GlassCard className="alert-list-card">
          <SectionHeading title="Saved job alerts" description="Run a saved search now or let the discovery worker watch for new roles." />
          {jobAlerts.length ? (
            <div className="alert-list">
              {jobAlerts.map((alert) => (
                <div className={`alert-row ${alert.active ? "" : "paused"}`.trim()} key={alert.id}>
                  <div className="alert-row-copy">
                    <strong>{alert.name}</strong>
                    <span>{[alert.skills, alert.location, alert.experience].filter(Boolean).join(" · ") || "All matching roles"}</span>
                  </div>
                  <div className="alert-row-actions">
                    <Button variant="ghost" size="sm" icon={Play} loading={runningAlert === alert.id} onClick={() => runAlert(alert)}>Run</Button>
                    <Button variant="ghost" size="sm" onClick={() => toggleAlert(alert)}>{alert.active ? "Pause" : "Resume"}</Button>
                    <button type="button" className="icon-button danger" aria-label={`Delete ${alert.name}`} onClick={() => setDeletingAlert(alert)}><Trash2 size={15} /></button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState compact icon={Bell} title="No job alerts yet" description="Save these filters to get notified when matching roles are published." />
          )}
        </GlassCard>

        <GlassCard className="alert-list-card">
          <SectionHeading title="Recent job alerts" description="New roles discovered by your saved searches." />
          {jobNotifications.length ? (
            <div className="notification-list">
              {jobNotifications.slice(0, 4).map((item) => (
                <button
                  type="button"
                  className={`notification-list-item ${item.read ? "read" : ""}`.trim()}
                  key={item.id}
                  onClick={() => {
                    if (!item.read) markJobNotificationRead(item.id).catch(() => {});
                    window.open(item.url || "/discovery", "_blank", "noopener,noreferrer");
                  }}
                >
                  <span className="notification-list-icon"><BriefcaseBusiness size={15} /></span>
                  <span><strong>{item.title}</strong><small>{item.message}</small></span>
                  <ArrowUpRight size={14} />
                </button>
              ))}
            </div>
          ) : (
            <EmptyState compact icon={Check} title="Nothing new yet" description="Run discovery or save an alert to start receiving role notifications." />
          )}
        </GlassCard>
      </div>

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
            description="Run AI discovery or adjust the filters to find roles across job portals and company career pages."
            action={<Button icon={Sparkles} loading={discovering} onClick={runDiscovery}>Run AI discovery</Button>}
          />
        </GlassCard>
      )}

      <Modal
        open={alertOpen}
        onClose={() => setAlertOpen(false)}
        title="Create job alert"
        description="Save the current discovery filters and get notified when new roles match."
        width="620px"
        footer={(
          <>
            <Button variant="ghost" onClick={() => setAlertOpen(false)}>Cancel</Button>
            <Button icon={Bell} onClick={saveAlert}>Save alert</Button>
          </>
        )}
      >
        <div className="form-grid">
          <label className="field full"><span>Alert name</span><input value={alertForm.name || ""} onChange={(event) => setAlertForm((current) => ({ ...current, name: event.target.value }))} placeholder="Python remote roles" /></label>
          <label className="field"><span>Skills</span><input value={alertForm.skills || ""} onChange={(event) => setAlertForm((current) => ({ ...current, skills: event.target.value }))} placeholder="Python, FastAPI" /></label>
          <label className="field"><span>Location</span><input value={alertForm.location || ""} onChange={(event) => setAlertForm((current) => ({ ...current, location: event.target.value }))} placeholder="Remote" /></label>
          <FilterSelect label="Experience" value={alertForm.experience || ""} onChange={(value) => setAlertForm((current) => ({ ...current, experience: value }))} options={EXPERIENCE_OPTIONS} />
          <label className="field"><span>Minimum salary</span><input type="number" min="0" value={alertForm.salary_min || ""} onChange={(event) => setAlertForm((current) => ({ ...current, salary_min: event.target.value }))} placeholder="80000" /></label>
          <label className="field full"><span>Sources</span><input value={alertForm.sources || ""} onChange={(event) => setAlertForm((current) => ({ ...current, sources: event.target.value }))} placeholder="remotive,arbeitnow,greenhouse" /></label>
          <label className="check-field full"><input type="checkbox" checked={Boolean(alertForm.fresher_only)} onChange={(event) => setAlertForm((current) => ({ ...current, fresher_only: event.target.checked }))} /><span>Fresher / entry level only</span></label>
        </div>
      </Modal>

      <ConfirmDialog
        open={Boolean(deletingAlert)}
        onClose={() => setDeletingAlert(null)}
        onConfirm={deleteAlert}
        title="Delete this job alert?"
        description={`${deletingAlert?.name || "This alert"} will stop watching for new roles. Existing notifications remain available.`}
        confirmLabel="Delete alert"
      />

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
            {detail?.contact_id ? <Button icon={Sparkles} loading={draftingId === detail?.id} onClick={() => handleDraft(detail)}>Create draft</Button> : null}
          </>
        )}
      >
        {detail ? (
          <div className="job-detail">
            <div className="job-detail-top">
              <div><StatusBadge status={detail.active ? "ACTIVE" : "CLOSED"} /><StatusBadge status={detail.verified_at ? "VERIFIED" : "UNVERIFIED"} />{isFresh(detail) ? <StatusBadge status="NEW" /> : null}</div>
              <div className="job-detail-score"><strong>{detail.match_score ?? "—"}</strong><span>match score</span></div>
            </div>
            <div className="detail-grid">
              <div><span>Company</span><strong>{detail.company_name}</strong></div>
              <div><span>Location</span><strong>{detail.location || "Not specified"}</strong></div>
              <div><span>Source</span><strong>{sourceLabel(detail.source)}</strong></div>
              <div><span>Salary</span><strong>{salaryLabel(detail)}</strong></div>
              <div><span>Experience</span><strong>{detail.experience_level && detail.experience_level !== "UNKNOWN" ? detail.experience_level : "Not specified"}</strong></div>
              <div><span>Posted</span><strong>{detail.posted_at ? formatDate(detail.posted_at) : "Not reported"}</strong></div>
            </div>
            <div className="detail-block"><span>Role description</span><p>{detail.description || "No description supplied."}</p></div>
            {detail.match_reasons ? <div className="detail-block"><span>Match reasoning</span><p>{detail.match_reasons}</p></div> : null}
            {evidence?.skills?.length ? <div className="tag-row">{evidence.skills.map((skill) => <span className="tag" key={skill}>{skill}</span>)}</div> : null}
            <div className="detail-actions">
              {detail.url ? <a className="text-link" href={detail.url} target="_blank" rel="noreferrer">Open original listing <ArrowUpRight size={14} /></a> : null}
              {detail.contact_id ? <Link className="text-link" to={`/studio?contact=${detail.contact_id}`}>Open contact in studio <ArrowUpRight size={14} /></Link> : null}
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
