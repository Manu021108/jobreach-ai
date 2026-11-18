import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  FileText,
  Sparkles,
  Upload,
  UserRound,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Button, GlassCard } from "../components/ui";
import { api, post, put } from "../lib/api";

const FIELDS = ["full_name", "phone", "location", "linkedin", "github", "summary", "skills", "target_roles"];
const STEPS = [
  { id: 0, label: "Profile", icon: UserRound },
  { id: 1, label: "Resume", icon: FileText },
  { id: 2, label: "Ready", icon: Sparkles },
];

export function Onboarding({ user, onCompleted }) {
  const [step, setStep] = useState(0);
  const [form, setForm] = useState(Object.fromEntries(FIELDS.map((field) => [field, ""])));
  const [resume, setResume] = useState(null);
  const [resumeName, setResumeName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api("/profile")
      .then((data) => {
        setForm(Object.fromEntries(FIELDS.map((field) => [field, data[field] || ""])));
        if (data.resume_name) setResumeName(data.resume_name);
      })
      .catch(() => {});
  }, []);

  const update = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));
  const profileReady = Boolean(form.full_name.trim() && form.summary.trim() && form.skills.trim() && form.target_roles.trim());

  const saveProfile = async () => {
    setBusy(true);
    setError("");
    try {
      const result = await put("/profile", form);
      if (result.onboarding?.completed) {
        onCompleted(await api("/auth/me"));
        return;
      }
      setStep(1);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  };

  const uploadResume = async () => {
    if (!resume) return;
    setBusy(true);
    setError("");
    try {
      const body = new FormData();
      body.append("file", resume);
      const result = await api("/profile/resume", { method: "POST", body });
      setResumeName(result.resume_name);
      setStep(2);
      if (result.onboarding?.completed) onCompleted(await api("/auth/me"));
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  };

  const finish = async () => {
    setBusy(true);
    setError("");
    try {
      const result = await post("/onboarding/complete", {});
      onCompleted(result.user);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="onboarding-page">
      <div className="auth-ambient" aria-hidden="true"><span className="ambient-orb orb-one" /><span className="ambient-orb orb-two" /><span className="ambient-grid" /></div>
      <div className="onboarding-shell">
        <aside className="onboarding-aside">
          <div className="auth-brand">
            <span className="brand-glyph"><Sparkles size={20} /></span>
            <span><strong>JobReach</strong><small>AI outreach CRM</small></span>
          </div>
          <span className="eyebrow">Welcome, {user?.name?.split(" ")[0] || "there"}</span>
          <h1>Let’s make your outreach feel like you.</h1>
          <p>A complete profile helps AI write grounded drafts, match roles more accurately, and keep every message relevant.</p>
          <div className="onboarding-steps">
            {STEPS.map((item) => {
              const Icon = item.icon;
              return (
                <div className={`onboarding-step ${step === item.id ? "active" : ""} ${step > item.id ? "done" : ""}`.trim()} key={item.id}>
                  <span>{step > item.id ? <Check size={15} /> : <Icon size={16} />}</span>
                  <div><strong>{item.label}</strong><small>{item.id === 0 ? "Your background and goals" : item.id === 1 ? "One polished PDF" : "Start reaching out"}</small></div>
                </div>
              );
            })}
          </div>
        </aside>

        <GlassCard className="onboarding-card">
          {error ? <div className="auth-error"><CheckCircle2 size={15} /><p>{error}</p></div> : null}

          {step === 0 ? (
            <>
              <div className="onboarding-card-head"><span>Step 1 of 3</span><h2>Tell us about your work</h2><p>This is used only to personalize your drafts and matches.</p></div>
              <div className="form-grid">
                <label className="field"><span>Full name *</span><input value={form.full_name} onChange={update("full_name")} placeholder="Your full name" /></label>
                <label className="field"><span>Phone</span><input value={form.phone} onChange={update("phone")} placeholder="Optional" /></label>
                <label className="field"><span>Location</span><input value={form.location} onChange={update("location")} placeholder="City, country" /></label>
                <label className="field"><span>Target roles *</span><input value={form.target_roles} onChange={update("target_roles")} placeholder="Product Designer, UX Researcher" /></label>
                <label className="field"><span>LinkedIn</span><input value={form.linkedin} onChange={update("linkedin")} placeholder="https://linkedin.com/in/..." /></label>
                <label className="field"><span>GitHub</span><input value={form.github} onChange={update("github")} placeholder="https://github.com/..." /></label>
                <label className="field full"><span>Skills *</span><input value={form.skills} onChange={update("skills")} placeholder="Comma-separated skills" /></label>
                <label className="field full"><span>Professional summary *</span><textarea rows={4} value={form.summary} onChange={update("summary")} placeholder="A short introduction used in AI drafts" /></label>
              </div>
              <div className="onboarding-actions">
                <span>{profileReady ? "Looks good." : "Complete the required fields to continue."}</span>
                <Button icon={ArrowRight} loading={busy} onClick={saveProfile} disabled={!profileReady}>Save and continue</Button>
              </div>
            </>
          ) : null}

          {step === 1 ? (
            <>
              <div className="onboarding-card-head"><span>Step 2 of 3</span><h2>Add your resume</h2><p>A PDF is required before any email can be sent.</p></div>
              <label className={`resume-dropzone ${resume ? "has-file" : ""}`.trim()}>
                <input type="file" accept=".pdf,application/pdf" onChange={(event) => setResume(event.target.files?.[0] || null)} />
                <Upload size={26} />
                <strong>{resume ? resume.name : resumeName || "Choose a PDF resume"}</strong>
                <span>PDF only · up to 10 MB</span>
                <span className="dropzone-action">{resume ? "Ready to upload" : "Browse files"}</span>
              </label>
              <div className="onboarding-actions">
                <Button variant="ghost" icon={ArrowLeft} onClick={() => setStep(0)}>Back</Button>
                <Button icon={ArrowRight} loading={busy} onClick={uploadResume} disabled={!resume}>{resumeName ? "Continue" : "Upload and continue"}</Button>
              </div>
              {resumeName ? <p className="form-hint">Already uploaded: {resumeName}. You can continue without replacing it.</p> : null}
              {resumeName && !resume ? <Button variant="secondary" onClick={() => setStep(2)}>Continue with existing resume</Button> : null}
            </>
          ) : null}

          {step === 2 ? (
            <>
              <div className="onboarding-ready">
                <span className="ready-orb"><CheckCircle2 size={30} /></span>
                <h2>You’re ready to reach out</h2>
                <p>Your profile and resume are set. Start with a few high-fit companies, generate a thoughtful draft, and approve it before sending.</p>
              </div>
              <div className="ready-summary">
                <div><UserRound size={17} /><span>Profile</span><strong>{form.full_name}</strong></div>
                <div><FileText size={17} /><span>Resume</span><strong>{resumeName || "Uploaded"}</strong></div>
                <div><Sparkles size={17} /><span>AI context</span><strong>{form.target_roles}</strong></div>
              </div>
              <div className="onboarding-actions">
                <Button variant="ghost" icon={ArrowLeft} onClick={() => setStep(1)}>Back</Button>
                <Button icon={ArrowRight} loading={busy} onClick={finish}>Enter workspace</Button>
              </div>
            </>
          ) : null}
        </GlassCard>
      </div>
    </div>
  );
}
