import type { CSSProperties } from "react";
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid,
} from "recharts";
import { T, fmt } from "@/lib/crm-data";
import { shareToGlobalChat } from "@/lib/global-chat-bridge";

type StageRow = { name: string; value: number; count: number; fill: string };
type TrendRow = { month: string; revenue: number; pipeline: number };
type HealthRow = { name: string; value: number; fill: string };

const ChartTooltip = ({ active, payload, label }: { active?: boolean; payload?: { name: string; value: number; color: string; payload?: Record<string, unknown> }[]; label?: string }) => {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload || {};
  const count = typeof row.count === "number" ? row.count : null;
  const healthShare = typeof row.value === "number" && payload[0]?.name !== "Value" ? null : null;
  return (
    <div style={{ background: T.bg2, border: `1px solid ${T.bg4}`, borderRadius: T.radius.md, padding: "8px 12px", fontSize: 14, minWidth: 140 }}>
      <div style={{ color: T.text3, marginBottom: 4, fontWeight: 600 }}>{label}</div>
      {payload.map((p, i) => (
        <div key={i} style={{ color: p.color, fontWeight: 600, marginBottom: 2 }}>
          {p.name}: {typeof p.value === "number" && p.value > 100 ? fmt(p.value) : p.value}
        </div>
      ))}
      {count != null && (
        <div style={{ color: T.text3, marginTop: 4 }}>{count} deal{count === 1 ? "" : "s"} in stage</div>
      )}
      {typeof row.avgProbability === "number" && (
        <div style={{ color: T.text3 }}>Avg probability {row.avgProbability}%</div>
      )}
    </div>
  );
};

export interface DashboardChartsProps {
  cardStyle: CSSProperties;
  revenueTrend: TrendRow[];
  stageData: StageRow[];
  healthData: HealthRow[];
  pipelineValue: number;
  weightedPipeline: number;
  wonValue: number;
  openDealsCount: number;
  onNavigate: (tab: string) => void;
}

export function DashboardCharts({
  cardStyle,
  revenueTrend,
  stageData,
  healthData,
  pipelineValue,
  weightedPipeline,
  wonValue,
  openDealsCount,
  onNavigate,
}: DashboardChartsProps) {
  return (
    <>
      <div className="crm-dashboard-grid" style={{ display: "grid", gap: 14, marginBottom: 14 }}>
        <div style={cardStyle}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: T.text0 }}>Revenue Trend</div>
            <button aria-label="Action"
              onClick={() => shareToGlobalChat({
                title: "Revenue Trend", type: "chart", color: T.accent,
                snapshot: {
                  Pipeline: fmt(pipelineValue),
                  Weighted: fmt(weightedPipeline),
                  Won: fmt(wonValue),
                  "Open Deals": `${openDealsCount}`,
                },
                status: "In Progress",
              })}
              style={{ fontSize: 14, color: T.purple, background: `${T.purple}12`, border: `1px solid ${T.purple}22`, borderRadius: T.radius.sm, padding: "4px 10px", cursor: "pointer", fontWeight: 600 }}
            >
              💬 Share
            </button>
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={revenueTrend}>
              <defs>
                <linearGradient id="gradRevenue" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={T.accent} stopOpacity={0.3} />
                  <stop offset="100%" stopColor={T.accent} stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gradPipeline" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={T.purple} stopOpacity={0.2} />
                  <stop offset="100%" stopColor={T.purple} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={T.bg4} />
              <XAxis dataKey="month" tick={{ fontSize: 14, fill: T.text3 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 14, fill: T.text3 }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
              <Tooltip content={<ChartTooltip />} />
              <Area type="monotone" dataKey="revenue" name="Revenue" stroke={T.accent} fill="url(#gradRevenue)" strokeWidth={2} />
              <Area type="monotone" dataKey="pipeline" name="Pipeline" stroke={T.purple} fill="url(#gradPipeline)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
          <div style={{ display: "flex", gap: 16, marginTop: 8, justifyContent: "center" }}>
            {[["Revenue", T.accent], ["Pipeline", T.purple]].map(([label, color]) => (
              <div key={label} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 14, color: T.text3 }}>
                <div style={{ width: 8, height: 3, borderRadius: 2, background: color as string }} />{label}
              </div>
            ))}
          </div>
        </div>

        <div style={cardStyle}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: T.text0 }}>Pipeline by Stage</div>
                <div style={{ fontSize: 14, color: T.text3, marginTop: 2 }}>
                  {stageData.reduce((s, r) => s + (r.count || 0), 0)} open deals · hover for value + count
                </div>
              </div>
              <button aria-label="Action"
                onClick={() => shareToGlobalChat({
                  title: "Pipeline by Stage", type: "chart", color: T.purple,
                  snapshot: Object.fromEntries(stageData.map((s) => [s.name, fmt(s.value)])),
                  status: "In Progress",
                })}
                style={{ fontSize: 14, color: T.purple, background: `${T.purple}12`, border: `1px solid ${T.purple}22`, borderRadius: T.radius.sm, padding: "4px 10px", cursor: "pointer", fontWeight: 600 }}
              >
                💬 Share
              </button>
            </div>
            <button aria-label="Action" onClick={() => onNavigate("sales")} style={{ fontSize: 14, color: T.accent, background: "none", border: "none", cursor: "pointer" }}>View board →</button>
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={stageData} barSize={28}>
              <CartesianGrid strokeDasharray="3 3" stroke={T.bg4} vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 14, fill: T.text3 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 14, fill: T.text3 }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
              <Tooltip content={<ChartTooltip />} />
              <Bar dataKey="value" name="Value" radius={[4, 4, 0, 0]}>
                {stageData.map((s, i) => <Cell key={i} fill={s.fill} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div style={cardStyle}>
        <div style={{ fontSize: 14, fontWeight: 600, color: T.text0, marginBottom: 8 }}>Deal Health</div>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <ResponsiveContainer width={120} height={120}>
            <PieChart>
              <Pie data={healthData} cx="50%" cy="50%" innerRadius={30} outerRadius={50} dataKey="value" strokeWidth={0}>
                {healthData.map((d, i) => <Cell key={i} fill={d.fill} />)}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {healthData.map((d) => (
              <div key={d.name} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14 }}>
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: d.fill }} />
                <span style={{ color: T.text2 }}>{d.name}</span>
                <span style={{ color: T.text0, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>{d.value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
