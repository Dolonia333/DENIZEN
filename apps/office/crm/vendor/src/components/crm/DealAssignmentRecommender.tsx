import { useMemo, useState } from "react";
import { T, S, fmt, type Deal, type Quota, TEAM_MEMBERS, getQuotaDaysRemaining } from "@/lib/crm-data";

interface Props {
  deals: Deal[];
  quotas: Quota[];
}

interface RepScore {
  memberId: string;
  name: string;
  avatar: string;
  score: number; // 0-100 overall fit score
  activeDeals: number;
  capacity: number;
  capacityScore: number;
  quotaProgress: number; // % of quota attained
  quotaScore: number;
  avgDealValue: number;
  experienceScore: number;
  wonRate: number;
  reasoning: string[];
}

function scoreReps(deals: Deal[], quotas: Quota[], dealValue: number): RepScore[] {
  return TEAM_MEMBERS.filter(m => m.role !== "manager").map(member => {
    const memberDeals = deals.filter(d => d.ownerId === member.id);
    const active = memberDeals.filter(d => !["Closed Won", "Closed Lost"].includes(d.stage));
    const won = memberDeals.filter(d => d.stage === "Closed Won");
    const lost = memberDeals.filter(d => d.stage === "Closed Lost");
    const totalClosed = won.length + lost.length;
    const wonRate = totalClosed > 0 ? Math.round((won.length / totalClosed) * 100) : 50;

    // Capacity score: fewer active deals = higher score
    const maxCapacity = 12;
    const capacityPct = active.length / maxCapacity;
    const capacityScore = Math.max(0, Math.round((1 - capacityPct) * 100));

    // Quota progress score: being behind means they need deals more
    const revenueQuota = quotas.find(q => q.assigneeId === member.id && q.type === "Revenue");
    const quotaProgress = revenueQuota
      ? Math.round((revenueQuota.currentValue / revenueQuota.targetValue) * 100)
      : 50;
    // Score higher if behind (needs the deal), but not too far behind (overwhelmed)
    const quotaScore = quotaProgress < 40 ? 70 : quotaProgress < 70 ? 90 : quotaProgress < 100 ? 60 : 30;

    // Experience score: based on avg deal value similarity
    const avgValue = won.length > 0
      ? won.reduce((s, d) => s + d.value, 0) / won.length
      : active.length > 0
        ? active.reduce((s, d) => s + d.value, 0) / active.length
        : 20000;
    const valueSimilarity = 1 - Math.min(1, Math.abs(avgValue - dealValue) / Math.max(avgValue, dealValue, 1));
    const experienceScore = Math.round(valueSimilarity * 100);

    // Overall score (weighted)
    const score = Math.round(
      capacityScore * 0.35 +
      quotaScore * 0.25 +
      experienceScore * 0.20 +
      wonRate * 0.20
    );

    const reasoning: string[] = [];
    if (capacityScore > 70) reasoning.push("Has bandwidth for new deals");
    else if (capacityScore < 30) reasoning.push("Currently at high capacity");
    if (quotaProgress < 60) reasoning.push("Needs deals to hit quota target");
    if (experienceScore > 70) reasoning.push("Experienced with similar deal sizes");
    if (wonRate > 70) reasoning.push(`Strong ${wonRate}% win rate`);
    if (active.length === 0) reasoning.push("No active deals — available immediately");

    return {
      memberId: member.id,
      name: member.name,
      avatar: member.avatar,
      score,
      activeDeals: active.length,
      capacity: maxCapacity,
      capacityScore,
      quotaProgress,
      quotaScore,
      avgDealValue: Math.round(avgValue),
      experienceScore,
      wonRate,
      reasoning,
    };
  }).sort((a, b) => b.score - a.score);
}

export function DealAssignmentRecommender({ deals, quotas }: Props) {
  const [dealValue, setDealValue] = useState(50000);
  const [expanded, setExpanded] = useState(true);

  const recommendations = useMemo(() => scoreReps(deals, quotas, dealValue), [deals, quotas, dealValue]);
  const topRec = recommendations[0];

  const presets = [
    { label: "Small", value: 10000 },
    { label: "Medium", value: 50000 },
    { label: "Large", value: 100000 },
    { label: "Enterprise", value: 250000 },
  ];

  return (
    <div style={{ ...S.card as React.CSSProperties, padding: "20px 24px", marginBottom: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: expanded ? 16 : 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, color: T.text0, margin: 0 }}>🎯 Deal Assignment AI</h3>
          {topRec && (
            <span style={{
              fontSize: 10, padding: "2px 10px", borderRadius: T.radius.full,
              background: "#22d3a018", color: "#22d3a0", fontWeight: 600,
            }}>Best: {topRec.name} ({topRec.score}%)</span>
          )}
        </div>
        <button onClick={() => setExpanded(e => !e)} style={{
          ...S.btnGhost as React.CSSProperties, fontSize: 10, padding: "4px 10px",
        }}>{expanded ? "▲ Collapse" : "▼ Expand"}</button>
      </div>

      {expanded && (
        <>
          {/* Deal Value Selector */}
          <div style={{
            display: "flex", alignItems: "center", gap: 12, marginBottom: 16,
            padding: "12px 16px", borderRadius: T.radius.md,
            background: T.bg3, border: `1px solid ${T.bg4}`,
          }}>
            <div style={{ fontSize: 11, color: T.text3, fontWeight: 600, whiteSpace: "nowrap" }}>DEAL SIZE:</div>
            <input
              type="range" min={5000} max={500000} step={5000} value={dealValue}
              onChange={e => setDealValue(Number(e.target.value))}
              style={{ flex: 1, accentColor: T.accent }}
            />
            <div style={{
              fontSize: 16, fontWeight: 800, color: T.accent,
              fontFamily: "'JetBrains Mono', monospace", minWidth: 90, textAlign: "right",
            }}>{fmt(dealValue)}</div>
          </div>

          {/* Presets */}
          <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
            {presets.map(p => (
              <button key={p.label} onClick={() => setDealValue(p.value)} style={{
                padding: "4px 12px", borderRadius: T.radius.full, fontSize: 10, fontWeight: 600,
                background: dealValue === p.value ? `${T.accent}22` : T.bg3,
                color: dealValue === p.value ? T.accent : T.text3,
                border: `1px solid ${dealValue === p.value ? `${T.accent}66` : T.bg4}`,
                cursor: "pointer",
              }}>{p.label} ({fmt(p.value)})</button>
            ))}
          </div>

          {/* Recommendations */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {recommendations.map((rec, idx) => {
              const isTop = idx === 0;
              return (
                <div key={rec.memberId} style={{
                  padding: "14px 18px", borderRadius: T.radius.md,
                  background: isTop ? `${T.green}08` : T.bg2,
                  border: `1px solid ${isTop ? `${T.green}44` : T.bg4}`,
                  borderLeft: `3px solid ${isTop ? T.green : idx === 1 ? T.blue : T.bg5}`,
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      {isTop && <span style={{ fontSize: 14 }}>🏆</span>}
                      <div style={{
                        width: 28, height: 28, borderRadius: T.radius.full,
                        background: `linear-gradient(135deg, ${T.purple}, ${T.blue})`,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: 10, fontWeight: 700, color: "#fff",
                      }}>{rec.avatar}</div>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: T.text0 }}>
                          {rec.name} {isTop && <span style={{ fontSize: 10, color: T.green, fontWeight: 600 }}>— Recommended</span>}
                        </div>
                        <div style={{ fontSize: 11, color: T.text3 }}>
                          {rec.reasoning.slice(0, 2).join(" · ")}
                        </div>
                      </div>
                    </div>
                    <div style={{
                      fontSize: 20, fontWeight: 800, fontFamily: "'JetBrains Mono', monospace",
                      color: rec.score >= 70 ? T.green : rec.score >= 50 ? T.accent : T.red,
                    }}>{rec.score}%</div>
                  </div>

                  {/* Score Breakdown */}
                  <div style={{ display: "flex", gap: 12, fontSize: 10, flexWrap: "wrap" }}>
                    {[
                      { label: "Capacity", value: rec.capacityScore, detail: `${rec.activeDeals}/${rec.capacity}` },
                      { label: "Quota Need", value: rec.quotaScore, detail: `${rec.quotaProgress}% attained` },
                      { label: "Fit", value: rec.experienceScore, detail: `Avg ${fmt(rec.avgDealValue)}` },
                      { label: "Win Rate", value: rec.wonRate, detail: `${rec.wonRate}%` },
                    ].map(s => (
                      <div key={s.label} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <span style={{ color: T.text3 }}>{s.label}:</span>
                        <div style={{
                          width: 40, height: 4, background: T.bg4, borderRadius: T.radius.full, overflow: "hidden",
                        }}>
                          <div style={{
                            width: `${s.value}%`, height: "100%", borderRadius: T.radius.full,
                            background: s.value >= 70 ? T.green : s.value >= 40 ? T.accent : T.red,
                          }} />
                        </div>
                        <span style={{ color: T.text2, fontFamily: "'JetBrains Mono', monospace" }}>{s.detail}</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
