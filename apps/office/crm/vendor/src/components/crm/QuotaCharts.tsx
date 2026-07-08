import { useMemo } from "react";
import { T, S, type Quota, TEAM_MEMBERS } from "@/lib/crm-data";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  LineChart, Line, Legend,
} from "recharts";

interface Props {
  quotas: Quota[];
  onDrilldown?: (memberId: string, type?: string) => void;
}

const MEMBER_COLORS = ["#4d9ef7", "#22d3a0", "#fbbf24", "#f85b5b", "#a78bfa"];

export function QuotaCharts({ quotas, onDrilldown }: Props) {
  // ─── BAR: attainment % by member per quota type ──────────────────
  const barData = useMemo(() => {
    const types = [...new Set(quotas.map(q => q.type))];
    return TEAM_MEMBERS
      .filter(m => quotas.some(q => q.assigneeId === m.id))
      .map(m => {
        const row: Record<string, any> = { name: m.name.split(" ")[0] };
        types.forEach(t => {
          const q = quotas.find(q2 => q2.assigneeId === m.id && q2.type === t);
          row[t] = q ? Math.min(120, Math.round((q.currentValue / q.targetValue) * 100)) : 0;
        });
        return row;
      });
  }, [quotas]);

  const quotaTypes = useMemo(() => [...new Set(quotas.map(q => q.type))], [quotas]);

  // ─── RADAR: multi-dimension comparison per member ────────────────
  const radarData = useMemo(() => {
    return quotaTypes.map(t => {
      const row: Record<string, any> = { type: t };
      TEAM_MEMBERS.forEach((m, i) => {
        const q = quotas.find(q2 => q2.assigneeId === m.id && q2.type === t);
        row[m.name.split(" ")[0]] = q ? Math.min(120, Math.round((q.currentValue / q.targetValue) * 100)) : 0;
      });
      return row;
    });
  }, [quotas, quotaTypes]);

  const activeMembers = useMemo(
    () => TEAM_MEMBERS.filter(m => quotas.some(q => q.assigneeId === m.id)),
    [quotas]
  );

  // ─── LINE: simulated history trend (last 6 periods) ─────────────
  const historyData = useMemo(() => {
    const periods = ["Oct", "Nov", "Dec", "Jan", "Feb", "Mar"];
    return periods.map((label, i) => {
      const row: Record<string, any> = { period: label };
      activeMembers.forEach((m, mi) => {
        // Generate a plausible trend: base from current attainment with variance
        const currentQ = quotas.filter(q => q.assigneeId === m.id);
        const avgPct = currentQ.length > 0
          ? Math.round(currentQ.reduce((s, q) => s + (q.currentValue / q.targetValue) * 100, 0) / currentQ.length)
          : 50;
        const base = Math.max(20, avgPct - 30 + (i * (30 / 5)));
        const jitter = ((mi * 7 + i * 13) % 15) - 7;
        row[m.name.split(" ")[0]] = Math.min(120, Math.max(10, Math.round(base + jitter)));
      });
      return row;
    });
  }, [quotas, activeMembers]);

  if (quotas.length === 0) return null;

  const tooltipStyle = {
    contentStyle: { background: T.bg2, border: `1px solid ${T.bg4}`, borderRadius: 8, fontSize: 12, color: T.text1 },
    labelStyle: { color: T.text0, fontWeight: 700, marginBottom: 4 },
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 20 }}>
      {/* Bar Chart */}
      <div style={{ ...S.card as React.CSSProperties, padding: "20px 20px 12px" }}>
        <h4 style={{ fontSize: 13, fontWeight: 700, color: T.text0, margin: "0 0 16px" }}>📊 Attainment by Member</h4>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={barData} barCategoryGap="20%" onClick={(data) => {
            if (data?.activeLabel && onDrilldown) {
              const member = TEAM_MEMBERS.find(m => m.name.split(" ")[0] === data.activeLabel);
              if (member) onDrilldown(member.id);
            }
          }} style={{ cursor: "pointer" }}>
            <CartesianGrid strokeDasharray="3 3" stroke={`${T.bg4}`} />
            <XAxis dataKey="name" tick={{ fill: T.text3, fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: T.text3, fontSize: 10 }} axisLine={false} tickLine={false} unit="%" domain={[0, 120]} />
            <Tooltip {...tooltipStyle} formatter={(v: number) => [`${v}%`, ""]} />
            {quotaTypes.map((t, i) => (
              <Bar key={t} dataKey={t} fill={MEMBER_COLORS[i % MEMBER_COLORS.length]} radius={[4, 4, 0, 0]} style={{ cursor: "pointer" }} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Radar Chart */}
      <div style={{ ...S.card as React.CSSProperties, padding: "20px 20px 12px" }}>
        <h4 style={{ fontSize: 13, fontWeight: 700, color: T.text0, margin: "0 0 16px" }}>🕸 Multi-Dimension Comparison</h4>
        <ResponsiveContainer width="100%" height={220}>
          <RadarChart data={radarData} outerRadius="70%">
            <PolarGrid stroke={T.bg4} />
            <PolarAngleAxis dataKey="type" tick={{ fill: T.text3, fontSize: 10 }} />
            <PolarRadiusAxis tick={{ fill: T.text3, fontSize: 9 }} domain={[0, 120]} />
            {activeMembers.map((m, i) => (
              <Radar
                key={m.id}
                name={m.name.split(" ")[0]}
                dataKey={m.name.split(" ")[0]}
                stroke={MEMBER_COLORS[i % MEMBER_COLORS.length]}
                fill={MEMBER_COLORS[i % MEMBER_COLORS.length]}
                fillOpacity={0.15}
                strokeWidth={2}
              />
            ))}
            <Legend wrapperStyle={{ fontSize: 11, color: T.text2 }} />
            <Tooltip {...tooltipStyle} formatter={(v: number) => [`${v}%`, ""]} />
          </RadarChart>
        </ResponsiveContainer>
      </div>

      {/* Line Chart - History Trends (full width) */}
      <div style={{ ...S.card as React.CSSProperties, padding: "20px 20px 12px", gridColumn: "1 / -1" }}>
        <h4 style={{ fontSize: 13, fontWeight: 700, color: T.text0, margin: "0 0 16px" }}>📈 Attainment Trends (Last 6 Periods)</h4>
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={historyData} onClick={(data) => {
            if (data?.activeLabel && onDrilldown) {
              // Find the member with the highest value at this point for drill-down
              const point = historyData.find(d => d.period === data.activeLabel);
              if (point) {
                let bestMember = activeMembers[0];
                let bestVal = 0;
                activeMembers.forEach(m => {
                  const val = point[m.name.split(" ")[0]] || 0;
                  if (val > bestVal) { bestVal = val; bestMember = m; }
                });
                if (bestMember) onDrilldown(bestMember.id);
              }
            }
          }} style={{ cursor: "pointer" }}>
            <CartesianGrid strokeDasharray="3 3" stroke={`${T.bg4}`} />
            <XAxis dataKey="period" tick={{ fill: T.text3, fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: T.text3, fontSize: 10 }} axisLine={false} tickLine={false} unit="%" domain={[0, 120]} />
            <Tooltip {...tooltipStyle} formatter={(v: number) => [`${v}%`, ""]} />
            {activeMembers.map((m, i) => (
              <Line
                key={m.id}
                type="monotone"
                dataKey={m.name.split(" ")[0]}
                stroke={MEMBER_COLORS[i % MEMBER_COLORS.length]}
                strokeWidth={2}
                dot={{ r: 4, fill: MEMBER_COLORS[i % MEMBER_COLORS.length] }}
                activeDot={{ r: 6, style: { cursor: "pointer" } }}
              />
            ))}
            <Legend wrapperStyle={{ fontSize: 11, color: T.text2 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
