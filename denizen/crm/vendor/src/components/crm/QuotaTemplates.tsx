import { useState, useRef, useEffect } from "react";
import { T, S, fmt, type QuotaTemplate, type QuotaPeriod, type Quota, BUILT_IN_QUOTA_TEMPLATES, DEFAULT_QUOTA_TYPES, TEAM_MEMBERS, getQuotaPeriodDates, calcQuotaStatus } from "@/lib/crm-data";
import { toast } from "sonner";

interface Props {
  onAssignFromTemplate: (quotas: Quota[]) => void;
}

const PERIOD_LABELS: Record<QuotaPeriod, string> = {
  weekly: "Weekly", monthly: "Monthly", quarterly: "Quarterly", annual: "Annual",
};

export function QuotaTemplates({ onAssignFromTemplate }: Props) {
  const [customTemplates, setCustomTemplates] = useState<QuotaTemplate[]>([]);
  const [showBuilder, setShowBuilder] = useState(false);
  const [assignModal, setAssignModal] = useState<QuotaTemplate | null>(null);
  const [selectedMembers, setSelectedMembers] = useState<string[]>([]);
  const [form, setForm] = useState<Record<string, string>>({});
  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (showBuilder && nameInputRef.current) {
      nameInputRef.current.focus();
      nameInputRef.current.select();
    }
  }, [showBuilder]);

  const allTemplates = [...BUILT_IN_QUOTA_TEMPLATES, ...customTemplates];

  const handleCreateTemplate = () => {
    if (!form.name?.trim() || !form.targetValue) return;
    const tmpl: QuotaTemplate = {
      id: Date.now(),
      name: form.name.trim(),
      type: form.type || DEFAULT_QUOTA_TYPES[0],
      period: (form.period as QuotaPeriod) || "monthly",
      targetValue: Number(form.targetValue),
      stretchGoal: form.stretchGoal ? Number(form.stretchGoal) : undefined,
      isBuiltIn: false,
    };
    setCustomTemplates(prev => [...prev, tmpl]);
    setShowBuilder(false);
    setForm({});
    toast.success(`Template "${tmpl.name}" created`);
  };

  const handleDeleteTemplate = (id: number) => {
    setCustomTemplates(prev => prev.filter(t => t.id !== id));
    toast.success("Template deleted");
  };

  const handleAssign = () => {
    if (!assignModal || selectedMembers.length === 0) return;
    const dates = getQuotaPeriodDates(assignModal.period);
    const newQuotas: Quota[] = selectedMembers.map(memberId => {
      const member = TEAM_MEMBERS.find(m => m.id === memberId)!;
      const q: Quota = {
        id: Date.now() + Math.random(),
        assigneeId: memberId,
        assigneeName: member.name,
        type: assignModal.type,
        period: assignModal.period,
        targetValue: assignModal.targetValue,
        stretchGoal: assignModal.stretchGoal,
        currentValue: 0,
        startDate: dates.startDate,
        endDate: dates.endDate,
        createdBy: "james",
        status: "on-track",
      };
      q.status = calcQuotaStatus(q);
      return q;
    });
    onAssignFromTemplate(newQuotas);
    toast.success(`Assigned "${assignModal.name}" to ${selectedMembers.length} member${selectedMembers.length > 1 ? "s" : ""}`);
    setAssignModal(null);
    setSelectedMembers([]);
  };

  const toggleMember = (id: string) => {
    setSelectedMembers(prev => prev.includes(id) ? prev.filter(m => m !== id) : [...prev, id]);
  };

  return (
    <div style={{ ...S.card as React.CSSProperties, padding: "20px 24px", marginBottom: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, color: T.text0, margin: 0 }}>📋 Quota Templates</h3>
          <span style={{ fontSize: 14, color: T.text3 }}>{allTemplates.length} templates</span>
        </div>
        <button aria-label="Action" onClick={() => { setForm({ type: DEFAULT_QUOTA_TYPES[0], period: "monthly" }); setShowBuilder(true); }}
          style={{ ...S.btnGhost as React.CSSProperties, fontSize: 14 }}>+ Build Template</button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 10 }}>
        {allTemplates.map(tmpl => (
          <div key={tmpl.id} style={{
            padding: "14px 16px", borderRadius: T.radius.md,
            background: T.bg2, border: `1px solid ${T.bg4}`,
            position: "relative",
          }}>
            {!tmpl.isBuiltIn && (
              <button aria-label="Action" onClick={() => handleDeleteTemplate(tmpl.id)} style={{
                position: "absolute", top: 8, right: 8, background: "none", border: "none",
                color: T.text3, cursor: "pointer", fontSize: 14, padding: 2,
              }}>✕</button>
            )}
            <div style={{ fontSize: 14, fontWeight: 700, color: T.text0, marginBottom: 4, paddingRight: 16 }}>{tmpl.name}</div>
            <div style={{ fontSize: 14, color: T.text3, marginBottom: 8 }}>
              {tmpl.type} · {PERIOD_LABELS[tmpl.period]}
            </div>
            <div style={{ display: "flex", gap: 12, fontSize: 14, marginBottom: 10 }}>
              <div>
                <span style={{ color: T.text3, fontSize: 14 }}>TARGET </span>
                <span style={{ fontWeight: 700, color: T.text0, fontFamily: "'JetBrains Mono', monospace" }}>
                  {tmpl.type === "Revenue" ? fmt(tmpl.targetValue) : tmpl.targetValue}
                </span>
              </div>
              {tmpl.stretchGoal && (
                <div>
                  <span style={{ color: T.text3, fontSize: 14 }}>STRETCH </span>
                  <span style={{ fontWeight: 600, color: T.text2, fontFamily: "'JetBrains Mono', monospace" }}>
                    {tmpl.type === "Revenue" ? fmt(tmpl.stretchGoal) : tmpl.stretchGoal}
                  </span>
                </div>
              )}
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button aria-label="Action" onClick={() => { setAssignModal(tmpl); setSelectedMembers([]); }} style={{
                ...S.btn as React.CSSProperties, fontSize: 14, padding: "4px 12px", flex: 1,
              }}>Assign</button>
              <button aria-label="Action" onClick={() => {
                setForm({
                  name: tmpl.name + " (copy)",
                  type: tmpl.type,
                  period: tmpl.period,
                  targetValue: String(tmpl.targetValue),
                  stretchGoal: tmpl.stretchGoal ? String(tmpl.stretchGoal) : "",
                });
                setShowBuilder(true);
              }} style={{
                ...S.btnGhost as React.CSSProperties, fontSize: 14, padding: "4px 10px",
              }}>⧉ Duplicate</button>
            </div>
            {tmpl.isBuiltIn && (
              <div style={{ fontSize: 14, color: T.text3, marginTop: 6, textAlign: "center" }}>Built-in</div>
            )}
          </div>
        ))}
      </div>

      {/* Build Template Modal */}
      {showBuilder && (
        <div style={S.modalBg as React.CSSProperties} onClick={() => setShowBuilder(false)}>
          <div style={S.modalBox as React.CSSProperties} onClick={e => e.stopPropagation()}>
            <h3 style={{ fontSize: 18, fontWeight: 700, color: T.text0, marginBottom: 20 }}>Build Custom Template</h3>

            <div style={{ marginBottom: 12 }}>
              <label style={S.label as React.CSSProperties}>Template Name</label>
              <input ref={nameInputRef} value={form.name || ""} placeholder="e.g. Q3 Revenue Push"
                onChange={e = aria-label="e.g. Q3 Revenue Push"> setForm(p => ({ ...p, name: e.target.value }))}
                style={S.input as React.CSSProperties} />
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

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 20 }}>
              <div>
                <label style={S.label as React.CSSProperties}>Target Value</label>
                <input type="number" value={form.targetValue || ""} placeholder="e.g. 50000"
                  onChange={e = aria-label="e.g. 50000"> setForm(p => ({ ...p, targetValue: e.target.value }))}
                  style={S.input as React.CSSProperties} />
              </div>
              <div>
                <label style={S.label as React.CSSProperties}>Stretch Goal (optional)</label>
                <input type="number" value={form.stretchGoal || ""} placeholder="e.g. 65000"
                  onChange={e = aria-label="e.g. 65000"> setForm(p => ({ ...p, stretchGoal: e.target.value }))}
                  style={S.input as React.CSSProperties} />
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <button aria-label="Action" onClick={() => setShowBuilder(false)} style={S.btnGhost as React.CSSProperties}>Cancel</button>
              <button aria-label="Action" onClick={handleCreateTemplate} style={S.btn as React.CSSProperties}>Create Template</button>
            </div>
          </div>
        </div>
      )}

      {/* Assign Modal */}
      {assignModal && (
        <div style={S.modalBg as React.CSSProperties} onClick={() => setAssignModal(null)}>
          <div style={S.modalBox as React.CSSProperties} onClick={e => e.stopPropagation()}>
            <h3 style={{ fontSize: 18, fontWeight: 700, color: T.text0, marginBottom: 6 }}>
              Assign "{assignModal.name}"
            </h3>
            <p style={{ fontSize: 14, color: T.text3, marginBottom: 20 }}>
              {assignModal.type} · {PERIOD_LABELS[assignModal.period]} · Target: {" "}
              <strong style={{ color: T.text0 }}>
                {assignModal.type === "Revenue" ? fmt(assignModal.targetValue) : assignModal.targetValue}
              </strong>
            </p>

            <div style={{ marginBottom: 20 }}>
              <label style={S.label as React.CSSProperties}>Select Team Members</label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {TEAM_MEMBERS.filter(m => m.role !== "manager").map(m => {
                  const selected = selectedMembers.includes(m.id);
                  return (
                    <button aria-label="Action" key={m.id} onClick={() => toggleMember(m.id)} style={{
                      padding: "8px 16px", borderRadius: T.radius.md, fontSize: 14, fontWeight: 600,
                      background: selected ? `${T.accent}22` : T.bg3,
                      color: selected ? T.accent : T.text3,
                      border: `2px solid ${selected ? T.accent : T.bg4}`,
                      cursor: "pointer", transition: "all 0.15s",
                    }}>{m.avatar} {m.name}</button>
                  );
                })}
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <button aria-label="Action" onClick={() => setSelectedMembers(TEAM_MEMBERS.filter(m => m.role !== "manager").map(m => m.id))}
                  style={{ ...S.btnGhost as React.CSSProperties, fontSize: 14, padding: "4px 10px" }}>Select All</button>
                <button aria-label="Action" onClick={() => setSelectedMembers([])}
                  style={{ ...S.btnGhost as React.CSSProperties, fontSize: 14, padding: "4px 10px" }}>Clear</button>
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 14, color: T.text2 }}>
                {selectedMembers.length} member{selectedMembers.length !== 1 ? "s" : ""} selected
              </span>
              <div style={{ display: "flex", gap: 10 }}>
                <button aria-label="Action" onClick={() => setAssignModal(null)} style={S.btnGhost as React.CSSProperties}>Cancel</button>
                <button aria-label="Action" onClick={handleAssign} disabled={selectedMembers.length === 0} style={{
                  ...S.btn as React.CSSProperties,
                  opacity: selectedMembers.length === 0 ? 0.5 : 1,
                }}>Assign Quotas</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
