import { useState, useMemo } from "react";
import { T, S, fmt, type QuotaProposal, type QuotaPeriod, DEFAULT_QUOTA_TYPES, TEAM_MEMBERS, getQuotaPeriodDates } from "@/lib/crm-data";

interface Props {
  proposals: QuotaProposal[];
  onUpdateProposals: (proposals: QuotaProposal[]) => void;
  isManager: boolean;
  currentUserId: string;
  onQuotaCreated?: (proposal: QuotaProposal, finalValue: number) => void;
}

const STATUS_STYLES: Record<string, { label: string; color: string; bg: string; icon: string }> = {
  pending: { label: "Pending", color: "#fbbf24", bg: "#fbbf2418", icon: "⏳" },
  accepted: { label: "Accepted", color: "#22d3a0", bg: "#22d3a018", icon: "✅" },
  counter: { label: "Counter Proposed", color: "#4d9ef7", bg: "#4d9ef718", icon: "🔄" },
  rejected: { label: "Declined", color: "#f85b5b", bg: "#f85b5b18", icon: "✕" },
};

const PERIOD_LABELS: Record<QuotaPeriod, string> = {
  weekly: "Weekly", monthly: "Monthly", quarterly: "Quarterly", annual: "Annual",
};

export function QuotaNegotiation({ proposals, onUpdateProposals, isManager, currentUserId, onQuotaCreated }: Props) {
  const [showPropose, setShowPropose] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});
  const [counterModal, setCounterModal] = useState<QuotaProposal | null>(null);
  const [counterValue, setCounterValue] = useState("");
  const [counterNote, setCounterNote] = useState("");

  const myProposals = useMemo(() =>
    isManager ? proposals : proposals.filter(p => p.assigneeId === currentUserId),
    [proposals, isManager, currentUserId]
  );

  const pendingCount = myProposals.filter(p => p.proposalStatus === "pending" || p.proposalStatus === "counter").length;

  const handlePropose = () => {
    const member = TEAM_MEMBERS.find(m => m.id === form.assigneeId);
    if (!member || !form.targetValue) return;
    const newProposal: QuotaProposal = {
      id: Date.now(),
      assigneeId: form.assigneeId,
      assigneeName: member.name,
      type: form.type || DEFAULT_QUOTA_TYPES[0],
      period: (form.period as QuotaPeriod) || "monthly",
      targetValue: Number(form.targetValue),
      stretchGoal: form.stretchGoal ? Number(form.stretchGoal) : undefined,
      proposedBy: "james",
      proposedAt: new Date().toISOString().slice(0, 10),
      proposalStatus: "pending",
      managerNote: form.note || undefined,
    };
    onUpdateProposals([...proposals, newProposal]);
    setShowPropose(false);
    setForm({});
  };

  const handleAccept = (id: number) => {
    const proposal = proposals.find(p => p.id === id);
    onUpdateProposals(proposals.map(p => p.id === id ? { ...p, proposalStatus: "accepted" as const } : p));
    if (proposal) onQuotaCreated?.(proposal, proposal.targetValue);
  };

  const handleReject = (id: number) => {
    onUpdateProposals(proposals.map(p => p.id === id ? { ...p, proposalStatus: "rejected" as const } : p));
  };

  const handleCounter = () => {
    if (!counterModal || !counterValue) return;
    onUpdateProposals(proposals.map(p =>
      p.id === counterModal.id
        ? { ...p, proposalStatus: "counter" as const, counterValue: Number(counterValue), counterNote: counterNote || undefined }
        : p
    ));
    setCounterModal(null);
    setCounterValue("");
    setCounterNote("");
  };

  const handleAcceptCounter = (id: number) => {
    const p = proposals.find(p => p.id === id);
    if (!p) return;
    const finalValue = p.counterValue || p.targetValue;
    onUpdateProposals(proposals.map(pr =>
      pr.id === id ? { ...pr, proposalStatus: "accepted" as const, targetValue: finalValue } : pr
    ));
    onQuotaCreated?.(p, finalValue);
  };

  return (
    <div style={{ ...S.card as React.CSSProperties, padding: "20px 24px", marginBottom: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, color: T.text0, margin: 0 }}>🤝 Quota Proposals</h3>
          {pendingCount > 0 && (
            <span style={{
              fontSize: 14, padding: "2px 8px", borderRadius: T.radius.full,
              background: "#fbbf2422", color: "#fbbf24", fontWeight: 700,
            }}>{pendingCount} pending</span>
          )}
        </div>
        {isManager && (
          <button aria-label="Action" onClick={() => { setForm({ assigneeId: TEAM_MEMBERS[0].id, type: DEFAULT_QUOTA_TYPES[0], period: "monthly" }); setShowPropose(true); }}
            style={{ ...S.btnGhost as React.CSSProperties, fontSize: 14 }}>+ Propose Quota</button>
        )}
      </div>

      {myProposals.length === 0 && (
        <div style={{ textAlign: "center", padding: 24, color: T.text3, fontSize: 14 }}>
          No quota proposals yet.{isManager ? " Click 'Propose Quota' to start a negotiation." : ""}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {myProposals.map(p => {
          const sMeta = STATUS_STYLES[p.proposalStatus];
          return (
            <div key={p.id} style={{
              padding: "14px 18px", borderRadius: T.radius.md,
              background: T.bg2, border: `1px solid ${T.bg4}`,
              borderLeft: `3px solid ${sMeta.color}`,
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 14, fontWeight: 700, color: T.text0 }}>{p.type}</span>
                    <span style={{ fontSize: 14, color: T.text3 }}>→ {p.assigneeName}</span>
                  </div>
                  <div style={{ fontSize: 14, color: T.text3, marginTop: 2 }}>
                    {PERIOD_LABELS[p.period]} · Proposed {p.proposedAt}
                  </div>
                </div>
                <span style={{
                  fontSize: 14, padding: "3px 10px", borderRadius: T.radius.full,
                  background: sMeta.bg, color: sMeta.color, fontWeight: 600,
                }}>{sMeta.icon} {sMeta.label}</span>
              </div>

              <div style={{ display: "flex", gap: 20, fontSize: 14, marginBottom: 8 }}>
                <div>
                  <span style={{ color: T.text3, fontSize: 14 }}>TARGET </span>
                  <span style={{ fontWeight: 700, color: T.text0, fontFamily: "'JetBrains Mono', monospace" }}>
                    {p.type === "Revenue" ? fmt(p.targetValue) : p.targetValue}
                  </span>
                </div>
                {p.stretchGoal && (
                  <div>
                    <span style={{ color: T.text3, fontSize: 14 }}>STRETCH </span>
                    <span style={{ fontWeight: 600, color: T.text2, fontFamily: "'JetBrains Mono', monospace" }}>
                      {p.type === "Revenue" ? fmt(p.stretchGoal) : p.stretchGoal}
                    </span>
                  </div>
                )}
                {p.counterValue && (
                  <div>
                    <span style={{ color: "#4d9ef7", fontSize: 14 }}>COUNTER </span>
                    <span style={{ fontWeight: 700, color: "#4d9ef7", fontFamily: "'JetBrains Mono', monospace" }}>
                      {p.type === "Revenue" ? fmt(p.counterValue) : p.counterValue}
                    </span>
                  </div>
                )}
              </div>

              {p.managerNote && (
                <div style={{ fontSize: 14, color: T.text2, marginBottom: 8, fontStyle: "italic" }}>
                  📝 "{p.managerNote}"
                </div>
              )}
              {p.counterNote && (
                <div style={{ fontSize: 14, color: "#4d9ef7", marginBottom: 8, fontStyle: "italic" }}>
                  💬 "{p.counterNote}"
                </div>
              )}

              {/* Actions */}
              {p.proposalStatus === "pending" && !isManager && (
                <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                  <button aria-label="Action" onClick={() => handleAccept(p.id)} style={{
                    ...S.btn as React.CSSProperties, fontSize: 14, padding: "5px 14px",
                    background: "#22d3a0",
                  }}>Accept</button>
                  <button aria-label="Action" onClick={() => { setCounterModal(p); setCounterValue(String(p.targetValue)); }}
                    style={{ ...S.btnGhost as React.CSSProperties, fontSize: 14, padding: "5px 14px", color: "#4d9ef7" }}>
                    Counter Propose
                  </button>
                  <button aria-label="Action" onClick={() => handleReject(p.id)} style={{
                    ...S.btnGhost as React.CSSProperties, fontSize: 14, padding: "5px 14px", color: "#f85b5b",
                  }}>Decline</button>
                </div>
              )}
              {p.proposalStatus === "counter" && isManager && (
                <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                  <button aria-label="Action" onClick={() => handleAcceptCounter(p.id)} style={{
                    ...S.btn as React.CSSProperties, fontSize: 14, padding: "5px 14px",
                    background: "#22d3a0",
                  }}>Accept Counter ({p.type === "Revenue" ? fmt(p.counterValue!) : p.counterValue})</button>
                  <button aria-label="Action" onClick={() => handleReject(p.id)} style={{
                    ...S.btnGhost as React.CSSProperties, fontSize: 14, padding: "5px 14px", color: "#f85b5b",
                  }}>Reject</button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Propose Modal */}
      {showPropose && (
        <div style={S.modalBg as React.CSSProperties} onClick={() => setShowPropose(false)}>
          <div style={S.modalBox as React.CSSProperties} onClick={e => e.stopPropagation()}>
            <h3 style={{ fontSize: 18, fontWeight: 700, color: T.text0, marginBottom: 20 }}>Propose New Quota</h3>

            <div style={{ marginBottom: 12 }}>
              <label style={S.label as React.CSSProperties}>Team Member</label>
              <select value={form.assigneeId || ""} onChange={e => setForm(p => ({ ...p, assigneeId: e.target.value }))}
                style={S.input as React.CSSProperties}>
                {TEAM_MEMBERS.filter(m => m.role !== "manager").map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
              <div>
                <label style={S.label as React.CSSProperties}>Quota Type</label>
                <select value={form.type || ""} onChange={e => setForm(p => ({ ...p, type: e.target.value }))}
                  style={S.input as React.CSSProperties}>
                  {DEFAULT_QUOTA_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label style={S.label as React.CSSProperties}>Period</label>
                <select value={form.period || "monthly"} onChange={e => setForm(p => ({ ...p, period: e.target.value }))}
                  style={S.input as React.CSSProperties}>
                  {(["weekly", "monthly", "quarterly", "annual"] as QuotaPeriod[]).map(p => (
                    <option key={p} value={p}>{PERIOD_LABELS[p]}</option>
                  ))}
                </select>
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
              <div>
                <label style={S.label as React.CSSProperties}>Target Value</label>
                <input type="number" value={form.targetValue || ""} placeholder="e.g. 50000"
                  onChange={e = aria-label="e.g. 50000"> setForm(p => ({ ...p, targetValue: e.target.value }))}
                  style={S.input as React.CSSProperties} />
              </div>
              <div>
                <label style={S.label as React.CSSProperties}>Stretch Goal (opt)</label>
                <input type="number" value={form.stretchGoal || ""} placeholder="e.g. 65000"
                  onChange={e = aria-label="e.g. 65000"> setForm(p => ({ ...p, stretchGoal: e.target.value }))}
                  style={S.input as React.CSSProperties} />
              </div>
            </div>

            <div style={{ marginBottom: 20 }}>
              <label style={S.label as React.CSSProperties}>Note to team member</label>
              <textarea value={form.note || ""} placeholder="Context for this quota..."
                onChange={e = aria-label="Context for this quota..."> setForm(p => ({ ...p, note: e.target.value }))}
                style={{ ...S.input as React.CSSProperties, minHeight: 60, resize: "vertical" }} />
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <button aria-label="Action" onClick={() => setShowPropose(false)} style={S.btnGhost as React.CSSProperties}>Cancel</button>
              <button aria-label="Action" onClick={handlePropose} style={S.btn as React.CSSProperties}>Send Proposal</button>
            </div>
          </div>
        </div>
      )}

      {/* Counter Modal */}
      {counterModal && (
        <div style={S.modalBg as React.CSSProperties} onClick={() => setCounterModal(null)}>
          <div style={S.modalBox as React.CSSProperties} onClick={e => e.stopPropagation()}>
            <h3 style={{ fontSize: 18, fontWeight: 700, color: T.text0, marginBottom: 6 }}>Counter Propose</h3>
            <p style={{ fontSize: 14, color: T.text3, marginBottom: 20 }}>
              Original target: <strong style={{ color: T.text0 }}>
                {counterModal.type === "Revenue" ? fmt(counterModal.targetValue) : counterModal.targetValue}
              </strong> ({counterModal.type}, {PERIOD_LABELS[counterModal.period]})
            </p>

            <div style={{ marginBottom: 12 }}>
              <label style={S.label as React.CSSProperties}>Your Proposed Value</label>
              <input type="number" value={counterValue}
                onChange={e = aria-label="number"> setCounterValue(e.target.value)}
                style={S.input as React.CSSProperties} />
            </div>

            <div style={{ marginBottom: 20 }}>
              <label style={S.label as React.CSSProperties}>Reason (optional)</label>
              <textarea value={counterNote} placeholder="Explain why you're proposing a different target..."
                onChange={e = aria-label="Explain why you"> setCounterNote(e.target.value)}
                style={{ ...S.input as React.CSSProperties, minHeight: 60, resize: "vertical" }} />
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <button aria-label="Action" onClick={() => setCounterModal(null)} style={S.btnGhost as React.CSSProperties}>Cancel</button>
              <button aria-label="Action" onClick={handleCounter} style={{ ...S.btn as React.CSSProperties, background: "#4d9ef7" }}>Submit Counter</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
