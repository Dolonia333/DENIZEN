import { useMemo } from "react";
import { T, S, fmt, type Quota, type QuotaPeriod, TEAM_MEMBERS, getQuotaDaysRemaining } from "@/lib/crm-data";

interface Props {
  quotas: Quota[];
}

const PERIOD_LABELS: Record<QuotaPeriod, string> = {
  weekly: "Weekly", monthly: "Monthly", quarterly: "Quarterly", annual: "Annual",
};

interface Forecast {
  quota: Quota;
  daysElapsed: number;
  daysTotal: number;
  dailyRate: number;
  projectedValue: number;
  projectedPct: number;
  confidence: "high" | "medium" | "low";
  trend: "accelerating" | "steady" | "decelerating";
}

function computeForecast(q: Quota): Forecast {
  const start = new Date(q.startDate).getTime();
  const end = new Date(q.endDate).getTime();
  const now = Date.now();
  const daysTotal = Math.max(1, Math.ceil((end - start) / 86400000));
  const daysElapsed = Math.max(1, Math.ceil((Math.min(now, end) - start) / 86400000));
  const daysRemaining = getQuotaDaysRemaining(q);
  const dailyRate = q.currentValue / daysElapsed;
  const projectedValue = Math.round(dailyRate * daysTotal);
  const projectedPct = Math.round((projectedValue / q.targetValue) * 100);

  // Simulate trend based on pace vs expected
  const expectedPace = (q.targetValue / daysTotal) * daysElapsed;
  const paceRatio = q.currentValue / Math.max(1, expectedPace);
  const trend: Forecast["trend"] = paceRatio > 1.1 ? "accelerating" : paceRatio < 0.8 ? "decelerating" : "steady";

  // Confidence based on data points (days elapsed) and consistency
  const timeRatio = daysElapsed / daysTotal;
  const confidence: Forecast["confidence"] = timeRatio > 0.5 ? "high" : timeRatio > 0.25 ? "medium" : "low";

  return { quota: q, daysElapsed, daysTotal, dailyRate, projectedValue, projectedPct, confidence, trend };
}

const TREND_META = {
  accelerating: { icon: "🚀", label: "Accelerating", color: "#22d3a0" },
  steady: { icon: "➡️", label: "Steady", color: "#4d9ef7" },
  decelerating: { icon: "⚠️", label: "Slowing", color: "#fbbf24" },
};

const CONF_META = {
  high: { label: "High", color: "#22d3a0", bg: "#22d3a018" },
  medium: { label: "Medium", color: "#fbbf24", bg: "#fbbf2418" },
  low: { label: "Low", color: "#f85b5b", bg: "#f85b5b18" },
};

export function QuotaForecast({ quotas }: Props) {
  const forecasts = useMemo(() =>
    quotas
      .filter(q => q.status !== "achieved")
      .map(computeForecast)
      .sort((a, b) => a.projectedPct - b.projectedPct),
    [quotas]
  );

  const avgProjected = forecasts.length > 0
    ? Math.round(forecasts.reduce((s, f) => s + f.projectedPct, 0) / forecasts.length)
    : 0;

  const onTrackCount = forecasts.filter(f => f.projectedPct >= 90).length;
  const atRiskCount = forecasts.filter(f => f.projectedPct >= 60 && f.projectedPct < 90).length;
  const missCount = forecasts.filter(f => f.projectedPct < 60).length;

  if (forecasts.length === 0) return null;

  return (
    <div style={{ ...S.card as React.CSSProperties, padding: "20px 24px", marginBottom: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h3 style={{ fontSize: 14, fontWeight: 700, color: T.text0, margin: 0 }}>🔮 Quota Forecast</h3>
        <div style={{ display: "flex", gap: 12, fontSize: 14 }}>
          <span style={{ color: "#22d3a0" }}>✓ {onTrackCount} on pace</span>
          <span style={{ color: "#fbbf24" }}>⚡ {atRiskCount} at risk</span>
          <span style={{ color: "#f85b5b" }}>✕ {missCount} likely miss</span>
        </div>
      </div>

      {/* Summary Bar */}
      <div style={{
        padding: "12px 18px", borderRadius: T.radius.md, marginBottom: 16,
        background: `linear-gradient(135deg, ${T.bg3}, ${T.bg2})`,
        border: `1px solid ${T.bg4}`,
        display: "flex", justifyContent: "space-between", alignItems: "center",
      }}>
        <div>
          <div style={{ fontSize: 14, color: T.text3, marginBottom: 2 }}>TEAM AVG PROJECTED ATTAINMENT</div>
          <div style={{
            fontSize: 28, fontWeight: 800,
            color: avgProjected >= 90 ? "#22d3a0" : avgProjected >= 60 ? "#fbbf24" : "#f85b5b",
            fontFamily: "'JetBrains Mono', monospace",
          }}>{avgProjected}%</div>
        </div>
        <div style={{ fontSize: 14, color: T.text3, textAlign: "right" }}>
          Based on current daily pace<br />across {forecasts.length} active quotas
        </div>
      </div>

      {/* Forecast Cards */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {forecasts.map(f => {
          const member = TEAM_MEMBERS.find(m => m.id === f.quota.assigneeId);
          const trendMeta = TREND_META[f.trend];
          const confMeta = CONF_META[f.confidence];
          const willHit = f.projectedPct >= 100;
          const projColor = willHit ? "#22d3a0" : f.projectedPct >= 80 ? "#4d9ef7" : f.projectedPct >= 60 ? "#fbbf24" : "#f85b5b";

          return (
            <div key={f.quota.id} style={{
              padding: "14px 18px", borderRadius: T.radius.md,
              background: T.bg2, border: `1px solid ${T.bg4}`,
              borderLeft: `3px solid ${projColor}`,
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{
                    width: 28, height: 28, borderRadius: T.radius.full,
                    background: `linear-gradient(135deg, ${T.purple}, ${T.blue})`,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 14, fontWeight: 700, color: "#fff",
                  }}>{member?.avatar || "?"}</div>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: T.text0 }}>{f.quota.assigneeName}</div>
                    <div style={{ fontSize: 14, color: T.text3 }}>
                      {f.quota.type} · {PERIOD_LABELS[f.quota.period]}
                    </div>
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{
                    fontSize: 20, fontWeight: 800, color: projColor,
                    fontFamily: "'JetBrains Mono', monospace",
                  }}>{f.projectedPct}%</div>
                  <div style={{ fontSize: 14, color: T.text3 }}>projected</div>
                </div>
              </div>

              {/* Projection Bar */}
              <div style={{ position: "relative", height: 6, background: T.bg4, borderRadius: T.radius.full, overflow: "visible", marginBottom: 10 }}>
                {/* Current progress */}
                <div style={{
                  height: "100%", width: `${Math.min(100, Math.round((f.quota.currentValue / f.quota.targetValue) * 100))}%`,
                  borderRadius: T.radius.full, background: projColor, transition: "width 0.4s",
                }} />
                {/* Projected marker */}
                <div style={{
                  position: "absolute", top: -3, height: 12, width: 2,
                  background: projColor, opacity: 0.5,
                  left: `${Math.min(100, f.projectedPct)}%`,
                  borderRadius: 1,
                }} title={`Projected: ${f.projectedPct}%`} />
                {/* 100% marker */}
                <div style={{
                  position: "absolute", top: -1, height: 8, width: 1,
                  background: T.text3, opacity: 0.4, left: "100%",
                }} />
              </div>

              {/* Details Row */}
              <div style={{ display: "flex", gap: 16, fontSize: 14, flexWrap: "wrap" }}>
                <div>
                  <span style={{ color: T.text3 }}>Current: </span>
                  <span style={{ color: T.text1, fontWeight: 600, fontFamily: "'JetBrains Mono', monospace" }}>
                    {f.quota.type === "Revenue" ? fmt(f.quota.currentValue) : f.quota.currentValue}
                  </span>
                </div>
                <div>
                  <span style={{ color: T.text3 }}>Projected: </span>
                  <span style={{ color: projColor, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>
                    {f.quota.type === "Revenue" ? fmt(f.projectedValue) : f.projectedValue}
                  </span>
                  <span style={{ color: T.text3 }}> / {f.quota.type === "Revenue" ? fmt(f.quota.targetValue) : f.quota.targetValue}</span>
                </div>
                <div>
                  <span style={{ color: T.text3 }}>Daily rate: </span>
                  <span style={{ color: T.text2, fontFamily: "'JetBrains Mono', monospace" }}>
                    {f.quota.type === "Revenue" ? fmt(Math.round(f.dailyRate)) : Math.round(f.dailyRate * 10) / 10}
                  </span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <span style={{ color: trendMeta.color }}>{trendMeta.icon}</span>
                  <span style={{ color: trendMeta.color, fontWeight: 600 }}>{trendMeta.label}</span>
                </div>
                <span style={{
                  fontSize: 14, padding: "2px 8px", borderRadius: T.radius.full,
                  background: confMeta.bg, color: confMeta.color, fontWeight: 600,
                }}>Confidence: {confMeta.label}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
