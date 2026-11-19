import {
  ArrowUpRight,
  CheckCircle2,
  Circle,
  FileText,
  LoaderCircle,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  UserRound,
  Search,
  Brain,
} from "lucide-react";
import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  Button,
  ConfirmDialog,
  GlassCard,
  PageHeader,
  ProgressRing,
  SectionHeading,
  StatusBadge,
  Modal,
  EmptyState,
} from "../components/ui";
import { useWorkspace } from "../context/WorkspaceContext";
import { api, post } from "../lib/api";

export function Resume() {
  const { settings, run, busy, notify, refresh } = useWorkspace();
  const inputRef = useRef(null);
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [parseOpen, setParseOpen] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [parsedData, setParsedData] = useState(null);

  const checks = [
    { label: "Profile summary", done: Boolean(settings?.profile_summary) },
    { label: "Skills", done: Boolean(settings?.skills) },
    { label: "Target roles", done: Boolean(settings?.target_roles) },
    { label: "PDF resume", done: Boolean(settings?.resume_name) },
    { label: "Gmail connected", done: Boolean(settings?.gmail_connected) },
  ];
  const completeness = Math.round((checks.filter((item) => item.done).length / checks.length) * 100);

  const upload = async () => {
    if (!file) {
      notify("Choose a PDF resume first.", "error");
      return;
    }
    const data = new FormData();
    data.append("file", file);
    setUploading(true);
    try {
      await api("/profile/resume", { method: "POST", body: data });
      notify("Resume uploaded. It will be attached to approved sends.");
      setFile(null);
      if (inputRef.current) inputRef.current.value = "";
      await refresh();
    } catch (error) {
      notify(error.message, "error");
    } finally {
      setUploading(false);
    }
  };

  const removeResume = async () => {
    setDeleteOpen(false);
    await run(() => api("/profile/resume", { method: "DELETE" }), "Resume removed.");
  };

  const parseResume = async () => {
    setParsing(true);
    try {
      const result = await post("/profile/resume/parse", {});
      setParsedData(result);
      setParseOpen(true);
      notify("Resume parsed successfully!");
    } catch (error) {
      const message = typeof error === "object" && error !== null && "message" in error
        ? String(error.message)
        : String(error);
      notify(message || "Failed to parse resume", "error");
    } finally {
      setParsing(false);
    }
  };

  const applyParsedData = async () => {
    if (!parsedData) return;
    try {
      const profileUpdate = {};
      if (parsedData.skills?.length) profileUpdate.skills = parsedData.skills.join(", ");
      if (parsedData.summary) profileUpdate.summary = parsedData.summary;
      if (parsedData.experience_level && !settings?.target_roles) {
        const levelRoles = {
          FRESHER: "Junior Developer, Entry Level Engineer",
          ENTRY: "Software Engineer, Developer",
          MID: "Software Engineer, Senior Developer",
          SENIOR: "Senior Software Engineer, Tech Lead, Staff Engineer",
        };
        profileUpdate.target_roles = levelRoles[parsedData.experience_level] || "";
      }
      if (Object.keys(profileUpdate).length) {
        await api("/profile", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(profileUpdate),
        });
        notify("Profile updated with parsed data!");
        await refresh();
      }
      setParseOpen(false);
      setParsedData(null);
    } catch (error) {
      const message = typeof error === "object" && error !== null && "message" in error
        ? String(error.message)
        : String(error);
      notify(message || "Failed to update profile", "error");
    }
  };

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Application assets"
        title="Resume manager"
        description="Keep one polished PDF ready for every human-approved send, and make sure your AI profile is complete."
        actions={(
          <>
            <Link to="/settings"><Button variant="secondary" icon={UserRound}>Edit profile</Button></Link>
            <Button icon={Upload} onClick={() => inputRef.current?.click()}>Upload resume</Button>
          </>
        )}
      />

      <div className="resume-layout">
        <GlassCard className="resume-main-card">
          <div className="resume-hero">
            <span className="resume-file-icon"><FileText size={30} /></span>
            <div>
              <span className="eyebrow">Current attachment</span>
              <h2>{settings?.resume_name || "No resume uploaded"}</h2>
              <p>{settings?.resume_name ? "PDF ready · attached to approved outbound emails" : "Upload a PDF to enable sending from JobReach AI."}</p>
            </div>
            <StatusBadge status={settings?.resume_name ? "READY" : "PENDING"} />
          </div>

          <label className={`resume-dropzone ${file ? "has-file" : ""}`.trim()}>
            <input
              ref={inputRef}
              type="file"
              accept=".pdf,application/pdf"
              onChange={(event) => setFile(event.target.files?.[0] || null)}
            />
            <Upload size={24} />
            <strong>{file ? file.name : "Choose a PDF resume"}</strong>
            <span>PDF only · up to 10 MB · your file stays in this workspace</span>
            <span className="dropzone-action">{file ? "Ready to upload" : "Browse files"}</span>
          </label>

          <div className="resume-actions">
            <Button icon={Upload} loading={uploading} onClick={upload} disabled={!file}>Upload resume</Button>
            {settings?.resume_name ? (
              <>
                <Button variant="secondary" icon={Brain} loading={parsing} onClick={parseResume} disabled={parsing}>
                  Parse with AI
                </Button>
                <Button variant="danger" icon={Trash2} onClick={() => setDeleteOpen(true)}>Remove</Button>
              </>
            ) : null}
          </div>

          <div className="resume-note">
            <ShieldCheck size={17} />
            <p>Resumes are never sent automatically. Every email requires explicit approval, and the attachment is included only on confirmed sends.</p>
          </div>

          {parsedData && (
            <div className="parsed-preview">
              <div className="parsed-preview-head">
                <Brain size={18} />
                <strong>Parsed resume data</strong>
                <span>Review and apply to your profile</span>
              </div>
              <div className="parsed-preview-grid">
                {parsedData.skills?.length ? (
                  <div className="parsed-section">
                    <div className="parsed-section-title">
                      <Search size={15} /><span>Skills ({parsedData.skills.length})</span>
                    </div>
                    <div className="parsed-skills">
                      {parsedData.skills.slice(0, 20).map((skill) => (
                        <span key={skill} className="parsed-skill">{skill}</span>
                      ))}
                      {parsedData.skills.length > 20 && <span className="parsed-skill more">+{parsedData.skills.length - 20} more</span>}
                    </div>
                  </div>
                ) : null}
                {parsedData.experience_years ? (
                  <div className="parsed-section">
                    <div className="parsed-section-title">
                      <FileText size={15} /><span>Experience</span>
                    </div>
                    <div className="parsed-value">
                      {parsedData.experience_years} year{parsedData.experience_years !== 1 ? "s" : ""}
                      {parsedData.experience_level ? ` · {parsedData.experience_level}` : ""}
                    </div>
                  </div>
                ) : null}
                {parsedData.education?.length ? (
                  <div className="parsed-section">
                    <div className="parsed-section-title">
                      <UserRound size={15} /><span>Education</span>
                    </div>
                    <div className="parsed-value">{parsedData.education.join(", ")}</div>
                  </div>
                ) : null}
                {parsedData.summary ? (
                  <div className="parsed-section full-width">
                    <div className="parsed-section-title">
                      <Sparkles size={15} /><span>Summary</span>
                    </div>
                    <p className="parsed-summary">{parsedData.summary}</p>
                  </div>
                ) : null}
              </div>
            </div>
          )}

        </GlassCard>

        <div className="resume-side">
          <GlassCard className="readiness-card">
            <SectionHeading title="Profile readiness" description="A complete profile improves matching and personalization." />
            <div className="readiness-top">
              <ProgressRing value={completeness} size={104} />
              <div><strong>{completeness}% ready</strong><span>{checks.filter((item) => item.done).length} of {checks.length} signals complete</span></div>
            </div>
            <div className="checklist">
              {checks.map((item) => (
                <div className={`checklist-item ${item.done ? "done" : ""}`.trim()} key={item.label}>
                  {item.done ? <CheckCircle2 size={17} /> : <Circle size={17} />}
                  <span>{item.label}</span>
                  {!item.done ? <Link to="/settings">Fix</Link> : null}
                </div>
              ))}
            </div>
          </GlassCard>

          <GlassCard className="resume-tips">
            <SectionHeading title="Make it count" />
            <div><Sparkles size={16} /><p>Use the same role titles in your profile that you target in outreach.</p></div>
            <div><FileText size={16} /><p>Keep the resume to one or two pages and name it clearly.</p></div>
            <div><CheckCircle2 size={16} /><p>Re-upload whenever your experience changes so AI context stays accurate.</p></div>
            <Link to="/studio" className="text-link">Open AI Email Studio <ArrowUpRight size={14} /></Link>
          </GlassCard>
        </div>
      </div>

      <Modal
        open={parseOpen}
        onClose={() => { setParseOpen(false); setParsedData(null); }}
        title="Parsed resume preview"
        description="Review the extracted information and apply it to your profile."
        width="680px"
        footer={(
          <>
            <Button variant="ghost" onClick={() => { setParseOpen(false); setParsedData(null); }}>Cancel</Button>
            <Button icon={CheckCircle2} onClick={applyParsedData}>Apply to profile</Button>
          </>
        )}
      >
        {parsedData ? (
          <div className="parsed-preview">
            <div className="parsed-preview-grid">
              {parsedData.skills?.length ? (
                <div className="parsed-section">
                  <div className="parsed-section-title">
                    <Search size={15} /><span>Skills ({parsedData.skills.length})</span>
                  </div>
                  <div className="parsed-skills">
                    {parsedData.skills.slice(0, 30).map((skill) => (
                      <span key={skill} className="parsed-skill">{skill}</span>
                    ))}
                    {parsedData.skills.length > 30 && <span className="parsed-skill more">+{parsedData.skills.length - 30} more</span>}
                  </div>
                </div>
              ) : null}
              {parsedData.experience_years ? (
                <div className="parsed-section">
                  <div className="parsed-section-title">
                    <FileText size={15} /><span>Experience</span>
                  </div>
                  <div className="parsed-value">
                    {parsedData.experience_years} year{parsedData.experience_years !== 1 ? "s" : ""}
                    {parsedData.experience_level ? ` · {parsedData.experience_level}` : ""}
                  </div>
                </div>
              ) : null}
              {parsedData.education?.length ? (
                <div className="parsed-section">
                  <div className="parsed-section-title">
                    <UserRound size={15} /><span>Education</span>
                  </div>
                  <div className="parsed-value">{parsedData.education.join(", ")}</div>
                </div>
              ) : null}
              {parsedData.summary ? (
                <div className="parsed-section full-width">
                  <div className="parsed-section-title">
                    <Sparkles size={15} /><span>Summary</span>
                  </div>
                  <p className="parsed-summary">{parsedData.summary}</p>
                </div>
              ) : null}
            </div>
          </div>
        ) : (
          <EmptyState icon={LoaderCircle} title="Parsing..." description="Extracting information from your resume." />
        )}
      </Modal>

      <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={removeResume}
        title="Remove your resume?"
        description="Approved sends will be blocked until a new PDF is uploaded. Your existing drafts and contacts are not affected."
        confirmLabel="Remove resume"
        loading={busy}
      />
    </div>
  );
}
