import {
  ArrowUpRight,
  Building2,
  Database,
  Download,
  FileUp,
  Mail,
  Plus,
  Sparkles,
  Upload,
  Users,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useWorkspace } from "../context/WorkspaceContext";
import { api, post } from "../lib/api";
import { formatDate, titleCase } from "../lib/format";
import { statusOptions } from "../lib/navigation";
import {
  Avatar,
  Button,
  DataTable,
  EmptyState,
  FilterSelect,
  GlassCard,
  Modal,
  PageHeader,
  SearchBar,
  StatusBadge,
} from "../components/ui";

const emptyForm = {
  company_name: "",
  email: "",
  hr_name: "Hiring Team",
  role: "Relevant Opportunities",
  company_context: "",
  job_url: "",
  location: "",
  notes: "",
};

const PAGE_SIZE = 8;

export function Companies() {
  const { contacts, billing, run, busy, refresh, notify } = useWorkspace();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("All");
  const [sort, setSort] = useState("recent");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [contactOpen, setContactOpen] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [formError, setFormError] = useState("");
  const [importFile, setImportFile] = useState(null);
  const [importResult, setImportResult] = useState(null);
  const [importingHr, setImportingHr] = useState(false);

  useEffect(() => {
    if (searchParams.get("new") === "1") {
      setCreateOpen(true);
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    setPage(1);
  }, [query, status, sort]);

  const counts = useMemo(() => {
    const result = { All: contacts.length };
    for (const contact of contacts) result[contact.status] = (result[contact.status] || 0) + 1;
    return result;
  }, [contacts]);

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    const rows = contacts.filter((contact) => {
      const matchesStatus = status === "All" || contact.status === status;
      const haystack = [contact.company_name, contact.email, contact.hr_name, contact.role, contact.location, contact.website].join(" ").toLowerCase();
      return matchesStatus && (!term || haystack.includes(term));
    });
    return rows.sort((a, b) => {
      if (sort === "company") return a.company_name.localeCompare(b.company_name);
      if (sort === "status") return a.status.localeCompare(b.status) || a.company_name.localeCompare(b.company_name);
      if (sort === "oldest") return new Date(a.updated_at || 0) - new Date(b.updated_at || 0);
      return new Date(b.updated_at || 0) - new Date(a.updated_at || 0);
    });
  }, [contacts, query, sort, status]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const visible = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  useEffect(() => {
    setSelected((current) => current.filter((id) => contacts.some((contact) => contact.id === id)));
  }, [contacts]);

  const updateForm = (key, value) => setForm((current) => ({ ...current, [key]: value }));

  const submitContact = async (event) => {
    event.preventDefault();
    setFormError("");
    if (!form.company_name.trim() || !form.email.trim()) {
      setFormError("Company name and email are required.");
      return;
    }
    const result = await run(
      () => post("/contacts", form),
      "Company added to your workspace.",
    );
    if (result) {
      setForm(emptyForm);
      setCreateOpen(false);
    }
  };

  const submitImport = async () => {
    if (!importFile) {
      notify("Choose a CSV or XLSX file first.", "error");
      return;
    }
    const data = new FormData();
    data.append("file", importFile);
    const result = await run(
      () => api("/contacts/import", { method: "POST", body: data }),
      (response) => `Imported ${response.added} companies${response.skipped ? `, skipped ${response.skipped}` : ""}.`,
    );
    if (result) {
      setImportResult(result);
      setImportFile(null);
    }
  };

  const importHrContacts = async () => {
    if (!billing?.unlocked) {
      navigate("/unlock");
      return;
    }
    setImportingHr(true);
    try {
      const result = await post("/hr-database/import", { limit: 5000 });
      await refresh();
      notify(`Imported ${result.added} HR contacts to Companies${result.skipped ? `, skipped ${result.skipped} existing` : ""}.`);
    } catch (error) {
      notify(error.message, "error");
    } finally {
      setImportingHr(false);
    }
  };

  const exportSelection = () => {
    const rows = contacts.filter((contact) => selected.includes(contact.id));
    if (!rows.length) return;
    const headers = ["company_name", "email", "hr_name", "role", "status", "location", "website"];
    const csv = [
      headers.join(","),
      ...rows.map((row) => headers.map((key) => `"${String(row[key] ?? "").replace(/"/g, '""')}"`).join(",")),
    ].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "jobreach-companies.csv";
    anchor.click();
    URL.revokeObjectURL(url);
    notify(`Exported ${rows.length} companies.`);
  };

  const addSelectionToCampaign = () => {
    if (!selected.length) return;
    navigate(`/campaigns?contacts=${selected.join(",")}`);
  };

  const columns = [
    {
      key: "company",
      label: "Company",
      render: (row) => (
        <div className="table-company">
          <Avatar name={row.company_name} size="sm" />
          <div>
            <strong>{row.company_name}</strong>
            <span>{row.role || "Relevant opportunities"}</span>
          </div>
        </div>
      ),
    },
    {
      key: "contact",
      label: "Contact",
      render: (row) => (
        <div className="table-contact">
          <strong>{row.hr_name || "Hiring Team"}</strong>
          <span>{row.email}</span>
        </div>
      ),
    },
    {
      key: "location",
      label: "Location",
      render: (row) => <span className="table-muted">{row.location || "Not specified"}</span>,
    },
    {
      key: "status",
      label: "Status",
      render: (row) => <StatusBadge status={row.status} />,
    },
    {
      key: "updated",
      label: "Updated",
      render: (row) => <span className="table-muted">{formatDate(row.updated_at, { hour: undefined, minute: undefined })}</span>,
    },
    {
      key: "actions",
      label: "",
      className: "actions-cell",
      render: (row) => (
        <div className="row-actions">
          <button type="button" className="table-action" onClick={() => setContactOpen(row)}>View</button>
          <button type="button" className="table-action accent" onClick={() => navigate(`/studio?contact=${row.id}`)}>
            Draft <ArrowUpRight size={13} />
          </button>
        </div>
      ),
    },
  ];

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Company workspace"
        title="Companies & contacts"
        description="Build a thoughtful, high-fit outreach list with verified contact details and context."
        actions={(
          <>
            <Button variant="secondary" icon={Database} loading={importingHr} onClick={importHrContacts}>
              {billing?.unlocked ? "Import HR contacts" : "Unlock HR database"}
            </Button>
            <Button variant="secondary" icon={Upload} onClick={() => { setImportResult(null); setImportOpen(true); }}>Import CSV</Button>
            <Button icon={Plus} onClick={() => setCreateOpen(true)}>Add company</Button>
          </>
        )}
      />

      <div className="stat-strip">
        <div><span className="stat-icon tone-teal"><Users size={17} /></span><strong>{contacts.length}</strong><small>Total companies</small></div>
        <div><span className="stat-icon tone-blue"><Mail size={17} /></span><strong>{counts.SENT || 0}</strong><small>Awaiting reply</small></div>
        <div><span className="stat-icon tone-violet"><Sparkles size={17} /></span><strong>{counts.DRAFTED || 0}</strong><small>Drafts ready</small></div>
        <div><span className="stat-icon tone-amber"><Building2 size={17} /></span><strong>{counts.REPLIED || 0}</strong><small>Conversations</small></div>
      </div>

      <GlassCard className="table-card">
        <div className="table-toolbar">
          <div className="table-toolbar-left">
            <SearchBar value={query} onChange={setQuery} placeholder="Search companies, people, or emails..." className="grow" />
            <FilterSelect
              value={status}
              onChange={setStatus}
              options={[{ value: "All", label: `All statuses (${counts.All})` }, ...statusOptions.map((option) => ({ value: option, label: titleCase(option) }))]}
            />
            <FilterSelect
              label="Sort"
              value={sort}
              onChange={setSort}
              options={[
                { value: "recent", label: "Recently updated" },
                { value: "oldest", label: "Oldest first" },
                { value: "company", label: "Company A–Z" },
                { value: "status", label: "Outreach status" },
              ]}
            />
          </div>
          <div className="table-toolbar-right">
            {selected.length ? (
              <>
                <span className="selection-count">{selected.length} selected</span>
                <Button variant="secondary" size="sm" icon={Download} onClick={exportSelection}>Export</Button>
                <Button size="sm" icon={Sparkles} onClick={addSelectionToCampaign}>Add to campaign</Button>
              </>
            ) : (
              <span className="table-hint">{filtered.length} compan{filtered.length === 1 ? "y" : "ies"}</span>
            )}
          </div>
        </div>

        <DataTable
          columns={columns}
          rows={visible}
          selectable
          selected={selected}
          onSelectionChange={setSelected}
          rowKey={(row) => row.id}
          empty={(
            <EmptyState
              icon={Building2}
              title={contacts.length ? "No companies match this view" : "Build your first outreach list"}
              description={contacts.length ? "Try a different search or status filter." : "Import verified HR contacts from the unlocked database, add a company manually, or upload a CSV."}
              action={!contacts.length ? <Button variant="secondary" icon={Database} loading={importingHr} onClick={importHrContacts}>{billing?.unlocked ? "Import HR contacts" : "Unlock HR database"}</Button> : null}
            />
          )}
        />

        <div className="table-pagination">
          <span>Showing {visible.length ? (page - 1) * PAGE_SIZE + 1 : 0}–{Math.min(page * PAGE_SIZE, filtered.length)} of {filtered.length}</span>
          <div>
            <Button variant="ghost" size="sm" disabled={page === 1} onClick={() => setPage((current) => current - 1)}>Previous</Button>
            <span className="page-indicator">{page} / {pageCount}</span>
            <Button variant="ghost" size="sm" disabled={page >= pageCount} onClick={() => setPage((current) => current + 1)}>Next</Button>
          </div>
        </div>
      </GlassCard>

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Add a company"
        description="Add the person and context you want AI to use when writing outreach."
        width="680px"
        footer={(
          <>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button loading={busy} onClick={submitContact} icon={Plus}>Add company</Button>
          </>
        )}
      >
        <form className="form-grid" onSubmit={submitContact}>
          <label className="field"><span>Company name *</span><input value={form.company_name} onChange={(event) => updateForm("company_name", event.target.value)} placeholder="Acme Labs" /></label>
          <label className="field"><span>Contact email *</span><input type="email" value={form.email} onChange={(event) => updateForm("email", event.target.value)} placeholder="hiring@acme.com" /></label>
          <label className="field"><span>Contact name</span><input value={form.hr_name} onChange={(event) => updateForm("hr_name", event.target.value)} placeholder="Hiring Team" /></label>
          <label className="field"><span>Role or focus</span><input value={form.role} onChange={(event) => updateForm("role", event.target.value)} placeholder="Product Designer" /></label>
          <label className="field"><span>Location</span><input value={form.location} onChange={(event) => updateForm("location", event.target.value)} placeholder="Remote · India" /></label>
          <label className="field"><span>Job URL</span><input value={form.job_url} onChange={(event) => updateForm("job_url", event.target.value)} placeholder="https://..." /></label>
          <label className="field full"><span>Company context</span><textarea rows={4} value={form.company_context} onChange={(event) => updateForm("company_context", event.target.value)} placeholder="What they do, recent news, why you're a fit..." /></label>
          <label className="field full"><span>Private notes</span><textarea rows={2} value={form.notes} onChange={(event) => updateForm("notes", event.target.value)} placeholder="Anything you want to remember..." /></label>
          {formError ? <p className="form-error full">{formError}</p> : null}
        </form>
      </Modal>

      <Modal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        title="Import companies"
        description="Upload a CSV or XLSX file with company_name and email columns."
        width="620px"
        footer={(
          <>
            <a href="/api/companies/template" className="button button-ghost button-md" download><Download size={16} /><span>Template</span></a>
            <Button variant="ghost" onClick={() => setImportOpen(false)}>Close</Button>
            <Button loading={busy} onClick={submitImport} icon={FileUp}>Import file</Button>
          </>
        )}
      >
        <label className="upload-zone">
          <FileUp size={28} />
          <strong>{importFile ? importFile.name : "Choose a CSV or XLSX file"}</strong>
          <span>Up to 10 MB · company_name and email are required</span>
          <input type="file" accept=".csv,.xlsx" onChange={(event) => setImportFile(event.target.files?.[0] || null)} />
        </label>
        {importResult ? (
          <div className="import-result">
            <strong>Import complete</strong>
            <span>{importResult.added} added · {importResult.skipped} skipped</span>
            {importResult.errors?.length ? <small>{importResult.errors.join(" · ")}</small> : null}
          </div>
        ) : null}
        <p className="form-hint">Use the template to keep columns consistent. Rows with missing required fields are skipped safely.</p>
      </Modal>

      <Modal
        open={Boolean(contactOpen)}
        onClose={() => setContactOpen(null)}
        title={contactOpen?.company_name || "Company"}
        description={contactOpen ? `${contactOpen.hr_name || "Hiring Team"} · ${contactOpen.email}` : ""}
        width="560px"
        footer={(
          <>
            <Button variant="ghost" onClick={() => setContactOpen(null)}>Close</Button>
            <Button icon={Sparkles} onClick={() => navigate(`/studio?contact=${contactOpen?.id}`)}>Open in studio</Button>
          </>
        )}
      >
        {contactOpen ? (
          <div className="contact-detail">
            <div className="contact-detail-top">
              <Avatar name={contactOpen.company_name} size="lg" />
              <div><StatusBadge status={contactOpen.status} /><span className="contact-detail-role">{contactOpen.role || "Relevant opportunities"}</span></div>
            </div>
            <div className="detail-grid">
              <div><span>Email</span><strong>{contactOpen.email}</strong></div>
              <div><span>Location</span><strong>{contactOpen.location || "Not specified"}</strong></div>
              <div><span>Website</span><strong>{contactOpen.website || "Not specified"}</strong></div>
              <div><span>Updated</span><strong>{formatDate(contactOpen.updated_at)}</strong></div>
            </div>
            {contactOpen.company_context ? <div className="detail-block"><span>Company context</span><p>{contactOpen.company_context}</p></div> : null}
            {contactOpen.notes ? <div className="detail-block"><span>Notes</span><p>{contactOpen.notes}</p></div> : null}
            {contactOpen.job_url ? <a className="text-link" href={contactOpen.job_url} target="_blank" rel="noreferrer">Open job listing <ArrowUpRight size={14} /></a> : null}
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
