import { useState } from "react";
import { T, S, type Contact, type Sequence, type SequenceEnrollment } from "@/lib/crm-data";
import { enrollCrmSequence } from "@/lib/crm-api";

interface Props {
  sequences: Sequence[];
  contacts: Contact[];
  enrollments: SequenceEnrollment[];
  onUpdateSequences: (sequences: Sequence[]) => void;
  onEnrolled: () => void;
  onCompose?: (contactId: number) => void;
}

export function SequencesTab({
  sequences,
  contacts,
  enrollments,
  onUpdateSequences,
  onEnrolled,
  onCompose,
}: Props) {
  const [enrollSeqId, setEnrollSeqId] = useState<number | null>(null);
  const [enrollContactId, setEnrollContactId] = useState<number | "">("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const card = {
    background: `linear-gradient(145deg,${T.bg2},${T.bg3}88)`,
    border: `1px solid ${T.bg4}`,
    borderRadius: T.radius.lg,
    padding: "18px 20px",
    marginBottom: 12,
  };

  const toggle = (id: number) => {
    onUpdateSequences(sequences.map((s) => (s.id === id ? { ...s, active: !s.active } : s)));
  };

  const handleEnroll = async () => {
    if (!enrollSeqId || enrollContactId === "") return;
    setBusy(true);
    setMsg(null);
    const result = await enrollCrmSequence(enrollSeqId, enrollContactId);
    setBusy(false);
    if (!result.ok) {
      setMsg(result.error || "Enroll failed");
      return;
    }
    setEnrollSeqId(null);
    setEnrollContactId("");
    setMsg("Contact enrolled — steps run on the server scheduler (every ~5 min).");
    onEnrolled();
  };

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: T.text0, margin: 0 }}>📬 Sequences</h1>
        <p style={{ fontSize: 13, color: T.text2, marginTop: 4 }}>
          Email & task cadences — enroll contacts; server sends steps on schedule
        </p>
      </div>

      {sequences.length === 0 ? (
        <div style={card}><p style={{ color: T.text3, margin: 0 }}>No sequences yet. Load sample data from Settings or Data Tools.</p></div>
      ) : sequences.map((seq) => {
        const activeEnrollments = enrollments.filter(
          (e) => e.sequenceId === seq.id && e.status === "active",
        );
        return (
          <div key={seq.id} style={card}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 700, color: T.text0 }}>{seq.name}</div>
                <div style={{ fontSize: 12, color: T.text3, marginTop: 4 }}>
                  {seq.steps.length} steps · {seq.enrolledCount} enrolled · {seq.completedCount} completed
                  {activeEnrollments.length > 0 ? ` · ${activeEnrollments.length} active now` : ""}
                </div>
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <button type="button" onClick={() => setEnrollSeqId(seq.id)} style={{ ...S.btnGhost as React.CSSProperties, fontSize: 11 }}>
                  + Enroll contact
                </button>
                <button type="button" onClick={() => toggle(seq.id)} style={{
                  ...S.btn,
                  padding: "6px 12px",
                  fontSize: 11,
                  background: seq.active ? `${T.green}22` : T.bg4,
                  color: seq.active ? T.green : T.text3,
                }}>
                  {seq.active ? "Active" : "Paused"}
                </button>
              </div>
            </div>
            <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 6 }}>
              {seq.steps.map((step, i) => (
                <div key={step.id} style={{ fontSize: 12, color: T.text2, display: "flex", gap: 8 }}>
                  <span style={{ color: T.text3, width: 18 }}>{i + 1}.</span>
                  <span style={{ color: T.accent, textTransform: "capitalize" }}>{step.type}</span>
                  <span>Day {step.day} — {step.subject || step.title || "—"}</span>
                </div>
              ))}
            </div>
            {activeEnrollments.length > 0 && (
              <div style={{ marginTop: 12, fontSize: 11, color: T.text3 }}>
                Active: {activeEnrollments.map((e) => {
                  const c = contacts.find((x) => x.id === e.contactId);
                  return c?.name || `#${e.contactId}`;
                }).join(", ")}
              </div>
            )}
          </div>
        );
      })}

      {enrollSeqId != null && (
        <div style={S.modalBg as React.CSSProperties} onClick={() => setEnrollSeqId(null)}>
          <div onClick={(e) => e.stopPropagation()} style={{ ...S.modalBox as React.CSSProperties, width: 420 }}>
            <h3 style={{ margin: "0 0 12px", color: T.text0 }}>Enroll in sequence</h3>
            <select
              value={enrollContactId}
              onChange={(e) => setEnrollContactId(e.target.value ? Number(e.target.value) : "")}
              style={{ ...S.input as React.CSSProperties, marginBottom: 12 }}
            >
              <option value="">— Select contact —</option>
              {contacts.map((c) => (
                <option key={c.id} value={c.id}>{c.name} {c.email ? `(${c.email})` : ""}</option>
              ))}
            </select>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button type="button" onClick={() => setEnrollSeqId(null)} style={S.btnGhost as React.CSSProperties}>Cancel</button>
              <button type="button" disabled={busy || enrollContactId === ""} onClick={handleEnroll} style={S.btn as React.CSSProperties}>
                {busy ? "Enrolling…" : "Enroll"}
              </button>
            </div>
          </div>
        </div>
      )}

      {msg && <div style={{ fontSize: 12, color: T.green, marginTop: 8 }}>{msg}</div>}
    </div>
  );
}
