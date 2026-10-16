import { useState } from "react";
import { T, S } from "@/lib/crm-data";

export interface EmailTemplate {
  id: number;
  name: string;
  subject: string;
  body: string;
  category: string;
  createdAt: string;
  updatedAt: string;
}

const MERGE_FIELDS = ["{{name}}", "{{company}}", "{{email}}", "{{deal.title}}", "{{deal.value}}", "{{sender.name}}"];
const CATEGORIES = ["Sales", "Onboarding", "Follow-Up", "Nurturing", "Internal"];

interface Props {
  templates: EmailTemplate[];
  onSave: (templates: EmailTemplate[]) => void;
  onCompose?: (templateId?: number) => void;
}

export function EmailTemplatesTab({ templates, onSave, onCompose }: Props) {
  const [editing, setEditing] = useState<EmailTemplate | null>(null);
  const [preview, setPreview] = useState(false);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("All");

  const card = { background: `linear-gradient(145deg,${T.bg2},${T.bg3}88)`, border: `1px solid ${T.bg4}`, borderRadius: T.radius.lg, padding: "20px 22px", marginBottom: 14 };

  const filtered = templates.filter(t => {
    if (categoryFilter !== "All" && t.category !== categoryFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return t.name.toLowerCase().includes(q) || t.subject.toLowerCase().includes(q);
    }
    return true;
  });

  const handleNew = () => {
    setEditing({
      id: Date.now(), name: "", subject: "", body: "",
      category: "Sales", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    });
    setPreview(false);
  };

  const handleSave = () => {
    if (!editing || !editing.name.trim()) return;
    const updated = { ...editing, updatedAt: new Date().toISOString() };
    const exists = templates.find(t => t.id === updated.id);
    onSave(exists ? templates.map(t => t.id === updated.id ? updated : t) : [...templates, updated]);
    setEditing(null);
  };

  const handleDelete = (id: number) => {
    onSave(templates.filter(t => t.id !== id));
  };

  const insertMergeField = (field: string) => {
    if (!editing) return;
    setEditing(prev => prev ? { ...prev, body: prev.body + field } : null);
  };

  const renderPreview = (text: string) => {
    return text
      .replace(/\{\{name\}\}/g, "Sarah Chen")
      .replace(/\{\{company\}\}/g, "Acme Corp")
      .replace(/\{\{email\}\}/g, "sarah@acme.com")
      .replace(/\{\{deal\.title\}\}/g, "Annual Contract")
      .replace(/\{\{deal\.value\}\}/g, "$48,000")
      .replace(/\{\{sender\.name\}\}/g, "John Doe");
  };

  if (editing) {
    return (
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: T.text0, margin: 0 }}>
              {editing.id && templates.find(t => t.id === editing.id) ? "Edit Template" : "New Template"}
            </h1>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button aria-label="Action" onClick={() => setPreview(p => !p)} style={{
              ...S.btnGhost as React.CSSProperties,
              background: preview ? `${T.blue}22` : T.bg3,
              color: preview ? T.blue : T.text2,
              border: `1px solid ${preview ? `${T.blue}66` : T.bg4}`,
            }}>👁 {preview ? "Edit" : "Preview"}</button>
            <button aria-label="Action" onClick={() => setEditing(null)} style={S.btnGhost as React.CSSProperties}>Cancel</button>
            <button aria-label="Save" onClick={handleSave} style={S.btn as React.CSSProperties}>Save Template</button>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: preview ? "1fr 1fr" : "1fr", gap: 16 }}>
          <div style={card}>
            <div style={{ marginBottom: 12 }}>
              <label style={S.label as React.CSSProperties}>Template Name</label>
              <input value={editing.name} onChange={e = aria-label="input"> setEditing(p => p ? { ...p, name: e.target.value } : null)} style={S.input as React.CSSProperties} placeholder="e.g., Welcome Email" />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
              <div>
                <label style={S.label as React.CSSProperties}>Category</label>
                <select value={editing.category} onChange={e => setEditing(p => p ? { ...p, category: e.target.value } : null)} style={S.input as React.CSSProperties}>
                  {CATEGORIES.map(c => <option key={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label style={S.label as React.CSSProperties}>Subject Line</label>
                <input value={editing.subject} onChange={e = aria-label="input"> setEditing(p => p ? { ...p, subject: e.target.value } : null)} style={S.input as React.CSSProperties} placeholder="Subject…" />
              </div>
            </div>

            {/* Merge field buttons */}
            <div style={{ marginBottom: 8 }}>
              <label style={S.label as React.CSSProperties}>Insert Merge Field</label>
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                {MERGE_FIELDS.map(f => (
                  <button aria-label="Action" key={f} onClick={() => insertMergeField(f)} style={{
                    background: T.bg4, border: "none", borderRadius: T.radius.xs, padding: "3px 8px",
                    color: T.accent, fontSize: 14, cursor: "pointer", fontFamily: "monospace",
                  }}>{f}</button>
                ))}
              </div>
            </div>

            {/* Toolbar */}
            <div style={{ display: "flex", gap: 4, marginBottom: 6, padding: "6px 0", borderBottom: `1px solid ${T.bg4}` }}>
              {[
                { label: "B", cmd: () => wrapText("**", "**") },
                { label: "I", cmd: () => wrapText("_", "_") },
                { label: "H1", cmd: () => prependLine("# ") },
                { label: "H2", cmd: () => prependLine("## ") },
                { label: "• List", cmd: () => prependLine("- ") },
                { label: "Link", cmd: () => insertAtCursor("[text](url)") },
              ].map(btn => (
                <button aria-label="Action" key={btn.label} onClick={btn.cmd} style={{
                  background: T.bg4, border: "none", borderRadius: T.radius.xs, padding: "4px 8px",
                  color: T.text2, fontSize: 14, cursor: "pointer", fontWeight: btn.label === "B" ? 700 : 400,
                  fontStyle: btn.label === "I" ? "italic" : "normal",
                }}>{btn.label}</button>
              ))}
            </div>

            <textarea
              value={editing.body}
              onChange={e = aria-label="textarea"> setEditing(p => p ? { ...p, body: e.target.value } : null)}
              placeholder="Write your email template here…&#10;&#10;Use merge fields like {{name}} to personalize."
              style={{ ...S.input as React.CSSProperties, minHeight: 300, resize: "vertical", fontFamily: "'JetBrains Mono', monospace", fontSize: 14, lineHeight: 1.6 }}
            />
          </div>

          {preview && (
            <div style={card}>
              <div style={{ fontSize: 14, fontWeight: 600, color: T.text3, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 12 }}>Preview</div>
              <div style={{ background: "#fff", borderRadius: T.radius.md, padding: 24, color: "#1a1a1a" }}>
                <div style={{ fontSize: 14, color: "#888", marginBottom: 4 }}>Subject:</div>
                <div style={{ fontSize: 15, fontWeight: 600, color: "#1a1a1a", marginBottom: 16, paddingBottom: 12, borderBottom: "1px solid #eee" }}>
                  {renderPreview(editing.subject) || "(No subject)"}
                </div>
                <div style={{ fontSize: 14, lineHeight: 1.7, color: "#333", whiteSpace: "pre-wrap" }}>
                  {renderPreview(editing.body) || "(Empty body)"}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // wrappers for toolbar (simplified - just append)
  function wrapText(before: string, after: string) {
    setEditing(p => p ? { ...p, body: p.body + before + "text" + after } : null);
  }
  function prependLine(prefix: string) {
    setEditing(p => p ? { ...p, body: p.body + "\n" + prefix } : null);
  }
  function insertAtCursor(text: string) {
    setEditing(p => p ? { ...p, body: p.body + text } : null);
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: T.text0, margin: 0, letterSpacing: "-0.02em" }}>✉️ Email Templates</h1>
          <p style={{ fontSize: 14, color: T.text2, marginTop: 4 }}>{templates.length} templates · Personalize with merge fields</p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {onCompose && (
            <button aria-label="Action" onClick={() => onCompose()} style={S.btnGhost as React.CSSProperties}>✉ Compose</button>
          )}
          <button aria-label="Action" onClick={handleNew} style={S.btn as React.CSSProperties}>+ New Template</button>
        </div>
      </div>

      <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
        <input value={search} onChange={e = aria-label="input"> setSearch(e.target.value)} placeholder="Search templates…"
          style={{ background: T.bg3, border: `1px solid ${T.bg4}`, borderRadius: T.radius.md, color: T.text1, padding: "8px 12px", fontSize: 14, outline: "none", flex: "1 1 200px" }} />
        <div style={{ display: "flex", gap: 4 }}>
          {["All", ...CATEGORIES].map(c => (
            <button aria-label="Action" key={c} onClick={() => setCategoryFilter(c)} style={{
              padding: "5px 12px", borderRadius: T.radius.sm, fontSize: 14,
              background: categoryFilter === c ? T.accent : T.bg3,
              color: categoryFilter === c ? "#080d18" : T.text2,
              border: `1px solid ${categoryFilter === c ? T.accent : T.bg4}`,
              cursor: "pointer", fontWeight: categoryFilter === c ? 700 : 400,
            }}>{c}</button>
          ))}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 12 }}>
        {filtered.map(t => (
          <div key={t.id} style={card}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: T.text0 }}>{t.name}</div>
                <div style={{
                  fontSize: 14, color: T.text3, marginTop: 2,
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>Subject: {t.subject}</div>
              </div>
              <span style={{ fontSize: 14, padding: "2px 8px", borderRadius: T.radius.xs, background: `${T.blue}18`, color: T.blue, fontWeight: 600 }}>{t.category}</span>
            </div>
            <div style={{
              fontSize: 14,
              color: T.text2,
              lineHeight: 1.55,
              marginBottom: 12,
              overflow: "hidden",
              display: "-webkit-box",
              WebkitLineClamp: 4,
              WebkitBoxOrient: "vertical",
              wordBreak: "break-word",
            } as React.CSSProperties}>
              {t.body}
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {onCompose && (
                <button aria-label="Action" onClick={() => onCompose(t.id)} style={{ ...S.btn as React.CSSProperties, padding: "6px 12px", fontSize: 14 }}>✉ Send</button>
              )}
              <button aria-label="Action" onClick={() => { setEditing({ ...t }); setPreview(false); }} style={{ ...S.btnGhost as React.CSSProperties, padding: "6px 12px", fontSize: 14 }}>✎ Edit</button>
              <button aria-label="Action" onClick={() => {
                const clone = { ...t, id: Date.now(), name: `${t.name} (Copy)`, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
                onSave([...templates, clone]);
              }} style={{ ...S.btnGhost as React.CSSProperties, padding: "6px 12px", fontSize: 14 }}>⧉ Clone</button>
              <button aria-label="Action" onClick={() => handleDelete(t.id)} style={{ ...S.btnGhost as React.CSSProperties, padding: "6px 12px", fontSize: 14, color: T.red }}>✕</button>
            </div>
          </div>
        ))}
        {filtered.length === 0 && (
          <div style={{ padding: 40, textAlign: "center", color: T.text3, gridColumn: "1/-1" }}>
            <div style={{ fontSize: 24, marginBottom: 8 }}>✉️</div>
            <div>No templates found. Create one to get started.</div>
          </div>
        )}
      </div>
    </div>
  );
}
