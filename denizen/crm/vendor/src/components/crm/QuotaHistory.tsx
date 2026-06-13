import { useMemo } from "react";
import { T, S, fmt, type Quota, type QuotaPeriod, TEAM_MEMBERS } from "@/lib/crm-data";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";

interface Props {
  quotas: Quota[];
}

const PERIOD_LABELS: Record<QuotaPeriod, string> = {
  weekly: "Wk", monthly: "Mon", quarterly: "Q", annual: "Yr",
};

// Generate simulated historical data based on current quotas
function generateHistory(quotas: Quota[]) {
  const members = [...new Set(quotas.map(q => q.assigneeId))];
  const periods = ["3 periods ago", "2 periods ago", "Last period", "Current"];

  return members.map(memberId => {
    const member = TEAM_MEMBERS.find(m => m.id === memberId);
    const memberQuotas = quotas.filter(q => q.assigneeId === memberId);
    const primaryQuota = memberQuotas.find(q => q.type === "Revenue") || memberQuotas[0];
    if (!primaryQuota) return null;

    const currentPct = Math.round((primaryQuota.currentValue / primaryQuota.targetValue) * 100);

    // Simulate past periods with some variance
    const seed = memberId.charCodeAt(0) + memberId.charCodeAt(memberId.length - 1);
    const pastPcts = [
      Math.min(130, Math.max(40, currentPct + ((seed * 7) % 40) - 20)),
      Math.min(130, Math.max(40, currentPct + ((seed * 13) % 30) - 10)),
      Math.min(130, Math.max(40, currentPct + ((seed * 3) % 25) - 5)),
    ];

    return {
      memberId,
      name: member?.name || memberId,
      avatar: member?.avatar || "?",
      type: primaryQuota.type,
      periods: periods.map((label, i) => ({
        label,
        pct: i < 3 ? pastPcts[i] : currentPct,
        isCurrent: i === 3,
      })),
      trend: currentPct > pastPcts[2] ? "up" : currentPct < pastPcts[2] ? "down" : "flat",
      avg: Math.round([...pastPcts, currentPct].reduce((s, v) => s + v, 0) / 4),
    };
  }).filter(Boolean) as NonNullable<ReturnType<typeof generateHistory>[0]>[];
}

export function QuotaHistory({ quotas }: Props) {
  const history = useMemo(() => generateHistory(quotas), [quotas]);

  const chartData = useMemo(() => {
    const periods = ["3 periods ago", "2 periods ago", "Last period", "Current"];
    return periods.map((label, i) => {
      const entry: Record<string, any> = { period: label };
      history.forEach(h => {
        entry[h.name] = h.periods[i].pct;
      });
      return entry;
    });
  }, [history]);

  const COLORS = ["#4d9ef7", "#22d3a0", "#f0b429", "#f85b5b", "#8b5cf6"];

  if (history.length === 0) return null;

  return (
    <div style={{ ...S.card as React.CSSProperties, padding: "20px 24px", marginBottom: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h3 style={{ fontSize: 14, fontWeight: 700, color: T.text0, margin: 0 }}>📊 Historical Comparison</h3>
        <span style={{ fontSize: 11, color: T.text3 }}>Attainment % across periods</span>
      </div>

      {/* Chart */}
      <div style={{ height: 220, marginBottom: 20 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} barCategoryGap="20%">
            <CartesianGrid strokeDasharray="3 3" stroke={T.bg4} />
            <XAxis dataKey="period" tick={{ fill: T.text3, fontSize: 11 }} axisLine={{ stroke: T.bg4 }} />
            <YAxis tick={{ fill: T.text3, fontSize: 11 }} axisLine={{ stroke: T.bg4 }} tickFormatter={v => `${v}%`} />
            <Tooltip
              contentStyle={{ background: T.bg2, border: `1px solid ${T.bg4}`, borderRadius: T.radius.md, fontSize: 12 }}
              labelStyle={{ color: T.text0, fontWeight: 700 }}
              formatter={(value: number) => [`${value}%`, undefined]}
            />
            <Legend wrapperStyle={{ fontSize: 11, color: T.text2 }} />
            {history.map((h, i) => (
              <Bar key={h.memberId} dataKey={h.name} fill={COLORS[i % COLORS.length]} radius={[4, 4, 0, 0]} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Member Summary Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 10 }}>
        {history.map(h => {
          const trendIcon = h.trend === "up" ? "📈" : h.trend === "down" ? "📉" : "➡️";
          const trendColor = h.trend === "up" ? "#22d3a0" : h.trend === "down" ? "#f85b5b" : "#fbbf24";
          const current = h.periods[3].pct;
          const last = h.periods[2].pct;
          const delta = current - last;

          return (
            <div key={h.memberId} style={{
              padding: "12px 14px", borderRadius: T.radius.md,
              background: T.bg2, border: `1px solid ${T.bg4}`,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <div style={{
                  width: 24, height: 24, borderRadius: T.radius.full,
                  background: `linear-gradient(135deg, ${T.purple}, ${T.blue})`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 9, fontWeight: 700, color: "#fff",
                }}>{h.avatar}</div>
                <span style={{ fontSize: 12, fontWeight: 600, color: T.text0 }}>{h.name}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <div>
                  <span style={{ fontSize: 10, color: T.text3 }}>AVG </span>
                  <span style={{ fontSize: 14, fontWeight: 700, color: T.text1, fontFamily: "'JetBrains Mono', monospace" }}>{h.avg}%</span>
                </div>
                <div style={{ textAlign: "right" }}>
                  <span style={{ fontSize: 16 }}>{trendIcon}</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: trendColor, marginLeft: 4 }}>
                    {delta > 0 ? "+" : ""}{delta}%
                  </span>
                </div>
              </div>
              {/* Mini sparkline of periods */}
              <div style={{ display: "flex", gap: 3, marginTop: 8 }}>
                {h.periods.map((p, i) => (
                  <div key={i} style={{
                    flex: 1, height: 4, borderRadius: 2,
                    background: p.isCurrent
                      ? (p.pct >= 100 ? "#22d3a0" : p.pct >= 70 ? "#4d9ef7" : "#fbbf24")
                      : T.bg4,
                    opacity: p.isCurrent ? 1 : 0.4 + (i * 0.15),
                  }} title={`${p.label}: ${p.pct}%`} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
