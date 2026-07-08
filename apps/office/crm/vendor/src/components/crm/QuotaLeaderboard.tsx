import { useMemo } from "react";
import { T, S, fmt, type Quota, TEAM_MEMBERS } from "@/lib/crm-data";

interface Props {
  quotas: Quota[];
}

const RANK_MEDALS = ["🥇", "🥈", "🥉"];

export function QuotaLeaderboard({ quotas }: Props) {
  const rankings = useMemo(() => {
    const memberMap = new Map<string, { id: string; name: string; avatar: string; totalPct: number; count: number; achieved: number }>();

    for (const q of quotas) {
      const existing = memberMap.get(q.assigneeId);
      const pct = Math.min(100, Math.round((q.currentValue / q.targetValue) * 100));
      const isAchieved = q.currentValue >= q.targetValue ? 1 : 0;
      if (existing) {
        existing.totalPct += pct;
        existing.count += 1;
        existing.achieved += isAchieved;
      } else {
        const member = TEAM_MEMBERS.find(m => m.id === q.assigneeId);
        memberMap.set(q.assigneeId, {
          id: q.assigneeId,
          name: q.assigneeName,
          avatar: member?.avatar || "??",
          totalPct: pct,
          count: 1,
          achieved: isAchieved,
        });
      }
    }

    return Array.from(memberMap.values())
      .map(m => ({ ...m, avgPct: Math.round(m.totalPct / m.count) }))
      .sort((a, b) => b.avgPct - a.avgPct);
  }, [quotas]);

  if (rankings.length === 0) return null;

  const maxPct = rankings[0]?.avgPct || 100;

  return (
    <div style={{ ...S.card as React.CSSProperties, padding: "20px 24px", marginBottom: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h3 style={{ fontSize: 14, fontWeight: 700, color: T.text0, margin: 0 }}>🏆 Quota Leaderboard</h3>
        <span style={{ fontSize: 11, color: T.text3 }}>Avg. attainment across all quotas</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {rankings.map((r, i) => {
          const barWidth = maxPct > 0 ? (r.avgPct / maxPct) * 100 : 0;
          const barColor = r.avgPct >= 100 ? "#4d9ef7" : r.avgPct >= 70 ? "#22d3a0" : r.avgPct >= 40 ? "#fbbf24" : "#f85b5b";
          return (
            <div key={r.id} style={{
              display: "flex", alignItems: "center", gap: 12,
              padding: "10px 14px", borderRadius: T.radius.md,
              background: i === 0 ? `${barColor}08` : "transparent",
              border: i === 0 ? `1px solid ${barColor}22` : `1px solid transparent`,
              transition: "all 0.2s ease",
            }}>
              {/* Rank */}
              <div style={{ fontSize: 18, minWidth: 28, textAlign: "center" }}>
                {i < 3 ? RANK_MEDALS[i] : <span style={{ fontSize: 13, fontWeight: 700, color: T.text3 }}>#{i + 1}</span>}
              </div>

              {/* Avatar */}
              <div style={{
                width: 32, height: 32, borderRadius: T.radius.full,
                background: `linear-gradient(135deg, ${T.purple}, ${T.blue})`,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 11, fontWeight: 700, color: "#fff", flexShrink: 0,
              }}>{r.avatar}</div>

              {/* Name & stats */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: T.text0 }}>{r.name}</span>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    {r.achieved > 0 && (
                      <span style={{ fontSize: 10, color: "#4d9ef7", fontWeight: 600 }}>
                        {r.achieved} achieved
                      </span>
                    )}
                    <span style={{ fontSize: 13, fontWeight: 800, color: barColor, fontFamily: "'JetBrains Mono', monospace" }}>
                      {r.avgPct}%
                    </span>
                  </div>
                </div>
                {/* Bar */}
                <div style={{ position: "relative", height: 6, background: T.bg4, borderRadius: T.radius.full, overflow: "hidden" }}>
                  <div style={{
                    height: "100%", width: `${barWidth}%`, borderRadius: T.radius.full,
                    background: `linear-gradient(90deg, ${barColor}cc, ${barColor})`,
                    transition: "width 0.6s cubic-bezier(0.4,0,0.2,1)",
                  }} />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
