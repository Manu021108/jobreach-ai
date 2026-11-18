import {
  ArrowUpRight,
  CheckCircle2,
  Database,
  Download,
  KeyRound,
  LockKeyhole,
  Search,
  ShieldCheck,
  Sparkles,
  Users,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Avatar,
  Button,
  DataTable,
  EmptyState,
  FilterSelect,
  GlassCard,
  LoadingSkeleton,
  PageHeader,
  SearchBar,
  SectionHeading,
  StatusBadge,
} from "../components/ui";
import { useWorkspace } from "../context/WorkspaceContext";
import { api, post } from "../lib/api";

export function Unlock() {
  const { hrDatabase, billing, contacts, refresh, notify } = useWorkspace();
  const [query, setQuery] = useState("");
  const [role, setRole] = useState("");
  const [verified, setVerified] = useState("all");
  const [page, setPage] = useState(1);
  const [data, setData] = useState(hrDatabase);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const [freeUnlocking, setFreeUnlocking] = useState(false);

  const unlocked = Boolean(data?.unlocked ?? billing?.unlocked);
  const freeUnlockEnabled = Boolean(billing?.free_unlock_enabled ?? data?.free_unlock_enabled);
  const price = billing?.amount_total != null ? (billing.amount_total / 100).toLocaleString() : "—";
  const currency = billing?.currency || "INR";

  const load = useCallback(async () => {
    if (!unlocked) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), page_size: "20" });
      if (query.trim()) params.set("query", query.trim());
      if (role.trim()) params.set("role", role.trim());
      if (verified !== "all") params.set("verified", verified === "verified" ? "true" : "false");
      const result = await api(`/hr-database?${params.toString()}`);
      setData(result);
    } catch (error) {
      notify(error.message, "error");
    } finally {
      setLoading(false);
    }
  }, [notify, page, query, role, unlocked, verified]);

  useEffect(() => {
    if (!unlocked) return;
    const timer = window.setTimeout(load, 220);
    return () => window.clearTimeout(timer);
  }, [load, unlocked]);

  useEffect(() => {
    setPage(1);
  }, [query, role, verified]);

  useEffect(() => {
    if (!unlocked) setData(hrDatabase);
  }, [hrDatabase, unlocked]);

  const unlock = async () => {
    setUnlocking(true);
    try {
      const result = await post("/billing/checkout", {});
      if (result?.url) window.location.href = result.url;
    } catch (error) {
      notify(error.message, "error");
    } finally {
      setUnlocking(false);
    }
  };

  const unlockFree = async () => {
    setFreeUnlocking(true);
    try {
      const result = await post("/billing/free-unlock", {});
      await refresh();
      notify(`All emails unlocked. Imported ${result.imported} contacts to Companies${result.skipped ? `, skipped ${result.skipped} existing` : ""}.`);
    } catch (error) {
      notify(error.message, "error");
    } finally {
      setFreeUnlocking(false);
    }
  };

  const importContacts = async () => {
    setImporting(true);
    try {
      const result = await post("/hr-database/import", {
        query: query.trim(),
        role: role.trim(),
        verified: verified === "all" ? null : verified === "verified",
        limit: 5000,
      });
      await refresh();
      notify(`Imported ${result.added} contacts to Companies${result.skipped ? `, skipped ${result.skipped}` : ""}.`);
    } catch (error) {
      notify(error.message, "error");
    } finally {
      setImporting(false);
    }
  };

  const rows = data?.rows || [];
  const preview = data?.preview || [];
  const total = data?.total ?? hrDatabase?.total ?? 0;
  const verifiedTotal = data?.verified_total ?? hrDatabase?.verified_total ?? 0;
  const filteredTotal = data?.filtered_total ?? 0;
  const pageCount = data?.page_count || 1;

  const columns = useMemo(() => [
    {
      key: "company",
      label: "Company",
      render: (row) => (
        <div className="table-company">
          <Avatar name={row.company_name} size="sm" />
          <div><strong>{row.company_name}</strong><span>{row.industry || "Industry not listed"}</span></div>
        </div>
      ),
    },
    {
      key: "contact",
      label: "HR contact",
      render: (row) => <div className="table-contact"><strong>{row.hr_name || "Hiring Team"}</strong><span>{row.email}</span></div>,
    },
    {
      key: "role",
      label: "Role",
      render: (row) => <span className="table-muted">{row.role || "Relevant opportunities"}</span>,
    },
    {
      key: "location",
      label: "Location",
      render: (row) => <span className="table-muted">{row.location || "Not specified"}</span>,
    },
    {
      key: "verified",
      label: "Quality",
      render: (row) => <StatusBadge status={row.verified ? "VERIFIED" : "UNVERIFIED"} />,
    },
  ], []);

  if (!unlocked) {
    return (
      <div className="page-stack">
        <PageHeader
          eyebrow="Verified HR database"
          title="Reach the right people, faster"
          description="Unlock a curated database of verified HR and hiring contacts, then import the matches that fit your search."
          actions={<Button icon={LockKeyhole} loading={unlocking} onClick={unlock}>Unlock database</Button>}
        />

        <div className="unlock-hero">
          <GlassCard className="unlock-copy">
            <span className="eyebrow"><Sparkles size={13} /> One-time access</span>
            <h2>Skip the guesswork. Start with real people.</h2>
            <p>Search verified HR contacts by company, role, location, and industry. Import only the contacts you want into your workspace.</p>
            <div className="unlock-benefits">
              <div><CheckCircle2 size={17} /><span>Verified hiring contacts</span></div>
              <div><CheckCircle2 size={17} /><span>Company and role context</span></div>
              <div><CheckCircle2 size={17} /><span>One-click import to your CRM</span></div>
              <div><CheckCircle2 size={17} /><span>Lifetime workspace access</span></div>
            </div>
            <div className="unlock-cta">
              <Button icon={LockKeyhole} loading={unlocking} onClick={unlock}>Unlock for {currency} {price}</Button>
              {freeUnlockEnabled ? (
                <Button variant="secondary" icon={KeyRound} loading={freeUnlocking} onClick={unlockFree}>
                  Unlock all emails free
                </Button>
              ) : null}
              <span>One-time payment A� secure checkout</span>
            </div>
          </GlassCard>

          <GlassCard className="unlock-preview">
            <div className="unlock-preview-head">
              <span className="lock-orb"><Database size={24} /></span>
              <div><strong>{total.toLocaleString()} contacts</strong><span>{verifiedTotal.toLocaleString()} verified</span></div>
              <StatusBadge status="LOCKED" />
            </div>
            <div className="unlock-metrics">
              <div><Users size={17} /><strong>{total.toLocaleString()}</strong><span>Total contacts</span></div>
              <div><ShieldCheck size={17} /><strong>{verifiedTotal.toLocaleString()}</strong><span>Verified</span></div>
            </div>
            <div className="preview-table">
              <div className="preview-head"><span>Company</span><span>Role</span><span>Email</span></div>
              {preview.length ? preview.map((row, index) => (
                <div className="preview-row" key={`${row.company_name}-${index}`}>
                  <span>{row.company_name}</span>
                  <span>{row.role}</span>
                  <span className="masked">••••••@••••••.com</span>
                </div>
              )) : (
                <div className="preview-empty">Database preview will appear here.</div>
              )}
            </div>
            <div className="unlock-foot"><LockKeyhole size={14} /> Contact details unlock after purchase.</div>
          </GlassCard>
        </div>

        <div className="unlock-features">
          <GlassCard><Search size={20} /><strong>Precision search</strong><p>Find contacts by company, role, location, and verification status.</p></GlassCard>
          <GlassCard><Download size={20} /><strong>Import what matters</strong><p>Bring only high-fit contacts into your outreach workspace.</p></GlassCard>
          <GlassCard><ShieldCheck size={20} /><strong>Compliance first</strong><p>Imported contacts still respect opt-outs, caps, and approval controls.</p></GlassCard>
        </div>
      </div>
    );
  }

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Verified HR database"
        title="HR contact database"
        description="Search verified contacts and import the strongest matches directly into your company workspace."
        actions={<Button icon={Download} loading={importing} onClick={importContacts}>Import all contacts</Button>}
      />

      {contacts.length < total ? (
        <GlassCard className="safety-banner">
          <span className="safety-icon"><Download size={20} /></span>
          <div>
            <strong>{contacts.length ? `${contacts.length.toLocaleString()} of ${total.toLocaleString()} HR contacts are in Companies` : "Unlocked, but Companies is still empty"}</strong>
            <p>Import the full database once to start drafting and sending outreach to every contact.</p>
          </div>
          <Button loading={importing} onClick={importContacts} icon={Download}>Import all contacts</Button>
        </GlassCard>
      ) : null}

      <div className="stat-strip">
        <div><span className="stat-icon tone-teal"><Database size={17} /></span><strong>{total.toLocaleString()}</strong><small>Total contacts</small></div>
        <div><span className="stat-icon tone-violet"><ShieldCheck size={17} /></span><strong>{verifiedTotal.toLocaleString()}</strong><small>Verified</small></div>
        <div><span className="stat-icon tone-blue"><Users size={17} /></span><strong>{filteredTotal.toLocaleString()}</strong><small>Matching filters</small></div>
        <div><span className="stat-icon tone-amber"><CheckCircle2 size={17} /></span><strong>Active</strong><small>Access status</small></div>
      </div>

      <GlassCard className="filter-card">
        <div className="filter-row">
          <SearchBar value={query} onChange={setQuery} placeholder="Search company, email, name, or industry..." className="grow" />
          <label className="inline-field"><span>Role</span><div className="inline-input"><Search size={14} /><input value={role} onChange={(event) => setRole(event.target.value)} placeholder="Designer, recruiter..." /></div></label>
          <FilterSelect
            label="Quality"
            value={verified}
            onChange={setVerified}
            options={[
              { value: "all", label: "All contacts" },
              { value: "verified", label: "Verified only" },
              { value: "unverified", label: "Unverified" },
            ]}
          />
        </div>
      </GlassCard>

      <GlassCard className="table-card">
        {loading ? <LoadingSkeleton rows={6} /> : (
          <>
            <DataTable
              columns={columns}
              rows={rows}
              rowKey={(row) => row.email}
              empty={<EmptyState icon={Search} title="No contacts match this search" description="Try a broader company, role, or quality filter." />}
            />
            <div className="table-pagination">
              <span>Showing {rows.length ? (page - 1) * 20 + 1 : 0}–{Math.min(page * 20, filteredTotal)} of {filteredTotal}</span>
              <div>
                <Button variant="ghost" size="sm" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>Previous</Button>
                <span className="page-indicator">{page} / {pageCount}</span>
                <Button variant="ghost" size="sm" disabled={page >= pageCount} onClick={() => setPage((current) => current + 1)}>Next</Button>
              </div>
            </div>
          </>
        )}
      </GlassCard>

      <GlassCard className="safety-banner">
        <span className="safety-icon"><ShieldCheck size={20} /></span>
        <div><strong>Imports stay inside your workspace</strong><p>Imported contacts are added as new companies with verified context. Existing duplicates are skipped safely.</p></div>
        <a href="https://stripe.com" target="_blank" rel="noreferrer" className="text-link">Billing help <ArrowUpRight size={14} /></a>
      </GlassCard>
    </div>
  );
}
