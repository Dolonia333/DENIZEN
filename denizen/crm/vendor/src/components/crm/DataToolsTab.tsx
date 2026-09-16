import { useState, useRef, useMemo } from "react";
import {
  T, S, fmt,
  type Contact, type Deal, type Note, type Task, type Company, type AuditEntry,
  contactsToCsv, dealsToCsv, tasksToCsv, companiesToCsv, notesToCsv,
  parseCsvAuto, type CsvImportKind,
} from "@/lib/crm-data";
import type { CrmWorkspaceState } from "@/lib/crm-api";
import { markCrmUserEdited } from "@/lib/crm-api";
import type { IndustryConfig } from "@/lib/industry-config";
import {
  type ImportMode, type RestoreMode, type DuplicateGroup,
  findDuplicateContacts, mergeContacts, applyContactImport, applyDealImport,
  bulkPatchContacts, analyzeDataQuality, parseWorkspaceJson, restoreWorkspace,
  buildColumnMapping, parseContactsWithMapping, CONTACT_FIELD_ALIASES, DEAL_FIELD_ALIASES,
  CLEARABLE_ENTITIES, type ClearableEntity, exportContactGdpr, appendAudit,
} from "@/lib/crm-data-management";

type Section = "import" | "export" | "manage" | "health" | "audit" | "backup";

interface Props {
  contacts: Contact[];
  deals: Deal[];
  notes: Note[];
  tasks: Task[];
  companies: Company[];
  auditLog: AuditEntry[];
  workspace?: CrmWorkspaceState;
  industryConfig: IndustryConfig;
  userName?: string;
  onSetContacts: (next: Contact[] | ((prev: Contact[]) => Contact[])) => void;
  onSetDeals: (next: Deal[] | ((prev: Deal[]) => Deal[])) => void;
  onSetNotes: (next: Note[] | ((prev: Note[]) => Note[])) => void;
  onSetTasks: (next: Task[] | ((prev: Task[]) => Task[])) => void;
  onSetCompanies: (next: Company[] | ((prev: Company[]) => Company[])) => void;
  onSetAuditLog: (next: AuditEntry[] | ((prev: AuditEntry[]) => AuditEntry[])) => void;
  onRestoreWorkspace: (state: CrmWorkspaceState, mode: RestoreMode) => void;
  onClearEntity: (entity: ClearableEntity) => void;
  onLoadDemoData?: () => void;
  onNavigate?: (tab: string) => void;
}

type PreviewRow = Partial<Contact> | Partial<Deal> | Partial<Task> | Partial<Company> | Partial<Note>;

const IMPORT_MODES: { id: ImportMode; label: string; desc: string }[] = [
  { id: "append", label: "Append", desc: "Add all rows as new records" },
  { id: "skip_duplicates", label: "Skip duplicates", desc: "Skip rows matching email or name+company" },
  { id: "update_by_email", label: "Update by email", desc: "Overwrite existing contacts with same email" },
  { id: "replace", label: "Replace all", desc: "Delete existing records of this type first" },
];

const FIELD_OPTIONS: Record<string, string[]> = {
  contacts: ["— skip —", "name", "email", "company", "phone", "status", "tags", "score", "lastContact", "leadSource"],
  deals: ["— skip —", "title", "contact", "value", "stage", "probability", "closeDate", "health", "leadSource"],
};

export function DataToolsTab({
  contacts, deals, notes, tasks, companies, auditLog, workspace, industryConfig, userName,
  onSetContacts, onSetDeals, onSetNotes, onSetTasks, onSetCompanies, onSetAuditLog,
  onRestoreWorkspace, onClearEntity, onLoadDemoData, onNavigate,
}: Props) {
  const [section, setSection] = useState<Section>("import");
  const [importKind, setImportKind] = useState<CsvImportKind>("contacts");
  const [importMode, setImportMode] = useState<ImportMode>("append");
  const [csvPreview, setCsvPreview] = useState<PreviewRow[] | null>(null);
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [csvRows, setCsvRows] = useState<string[][]>([]);
  const [columnMapping, setColumnMapping] = useState<Record<string, string>>({});
  const [showMapping, setShowMapping] = useState(false);
  const [csvFileName, setCsvFileName] = useState("");
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
  const [dragOver, setDragOver] = useState(false);
  const [restoreMode, setRestoreMode] = useState<RestoreMode>("merge");
  const [restoreError, setRestoreError] = useState("");
  const [clearConfirm, setClearConfirm] = useState<ClearableEntity | null>(null);
  const [bulkSelected, setBulkSelected] = useState<Set<number>>(new Set());
  const [bulkStatus, setBulkStatus] = useState("");
  const [bulkTag, setBulkTag] = useState("");
  const [gdprContactId, setGdprContactId] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const jsonRef = useRef<HTMLInputElement>(null);

  const card = { background: `linear-gradient(145deg,${T.bg2},${T.bg3}88)`, border: `1px solid ${T.bg4}`, borderRadius: T.radius.lg, padding: "20px 22px", marginBottom: 14 };
  const dupes = useMemo(() => findDuplicateContacts(contacts), [contacts]);
  const health = useMemo(() => analyzeDataQuality({ contacts, deals, tasks, companies, notes }), [contacts, deals, tasks, companies, notes]);

  const handleFile = (file: File) => {
    if (!file.name.toLowerCase().endsWith(".csv")) return;
    setCsvFileName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = String(e.target?.result || "");
      const parsed = parseCsvAuto(text, industryConfig.customFields);
      setImportKind(parsed.kind === "unknown" ? "contacts" : parsed.kind);
      const rows = parsed.kind === "deals" ? parsed.deals
        : parsed.kind === "tasks" ? parsed.tasks
        : parsed.kind === "companies" ? parsed.companies
        : parsed.kind === "notes" ? parsed.notes
        : parsed.contacts;
      setCsvPreview(rows);
      setCsvHeaders(parsed.headers);
      setCsvRows(parsed.rows);
      const aliases = parsed.kind === "deals" ? DEAL_FIELD_ALIASES : CONTACT_FIELD_ALIASES;
      setColumnMapping(buildColumnMapping(parsed.headers, aliases));
      setShowMapping(false);
      setSelectedRows(new Set(rows.map((_, i) => i)));
    };
    reader.readAsText(file);
  };

  const remappedContacts = useMemo(() => {
    if (!showMapping || importKind !== "contacts" || !csvRows.length) return null;
    return parseContactsWithMapping(csvRows, csvHeaders, columnMapping, industryConfig.customFields);
  }, [showMapping, importKind, csvRows, csvHeaders, columnMapping, industryConfig.customFields]);

  const effectivePreview = remappedContacts ?? csvPreview;

  const finalizeImport = () => {
    if (!effectivePreview) return;
    const selected = effectivePreview.filter((_, i) => selectedRows.has(i));
    const today = new Date().toISOString().slice(0, 10);

    if (importKind === "contacts") {
      const incoming = selected.map((c, i) => ({
        name: "", company: "", email: "", phone: "", status: "Lead", tags: [] as string[],
        score: 50, lastContact: today, interactions: 0, ...c, id: Date.now() + i,
      } as Contact));
      onSetContacts((prev) => applyContactImport(prev, incoming, importMode));
    } else if (importKind === "deals") {
      const incoming = selected.map((d, i) => ({
        title: "", contact: "", value: 0, stage: "Lead", probability: 25,
        closeDate: today, daysInStage: 0, health: "good", ...d, id: Date.now() + i,
      } as Deal));
      onSetDeals((prev) => applyDealImport(prev, incoming, importMode));
    } else if (importKind === "tasks") {
      const incoming = selected.map((t, i) => ({
        title: "", contact: "", due: "", priority: "Medium", done: false, ...t, id: Date.now() + i,
      } as Task));
      onSetTasks((prev) => importMode === "replace" ? incoming : [...prev, ...incoming]);
    } else if (importKind === "companies") {
      const incoming = selected.map((c, i) => ({
        name: "", domain: "", industry: "", size: "", mrr: 0, arr: 0, health: "good",
        tags: [], website: "", notes: "", linkedContacts: [], linkedDeals: [], ...c, id: Date.now() + i,
      } as Company));
      onSetCompanies((prev) => importMode === "replace" ? incoming : [...prev, ...incoming]);
    } else if (importKind === "notes") {
      const incoming = selected.map((n, i) => ({
        contact: "", text: "", date: today, type: "Call", ...n, id: Date.now() + i,
      } as Note));
      onSetNotes((prev) => importMode === "replace" ? incoming : [...prev, ...incoming]);
    }

    markCrmUserEdited();
    onSetAuditLog((prev) => appendAudit(prev, {
      user: userName || "You",
      action: "imported",
      entity: importKind,
      entityName: `${selected.length} rows (${importMode})`,
    }));
    resetImport();
  };

  const resetImport = () => {
    setCsvPreview(null);
    setCsvFileName("");
    setSelectedRows(new Set());
    setCsvHeaders([]);
    setCsvRows([]);
    setShowMapping(false);
  };

  const handleMergeDupe = (group: DuplicateGroup) => {
    const [primary, ...rest] = group.contacts;
    const merged = mergeContacts(primary, rest);
    const removeIds = new Set(rest.map((c) => c.id));
    onSetContacts((prev) => prev.filter((c) => !removeIds.has(c.id)).map((c) => (c.id === primary.id ? merged : c)));
    onSetDeals((prev) => prev.map((d) => {
      const alt = rest.find((r) => r.name === d.contact);
      return alt ? { ...d, contact: primary.name } : d;
    }));
    onSetNotes((prev) => prev.map((n) => {
      const alt = rest.find((r) => r.name === n.contact);
      return alt ? { ...n, contact: primary.name } : n;
    }));
    onSetTasks((prev) => prev.map((t) => {
      const alt = rest.find((r) => r.name === t.contact);
      return alt ? { ...t, contact: primary.name } : t;
    }));
    markCrmUserEdited();
    onSetAuditLog((prev) => appendAudit(prev, {
      user: userName || "You",
      action: "merged",
      entity: "contacts",
      entityName: primary.name,
    }));
  };

  const handleBulkApply = () => {
    if (!bulkSelected.size) return;
    onSetContacts((prev) => bulkPatchContacts(prev, bulkSelected, {
      status: bulkStatus || undefined,
      addTags: bulkTag ? [bulkTag] : undefined,
    }));
    setBulkSelected(new Set());
    setBulkStatus("");
    setBulkTag("");
  };

  const handleBulkDelete = () => {
    if (!bulkSelected.size || !confirm(`Delete ${bulkSelected.size} contacts?`)) return;
    onSetContacts((prev) => prev.filter((c) => !bulkSelected.has(c.id)));
    setBulkSelected(new Set());
  };

  const download = (content: string, filename: string, type = "text/csv") => {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const cfContactIds = industryConfig.customFields.filter((f) => f.entity === "contact").map((f) => f.id);
  const cfDealIds = industryConfig.customFields.filter((f) => f.entity === "deal").map((f) => f.id);

  const exportItems = [
    { label: "Contacts CSV", desc: `${contacts.length} contacts`, action: () => download(contactsToCsv(contacts, cfContactIds), "contacts.csv") },
    { label: "Deals CSV", desc: `${deals.length} deals`, action: () => download(dealsToCsv(deals, cfDealIds), "deals.csv") },
    { label: "Tasks CSV", desc: `${tasks.length} tasks`, action: () => download(tasksToCsv(tasks), "tasks.csv") },
    { label: "Companies CSV", desc: `${companies.length} companies`, action: () => download(companiesToCsv(companies), "companies.csv") },
    { label: "Notes CSV", desc: `${notes.length} notes`, action: () => download(notesToCsv(notes), "notes.csv") },
    { label: "Full workspace JSON", desc: "Complete team backup", action: () => download(JSON.stringify(workspace || { contacts, deals, notes, tasks, companies }, null, 2), `crm-workspace-${new Date().toISOString().slice(0, 10)}.json`, "application/json") },
  ];

  const sections: { id: Section; label: string }[] = [
    { id: "import", label: "⬆ Import" },
    { id: "export", label: "⬇ Export" },
    { id: "manage", label: "⚙ Manage" },
    { id: "health", label: "🩺 Health" },
    { id: "audit", label: "📋 Audit" },
    { id: "backup", label: "💾 Backup" },
  ];

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: T.text0, margin: 0 }}>📦 Data Tools</h1>
        <p style={{ fontSize: 13, color: T.text2, marginTop: 4 }}>Import, export, clean up, and back up your CRM workspace</p>
      </div>

      <div style={{ display: "flex", gap: 6, marginBottom: 20, flexWrap: "wrap" }}>
        {sections.map((s) => (
          <button key={s.id} onClick={() => setSection(s.id)} style={{
            padding: "7px 14px", borderRadius: T.radius.full, fontSize: 12, fontWeight: 600,
            background: section === s.id ? `${T.accent}22` : T.bg3,
            color: section === s.id ? T.accent : T.text3,
            border: `1px solid ${section === s.id ? `${T.accent}66` : T.bg4}`, cursor: "pointer",
          }}>{s.label}</button>
        ))}
      </div>

      {/* IMPORT */}
      {section === "import" && (
        <div>
          <input ref={fileRef} type="file" accept=".csv,text/csv" style={{ display: "none" }} onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); if (fileRef.current) fileRef.current.value = ""; }} />
          {!effectivePreview ? (
            <div style={card} onDragOver={(e) => { e.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)} onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}>
              <div onClick={() => fileRef.current?.click()} style={{ border: `2px dashed ${dragOver ? T.accent : T.bg5}`, borderRadius: T.radius.lg, padding: "48px 24px", textAlign: "center", cursor: "pointer", background: dragOver ? `${T.accent}08` : "transparent" }}>
                <div style={{ fontSize: 36, marginBottom: 12 }}>📄</div>
                <div style={{ fontSize: 14, fontWeight: 600, color: T.text0 }}>Drop CSV or click to browse</div>
                <div style={{ fontSize: 12, color: T.text3, marginTop: 6 }}>Auto-detects contacts, deals, tasks, companies, or notes</div>
              </div>
              {onLoadDemoData && (
                <div style={{ marginTop: 14 }}>
                  <button onClick={onLoadDemoData} style={{ ...S.btnGhost }}>Load sample CRM data</button>
                  <div style={{ fontSize: 11, color: T.text3, marginTop: 6 }}>
                    Optional for demos only. New workspaces start empty and track your real contacts, deals, and tasks.
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div style={card}>
              <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: T.text0 }}>📄 {csvFileName}</div>
                  <div style={{ fontSize: 12, color: T.text2 }}>Type: <strong>{importKind}</strong> · {effectivePreview.length} rows · {selectedRows.size} selected</div>
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {(importKind === "contacts" || importKind === "deals") && (
                    <button onClick={() => setShowMapping((v) => !v)} style={S.btnGhost as React.CSSProperties}>{showMapping ? "Hide mapping" : "Map columns"}</button>
                  )}
                  <button onClick={resetImport} style={S.btnGhost as React.CSSProperties}>Cancel</button>
                  <button onClick={finalizeImport} disabled={!selectedRows.size} style={{ ...S.btn as React.CSSProperties, opacity: selectedRows.size ? 1 : 0.5 }}>
                    Import {selectedRows.size}
                  </button>
                </div>
              </div>

              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: T.text3, textTransform: "uppercase", marginBottom: 8 }}>Import mode</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 8 }}>
                  {IMPORT_MODES.map((m) => (
                    <label key={m.id} style={{ display: "flex", gap: 8, padding: 10, borderRadius: T.radius.md, border: `1px solid ${importMode === m.id ? T.accent : T.bg4}`, background: importMode === m.id ? `${T.accent}10` : T.bg3, cursor: "pointer" }}>
                      <input type="radio" checked={importMode === m.id} onChange={() => setImportMode(m.id)} />
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 600, color: T.text0 }}>{m.label}</div>
                        <div style={{ fontSize: 10, color: T.text3 }}>{m.desc}</div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              {showMapping && csvHeaders.length > 0 && (
                <div style={{ marginBottom: 16, background: T.bg3, borderRadius: T.radius.md, padding: 12 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: T.text0, marginBottom: 8 }}>Column mapping</div>
                  {csvHeaders.map((h) => (
                    <div key={h} style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
                      <span style={{ fontSize: 11, color: T.text2, minWidth: 120 }}>{h}</span>
                      <span style={{ color: T.text3 }}>→</span>
                      <select value={columnMapping[h] || ""} onChange={(e) => setColumnMapping((p) => ({ ...p, [h]: e.target.value }))} style={{ ...S.input, flex: 1, padding: "6px 10px" }}>
                        <option value="">— skip —</option>
                        {(FIELD_OPTIONS[importKind === "deals" ? "deals" : "contacts"] || []).filter((f) => f !== "— skip —").map((f) => (
                          <option key={f} value={f}>{f}</option>
                        ))}
                        {industryConfig.customFields.filter((cf) => cf.entity === (importKind === "deals" ? "deal" : "contact")).map((cf) => (
                          <option key={cf.id} value={`cf:${cf.id}`}>{cf.label} (custom)</option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
              )}

              <PreviewTable kind={importKind} rows={effectivePreview} selectedRows={selectedRows} onToggle={(i) => setSelectedRows((p) => { const n = new Set(p); if (n.has(i)) n.delete(i); else n.add(i); return n; })} onToggleAll={() => setSelectedRows(selectedRows.size === effectivePreview.length ? new Set() : new Set(effectivePreview.map((_, i) => i)))} />
            </div>
          )}
        </div>
      )}

      {/* EXPORT */}
      {section === "export" && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 14 }}>
          {exportItems.map((item) => (
            <div key={item.label} style={card}>
              <div style={{ fontSize: 14, fontWeight: 600, color: T.text0 }}>{item.label}</div>
              <div style={{ fontSize: 12, color: T.text3, margin: "4px 0 14px" }}>{item.desc}</div>
              <button onClick={item.action} style={S.btn as React.CSSProperties}>⬇ Download</button>
            </div>
          ))}
        </div>
      )}

      {/* MANAGE */}
      {section === "manage" && (
        <div>
          <div style={card}>
            <h3 style={{ margin: "0 0 12px", fontSize: 15, color: T.text0 }}>Duplicate contacts ({dupes.length} groups)</h3>
            {dupes.length === 0 ? <p style={{ fontSize: 13, color: T.text2, margin: 0 }}>No duplicate contacts detected.</p> : dupes.map((g) => (
              <div key={g.key} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: `1px solid ${T.bg4}`, gap: 8, flexWrap: "wrap" }}>
                <div style={{ fontSize: 12, color: T.text1 }}>{g.contacts.map((c) => c.name).join(" · ")}</div>
                <button onClick={() => handleMergeDupe(g)} style={{ ...S.btn, fontSize: 11, padding: "6px 12px" }}>Merge into first</button>
              </div>
            ))}
          </div>

          <div style={card}>
            <h3 style={{ margin: "0 0 12px", fontSize: 15, color: T.text0 }}>Bulk contact actions</h3>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
              <select value={bulkStatus} onChange={(e) => setBulkStatus(e.target.value)} style={{ ...S.input, width: 140 }}>
                <option value="">Set status…</option>
                {industryConfig.contactStatuses.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <input placeholder="Add tag…" value={bulkTag} onChange={(e) => setBulkTag(e.target.value)} style={{ ...S.input, width: 140 }} />
              <button onClick={handleBulkApply} disabled={!bulkSelected.size} style={S.btn as React.CSSProperties}>Apply to {bulkSelected.size || 0}</button>
              <button onClick={handleBulkDelete} disabled={!bulkSelected.size} style={{ ...S.btnGhost, color: T.red } as React.CSSProperties}>Delete selected</button>
            </div>
            <div style={{ maxHeight: 240, overflowY: "auto", border: `1px solid ${T.bg4}`, borderRadius: T.radius.md }}>
              {contacts.slice(0, 200).map((c) => (
                <label key={c.id} style={{ display: "flex", gap: 8, padding: "8px 12px", borderBottom: `1px solid ${T.bg3}`, fontSize: 12, cursor: "pointer" }}>
                  <input type="checkbox" checked={bulkSelected.has(c.id)} onChange={() => setBulkSelected((p) => { const n = new Set(p); if (n.has(c.id)) n.delete(c.id); else n.add(c.id); return n; })} />
                  <span style={{ color: T.text0, flex: 1 }}>{c.name}</span>
                  <span style={{ color: T.text3 }}>{c.email || "no email"}</span>
                </label>
              ))}
            </div>
          </div>

          <div style={card}>
            <h3 style={{ margin: "0 0 8px", fontSize: 15, color: T.text0 }}>GDPR / contact export</h3>
            <p style={{ fontSize: 12, color: T.text2, margin: "0 0 10px" }}>Export all stored data for one contact.</p>
            <div style={{ display: "flex", gap: 8 }}>
              <select value={gdprContactId} onChange={(e) => setGdprContactId(e.target.value)} style={{ ...S.input, flex: 1 }}>
                <option value="">Select contact…</option>
                {contacts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <button disabled={!gdprContactId} onClick={() => {
                const data = exportContactGdpr(contacts, Number(gdprContactId));
                if (data) download(JSON.stringify(data, null, 2), `contact-${gdprContactId}-export.json`, "application/json");
              }} style={S.btn as React.CSSProperties}>Export</button>
            </div>
          </div>
        </div>
      )}

      {/* HEALTH */}
      {section === "health" && (
        <div style={card}>
          <div style={{ display: "flex", gap: 16, marginBottom: 16, flexWrap: "wrap" }}>
            <Stat label="Errors" value={health.counts.errors} color={T.red} />
            <Stat label="Warnings" value={health.counts.warnings} color={T.orange} />
            <Stat label="Info" value={health.counts.info} color={T.blue} />
          </div>
          {health.issues.length === 0 ? <p style={{ color: T.text2, fontSize: 13 }}>No data quality issues found.</p> : (
            <div style={{ maxHeight: 400, overflowY: "auto" }}>
              {health.issues.map((issue) => (
                <div key={issue.id} style={{ display: "flex", gap: 10, padding: "10px 0", borderBottom: `1px solid ${T.bg4}`, alignItems: "flex-start" }}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: issue.severity === "error" ? T.red : issue.severity === "warn" ? T.orange : T.text3, minWidth: 48 }}>{issue.severity}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12, color: T.text0 }}>{issue.message}</div>
                    <div style={{ fontSize: 10, color: T.text3 }}>{issue.category}{issue.entityName ? ` · ${issue.entityName}` : ""}</div>
                  </div>
                  {issue.entityType === "contact" && onNavigate && (
                    <button onClick={() => onNavigate("contacts")} style={{ ...S.btnGhost, fontSize: 10, padding: "4px 8px" }}>View</button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* AUDIT */}
      {section === "audit" && (
        <div style={card}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
            <h3 style={{ margin: 0, fontSize: 15, color: T.text0 }}>Change history ({auditLog.length})</h3>
            <button onClick={() => download(JSON.stringify(auditLog, null, 2), "crm-audit-log.json", "application/json")} style={S.btnGhost as React.CSSProperties}>Export log</button>
          </div>
          {auditLog.length === 0 ? <p style={{ fontSize: 13, color: T.text2 }}>No audit entries yet. Imports, merges, and email sends are logged here.</p> : (
            <div style={{ maxHeight: 420, overflowY: "auto" }}>
              {auditLog.slice(0, 100).map((e) => (
                <div key={e.id} style={{ padding: "10px 0", borderBottom: `1px solid ${T.bg4}`, fontSize: 12 }}>
                  <span style={{ color: T.accent, fontWeight: 600 }}>{e.action}</span>
                  <span style={{ color: T.text1 }}> {e.entity} </span>
                  <span style={{ color: T.text0 }}>{e.entityName}</span>
                  <div style={{ fontSize: 10, color: T.text3, marginTop: 2 }}>{e.user} · {new Date(e.at).toLocaleString()}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* BACKUP */}
      {section === "backup" && (
        <div>
          <div style={card}>
            <h3 style={{ margin: "0 0 8px", fontSize: 15, color: T.text0 }}>Restore from JSON backup</h3>
            <p style={{ fontSize: 12, color: T.text2, margin: "0 0 12px" }}>Import a workspace JSON file exported from this CRM or another team backup.</p>
            <input ref={jsonRef} type="file" accept=".json,application/json" style={{ display: "none" }} onChange={(e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              setRestoreError("");
              const reader = new FileReader();
              reader.onload = (ev) => {
                const result = parseWorkspaceJson(String(ev.target?.result || ""));
                if (!result.ok) { setRestoreError(result.error); return; }
                if (!confirm(restoreMode === "replace" ? "Replace entire workspace with backup? This cannot be undone easily." : "Merge backup into current workspace?")) return;
                onRestoreWorkspace(result.state, restoreMode);
              };
              reader.readAsText(f);
              if (jsonRef.current) jsonRef.current.value = "";
            }} />
            <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
              <label style={{ fontSize: 12, color: T.text2, display: "flex", alignItems: "center", gap: 6 }}>
                <input type="radio" checked={restoreMode === "merge"} onChange={() => setRestoreMode("merge")} /> Merge into current
              </label>
              <label style={{ fontSize: 12, color: T.text2, display: "flex", alignItems: "center", gap: 6 }}>
                <input type="radio" checked={restoreMode === "replace"} onChange={() => setRestoreMode("replace")} /> Replace entire workspace
              </label>
            </div>
            <button onClick={() => jsonRef.current?.click()} style={S.btn as React.CSSProperties}>Choose backup file…</button>
            {restoreError && <p style={{ color: T.red, fontSize: 12, marginTop: 8 }}>{restoreError}</p>}
          </div>

          <div style={card}>
            <h3 style={{ margin: "0 0 8px", fontSize: 15, color: T.text0 }}>Clear data</h3>
            <p style={{ fontSize: 12, color: T.text2, margin: "0 0 12px" }}>Permanently remove records from your workspace. Syncs to your team.</p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 8 }}>
              {CLEARABLE_ENTITIES.map((e) => (
                <button key={e.id} onClick={() => setClearConfirm(e.id)} style={{ ...S.btnGhost, textAlign: "left", padding: 12 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: T.text0 }}>Clear {e.label}</div>
                  <div style={{ fontSize: 10, color: T.text3, marginTop: 4 }}>{e.warn}</div>
                </button>
              ))}
            </div>
            {clearConfirm && (
              <div style={{ marginTop: 14, padding: 14, background: `${T.red}12`, border: `1px solid ${T.red}44`, borderRadius: T.radius.md }}>
                <p style={{ fontSize: 13, color: T.text0, margin: "0 0 10px" }}>Clear all {CLEARABLE_ENTITIES.find((e) => e.id === clearConfirm)?.label}? This syncs to your team.</p>
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={() => { onClearEntity(clearConfirm); setClearConfirm(null); }} style={{ ...S.btn, background: T.red }}>Yes, clear</button>
                  <button onClick={() => setClearConfirm(null)} style={S.btnGhost as React.CSSProperties}>Cancel</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ textAlign: "center" }}>
      <div style={{ fontSize: 22, fontWeight: 700, color }}>{value}</div>
      <div style={{ fontSize: 10, color: T.text3, textTransform: "uppercase" }}>{label}</div>
    </div>
  );
}

function PreviewTable({ kind, rows, selectedRows, onToggle, onToggleAll }: {
  kind: CsvImportKind; rows: PreviewRow[]; selectedRows: Set<number>;
  onToggle: (i: number) => void; onToggleAll: () => void;
}) {
  if (kind === "deals") {
    return (
      <div style={{ background: T.bg3, borderRadius: T.radius.md, overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: "32px 1.4fr 1fr 0.8fr 0.8fr", padding: "8px 12px", borderBottom: `1px solid ${T.bg4}`, gap: 8 }}>
          <div><input type="checkbox" checked={selectedRows.size === rows.length && rows.length > 0} onChange={onToggleAll} /></div>
          {["Title", "Contact", "Value", "Stage"].map((h) => <div key={h} style={{ fontSize: 10, color: T.text3, fontWeight: 700 }}>{h}</div>)}
        </div>
        {(rows as Partial<Deal>[]).map((d, i) => (
          <div key={i} style={{ display: "grid", gridTemplateColumns: "32px 1.4fr 1fr 0.8fr 0.8fr", padding: "8px 12px", borderBottom: `1px solid ${T.bg3}`, gap: 8, alignItems: "center" }}>
            <input type="checkbox" checked={selectedRows.has(i)} onChange={() => onToggle(i)} />
            <div style={{ fontSize: 12, color: T.text1 }}>{d.title || "—"}</div>
            <div style={{ fontSize: 12, color: T.text2 }}>{d.contact || "—"}</div>
            <div style={{ fontSize: 12, color: T.text2 }}>{d.value != null ? fmt(d.value) : "—"}</div>
            <div style={{ fontSize: 11, color: T.text2 }}>{d.stage || "Lead"}</div>
          </div>
        ))}
      </div>
    );
  }
  if (kind === "contacts") {
    return (
      <div style={{ background: T.bg3, borderRadius: T.radius.md, overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: "32px 1.5fr 1.5fr 1fr", padding: "8px 12px", borderBottom: `1px solid ${T.bg4}`, gap: 8 }}>
          <div><input type="checkbox" checked={selectedRows.size === rows.length && rows.length > 0} onChange={onToggleAll} /></div>
          {["Name", "Email", "Company"].map((h) => <div key={h} style={{ fontSize: 10, color: T.text3, fontWeight: 700 }}>{h}</div>)}
        </div>
        {(rows as Partial<Contact>[]).map((c, i) => (
          <div key={i} style={{ display: "grid", gridTemplateColumns: "32px 1.5fr 1.5fr 1fr", padding: "8px 12px", borderBottom: `1px solid ${T.bg3}`, gap: 8, alignItems: "center" }}>
            <input type="checkbox" checked={selectedRows.has(i)} onChange={() => onToggle(i)} />
            <div style={{ fontSize: 12, color: T.text1 }}>{c.name || "—"}</div>
            <div style={{ fontSize: 12, color: T.text2 }}>{c.email || "—"}</div>
            <div style={{ fontSize: 12, color: T.text2 }}>{c.company || "—"}</div>
          </div>
        ))}
      </div>
    );
  }
  return (
    <div style={{ background: T.bg3, borderRadius: T.radius.md, padding: 12, fontSize: 12, color: T.text2 }}>
      {rows.length} {kind} rows ready to import
    </div>
  );
}
