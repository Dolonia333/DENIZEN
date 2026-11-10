import { T, fmt, type Goal, type Deal, type Contact } from "@/lib/crm-data";

interface Props {
  goals: Goal[];
  deals: Deal[];
  contacts: Contact[];
  onNavigate?: (tab: string) => void;
}

function goalCurrent(g: Goal, deals: Deal[], contacts: Contact[]): number {
  if (g.metric === "new_contacts") return contacts.length;
  if (g.metric === "deals_won") return deals.filter((d) => d.stage === "Closed Won").length;
  if (g.metric === "pipeline_value") {
    return deals
      .filter((d) => !/closed won|closed lost/i.test(d.stage))
      .reduce((s, d) => s + d.value, 0);
  }
  if (g.metric === "mrr") {
    return deals.filter((d) => d.stage === "Closed Won").reduce((s, d) => s + d.value / 12, 0);
  }
  return g.current;
}

export function GoalsPanel({ goals, deals, contacts, onNavigate }: Props) {
  if (!goals.length) return null;
  return (
    <div className="crm-panel" style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: T.text0 }}>Goals</div>
        {onNavigate && (
          <button onClick={() => onNavigate("analytics")} style={{ background: "none", border: "none", color: T.accent, fontSize: 11, cursor: "pointer" }}>Analytics →</button>
        )}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 12 }}>
        {goals.map((g) => {
          const current = goalCurrent(g, deals, contacts);
          const pct = g.target > 0 ? Math.min(100, Math.round((current / g.target) * 100)) : 0;
          const isMoney = g.metric === "mrr" || g.metric === "pipeline_value";
          return (
            <div key={g.id} style={{ background: T.bg3, borderRadius: T.radius.md, padding: "12px 14px", border: `1px solid ${T.bg4}` }}>
              <div style={{ fontSize: 11, color: T.text3 }}>{g.label}</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: T.text0, marginTop: 4 }}>
                {isMoney ? fmt(current) : Math.round(current)}
                <span style={{ fontSize: 12, color: T.text3, fontWeight: 500 }}> / {isMoney ? fmt(g.target) : g.target}</span>
              </div>
              <div style={{ height: 4, background: T.bg4, borderRadius: 2, marginTop: 8, overflow: "hidden" }}>
                <div style={{ width: `${pct}%`, height: "100%", background: g.color, borderRadius: 2 }} />
              </div>
              <div style={{ fontSize: 10, color: T.text3, marginTop: 4 }}>{g.period} · {pct}%</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
