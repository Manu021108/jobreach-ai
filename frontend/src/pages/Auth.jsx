import {
  ArrowRight,
  CheckCircle2,
  KeyRound,
  Mail,
  ShieldCheck,
  Sparkles,
  UserRound,
} from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "../components/ui";
import { api, post } from "../lib/api";

const MODES = [
  { id: "login", label: "Sign in" },
  { id: "register", label: "Create account" },
  { id: "reset", label: "Reset" },
];

export function Auth({ onAuthenticated, initialMode = "login", initialToken = "" }) {
  const [mode, setMode] = useState(initialMode);
  const [form, setForm] = useState({ name: "", email: "", password: "", token: initialToken });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const update = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      if (mode === "register") {
        const result = await post("/auth/register", {
          name: form.name,
          email: form.email,
          password: form.password,
        });
        if (result.dev_verification_token) {
          sessionStorage.setItem("jr_verification_token", result.dev_verification_token);
        }
        setMode("login");
        setMessage(
          result.dev_verification_token
            ? `Account created. Sign in, then verify with token ${result.dev_verification_token}.`
            : "Account created. Sign in to continue verification.",
        );
      } else if (mode === "login") {
        onAuthenticated(await post("/auth/login", { email: form.email, password: form.password }));
      } else if (mode === "reset") {
        const result = await post("/auth/reset-request", { email: form.email });
        setForm((current) => ({ ...current, token: result.dev_reset_token || "" }));
        setMode("reset-confirm");
        setMessage(result.dev_reset_token ? `Your password reset token is ${result.dev_reset_token}` : result.message);
      } else {
        const result = await post("/auth/reset-confirm", { token: form.token, password: form.password });
        setMode("login");
        setMessage(result.message || "Password updated. Sign in with your new password.");
      }
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  };

  const switchMode = (next) => {
    setMode(next);
    setError("");
    setMessage("");
  };

  return (
    <div className="auth-page">
      <div className="auth-ambient" aria-hidden="true">
        <span className="ambient-orb orb-one" />
        <span className="ambient-orb orb-two" />
        <span className="ambient-grid" />
      </div>
      <div className="auth-layout">
        <section className="auth-story">
          <Link to="/" className="auth-brand">
            <span className="brand-glyph"><Sparkles size={20} /></span>
            <span><strong>JobReach</strong><small>AI outreach CRM</small></span>
          </Link>
          <span className="eyebrow"><Sparkles size={13} /> Your next opportunity starts here</span>
          <h1>Outreach that feels personal. Because it is.</h1>
          <p>Turn a thoughtful job search into a clear, human-centered system — with AI drafts, verified context, and safety built in.</p>
          <div className="auth-benefits">
            <div><CheckCircle2 size={17} /><span>Company-aware AI drafts</span></div>
            <div><CheckCircle2 size={17} /><span>Human approval before every send</span></div>
            <div><CheckCircle2 size={17} /><span>Follow-ups, replies, and audit history</span></div>
          </div>
          <div className="auth-trust">
            <ShieldCheck size={18} />
            <span>Opt-outs, daily caps, and dry-run controls are enforced by the backend.</span>
          </div>
        </section>

        <form className="auth-card" onSubmit={submit}>
          <div className="auth-card-head">
            <span className="auth-card-icon"><UserRound size={20} /></span>
            <div>
              <h2>{mode === "register" ? "Create your workspace" : mode === "reset-confirm" ? "Set a new password" : mode === "reset" ? "Reset your password" : "Welcome back"}</h2>
              <p>{mode === "register" ? "Start building a more intentional job search." : "Sign in to your JobReach AI workspace."}</p>
            </div>
          </div>

          {mode !== "reset-confirm" ? (
            <div className="auth-tabs">
              {MODES.map((item) => (
                <button type="button" key={item.id} className={mode === item.id || (item.id === "reset" && mode === "reset-confirm") ? "active" : ""} onClick={() => switchMode(item.id)}>
                  {item.label}
                </button>
              ))}
            </div>
          ) : null}

          {message ? <div className="auth-message"><CheckCircle2 size={15} /><p>{message}</p></div> : null}
          {error ? <div className="auth-error"><ShieldCheck size={15} /><p>{error}</p></div> : null}

          {mode === "register" ? (
            <label className="auth-field"><span>Full name</span><div><UserRound size={16} /><input value={form.name} onChange={update("name")} autoComplete="name" placeholder="Your full name" required /></div></label>
          ) : null}

          {["login", "register", "reset"].includes(mode) ? (
            <label className="auth-field"><span>Email</span><div><Mail size={16} /><input type="email" value={form.email} onChange={update("email")} autoComplete="email" placeholder="you@example.com" required /></div></label>
          ) : null}

          {["login", "register", "reset-confirm"].includes(mode) ? (
            <label className="auth-field"><span>{mode === "reset-confirm" ? "New password" : "Password"}</span><div><KeyRound size={16} /><input type="password" value={form.password} onChange={update("password")} autoComplete={mode === "login" ? "current-password" : "new-password"} placeholder="At least 8 characters" minLength={8} required /></div></label>
          ) : null}

          {mode === "reset-confirm" ? (
            <label className="auth-field"><span>Reset token</span><div><KeyRound size={16} /><input value={form.token} onChange={update("token")} placeholder="Paste your reset token" required /></div></label>
          ) : null}

          <Button type="submit" size="lg" loading={busy} className="auth-submit">
            {mode === "login" ? "Sign in" : mode === "register" ? "Create account" : mode === "reset" ? "Send reset link" : "Set new password"}
            {!busy ? <ArrowRight size={16} /> : null}
          </Button>

          {mode === "login" ? (
            <button type="button" className="auth-link-button" onClick={() => switchMode("reset")}>Forgot your password?</button>
          ) : null}
          {mode === "reset" || mode === "reset-confirm" ? (
            <button type="button" className="auth-link-button" onClick={() => switchMode("login")}>Back to sign in</button>
          ) : null}

          <p className="auth-footnote">Private workspace · Your outreach data stays in your account</p>
          <div className="auth-legal">
            <Link to="/legal?doc=privacy">Privacy</Link>
            <span>·</span>
            <Link to="/legal?doc=terms">Terms</Link>
          </div>
        </form>
      </div>
    </div>
  );
}

export function VerifyEmail({ user, initialToken = "", onVerified }) {
  const [token, setToken] = useState(initialToken || sessionStorage.getItem("jr_verification_token") || "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const verify = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await post("/auth/verify-email", { token });
      sessionStorage.removeItem("jr_verification_token");
      onVerified(await api("/auth/me"));
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await post("/auth/resend-verification", { email: user.email });
      if (result.dev_verification_token) {
        setToken(result.dev_verification_token);
        sessionStorage.setItem("jr_verification_token", result.dev_verification_token);
        setMessage(`New verification token: ${result.dev_verification_token}`);
      } else {
        setMessage(result.message);
      }
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  };

  const signOut = async () => {
    try {
      await api("/auth/logout", { method: "POST" });
    } catch {
      /* ignore */
    }
    onVerified(null);
  };

  return (
    <div className="auth-page">
      <div className="auth-ambient" aria-hidden="true"><span className="ambient-orb orb-one" /><span className="ambient-orb orb-two" /><span className="ambient-grid" /></div>
      <form className="auth-card verify-card" onSubmit={verify}>
        <div className="verify-icon"><Mail size={28} /></div>
        <h2>Verify your email</h2>
        <p className="auth-subtitle">Signed in as <strong>{user.email}</strong>. Verify your email to unlock the workspace.</p>
        {message ? <div className="auth-message"><CheckCircle2 size={15} /><p>{message}</p></div> : null}
        {error ? <div className="auth-error"><ShieldCheck size={15} /><p>{error}</p></div> : null}
        <label className="auth-field"><span>Verification token</span><div><KeyRound size={16} /><input value={token} onChange={(event) => setToken(event.target.value)} placeholder="Paste your verification token" required /></div></label>
        <Button type="submit" size="lg" loading={busy} className="auth-submit">Verify email</Button>
        <Button type="button" variant="ghost" onClick={resend} disabled={busy}>Resend verification link</Button>
        <Button type="button" variant="ghost" onClick={signOut}>Sign out</Button>
      </form>
    </div>
  );
}
