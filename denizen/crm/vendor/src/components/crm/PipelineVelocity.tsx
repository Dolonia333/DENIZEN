import { useMemo } from "react";
import { T, fmt, STAGES, STAGE_COLORS, type Deal } from "@/lib/crm-data";
import { BarChart, Bar, ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid, Cell } from "recharts";

interface Props {
  deals: Deal[];
}

const ChartTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: T.bg2, border: `1px solid ${T.bg4}`, borderRadius: T.radius.md, padding: "8px 12px", fontSize: 14 }}>
      <div style={{ color: T.text3, marginBottom: 4 }}>{label}</div>
      {payload.map((p: any, i: number) => (
        <div key={i} style={{ color: p.color || p.fill, fontWeight: 600 }}>{p.name}: {p.value} days</div>
      ))}
    </div>
  );
};

export function PipelineVelocity({ deals }: Props) {
  const activeStages = STAGES.filter(s => !["Closed Won", "Closed Lost"].includes(s));

  const velocityData = useMemo(() => {
    return activeStages.map(stage => {
      const stageDeals = deals.filter(d => d.stage === stage);
      const avgDays = stageDeals.length > 0
        ? Math.round(stageDeals.reduce((s, d) => s + d.daysInStage, 0) / stageDeals.length)
        : 0;
      const maxDays = stageDeals.length > 0
        ? Math.max(...stageDeals.map(d => d.daysInStage))
        : 0;
      const count = stageDeals.length;
      const totalValue = stageDeals.reduce((s, d) => s + d.value, 0);
      return { stage, avgDays, maxDays, count, totalValue, color: STAGE_COLORS[stage] || T.bg4 };
    });
  }, [deals]);

  const totalCycleDays = velocityData.reduce((s, v) => s + v.avgDays, 0);
  const bottleneck = velocityData.reduce((max, v) => v.avgDays > max.avgDays ? v : max, velocityData[0]);
  const fastestStage = velocityData.filter(v => v.avgDays > 0).reduce((min, v) => v.avgDays < min.avgDays ? v : min, velocityData.find(v => v.avgDays > 0) || velocityData[0]);

  const wonDeals = deals.filter(d => d.stage === "Closed Won");
  const avgDealCycle = wonDeals.length > 0 ? Math.round(wonDeals.reduce((s, d) => s + d.daysInStage, 0) / wonDeals.length) : totalCycleDays;

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: T.text0, margin: 0 }}>⚡ Pipeline Velocity</h2>
        <p style={{ fontSize: 14, color: T.text3, marginTop: 4 }}>
          Average days deals spend in each stage — find where deals get stuck
        </p>
      </div>

      {/* KPI Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10, marginBottom: 20 }}>
        {[
          { label: "Est. Cycle Time", value: `${totalCycleDays}d`, color: T.blue, sub: "Sum of avg stage durations" },
          { label: "Bottleneck", value: bottleneck?.stage || "—", color: T.red, sub: `${bottleneck?.avgDays || 0} avg days` },
          { label: "Fastest Stage", value: fastestStage?.stage || "—", color: T.green, sub: `${fastestStage?.avgDays || 0} avg days` },
          { label: "Won Deal Avg", value: `${avgDealCycle}d`, color: T.accent, sub: `${wonDeals.length} closed deals` },
        ].map(k => (
          <div key={k.label} style={{
            background: `linear-gradient(145deg,${T.bg2},${T.bg3}88)`,
            border: `1px solid ${T.bg4}`, borderRadius: T.radius.md, padding: "14px 16px",
          }}>
            <div style={{ fontSize: 14, color: T.text3, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>{k.label}</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: k.color, fontFamily: "'JetBrains Mono', monospace", marginTop: 4 }}>{k.value}</div>
            <div style={{ fontSize: 14, color: T.text3, marginTop: 2 }}>{k.sub}</div>
          </div>
        ))}
      </div>

      {/* Bar chart */}
      <div style={{
        background: `linear-gradient(145deg,${T.bg2},${T.bg3}88)`,
        border: `1px solid ${T.bg4}`, borderRadius: T.radius.lg, padding: "20px 16px", marginBottom: 16,
      }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: T.text1, marginBottom: 16 }}>Average Days per Stage</div>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={velocityData} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={T.bg4} />
            <XAxis dataKey="stage" tick={{ fill: T.text3, fontSize: 14 }} axisLine={{ stroke: T.bg4 }} />
            <YAxis tick={{ fill: T.text3, fontSize: 14 }} axisLine={{ stroke: T.bg4 }} />
            <Tooltip content={<ChartTooltip />} />
            <Bar dataKey="avgDays" name="Avg Days" radius={[4, 4, 0, 0]}>
              {velocityData.map((entry, i) => (
                <Cell key={i} fill={entry.color} fillOpacity={0.8} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>


      {/* Current-stage conversion ladder (snapshot, not historical cohort) */}
      <div style={{
        background: `linear-gradient(145deg,${T.bg2},${T.bg3}88)`,
        border: `1px solid ${T.bg4}`, borderRadius: T.radius.lg, padding: "16px", marginBottom: 16,
      }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: T.text1, marginBottom: 4 }}>Stage occupancy ladder</div>
        <div style={{ fontSize: 14, color: T.text3, marginBottom: 12 }}>
          Share of open deals currently sitting in each stage (live snapshot — not historical cohort conversion)
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {velocityData.map((v, i) => {
            const openTotal = velocityData.reduce((s, x) => s + x.count, 0) || 1;
            const share = Math.round((v.count / openTotal) * 100);
            const next = velocityData[i + 1];
            const step = next && v.count ? Math.round((next.count / v.count) * 100) : null;
            return (
              <div key={`ladder-${v.stage}`}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, marginBottom: 3 }}>
                  <span style={{ color: T.text1, fontWeight: 600 }}>{v.stage}</span>
                  <span style={{ color: T.text3, fontFamily: "'JetBrains Mono', monospace" }}>
                    {v.count} · {share}% of open
                    {step != null ? ` · → next ${step}%` : ""}
                  </span>
                </div>
                <div style={{ height: 6, background: T.bg4, borderRadius: 3, overflow: "hidden" }}>
                  <div style={{ width: `${share}%`, height: "100%", background: v.color, borderRadius: 3 }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Stage detail cards */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {velocityData.map(v => {
          const isBottleneck = v.stage === bottleneck?.stage && v.avgDays > 0;
          return (
            <div key={v.stage} style={{
              display: "flex", alignItems: "center", gap: 14,
              background: `linear-gradient(145deg,${T.bg2},${T.bg3}88)`,
              border: `1px solid ${isBottleneck ? T.red + "44" : T.bg4}`,
              borderRadius: T.radius.md, padding: "12px 16px",
            }}>
              <div style={{ width: 10, height: 10, borderRadius: T.radius.full, background: v.color, flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: T.text0 }}>{v.stage}</span>
                  {isBottleneck && (
                    <span style={{ fontSize: 14, padding: "1px 6px", borderRadius: T.radius.sm, background: `${T.red}18`, color: T.red, fontWeight: 700 }}>
                      BOTTLENECK
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 14, color: T.text3, marginTop: 2 }}>
                  {v.count} deals · {fmt(v.totalValue)} value · max {v.maxDays}d
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{
                  fontSize: 20, fontWeight: 800, fontFamily: "'JetBrains Mono', monospace",
                  color: isBottleneck ? T.red : T.text0,
                }}>{v.avgDays}d</div>
                <div style={{ fontSize: 14, color: T.text3 }}>avg</div>
              </div>

              {/* Visual bar */}
              <div style={{ width: 60, height: 6, background: T.bg4, borderRadius: 3, flexShrink: 0 }}>
                <div style={{
                  height: "100%", borderRadius: 3,
                  width: `${Math.min(100, (v.avgDays / Math.max(1, bottleneck?.avgDays || 1)) * 100)}%`,
                  background: isBottleneck ? T.red : v.color,
                }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
