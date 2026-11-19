# JobReach AI — Project Review

**Date:** 2026-11-19

**Project Root:** `C:\Users\manis\Downloads\JobReach_AI_Complete_Project\jobreach-ai`

**Stack:** FastAPI + React (Vite) + SQLite (SQLAlchemy) + Gmail OAuth + Stripe + Ollama/OpenAI-compatible LLM

---

## Executive Summary

JobReach AI is a **personal job-outreach CRM** built around AI-assisted email generation, job discovery, and safe sending controls. It targets individual job seekers (not recruiters/agencies) who want to run thoughtful, human-in-the-loop outreach at scale while staying compliant with opt-out and rate-limit best practices.

The codebase is **well-structured, production-ready for a single-user/small-team deployment**, and demonstrates strong domain awareness (deliverability safety, audit trails, incremental job discovery, campaign orchestration). It is not a multi-tenant SaaS — it assumes one workspace per authenticated user.

---

## Architecture Overview

| Layer | Technology | Key Files |
|-------|------------|-----------|
| **API** | FastAPI (async lifespan, dependency injection) | `main.py`, `app/config.py` |
| **DB** | SQLAlchemy 2.0 + SQLite (WAL mode) | `app/db/models.py`, `app/db/session.py` |
| **Auth** | PBKDF2-SHA256, HMAC-signed session cookies, email verification, password reset | `app/services/auth.py`, `app/services/security.py` |
| **AI** | OpenAI-compatible client (Ollama default), structured JSON prompts with strict schema | `app/services/ai_writer.py` |
| **Email** | Gmail API (OAuth), PDF resume attachment, List-Unsubscribe header | `app/services/gmail_service.py`, `app/services/gmail_tokens.py` |
| **Job Discovery** | Public APIs (Remotive, Arbeitnow, RemoteOK) + Greenhouse/Lever/careers-page scraping | `app/services/job_sources.py`, `app/services/job_discovery.py`, `app/services/job_discovery_engine.py` |
| **Workers** | Background threads for auto-send, follow-ups, job discovery | `app/services/auto_sender.py`, `app/services/followups.py`, `app/services/job_discovery_worker.py` |
| **Billing** | Stripe Checkout + webhook (one-time unlock for HR database) | `app/services/billing.py` |
| **Frontend** | React 18 + Vite + React Router + Framer Motion + Recharts | `frontend/src/` |
| **UI Components** | Custom glass-morphism design system, no external component lib | `frontend/src/components/ui/` |

---

## Issues Found

### 🔴 Critical / Security

| # | Issue | Location | Impact |
|---|-------|----------|--------|
| 1 | **Hardcoded Gmail client secret path in `.env`** | `.env:25` | Credentials committed to repo; path is Windows-specific absolute path. |
| 2 | **`AUTH_SECRET_KEY` in `.env`** | `.env:35` | Session signing key exposed. Rotate immediately. |
| 3 | **Gmail token.json stored in repo** | `credentials/token.json` | OAuth refresh token committed. Revoke & regenerate. |
| 4 | **`SECRET_KEY` fallback uses `secrets.token_urlsafe(48)` at import time** | `app/services/security.py:10` | New key generated on every restart → all sessions invalidated. Use persistent env var. |
| 5 | **No CSRF protection on state-changing POST endpoints** | `main.py` (all mutating routes) | Cookie-based auth + no CSRF token = CSRF vulnerability. |
| 6 | **`auth_cookie_secure: false` with no HTTPS enforcement** | `app/config.py:44` | Session cookies transmitted in cleartext on non-localhost. |
| 7 | **`TrustedHostMiddleware` only allows localhost** | `main.py:91-94` | Works for dev but blocks any real deployment. |
| 8 | **SQLite file permissions world-writable** | `data/jobreach.db` (mode 700) | Acceptable for local dev; problematic if deployed multi-user. |
| 9 | **No rate limiting on auth endpoints** | `main.py` (`/api/auth/login`, `/register`, `/reset-*`) | Brute-force / enumeration risk. |
| 10 | **AI prompt injection surface** | `app/services/ai_writer.py:228-235`, `267-275` | User-controlled `company_context` / `job.description` injected into LLM prompt without sanitization. |

### 🟠 High / Correctness & Reliability

| # | Issue | Location | Impact |
|---|-------|----------|--------|
| 11 | **Background workers use daemon threads with global state** | `auto_sender.py`, `followups.py`, `job_discovery_worker.py` | No graceful shutdown on SIGTERM; in-memory locks lost on restart; no horizontal scaling. |
| 12 | **`_sent_this_run` global counter resets on worker restart** | `main.py:96`, `auto_sender.py` | Daily/run caps can be exceeded across restarts. |
| 13 | **`run_once()` in `auto_sender.py` opens 2 DB sessions sequentially** | `auto_sender.py:189-294` | Race condition: campaign state can change between read and write. |
| 14 | **Job discovery deduplication uses `fingerprint` + URL but `fingerprint` generation is lossy** | `job_sources.py:129-145` | `company_slug` + `domain_label` can collide for different companies on same domain. |
| 15 | **`collect_jobs()` re-fetches Greenhouse/Lever for every contact on every run** | `job_sources.py:349-374` | Redundant API calls; no caching/ETag; will hit rate limits at scale. |
| 16 | **`verify_job()` makes blocking HTTP request per job link** | `job_discovery.py:192-224` | Sequential, no concurrency; slow for large career pages. |
| 17 | **Salary parsing assumes annual unless keywords found** | `job_sources.py:50-95` | Misclassifies hourly/monthly salaries without explicit period. |
| 18 | **`match_job()` scoring is naive keyword matching** | `job_matcher.py:33-68` | False positives/negatives; no semantic understanding. |
| 19 | **Follow-up worker creates drafts but never sends them automatically** | `followups.py:42-94` | By design (human-in-the-loop), but UI doesn't surface "draft ready" prominently enough. |
| 20 | **`sync_inbox_best_effort()` matches by sender substring** | `outreach.py:490-544` | False positives: `recruiter@company.com` matches `hr@company.com`. |
| 21 | **Campaign `queue_campaign()` sets `scheduled_at = now` for all entries** | `campaign.py:188-209` | All queued emails eligible immediately; defeats staggering. |
| 22 | **Stripe webhook doesn't verify `payment_intent.succeeded`** | `billing.py:148-207` | Only handles `checkout.session.completed`; misses async payment success. |
| 23 | **No idempotency key on Stripe Checkout creation** | `billing.py:100-126` | Duplicate sessions possible on double-click. |
| 24 | **Frontend `WorkspaceContext` fetches 13 endpoints on every mount** | `WorkspaceContext.jsx:57-110` | Slow initial load; no pagination/streaming. |
| 25 | **Frontend stores theme/sidebar in `localStorage` but no SSR** | `WorkspaceContext.jsx:30-44` | Flash of wrong theme on first load. |
| 26 | **`DataTable` select-all only selects current page** | `ui/index.jsx:405-409` | UX bug: "Select all" doesn't select filtered rows across pages. |
| 27 | **No test coverage for core business logic** | `tests/test_email_validation.py` only | Regression risk on refactors. |

### 🟡 Medium / Code Quality & Maintainability

| # | Issue | Location |
|---|-------|----------|
| 28 | **Duplicate `outreach.py` file** | Root `outreach.py` duplicates `app/services/outreach.py` — confusion risk. |
| 29 | **`security.py` duplicated in root and `app/services/`** | Same as above. |
| 30 | **`init_db()` runs migration-like `ALTER TABLE` on every startup** | `session.py:14-64` | Works for SQLite but not portable; no versioned migrations (Alembic). |
| 31 | **`Base.metadata.create_all()` + manual migrations = drift risk** | `session.py:154-163` | Schema changes not tracked in version control. |
| 32 | **`pyproject.toml` only defines pytest config** | `pyproject.toml` | No `build-system`, `dependencies`, `optional-dependencies`, `scripts`. |
| 33 | **Virtualenv (`env/`) committed to repo** | `env/` (4000+ files) | Bloats repo; should be in `.gitignore`. |
| 34 | **`__pycache__` directories committed** | Throughout | Should be in `.gitignore`. |
| 35 | **Frontend `package.json` has no lint/format scripts** | `frontend/package.json` | No `eslint`, `prettier`, `typecheck`. |
| 36 | **No TypeScript** | `frontend/src/` | Large React codebase without types = refactor friction. |
| 37 | **CSS custom properties used but no design token file** | `frontend/src/styles.css` | Colors, spacing, radii scattered. |
| 38 | **`JobCard` component does too much (match, draft, open)** | `frontend/src/components/JobCard.jsx` | Violates single responsibility; hard to test. |
| 39 | **`WorkspaceContext` is a god-object (22 state fields, 13 fetch calls)** | `WorkspaceContext.jsx` | Consider splitting by domain (contacts, drafts, campaigns, etc.). |
| 40 | **Error handling in workers swallows exceptions** | `auto_sender.py:340-345`, `followups.py:97-103` | `logger.exception` but no alerting/metrics. |
| 41 | **No structured logging / correlation IDs** | All services | Hard to trace requests across services. |
| 42 | **Hardcoded `MAX_JOBS = 8` in job discovery** | `job_discovery.py:12` | Arbitrary limit; should be configurable. |
| 43 | **`fingerprint` uses SHA1** | `job_sources.py:129-145` | SHA1 deprecated; use SHA256. |
| 44 | **`clean_text` strips HTML but not Unicode control chars** | `job_sources.py:64-65` | Potential storage/XSS issues. |
| 45 | **No API versioning** | `main.py` routes | Breaking changes require new endpoints. |
| 46 | **OpenAPI docs disabled (`docs_url=None`)** | `main.py:90` | Good for prod, but no dev-time contract testing. |
| 47 | **`httpx.Client` created per request in job discovery** | `job_sources.py:199-207` | No connection pooling; create once per worker cycle. |
| 48 | **No health check beyond `/api/health`** | `main.py:405-407` | No DB, Gmail, AI, Stripe connectivity checks. |
| 49 | **Frontend `api()` helper doesn't handle 401 token refresh** | `frontend/src/lib/api.js` | Session expiry = hard logout. |
| 50 | **No E2E tests (Playwright/Cypress)** | — | Critical user flows untested. |

### 🟢 Low / Polish & DX

| # | Issue | Location |
|---|-------|----------|
| 51 | **`.env` uses Windows path `C:\Users\...`** | `.env:25` | Breaks on Linux/macOS. Use relative path. |
| 52 | **`companies_template.csv` has only header row** | `data/companies_template.csv` | Add 2-3 example rows. |
| 53 | **No `README.md`** | Root | Onboarding friction for new devs. |
| 54 | **No `Dockerfile` / `docker-compose.yml`** | Root | Deployment requires manual setup. |
| 55 | **No `.gitignore`** | Root | `env/`, `__pycache__/`, `*.db`, `credentials/*.json`, `frontend/dist/` committed. |
| 56 | **Frontend `vite.config.js` proxy hardcoded to 127.0.0.1:8000** | `vite.config.js:8` | Not configurable via env. |
| 57 | **No Storybook / component documentation** | `frontend/src/components/` | Design system undocumented. |
| 58 | **`StatusBadge` tone mapping incomplete** | `ui/index.jsx:55-87` | Missing tones for `QUEUED`, `GENERATED`, etc. |
| 59 | **`formatTimeAgo` returns "just now" for future dates** | `format.js:22-42` | Edge case for clock skew. |
| 60 | **No favicon / PWA manifest** | `frontend/` | Missing basic web app polish. |

---

## Future Development / Feature Opportunities

### 🚀 Phase 1: Hardening & Deployability (1-2 weeks)

| Feature | Description | Effort |
|---------|-------------|--------|
| **Add `.gitignore`** | Exclude `env/`, `__pycache__/`, `*.db`, `credentials/*.json`, `frontend/dist/`, `.env` | 15 min |
| **Rotate all secrets** | New `AUTH_SECRET_KEY`, Gmail OAuth client, Stripe keys; store in `.env.example` | 30 min |
| **Add Alembic migrations** | Replace `init_db()` `ALTER TABLE` with versioned migrations | 2-3 hrs |
| **Add CSRF protection** | Double-submit cookie pattern or `fastapi-csrf-protect` | 1-2 hrs |
| **Add rate limiting** | `slowapi` on auth endpoints + global | 1 hr |
| **Structured logging + correlation IDs** | `structlog` + middleware adding `X-Request-ID` | 2 hrs |
| **Health check endpoint** | `/api/health` checks DB, Gmail token validity, AI connectivity, Stripe config | 1 hr |
| **Dockerfile + docker-compose** | Multi-stage build (backend + frontend), sqlite volume, env file | 3-4 hrs |
| **GitHub Actions CI** | Lint, typecheck, pytest, frontend build, docker build | 2-3 hrs |
| **README.md** | Quickstart, env vars, architecture diagram, deployment guide | 1 hr |

### 🚀 Phase 2: Reliability & Scale (2-4 weeks)

| Feature | Description | Effort |
|---------|-------------|--------|
| **Replace daemon threads with Celery + Redis** | Durable task queue, retries, scheduling, horizontal workers | 1-2 weeks |
| **Add job discovery caching** | Redis cache for Greenhouse/Lever/portal responses with TTL + ETag | 1 week |
| **Concurrent job verification** | `httpx.AsyncClient` + semaphore for `verify_job()` | 2-3 days |
| **Semantic job matching** | Embeddings (sentence-transformers) + vector search (pgvector/FAISS) | 2-3 weeks |
| **Alembic + Postgres support** | Switch from SQLite to Postgres for multi-user / concurrency | 1 week |
| **API versioning** | `/api/v1/` prefix, deprecation policy | 2 days |
| **WebSocket / SSE for real-time updates** | Push dashboard stats, follow-up due, campaign progress | 1 week |
| **Comprehensive test suite** | `pytest` + `factory_boy` for models, `httpx.AsyncClient` for API, `playwright` for E2E | 2-3 weeks |

### 🚀 Phase 3: Product Features (ongoing)

| Feature | Description | Value |
|---------|-------------|-------|
| **Multi-user / team workspaces** | Invite team members, shared contacts, role-based access | SaaS readiness |
| **LinkedIn profile enrichment** | Apollo / Proxycurl / manual import for contact data | Better targeting |
| **Email sequence builder** | Visual multi-step sequences with conditions (reply → stop, no reply → wait N days → follow-up) | Campaign power |
| **A/B test subject lines** | Split-test within campaign, track open/reply rates | Optimization |
| **Analytics dashboard enhancements** | Cohort analysis, funnel by source, time-to-reply, best sending windows | Insights |
| **Mobile-responsive UI** | Current desktop-first; add mobile breakpoints | Accessibility |
| **Dark mode polish** | Current theme toggle works but some components hardcode colors | UX |
| **Keyboard shortcuts / command palette** | `Cmd+K` global search, quick actions | Power users |
| **Export / backup / GDPR delete** | User data portability + right to erasure | Compliance |
| **Plugin system for job sources** | Custom scrapers / API adapters via entrypoints | Extensibility |
| **AI prompt customization** | User-editable prompt templates per mode | Personalization |
| **Attachment support beyond PDF** | Portfolio links, GitHub repo, Loom video | Richer outreach |
| **Calendar integration** | Calendly/Cal.com link in signature, meeting booked webhook | Closing loop |
| **Chrome extension** | One-click "Add to JobReach" from LinkedIn/Greenhouse/Lever pages | Acquisition |

### 🚀 Phase 4: Platform / Business (long-term)

| Feature | Description |
|---------|-------------|
| **Multi-tenant SaaS architecture** | Shared Postgres, row-level security, per-org billing, admin dashboard |
| **Stripe Billing portal** | Self-serve subscription management, invoices, payment methods |
| **Affiliate / referral program** | Track referrals, reward unlocks |
| **White-label / agency mode** | Agencies manage multiple client workspaces |
| **Public API** | Webhooks for sent/replied/opt-out, Zapier/Make integration |
| **AI agent for autonomous outreach** | "Find 50 roles, generate drafts, approve top 10, send over 2 weeks" |
| **Marketplace for prompt templates** | Community-shared, rated prompt packs for different roles/industries |

---

## Recommended Immediate Actions

1. **Security sprint (today):**
   - Rotate `AUTH_SECRET_KEY`, Gmail OAuth client, Stripe keys
   - Remove `credentials/token.json`, `env/`, `__pycache__/` from git history (`git filter-repo` or rewrite)
   - Add `.gitignore` and `.env.example`

2. **Deployability sprint (this week):**
   - Dockerfile + docker-compose
   - Alembic migrations
   - GitHub Actions CI
   - README.md

3. **Reliability sprint (next 2 weeks):**
   - Move workers to Celery + Redis
   - Add structured logging
   - Health checks
   - Rate limiting on auth

4. **Product sprint (ongoing):**
   - Semantic job matching (embeddings)
   - Email sequence builder
   - Multi-user workspaces

---

## File Tree (Key Directories)

```
jobreach-ai/
├── app/
│   ├── config.py              # Pydantic Settings (env-driven)
│   ├── db/
│   │   ├── models.py          # SQLAlchemy models (18 tables)
│   │   └── session.py         # Engine, SessionLocal, init_db + migrations
│   ├── services/              # 20 service modules
│   │   ├── ai_writer.py       # LLM email generation (structured JSON)
│   │   ├── auth.py            # Register, login, verify, reset
│   │   ├── auto_sender.py     # Campaign auto-send worker
│   │   ├── billing.py         # Stripe checkout + webhook
│   │   ├── campaign.py        # Campaign CRUD + draft generation
│   │   ├── compliance.py      # Dry-run, opt-out footer
│   │   ├── followups.py       # Follow-up draft worker
│   │   ├── gmail_service.py   # Gmail API send + inbox
│   │   ├── gmail_tokens.py    # Encrypted token storage
│   │   ├── hr_database.py     # CSV/XLSX HR contact import
│   │   ├── job_alerts.py      # Saved searches + notifications
│   │   ├── job_discovery.py   # Company careers page scraping
│   │   ├── job_discovery_engine.py  # Orchestration + persistence
│   │   ├── job_discovery_worker.py  # Background discovery
│   │   ├── job_matcher.py     # Keyword-based match scoring
│   │   ├── job_sources.py     # Public API fetchers (Remotive, etc.)
│   │   ├── mailer.py          # SMTP verification/reset emails
│   │   ├── outreach.py        # Core CRUD: contacts, drafts, jobs, events
│   │   ├── profile_service.py # Student profile + resume
│   │   └── security.py        # PBKDF2, HMAC tokens, sessions
│   └── utils.py               # Email/website normalization
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── ui/            # 25+ reusable components
│   │   │   ├── layout/        # Sidebar, Topbar, AppLayout
│   │   │   └── JobCard.jsx
│   │   ├── context/WorkspaceContext.jsx  # Global state + data fetching
│   │   ├── lib/               # api.js, format.js, navigation.js
│   │   ├── pages/             # 17 page components
│   │   └── styles.css         # Glass-morphism design system
│   └── package.json
├── data/                      # SQLite DB, HR CSV/XLSX, template
├── credentials/               # Gmail OAuth client secret + token (COMMITTED ⚠️)
├── resumes/                   # User PDF resumes
├── tests/                     # 1 test file (email validation)
├── main.py                    # FastAPI app + all routes (1280 lines)
├── pyproject.toml             # Minimal pytest config
├── .env                       # SECRETS COMMITTED ⚠️
└── .streamlit/config.toml     # Unused? (Streamlit config)
```

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| **Secrets leaked** | High (already committed) | Critical | Rotate immediately; add pre-commit hooks (`detect-secrets`) |
| **SQLite corruption / locking** | Medium | High | Migrate to Postgres + Alembic |
| **Gmail OAuth token expiry** | High | Medium | Auto-refresh implemented; monitor `needs_reconnect` |
| **Job source API changes** | Medium | Medium | Add integration tests; versioned source adapters |
| **Stripe webhook missed events** | Low | High | Add `payment_intent.succeeded` handling; idempotency keys |
| **LLM prompt injection** | Low | Medium | Sanitize `company_context` / `job.description`; use structured prompts |
| **Single-threaded workers** | High | Medium | Move to Celery |
| **No automated tests** | High | High | Add pytest + Playwright CI |

---

## Conclusion

JobReach AI is a **thoughtfully designed, feature-complete MVP** for personal job outreach. The codebase demonstrates strong product sense: human-in-the-loop safety, audit trails, incremental job discovery, campaign orchestration, and a polished React frontend. The primary gaps are **operational hardening** (secrets, migrations, workers, tests, deployment) rather than product gaps.

**Priority order:**
1. **Security hygiene** (rotate secrets, `.gitignore`)
2. **Deployability** (Docker, Alembic, CI, README)
3. **Reliability** (Celery, structured logging, health checks, rate limiting)
4. **Testing** (unit + E2E)
5. **Product evolution** (semantic matching, sequences, multi-user)

The architecture supports all planned features cleanly. With the hardening work done, this is a solid foundation for a SaaS product or a powerful personal tool.