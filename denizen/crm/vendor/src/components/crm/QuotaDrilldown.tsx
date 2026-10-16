import { T, S, fmt, type Quota, TEAM_MEMBERS, getQuotaDaysRemaining } from "@/lib/crm-data";

interface Props {
  quota: Quota | null;
  memberQuotas: Quota[];
  onClose: () => void;
}

const STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  "on-track": { label: "On Track", color: "#22d3a0", bg: "#22d3a018" },
  "at-risk": { label: "At Risk", color: "#fbbf24", bg: "#fbbf2418" },
  "behind": { label: "Behind", color: "#f85b5b", bg: "#f85b5b18" },
  "achieved": { label: "Achieved", color: "#4d9ef7", bg: "#4d9ef718" },
};

const PERIOD_LABELS: Record<string, string> = {
  weekly: "Weekly", monthly: "Monthly", quarterly: "Quarterly", annual: "Annual",
};

export function QuotaDrilldown({ quota, memberQuotas, onClose }: Props) {
  if (!quota) return null;

  const member = TEAM_MEMBERS.find(m => m.id === quota.assigneeId);
  const pct = Math.min(100, Math.round((quota.currentValue / quota.targetValue) * 100));
  const meta = STATUS_META[quota.status] || STATUS_META["on-track"];
  const days = getQuotaDaysRemaining(quota);
  const allMemberQuotas = memberQuotas.filter(q => q.assigneeId === quota.assigneeId);
  const avgAttainment = allMemberQuotas.length > 0
    ? Math.round(allMemberQuotas.reduce((s, q) => s + Math.min(100, (q.currentValue / q.targetValue) * 100), 0) / allMemberQuotas.length)
    : 0;

  return (
    <>
      {/* Backdrop */}
      <div onClick={onClose} style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 998,
        animation: "fade-in 0.2s ease-out",
      }} />

      {/* Panel */}
      <div style={{
        position: "fixed", top: 0, right: 0, bottom: 0, width: 420, maxWidth: "90vw",
        background: T.bg1, borderLeft: `1px solid ${T.bg4}`, zIndex: 999,
        overflowY: "auto", padding: "28px 24px",
        animation: "slide-in-right 0.3s ease-out",
      }}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
              <div style={{
                width: 40, height: 40, borderRadius: T.radius.full,
                background: `linear-gradient(135deg, ${T.purple}, ${T.blue})`,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 14, fontWeight: 700, color: "#fff",
              }}>{member?.avatar || "?"}</div>
              <div>
                <div style={{ fontSize: 16, fontWeight: 700, color: T.text0 }}>{quota.assigneeName}</div>
                <div style={{ fontSize: 14, color: T.text3 }}>{member?.role === "manager" ? "Manager" : "Sales Rep"}</div>
              </div>
            </div>
          </div>
          <button aria-label="Close" onClick={onClose} style={{
            ...S.btnGhost as React.CSSProperties, fontSize: 16, padding: "4px 8px",
          }}>✕</button>
        </div>

        {/* Primary quota detail */}
        <div style={{
          ...S.card as React.CSSProperties, padding: "20px 22px", marginBottom: 20,
          borderLeft: `4px solid ${meta.color}`,
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div style={{ fontSize: 17, fontWeight: 700, color: T.text0 }}>{quota.type}</div>
            <span style={{
              fontSize: 14, padding: "3px 10px", borderRadius: T.radius.full,
              background: meta.bg, color: meta.color, fontWeight: 600,
            }}>{meta.label}</span>
          </div>

          {/* Big number */}
          <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginBottom: 16 }}>
            <span style={{ fontSize: 36, fontWeight: 800, color: meta.color, fontFamily: "'JetBrains Mono', monospace" }}>
              {pct}%
            </span>
            <span style={{ fontSize: 14, color: T.text3 }}>attainment</span>
          </div>

          {/* Progress bar */}
          <div style={{ position: "relative", height: 10, background: T.bg4, borderRadius: T.radius.full, overflow: "hidden", marginBottom: 12 }}>
            <div style={{
              height: "100%", width: `${pct}%`, borderRadius: T.radius.full,
              background: `linear-gradient(90deg, ${meta.color}cc, ${meta.color})`,
              transition: "width 0.6s cubic-bezier(0.4,0,0.2,1)",
            }} />
            {quota.stretchGoal && (
              <div style={{
                position: "absolute", top: 0, bottom: 0,
                left: `${Math.min(100, (quota.targetValue / quota.stretchGoal) * 100)}%`,
                width: 2, background: T.text3, opacity: 0.5,
              }} title="Target line" />
            )}
          </div>

          {/* Stats grid */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            {[
              { label: "Current", value: quota.type === "Revenue" ? fmt(quota.currentValue) : String(quota.currentValue) },
              { label: "Target", value: quota.type === "Revenue" ? fmt(quota.targetValue) : String(quota.targetValue) },
              { label: "Period", value: PERIOD_LABELS[quota.period] || quota.period },
              { label: "Days Left", value: `${days} day${days !== 1 ? "s" : ""}` },
              ...(quota.stretchGoal ? [{ label: "Stretch Goal", value: quota.type === "Revenue" ? fmt(quota.stretchGoal) : String(quota.stretchGoal) }] : []),
              { label: "Start Date", value: quota.startDate },
              { label: "End Date", value: quota.endDate },
            ].map(s => (
              <div key={s.label}>
                <div style={{ fontSize: 14, color: T.text3, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 2 }}>{s.label}</div>
                <div style={{ fontSize: 14, fontWeight: 600, color: T.text1, fontFamily: "'JetBrains Mono', monospace" }}>{s.value}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Other quotas for this member */}
        {allMemberQuotas.length > 1 && (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <h4 style={{ fontSize: 14, fontWeight: 700, color: T.text0, margin: 0 }}>All Quotas for {quota.assigneeName.split(" ")[0]}</h4>
              <span style={{ fontSize: 14, color: T.text3 }}>Avg: {avgAttainment}%</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {allMemberQuotas.map(q => {
                const qPct = Math.min(100, Math.round((q.currentValue / q.targetValue) * 100));
                const qMeta = STATUS_META[q.status] || STATUS_META["on-track"];
                const isActive = q.id === quota.id;
                return (
                  <div key={q.id} style={{
                    ...S.card as React.CSSProperties, padding: "12px 16px",
                    border: isActive ? `1px solid ${qMeta.color}44` : undefined,
                    background: isActive ? `${qMeta.color}08` : undefined,
                  }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                      <span style={{ fontSize: 14, fontWeight: 600, color: T.text0 }}>{q.type}</span>
                      <span style={{ fontSize: 14, fontWeight: 700, color: qMeta.color, fontFamily: "'JetBrains Mono', monospace" }}>{qPct}%</span>
                    </div>
                    <div style={{ height: 5, background: T.bg4, borderRadius: T.radius.full, overflow: "hidden" }}>
                      <div style={{
                        height: "100%", width: `${qPct}%`, borderRadius: T.radius.full,
                        background: qMeta.color, transition: "width 0.4s ease",
                      }} />
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4, fontSize: 14, color: T.text3 }}>
                      <span>{PERIOD_LABELS[q.period]}</span>
                      <span>{q.type === "Revenue" ? fmt(q.currentValue) : q.currentValue} / {q.type === "Revenue" ? fmt(q.targetValue) : q.targetValue}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        <style>{`
          @keyframes slide-in-right { from { transform: translateX(100%); } to { transform: translateX(0); } }
          @keyframes fade-in { from { opacity: 0; } to { opacity: 1; } }
        `}</style>
      </div>
    </>
  );
}
