# JobReach AI

A single-user, local-first job outreach CRM built with FastAPI, React, SQLite, Gmail API OAuth, and an optional AI email-personalization provider (Ollama or an OpenAI-compatible endpoint).

## Safety model

- Emails are sent one recipient at a time. No CC/BCC bulk blast.
- New contacts are imported as **Pending**; generated messages are **Draft** until explicitly approved.
- `DRY_RUN=true` is the default. Sending is disabled until you deliberately set `DRY_RUN=false`.
- Each send requires explicit approval, a reviewed-recipient checkbox, and typing the exact recipient address. A daily cap, per-run cap, and send interval are enforced by the API.
- Follow-ups are reminders only; the app never automatically sends follow-up emails.
- Only use relevant business contact addresses, personalize honestly, respect opt-outs, and stop contacting anyone who declines.
- AI must only use facts supplied in the contact record/profile; it is instructed not to invent openings, company facts, relationships, or achievements.

This is a robust local-first starter for one operator, not a certified enterprise deployment. For multiple users or public hosting, use PostgreSQL, managed secrets, HTTPS, authentication/authorization, backups, and a security review.

## 1. Requirements

- Python 3.10.7+
- Gmail account
- Google Cloud project with Gmail API enabled and OAuth Desktop credentials
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

Edit `.env` with your real profile details. Place your resume PDF in `resumes/` (the dashboard also supports uploading one). Never commit `.env`, OAuth credentials, tokens, or your resume.

## 3. Gmail API OAuth setup

1. Open https://console.cloud.google.com/ and create/select a Google Cloud project.
2. Enable **Gmail API**.
3. Configure Google Auth Platform / OAuth consent screen. For a personal project, configure the appropriate external/test-user settings if required and add your Gmail account as a test user while the app is in testing.
4. Create an OAuth Client ID with application type **Desktop app**.
5. Download the client JSON and save it as `credentials/client_secret.json`.
6. Start the app and choose **Connect Gmail** in Settings. A browser opens for consent. Token is saved locally at `credentials/token.json`.

The app requests `gmail.send` and `gmail.readonly` to send mail and optionally inspect inbox messages for replies. If you change scopes, delete the local token and authorize again. Google may require OAuth verification for broader/public distribution; do not distribute your client secret or token.

Official guide: https://developers.google.com/workspace/gmail/api/quickstart/python

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

## 5. Run

The Windows launcher installs the Python and frontend dependencies, starts the API on loopback, and runs the React development server:

```bash
run_windows.bat
```

For manual startup, use two terminals from the project root:

```bash
# Terminal 1
python -m uvicorn main:app --host 127.0.0.1 --port 8000

# Terminal 2
cd frontend
npm install
npm run dev
```

Open the local URL Vite prints. The Vite development server proxies API calls to `127.0.0.1:8000`. For a production-style local build, run `npm run build` in `frontend`, then start the API; FastAPI serves the built UI from `frontend/dist`.

The API deliberately binds to loopback. Do not expose it on a public interface: it has no user authentication and can access local files and Gmail OAuth credentials.

## 6. Import spreadsheet format

Required columns: `company_name`, `email`.

Optional columns: `hr_name`, `role`, `company_context`, `job_url`, `source_url`, `location`, `notes`.

A sample file is at `data/companies_template.csv`. `company_context` should contain verified information you provide (e.g. a job description or company product summary). Do not rely on AI to guess company details.

## 7. Recommended workflow

1. Add/update sender profile and resume.
2. Import a small, relevant contact list.
3. Generate drafts for selected contacts.
4. Review/edit each draft and mark it approved.
5. Keep `DRY_RUN=true` and use Preview first.
6. When ready, set `DRY_RUN=false` in `.env`, restart the API, and send a small approved batch.
7. Use Follow-ups to set reminders. Follow-up reminders do not send automatically.
8. Mark replies/opt-outs manually, or use the optional Gmail reply sync in the dashboard.

## 8. Data and operational notes

- SQLite database: `data/jobreach.db`.
- Back up the database regularly; it contains personal contact and outreach data.
- Sending uses Gmail's `users.messages.send` API. Gmail API quotas and mailbox sending limits are separate; never treat a quota as a recommended outreach volume.
- A successful API response means Gmail accepted the send request, not that the recipient's inbox received it.
- Reply detection is best-effort and should be verified manually; email threading and aliases can complicate matching.
- The app does not scrape addresses, bypass spam controls, rotate accounts, or send automatically to unreviewed lists.

## 9. Tests

```bash
pytest -q
```

## 10. Deployment guidance

Run locally for the first version. Do not expose this app publicly without authentication. For a shared deployment, replace SQLite with PostgreSQL, add user authentication and role-based access, store OAuth tokens in encrypted secret storage, use a managed background worker/queue, configure HTTPS, implement audit logs and backups, and review Google's OAuth verification requirements.

## 11. Efficiency roadmap

The current app is intentionally single-user and local-first. The most useful next steps, in order, are:

1. Add server-side pagination and search for contacts and drafts; the current UI loads all records at once.
2. Move slow AI generation and Gmail reply sync into a background task with visible progress and retryable failures.
3. Add database migrations and scheduled, verified SQLite backups before changing the schema or scaling data volume.
4. Add structured API/integration tests and import preview/validation so spreadsheet errors can be fixed before records are added.
5. If multiple users or remote access become requirements, add authentication, per-user data isolation, PostgreSQL, encrypted credential storage, and audit history before deployment.
