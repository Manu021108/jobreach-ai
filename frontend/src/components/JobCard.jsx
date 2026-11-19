import { ArrowUpRight, ExternalLink, MapPin, Sparkles, Target, Wallet } from "lucide-react";
import { Avatar, Button, GlassCard, ProgressRing, StatusBadge } from "./ui";
import { formatShortDate, parseEvidence } from "../lib/format";

function salaryLabel(job) {
  if (!job.salary_min && !job.salary_max) return "";
  const symbol = { USD: "$", EUR: "€", GBP: "£", INR: "₹" }[job.salary_currency] || "";
  const short = (value) => (value >= 1000 ? `${Math.round(value / 1000)}k` : String(value));
  if (job.salary_min && job.salary_max && job.salary_min !== job.salary_max) {
    return `${symbol}${short(job.salary_min)}–${symbol}${short(job.salary_max)}`;
  }
  return `${symbol}${short(job.salary_max || job.salary_min)}`;
}

export function JobCard({ job, onOpen, onMatch, onDraft, matching, drafting }) {
  const evidence = parseEvidence(job.evidence);
  return (
    <GlassCard className="job-card">
      <div className="job-card-head">
        <Avatar name={job.company_name} />
        <div className="job-card-title">
          <div>
            <strong>{job.title || "Open role"}</strong>
            <span>{job.company_name}</span>
          </div>
          <StatusBadge status={job.active ? "ACTIVE" : "CLOSED"} />
        </div>
      </div>
      <div className="job-meta">
        <span><MapPin size={14} /> {job.location || "Location flexible"}</span>
        <span><ExternalLink size={14} /> {job.source || "Company careers"}</span>
        {job.experience_level && job.experience_level !== "UNKNOWN" ? <span>{job.experience_level}</span> : null}
        {salaryLabel(job) ? <span><Wallet size={14} /> {salaryLabel(job)}</span> : null}
        {job.posted_at ? <span>Posted {formatShortDate(job.posted_at)}</span> : null}
        {job.verified_at ? <span className="verified"><Target size={14} /> Verified {formatShortDate(job.verified_at)}</span> : null}
      </div>
      <p className="job-description">{job.description ? `${job.description.slice(0, 170)}${job.description.length > 170 ? "…" : ""}` : "Open the role to review the full description and matching context."}</p>
      {job.match_reasons ? <p className="job-reasons"><Sparkles size={13} /> {job.match_reasons}</p> : null}
      {evidence?.skills?.length ? (
        <div className="tag-row">
          {evidence.skills.slice(0, 4).map((skill) => <span className="tag" key={skill}>{skill}</span>)}
        </div>
      ) : null}
      <div className="job-card-footer">
        <div className="job-score">
          <ProgressRing value={job.match_score || 0} size={52} />
          <span>Match score</span>
        </div>
        <div className="job-actions">
          <Button variant="ghost" size="sm" onClick={() => onOpen?.(job)}>Details</Button>
          <Button variant="secondary" size="sm" icon={Target} loading={matching} onClick={() => onMatch?.(job)}>Match</Button>
          <Button size="sm" icon={Sparkles} loading={drafting} onClick={() => onDraft?.(job)}>Draft</Button>
        </div>
      </div>
      {job.url ? <a className="job-link" href={job.url} target="_blank" rel="noreferrer">View original listing <ArrowUpRight size={13} /></a> : null}
    </GlassCard>
  );
}
