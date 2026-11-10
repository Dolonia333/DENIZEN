import { useMemo, useState } from "react";
import { T, defaultIntakeQuestions, type IntakeQuestion } from "@/lib/crm-data";
import {
  INTAKE_FIELD_TYPES,
  createBlankIntakeQuestion,
  embedSnippet,
  moveIntakeQuestion,
  parseOptionsText,
  removeIntakeQuestion,
  updateIntakeQuestion,
} from "@/lib/crm-intake-form";

interface Props {
  questions: IntakeQuestion[];
  orgSlug?: string | null;
  intakePageUrl?: string;
  onChange: (next: IntakeQuestion[]) => void;
  onClose: () => void;
}

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "9px 12px", borderRadius: 8,
  border: `1px solid ${T.bg4}`, background: T.bg3, color: T.text0,
  fontSize: 13, outline: "none", boxSizing: "border-box",
};
const labelStyle: React.CSSProperties = {
  display: "block", fontSize: 11, fontWeight: 600, color: T.text2,
  marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.05em",
};
const btnPrimary: React.CSSProperties = {
  padding: "9px 16px", borderRadius: 8, border: "none",
  background: T.accent, color: "#080d18", fontSize: 13, fontWeight: 700, cursor: "pointer",
};
const btnSecondary: React.CSSProperties = {
  padding: "9px 16px", borderRadius: 8, border: `1px solid ${T.bg4}`,
  background: "transparent", color: T.text1, fontSize: 13, fontWeight: 600, cursor: "pointer",
};

function PreviewField({ q }: { q: IntakeQuestion }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={labelStyle}>{q.icon} {q.label}{q.required ? " *" : ""}</label>
      {q.type === "textarea" && (
        <textarea style={{ ...inputStyle, minHeight: 64 }} placeholder={q.placeholder || ""} disabled />
      )}
      {(q.type === "text" || q.type === "email" || q.type === "phone" || q.type === "number") && (
        <input
          style={inputStyle}
          type={q.type === "number" ? "number" : q.type === "email" ? "email" : q.type === "phone" ? "tel" : "text"}
          placeholder={q.placeholder || ""}
          disabled
        />
      )}
      {q.type === "select" && (
        <select style={inputStyle} disabled defaultValue="">
          <option value="">Select…</option>
          {(q.options || []).map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      )}
      {q.type === "multiselect" && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {(q.options || []).map((o) => (
            <span key={o} style={{
              padding: "5px 10px", borderRadius: 6, fontSize: 12,
              border: `1px solid ${T.bg4}`, background: T.bg3, color: T.text2,
            }}>{o}</span>
          ))}
        </div>
      )}
    </div>
  );
}

export function IntakeFormBuilder({
  questions, orgSlug, intakePageUrl = "", onChange, onClose,
}: Props) {
  const [selectedId, setSelectedId] = useState<number | null>(questions[0]?.id ?? null);
  const [copiedEmbed, setCopiedEmbed] = useState(false);
  const selected = useMemo(
    () => questions.find((q) => q.id === selectedId) || questions[0] || null,
    [questions, selectedId],
  );

  const patchSelected = (patch: Partial<IntakeQuestion>) => {
    if (!selected) return;
    onChange(updateIntakeQuestion(questions, selected.id, patch));
  };

  const addQuestion = () => {
    const next = createBlankIntakeQuestion(questions);
    onChange([...questions, next]);
    setSelectedId(next.id);
  };

  const embed = orgSlug ? embedSnippet(orgSlug, intakePageUrl) : "";

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16 }}>
      <div style={{ background: T.bg2, border: `1px solid ${T.bg4}`, borderRadius: 12, padding: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: T.text0 }}>Form builder</h2>
            <p style={{ margin: "4px 0 0", fontSize: 12, color: T.text2 }}>
              Edit fields for the hosted public intake and in-app New Intake form.
            </p>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" style={btnSecondary} onClick={() => onChange([...defaultIntakeQuestions])}>
              Reset defaults
            </button>
            <button type="button" style={btnPrimary} onClick={addQuestion}>+ Add field</button>
            <button type="button" style={btnSecondary} onClick={onClose}>Done</button>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 18 }}>
          {questions.map((q, i) => {
            const active = selected?.id === q.id;
            return (
              <button
                key={q.id}
                type="button"
                onClick={() => setSelectedId(q.id)}
                style={{
                  display: "flex", alignItems: "center", gap: 10, textAlign: "left",
                  padding: "10px 12px", borderRadius: 10, cursor: "pointer",
                  border: `1px solid ${active ? T.accent : T.bg4}`,
                  background: active ? `${T.accent}14` : T.bg3,
                  color: T.text0,
                }}
              >
                <span style={{ fontSize: 11, color: T.text3, width: 18 }}>{i + 1}</span>
                <span style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>
                  {q.icon} {q.label}
                  {q.required ? <span style={{ color: T.accent, marginLeft: 6 }}>*</span> : null}
                </span>
                <span style={{ fontSize: 11, color: T.text2 }}>{q.type}</span>
                <span style={{ display: "flex", gap: 4 }} onClick={(e) => e.stopPropagation()}>
                  <button type="button" style={{ ...btnSecondary, padding: "4px 8px", fontSize: 11 }}
                    onClick={() => onChange(moveIntakeQuestion(questions, q.id, -1))} aria-label="Move up">↑</button>
                  <button type="button" style={{ ...btnSecondary, padding: "4px 8px", fontSize: 11 }}
                    onClick={() => onChange(moveIntakeQuestion(questions, q.id, 1))} aria-label="Move down">↓</button>
                  <button type="button" style={{ ...btnSecondary, padding: "4px 8px", fontSize: 11, color: T.red }}
                    onClick={() => {
                      const next = removeIntakeQuestion(questions, q.id);
                      onChange(next);
                      if (selectedId === q.id) setSelectedId(next[0]?.id ?? null);
                    }}
                    aria-label="Remove"
                  >✕</button>
                </span>
              </button>
            );
          })}
        </div>

        {selected && (
          <div style={{ borderTop: `1px solid ${T.bg4}`, paddingTop: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: T.text0, marginBottom: 12 }}>Field settings</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div style={{ gridColumn: "1 / -1" }}>
                <label style={labelStyle}>Label</label>
                <input style={inputStyle} value={selected.label}
                  onChange={(e) => patchSelected({ label: e.target.value })} />
              </div>
              <div>
                <label style={labelStyle}>Type</label>
                <select style={inputStyle} value={selected.type}
                  onChange={(e) => patchSelected({ type: e.target.value })}>
                  {INTAKE_FIELD_TYPES.map((t) => (
                    <option key={t.id} value={t.id}>{t.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={labelStyle}>Icon</label>
                <input style={inputStyle} value={selected.icon || ""}
                  onChange={(e) => patchSelected({ icon: e.target.value.slice(0, 8) })} />
              </div>
              <div style={{ gridColumn: "1 / -1" }}>
                <label style={labelStyle}>Placeholder</label>
                <input style={inputStyle} value={selected.placeholder || ""}
                  onChange={(e) => patchSelected({ placeholder: e.target.value })} />
              </div>
              {(selected.type === "select" || selected.type === "multiselect") && (
                <div style={{ gridColumn: "1 / -1" }}>
                  <label style={labelStyle}>Options (one per line or comma-separated)</label>
                  <textarea
                    style={{ ...inputStyle, minHeight: 90, resize: "vertical" }}
                    value={(selected.options || []).join("\n")}
                    onChange={(e) => patchSelected({ options: parseOptionsText(e.target.value) })}
                  />
                </div>
              )}
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: T.text1, cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={Boolean(selected.required)}
                  onChange={(e) => patchSelected({ required: e.target.checked })}
                />
                Required
              </label>
            </div>
          </div>
        )}

        {orgSlug && (
          <div style={{ marginTop: 18, padding: 14, borderRadius: 10, background: `${T.blue}12`, border: `1px solid ${T.blue}33` }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: T.text0, marginBottom: 6 }}>Embed snippet</div>
            <pre style={{
              margin: 0, padding: 10, borderRadius: 8, background: T.bg0, border: `1px solid ${T.bg4}`,
              fontSize: 11, color: T.text2, overflowX: "auto", whiteSpace: "pre-wrap",
            }}>{embed}</pre>
            <button
              type="button"
              style={{ ...btnSecondary, marginTop: 8, fontSize: 12 }}
              onClick={() => {
                void navigator.clipboard.writeText(embed).then(() => {
                  setCopiedEmbed(true);
                  setTimeout(() => setCopiedEmbed(false), 1600);
                });
              }}
            >
              {copiedEmbed ? "Copied" : "Copy embed code"}
            </button>
          </div>
        )}
      </div>

      <div style={{ background: T.bg2, border: `1px solid ${T.bg4}`, borderRadius: 12, padding: 20 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: T.text0, marginBottom: 4 }}>Live preview</div>
        <p style={{ margin: "0 0 16px", fontSize: 12, color: T.text2 }}>
          Name, email, and company stay fixed. Your custom fields render below.
        </p>
        <div style={{
          background: "radial-gradient(ellipse at top, #121b2e 0%, #080d18 70%)",
          border: `1px solid ${T.bg4}`, borderRadius: 12, padding: 18,
        }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: T.text0, marginBottom: 4 }}>Tell us about your project</div>
          <div style={{ fontSize: 12, color: T.text2, marginBottom: 16 }}>Preview of the hosted public form</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
            <div>
              <label style={labelStyle}>Your name *</label>
              <input style={inputStyle} disabled placeholder="Jane Smith" />
            </div>
            <div>
              <label style={labelStyle}>Email *</label>
              <input style={inputStyle} disabled placeholder="jane@acme.com" />
            </div>
          </div>
          <div style={{ marginBottom: 14 }}>
            <label style={labelStyle}>Company</label>
            <input style={inputStyle} disabled placeholder="Acme Inc" />
          </div>
          {questions.map((q) => <PreviewField key={q.id} q={q} />)}
          <button type="button" style={{ ...btnPrimary, width: "100%", opacity: 0.85 }} disabled>
            Submit intake
          </button>
        </div>
      </div>
    </div>
  );
}
