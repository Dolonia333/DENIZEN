import { useState } from "react";
import { T, S, type ReportSchedule, TEAM_MEMBERS } from "@/lib/crm-data";
import { toast } from "sonner";

interface Props {
  schedules: ReportSchedule[];
  onUpdateSchedules: (schedules: ReportSchedule[]) => void;
}

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const getNextSendDate = (s: ReportSchedule): string => {
  const now = new Date();
  if (s.frequency === "weekly" && s.dayOfWeek !== undefined) {
    const diff = (s.dayOfWeek - now.getDay() + 7) % 7 || 7;
    const next = new Date(now); next.setDate(now.getDate() + diff);
    return next.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  }
  if (s.frequency === "monthly" && s.dayOfMonth) {
    const next = new Date(now.getFullYear(), now.getMonth(), s.dayOfMonth);
    if (next <= now) next.setMonth(next.getMonth() + 1);
    return next.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }
  return "—";
};

export function QuotaReportScheduler({ schedules, onUpdateSchedules }: Props) {
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState<Record<string, any>>({
    frequency: "weekly", dayOfWeek: 1, dayOfMonth: 1, recipientIds: [] as string[],
  });

  const handleAdd = () => {
    const sched: ReportSchedule = {
      id: Date.now(),
      frequency: form.frequency,
      dayOfWeek: form.frequency === "weekly" ? Number(form.dayOfWeek) : undefined,
      dayOfMonth: form.frequency === "monthly" ? Number(form.dayOfMonth) : undefined,
      recipientIds: form.recipientIds.length > 0 ? form.recipientIds : TEAM_MEMBERS.filter(m => m.role === "manager").map(m => m.id),
      enabled: true,
      createdAt: new Date().toISOString().slice(0, 10),
    };
    onUpdateSchedules([...schedules, sched]);
    setShowAdd(false);
    setForm({ frequency: "weekly", dayOfWeek: 1, dayOfMonth: 1, recipientIds: [] });
  };

  const toggleEnabled = (id: number) => {
    onUpdateSchedules(schedules.map(s => s.id === id ? { ...s, enabled: !s.enabled } : s));
  };

  const handleDelete = (id: number) => {
    onUpdateSchedules(schedules.filter(s => s.id !== id));
  };

  const toggleRecipient = (memberId: string) => {
    setForm(prev => {
      const ids = prev.recipientIds as string[];
      return { ...prev, recipientIds: ids.includes(memberId) ? ids.filter(id => id !== memberId) : [...ids, memberId] };
    });
  };

  return (
    <div style={{ ...S.card as React.CSSProperties, padding: "20px 24px", marginBottom: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, color: T.text0, margin: 0 }}>📧 Scheduled Reports</h3>
          <span style={{ fontSize: 11, color: T.text3 }}>{schedules.filter(s => s.enabled).length} active</span>
        </div>
        <button onClick={() => setShowAdd(true)} style={{ ...S.btnGhost as React.CSSProperties, fontSize: 11 }}>+ Add Schedule</button>
      </div>

      {schedules.length === 0 && (
        <div style={{ textAlign: "center", padding: 24, color: T.text3, fontSize: 13 }}>
          No report schedules. Set up automatic quota reports for your team.
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {schedules.map(s => {
          const recipients = s.recipientIds
            .map(id => TEAM_MEMBERS.find(m => m.id === id)?.name || id)
            .join(", ");
          const scheduleText = s.frequency === "weekly"
            ? `Every ${DAYS[s.dayOfWeek || 0]}`
            : `Monthly on the ${s.dayOfMonth}${s.dayOfMonth === 1 ? "st" : s.dayOfMonth === 2 ? "nd" : s.dayOfMonth === 3 ? "rd" : "th"}`;

          return (
            <div key={s.id} style={{
              display: "flex", alignItems: "center", gap: 14,
              padding: "12px 16px", borderRadius: T.radius.md,
              background: T.bg2, border: `1px solid ${T.bg4}`,
              opacity: s.enabled ? 1 : 0.5,
            }}>
              {/* Toggle */}
              <button onClick={() => toggleEnabled(s.id)} style={{
                width: 36, height: 20, borderRadius: 10, border: "none", cursor: "pointer",
                background: s.enabled ? "#22d3a0" : T.bg4, position: "relative", flexShrink: 0,
                transition: "background 0.2s",
              }}>
                <div style={{
                  width: 16, height: 16, borderRadius: "50%", background: "#fff",
                  position: "absolute", top: 2, transition: "left 0.2s",
                  left: s.enabled ? 18 : 2,
                }} />
              </button>

              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: T.text0 }}>{scheduleText}</div>
                <div style={{ fontSize: 11, color: T.text3, marginTop: 2 }}>
                  To: {recipients} · {s.frequency === "weekly" ? "Weekly" : "Monthly"} report
                  {s.lastSent && <span> · Last sent: {s.lastSent}</span>}
                </div>
                {s.enabled && (
                  <div style={{ fontSize: 10, color: T.blue, marginTop: 2 }}>
                    📬 Next send: {getNextSendDate(s)}
                  </div>
                )}
              </div>

              <button onClick={(e) => {
                e.stopPropagation();
                const recipientNames = s.recipientIds.map(id => TEAM_MEMBERS.find(m => m.id === id)?.name || id).join(", ");
                onUpdateSchedules(schedules.map(sc => sc.id === s.id ? { ...sc, lastSent: new Date().toISOString().slice(0, 10) } : sc));
                toast.success(`📧 Report sent to ${recipientNames}`);
              }} style={{
                ...S.btnGhost as React.CSSProperties, padding: "4px 10px", fontSize: 10, color: T.green, flexShrink: 0,
              }}>Send Now</button>

              <button onClick={() => handleDelete(s.id)} style={{
                ...S.btnGhost as React.CSSProperties, padding: "4px 8px", fontSize: 11, color: T.red, flexShrink: 0,
              }}>✕</button>
            </div>
          );
        })}
      </div>

      {/* Add Schedule Modal */}
      {showAdd && (
        <div style={S.modalBg as React.CSSProperties} onClick={() => setShowAdd(false)}>
          <div style={S.modalBox as React.CSSProperties} onClick={e => e.stopPropagation()}>
            <h3 style={{ fontSize: 18, fontWeight: 700, color: T.text0, marginBottom: 20 }}>Schedule Quota Report</h3>

            <div style={{ marginBottom: 12 }}>
              <label style={S.label as React.CSSProperties}>Frequency</label>
              <div style={{ display: "flex", gap: 8 }}>
                {(["weekly", "monthly"] as const).map(f => (
                  <button key={f} onClick={() => setForm(p => ({ ...p, frequency: f }))} style={{
                    flex: 1, padding: "10px 14px", borderRadius: T.radius.md, fontSize: 12, fontWeight: 600,
                    background: form.frequency === f ? `${T.accent}22` : T.bg3,
                    color: form.frequency === f ? T.accent : T.text3,
                    border: `1px solid ${form.frequency === f ? `${T.accent}66` : T.bg4}`,
                    cursor: "pointer",
                  }}>{f === "weekly" ? "📅 Weekly" : "📆 Monthly"}</button>
                ))}
              </div>
            </div>

            {form.frequency === "weekly" && (
              <div style={{ marginBottom: 12 }}>
                <label style={S.label as React.CSSProperties}>Day of Week</label>
                <select value={form.dayOfWeek} onChange={e => setForm(p => ({ ...p, dayOfWeek: Number(e.target.value) }))}
                  style={S.input as React.CSSProperties}>
                  {DAYS.map((d, i) => <option key={i} value={i}>{d}</option>)}
                </select>
              </div>
            )}

            {form.frequency === "monthly" && (
              <div style={{ marginBottom: 12 }}>
                <label style={S.label as React.CSSProperties}>Day of Month</label>
                <select value={form.dayOfMonth} onChange={e => setForm(p => ({ ...p, dayOfMonth: Number(e.target.value) }))}
                  style={S.input as React.CSSProperties}>
                  {Array.from({ length: 28 }, (_, i) => i + 1).map(d => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
              </div>
            )}

            <div style={{ marginBottom: 20 }}>
              <label style={S.label as React.CSSProperties}>Recipients</label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {TEAM_MEMBERS.map(m => {
                  const selected = (form.recipientIds as string[]).includes(m.id);
                  return (
                    <button key={m.id} onClick={() => toggleRecipient(m.id)} style={{
                      padding: "5px 12px", borderRadius: T.radius.full, fontSize: 11, fontWeight: 600,
                      background: selected ? `${T.accent}22` : T.bg3,
                      color: selected ? T.accent : T.text3,
                      border: `1px solid ${selected ? `${T.accent}66` : T.bg4}`,
                      cursor: "pointer",
                    }}>{m.avatar} {m.name.split(" ")[0]}</button>
                  );
                })}
              </div>
              <div style={{ fontSize: 10, color: T.text3, marginTop: 4 }}>
                {(form.recipientIds as string[]).length === 0 ? "Defaults to managers if none selected" : `${(form.recipientIds as string[]).length} selected`}
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <button onClick={() => setShowAdd(false)} style={S.btnGhost as React.CSSProperties}>Cancel</button>
              <button onClick={handleAdd} style={S.btn as React.CSSProperties}>Create Schedule</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
