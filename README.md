# JobReach AI

A local-first, multi-user job outreach CRM built with FastAPI, React, SQLite, Gmail API OAuth, and an optional AI email-personalization provider (Ollama or an OpenAI-compatible endpoint). Each student has a private profile, resume, contacts, drafts, and Gmail connection.

## Safety model

- Emails are sent one recipient at a time. No CC/BCC bulk blast.
- The campaign builder generates drafts in batches. Automated sending starts only after you approve drafts, queue them, and explicitly start the campaign.
- New contacts are imported as **Pending**; generated messages are **Draft** until explicitly approved.
- `DRY_RUN=true` is the global default. Each account can override it in Settings; if the account has no override, it inherits the global default. Manual and automated sending are disabled while the effective setting is on.
- Manual sends require a reviewed-recipient checkbox and typing the exact recipient address. Automated sends use the same daily cap and minimum interval, plus retry backoff and per-campaign progress.
- Due follow-ups are turned into drafts automatically, but follow-up drafts are never sent automatically. They still require approval and the normal send confirmation.
- Every outreach email includes an unsubscribe footer. Unsubscribe links use signed tokens and mark the contact as opted out, blocking future sends. Gmail sends also include `List-Unsubscribe` headers when the footer link is present.
- Gmail inbox sync matches possible replies and opt-outs into the dashboard. Matches are best-effort and should be verified manually.
- Important actions are recorded in an in-app audit log. Privacy and Terms pages are available from the app and sign-in screen.
- Only use relevant business contact addresses, personalize honestly, respect opt-outs, and stop contacting anyone who declines.
- AI must only use facts supplied in the contact record/profile; it is instructed not to invent openings, company facts, relationships, or achievements.

This is a robust local-first starter for one operator, not a certified enterprise deployment. For multiple users or public hosting, use PostgreSQL, managed secrets, HTTPS, authentication/authorization, backups, and a security review.

## 1. Requirements

- Python 3.10.7+
- Gmail account
- Google Cloud project with Gmail API enabled and OAuth Web application credentials
- Optional: Ollama installed locally and a model pulled, e.g. `ollama pull qwen2.5:7b`

## 2. Setup

```bash
python -m venv .venv
# Windows PowerShell
.venv\\Scripts\\Activate.ps1
# macOS/Linux
source .venv/bin/activate

pip install -r requirements.txt
copy .env.example .env  # Windows
# cp .env.example .env  # macOS/Linux
```

After starting the app, register and verify your account, then complete the in-app onboarding with your student profile and PDF resume. Profile details and resumes are stored per user in the application database and can be edited any time in Settings; no `.env` editing is needed. Never commit `.env` or OAuth credentials.

## 3. Gmail API OAuth setup

1. Open https://console.cloud.google.com/ and create/select a Google Cloud project.
2. Enable **Gmail API**.
3. Configure Google Auth Platform / OAuth consent screen. For a personal project, configure the appropriate external/test-user settings if required and add each Gmail account as a test user while the app is in testing.
4. Create an OAuth Client ID with application type **Web application**. Add `http://127.0.0.1:8000/api/gmail/oauth/callback` to **Authorized redirect URIs** (change the host/port if you change `GMAIL_OAUTH_REDIRECT_URI`).
5. Download the client JSON and save it as `credentials/client_secret.json`.
6. Set `GMAIL_TOKEN_ENCRYPTION_KEY` (or `AUTH_SECRET_KEY`) in `.env` to a long random value. Changing it later makes existing tokens unreadable, so affected users must reconnect.
7. Start the app, sign in, and choose **Connect Gmail** in Settings. Google redirects back to the app and Settings shows the connected Google account.

The app requests `gmail.send` and `gmail.readonly` to send mail and optionally inspect inbox messages for replies. Each user's OAuth credentials are encrypted in the application database and are never written to a shared token file. Access tokens are refreshed automatically; if Google revokes access, Settings shows **Reconnect needed**. If you change scopes, disconnect and authorize again. Google may require OAuth verification for broader/public distribution; do not distribute your client secret or encryption key.

Official guide: https://developers.google.com/identity/protocols/oauth2/web-server

## 3.1 Onboarding and profile

On first sign-in you will be asked for your full name, target roles, summary, skills, and a PDF resume. These values feed AI drafts and job matching. The resume is stored in the database for your account only and is attached when you send an approved email. Use Settings to update any profile field, replace/remove the resume, or reconnect Gmail.

## 3.2 One-time HR database unlock

The **Unlock** page sells one-time access to the bundled HR contact database through Stripe Checkout. Accounts are gated by a per-user entitlement stored in SQLite. Locked accounts see a clearly marked preview with company names, roles, and verification badges only; unlocked accounts get full-text search, company/role/verification filters, paginated results, and filtered imports. Set `HR_DATABASE_FILE` to the dataset you intend to sell.

Set these values in `.env`:

- `STRIPE_SECRET_KEY`: Stripe secret key.
- `STRIPE_WEBHOOK_SECRET`: signing secret for the webhook endpoint.
- `STRIPE_PRICE_ID`: one-time Stripe Price ID. If omitted, `STRIPE_UNLOCK_AMOUNT` and `STRIPE_UNLOCK_CURRENCY` are used to create an inline price.
- `HR_DATABASE_FILE`: CSV/XLSX path relative to the project root, with at least `company_name` and `email` columns.

Configure Stripe to send checkout events to `https://your-host/api/billing/webhook`. The endpoint verifies the `stripe-signature` header against the raw request body, records processed event IDs to prevent duplicate activation, activates access on a completed paid checkout session, and revokes access when the payment is fully refunded. Keep the webhook secret out of the frontend and never trust a browser redirect as proof of payment.

For local development, Stripe CLI can forward signed events to `http://127.0.0.1:8000/api/billing/webhook`. Use the printed webhook signing secret for `STRIPE_WEBHOOK_SECRET`.

## 3.3 Campaign builder and background sender

The **Campaign & Send** page lets you select up to 50 eligible contacts, generate one AI draft per contact, approve drafts in bulk, and queue approved drafts. **Start auto-send** makes the campaign eligible for the Celery auto-send job, which sends queued drafts one at a time. The worker enforces `MAX_EMAILS_PER_DAY`, `MIN_SECONDS_BETWEEN_EMAILS`, and retry backoff, and records per-campaign progress, attempts, and errors. It pauses automatically on the daily cap, Gmail/resume problems, or terminal send failures. You can pause a running campaign at any time. Editing an approved draft resets it to **Draft** and requires re-approval.

Automated-send settings:

- `AUTO_SEND_WORKER_ENABLED`: include the auto-send schedule in Celery Beat.
- `AUTO_SEND_POLL_SECONDS`: how often Celery Beat enqueues a send pass.
- `AUTO_SEND_MAX_ATTEMPTS`: maximum attempts per draft before it is marked failed.
- `AUTO_SEND_RETRY_BACKOFF_SECONDS`: base delay for retries; each retry waits progressively longer.
- `AUTO_SEND_SEND_LEASE_SECONDS`: how long a reserved send is considered active before it is reconciled against Gmail Sent.

Follow-up settings:

- `FOLLOWUP_AUTO_DRAFT_ENABLED`: automatically create a draft when a sent email's follow-up date is due.
- `FOLLOWUP_POLL_SECONDS`: how often Celery Beat enqueues a follow-up pass.
- `FOLLOWUP_MAX_PER_RUN`: maximum follow-up drafts created per worker pass.

The Follow-ups page and dashboard also provide **Sync inbox**, which matches replies and opt-outs from Gmail. Opt-out wording is detected best-effort; always verify the message before relying on it. Detected replies and opt-outs complete the open follow-up reminder so it no longer appears as due.

## 3.4 Student dashboard

The Overview page shows emails sent, opened, replied, opted out, and remaining daily quota. Gmail does not expose opens without a tracking pixel, so the Opened metric is shown as unavailable rather than estimated. The guardrails panel shows today's sent count against the daily cap, and **Sync inbox** refreshes reply and opt-out metrics.

## 3.5 Safety and compliance

- **Per-account dry-run:** Settings includes a dry-run toggle. A user with no override inherits the global `DRY_RUN` value; changing the setting affects that account only.
- **Opt-out footer:** Manual sends, previews, and automated sends append a plain unsubscribe line with a signed link. Automated Gmail sends also add `List-Unsubscribe` and `List-Unsubscribe-Post` headers when the link is present.
- **Unsubscribe handling:** `GET /api/unsubscribe?token=...` shows a confirmation page and records the opt-out. The contact is marked `OPTED_OUT`, open follow-up reminders are completed, and further sends are blocked.
- **Public URL:** unsubscribe links use `FRONTEND_URL`. Before live sending, set it to a publicly reachable URL (HTTPS in production); otherwise recipients receive a localhost link.
- **Audit log:** The Audit log page shows recent imports, drafts, approvals, sends, failures, status changes, replies, opt-outs, campaign starts/pauses, and dry-run changes. `GET /api/audit` returns up to 100 recent entries for the signed-in account.
- **Legal pages:** Privacy and Terms are available from the app navigation, footer, and sign-in screen. They summarize data handling, Gmail access, AI drafting, user responsibilities, and outreach limits.

## 4. AI setup

### Local Ollama (default)

```bash
ollama pull qwen2.5:7b
ollama serve
```

Keep `AI_PROVIDER=ollama`, `AI_BASE_URL=http://localhost:11434/v1`, `AI_API_KEY=ollama`, and choose a model available on your machine in `AI_MODEL`.

### OpenAI-compatible service

Set `AI_PROVIDER=openai-compatible`, `AI_BASE_URL` to the provider's compatible `/v1` endpoint, `AI_API_KEY` to its key, and `AI_MODEL` to a model supported by that provider. Keep secrets only in `.env`.

AI-generated text is always a draft. Check every company-specific statement before approving.

## 4.1 Background workers (Celery + Redis)

Scheduled work runs in Celery, not inside the FastAPI process. Start Redis as described in section 4.2, then start one worker and one Beat scheduler from the project root. Run only one Beat process; worker instances can be scaled separately.

```bash
celery -A app.services.worker:celery_app worker --loglevel=info --concurrency=1 --queues jobreach
celery -A app.services.worker:celery_app beat --loglevel=info
```

Set `CELERY_BROKER_URL` and `CELERY_RESULT_BACKEND` in `.env` to a Redis instance reachable by the API host and workers. For local debugging only, `CELERY_TASK_ALWAYS_EAGER=true` runs submitted tasks in-process without Redis; never use it in production. `CELERY_TASK_TIME_LIMIT` bounds a single task run. If Redis, the worker, or Beat is not running, manual API actions still work, but scheduled auto-send, follow-up drafts, and job-discovery alerts will not run.

## 4.2 Data services (PostgreSQL)

PostgreSQL is the default database. Start the local PostgreSQL and Redis services from the project root, then apply migrations before starting the API, worker, or Beat:

```bash
docker compose up -d postgres redis
alembic upgrade head
```

`DATABASE_URL` defaults to `postgresql://jobreach:jobreach@localhost:5432/jobreach`. The Compose service credentials come from `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_PORT`, and `REDIS_PORT` in `.env`; keep them consistent with `DATABASE_URL`, `CELERY_BROKER_URL`, and `CELERY_RESULT_BACKEND`. The API, Celery worker, and Beat must use the same database. For production, use managed PostgreSQL with backups and a managed Redis instance; run `alembic upgrade head` as a release step before replacing the running API version.

## 5. Run

The Windows launcher installs dependencies, starts PostgreSQL and Redis through Docker when available, applies Alembic migrations, then starts the API, Celery worker/Beat, and React development server:

```bash
run_windows.bat
```

For manual startup, use two terminals from the project root:

```bash
# Terminal 1
docker compose up -d postgres redis
alembic upgrade head
python -m uvicorn main:app --host 127.0.0.1 --port 8000

# Terminal 2
cd frontend
npm install
npm run dev
```

Open the local URL Vite prints. The Vite development server proxies API calls to `127.0.0.1:8000`. For a production-style local build, run `npm run build` in `frontend`, then start the API; FastAPI serves the built UI from `frontend/dist`.

Scheduled jobs need Redis plus the Celery worker and Beat commands in section 4.1; the launcher starts those processes, but the manual two-terminal setup above starts only the API and UI.

The API deliberately binds to loopback. Do not expose it publicly without HTTPS, trusted-host configuration, and a Web OAuth client: it can access local files and connected Gmail accounts.

## 6. Import spreadsheet format

Required columns: `company_name`, `email`.

Optional columns: `hr_name`, `role`, `company_context`, `job_url`, `source_url`, `location`, `notes`.

A sample file is at `data/companies_template.csv`. `company_context` should contain verified information you provide (e.g. a job description or company product summary). Do not rely on AI to guess company details.

## 7. Recommended workflow

1. Complete onboarding or update your student profile and resume in Settings.
2. Import a small, relevant contact list.
3. Generate drafts for selected contacts.
4. Review/edit each draft and mark it approved.
5. Keep dry-run on and use Preview first. Confirm the unsubscribe footer is present.
6. When ready, turn off dry-run in Settings for your account and send a small approved batch. Global `DRY_RUN=false` is only the fallback for accounts without an override.
7. Use Follow-ups to review due reminders. Due follow-ups become drafts automatically, but they do not send automatically.
8. Use **Sync inbox** on the dashboard or Follow-ups page to match replies and opt-outs, then verify the result in Gmail.
9. Review the Audit log after imports, sends, and opt-outs to confirm what changed.

## 8. Data and operational notes

- SQLite database: `data/jobreach.db`.
- Back up the database regularly; it contains per-user profiles, resumes, Gmail tokens, contacts, and outreach data.
- Sending uses Gmail's `users.messages.send` API. Gmail API quotas and mailbox sending limits are separate; never treat a quota as a recommended outreach volume.
- A successful API response means Gmail accepted the send request, not that the recipient's inbox received it.
- Reply and opt-out detection is best-effort and should be verified manually; email threading and aliases can complicate matching. Opt-outs are detected from common phrases in the reply subject/snippet and mark the contact as opted out.
- Audit log entries are stored in the same database and are visible only to the owning account. They are operational records, not a substitute for provider-level compliance logs.
- Unsubscribe tokens are signed with `AUTH_SECRET_KEY`; changing that key invalidates old unsubscribe links. Set a stable secret and rotate keys carefully.
- The app does not scrape addresses, bypass spam controls, rotate accounts, or send automatically to unreviewed lists.

## 9. Tests

```bash
pytest -q
```

## 10. Deployment guidance

Run locally first. Do not expose this app publicly without HTTPS and a trusted-host configuration. For a shared deployment, use managed PostgreSQL with verified backups and retention policies, add role-based access, keep the token encryption key in a managed secret store, run Alembic migrations as a release step, run the Celery worker and Beat against managed Redis with persistence enabled, and review Google's OAuth verification requirements. The in-app audit log is useful for operators but does not replace centralized security logging or provider compliance records.

## 11. Efficiency roadmap

The current app is local-first with per-user isolation. The most useful next steps, in order, are:

1. Add server-side pagination and search for drafts and audit entries; contacts already use paginated, server-filtered queries with indexed, stable ordering.
2. Move slow AI generation and Gmail reply sync into a background task with visible progress and retryable failures.
3. Add scheduled, verified PostgreSQL backups and retention policies before scaling data volume.
4. Add import preview/validation so spreadsheet errors can be fixed before records are added.
5. For public or larger deployments, add managed secrets, HTTPS, role-based access, centralized audit logging, and retention policies around the existing PostgreSQL/Redis setup.
