import { ArrowLeft, FileText, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { GlassCard, PageHeader } from "../components/ui";

const DOCS = {
  privacy: {
    title: "Privacy",
    icon: ShieldCheck,
    intro: "JobReach AI is designed as a local-first workspace. This page explains what the application stores and how it is used.",
    sections: [
      ["What we store", "Account details, company contacts you add or import, generated drafts, outreach events, audit logs, profile information, and an optional PDF resume."],
      ["Why we store it", "To provide the outreach workspace, generate context-aware drafts, enforce opt-outs and sending limits, and keep an audit trail of actions you take."],
      ["AI processing", "Draft generation sends the company context and profile information you provide to the configured AI provider. Do not add sensitive personal data you are not permitted to process."],
      ["Email and Google", "Gmail access is used to send approved messages and, when requested, detect replies. Credentials are stored server-side and are not exposed to the browser."],
      ["Your controls", "You can edit your profile, remove your resume, disconnect Gmail, sign out, and stop using the workspace at any time. Local deployment data remains under the operator's control."],
    ],
  },
  terms: {
    title: "Terms",
    icon: FileText,
    intro: "These terms describe the expected use of this JobReach AI deployment. They are a product notice, not legal advice.",
    sections: [
      ["Acceptable use", "Use the workspace for legitimate job-search outreach. Do not use it to send spam, harass recipients, misrepresent your identity, or bypass opt-out requests."],
      ["Human responsibility", "AI-generated content may be inaccurate. You are responsible for reviewing every draft, verifying claims, and confirming the recipient before sending."],
      ["Sending controls", "Daily caps, dry-run mode, opt-out handling, and approval requirements are safety features. Do not attempt to circumvent them."],
      ["Third-party services", "AI generation, Gmail sending, and payments rely on third-party providers. Their availability and terms apply in addition to this workspace."],
      ["No guarantee", "The software is provided as-is without a guarantee of job outcomes, deliverability, or uninterrupted availability."],
    ],
  },
};

export function Legal({ standalone = false }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const initial = searchParams.get("doc") === "terms" ? "terms" : "privacy";
  const [doc, setDoc] = useState(initial);
  const active = DOCS[doc];

  const select = (next) => {
    setDoc(next);
    setSearchParams({ doc: next }, { replace: true });
  };

  return (
    <div className={standalone ? "legal-standalone" : "page-stack"}>
      {standalone ? (
        <div className="legal-topbar">
          <Link to="/" className="text-link"><ArrowLeft size={14} /> Back to sign in</Link>
        </div>
      ) : (
        <PageHeader eyebrow="Trust center" title="Legal" description="How this workspace handles your data and expected use." />
      )}
      <GlassCard className="legal-card">
        <div className="legal-tabs">
          {Object.entries(DOCS).map(([key, item]) => {
            const Icon = item.icon;
            return (
              <button type="button" key={key} className={doc === key ? "active" : ""} onClick={() => select(key)}>
                <Icon size={16} /> {item.title}
              </button>
            );
          })}
        </div>
        <div className="legal-content">
          <span className="eyebrow">JobReach AI · {active.title}</span>
          <h1>{active.title} notice</h1>
          <p className="legal-intro">{active.intro}</p>
          {active.sections.map(([heading, copy]) => (
            <section key={heading}>
              <h2>{heading}</h2>
              <p>{copy}</p>
            </section>
          ))}
          <p className="legal-footnote">This deployment is operated locally. Contact the workspace owner for data requests or deletion.</p>
        </div>
      </GlassCard>
    </div>
  );
}
