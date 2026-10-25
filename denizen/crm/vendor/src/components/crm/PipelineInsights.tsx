import { useMemo } from "react";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ComposedChart,
  Legend, Line, Pie, PieChart, ResponsiveContainer, Scatter, ScatterChart,
  Tooltip, XAxis, YAxis, ZAxis,
} from "recharts";
import { T, fmt, STAGES, STAGE_COLORS, type Deal } from "@/lib/crm-data";
import { chartAxisTick, chartGridProps, chartMargin, chartPanelStyle, moneyTick } from "@/lib/crm-chart-theme";

interface Props {
  deals: Deal[];
}

const OPEN = STAGES.filter((s) => !["Closed Won", "Closed Lost"].includes(s));

function PremiumTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: "rgba(13,16,21,0.94)",
      border: `1px solid ${T.bg4}`,
      borderRadius: 12,
      padding: "10px 14px",
      boxShadow: T.shadow.elevated,
      backdropFilter: "blur(8px)",
      minWidth: 160,
    }}>
      {label != null && label !== "" && (
        <div style={{ color: T.text3, fontSize: 11, fontWeight: 700, marginBottom: 6 }}>{label}</div>
      )}
      {payload.map((p: any, i: number) => {
        const raw = p.value;
        const showMoney = typeof raw === "number" && (p.dataKey === "value" || p.dataKey === "weighted" || p.name?.toLowerCase?.().includes("value") || raw > 999);
        return (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3, fontSize: 12 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: p.color || p.fill || p.stroke }} />
            <span style={{ color: T.text2 }}>{p.name || p.dataKey}</span>
            <span style={{ marginLeft: "auto", color: T.text0, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
              {typeof raw === "number" ? (showMoney ? fmt(raw) : raw) : String(raw)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function PipelineInsights({ deals }: Props) {
  const openDeals = useMemo(
    () => deals.filter((d) => !["Closed Won", "Closed Lost"].includes(d.stage)),
    [deals],
  );

  const funnel = useMemo(() => {
    return OPEN.map((stage, i) => {
      const stageDeals = openDeals.filter((d) => d.stage === stage);
      const value = stageDeals.reduce((s, d) => s + d.value, 0);
      const weighted = stageDeals.reduce((s, d) => s + d.value * (d.probability || 0) / 100, 0);
      const count = stageDeals.length;
      const fromTop = openDeals.length ? Math.round((count / openDeals.length) * 100) : 0;
      return {
        stage,
        count,
        value,
        weighted,
        fromTop,
        color: STAGE_COLORS[stage] || T.accent,
        width: Math.max(18, 100 - i * 14),
      };
    });
  }, [openDeals]);

  const forecast = useMemo(() => {
    const commit = openDeals.filter((d) => (d.probability || 0) >= 70).reduce((s, d) => s + d.value, 0);
    const best = openDeals.filter((d) => (d.probability || 0) >= 40).reduce((s, d) => s + d.value, 0);
    const pipeline = openDeals.reduce((s, d) => s + d.value, 0);
    const weighted = openDeals.reduce((s, d) => s + d.value * (d.probability || 0) / 100, 0);
    return [
      { name: "Commit ≥70%", value: commit, fill: T.green },
      { name: "Best case ≥40%", value: best, fill: T.blue },
      { name: "Full pipeline", value: pipeline, fill: T.copper },
      { name: "Weighted", value: Math.round(weighted), fill: T.accent },
    ];
  }, [openDeals]);

  const scatter = useMemo(() => {
    return openDeals.map((d) => ({
      id: d.id,
      title: d.title,
      x: Math.max(0, d.daysInStage || 0),
      y: Math.min(100, Math.max(0, d.probability || 0)),
      z: Math.max(8, Math.sqrt(Math.max(d.value, 1)) / 8),
      value: d.value,
      stage: d.stage,
      fill: STAGE_COLORS[d.stage] || T.accent,
    }));
  }, [openDeals]);

  const aging = useMemo(() => {
    const buckets = ["0–7d", "8–14d", "15–30d", "31–60d", "60d+"] as const;
    return OPEN.map((stage) => {
      const row: Record<string, string | number> = { stage };
      for (const b of buckets) row[b] = 0;
      for (const d of openDeals.filter((x) => x.stage === stage)) {
        const days = d.daysInStage || 0;
        const key = days <= 7 ? "0–7d" : days <= 14 ? "8–14d" : days <= 30 ? "15–30d" : days <= 60 ? "31–60d" : "60d+";
        row[key] = Number(row[key]) + 1;
      }
      return row;
    });
  }, [openDeals]);

  const health = useMemo(() => {
    const map: Record<string, number> = { healthy: 0, "at-risk": 0, stalled: 0, unknown: 0 };
    for (const d of openDeals) {
      const h = String(d.health || "unknown").toLowerCase();
      if (h.includes("risk")) map["at-risk"] += 1;
      else if (h.includes("stall")) map.stalled += 1;
      else if (h.includes("health") || h === "ok" || h === "good") map.healthy += 1;
      else map.unknown += 1;
    }
    return [
      { name: "Healthy", value: map.healthy, fill: T.green },
      { name: "At risk", value: map["at-risk"], fill: T.orange },
      { name: "Stalled", value: map.stalled, fill: T.red },
      { name: "Unset", value: map.unknown, fill: T.text3 },
    ].filter((r) => r.value > 0);
  }, [openDeals]);

  const composition = useMemo(() => funnel.map((f) => ({
    stage: f.stage,
    value: f.value,
    weighted: Math.round(f.weighted),
    fill: f.color,
  })), [funnel]);

  const totalOpen = openDeals.reduce((s, d) => s + d.value, 0);
  const totalWeighted = openDeals.reduce((s, d) => s + d.value * (d.probability || 0) / 100, 0);

  if (!deals.length) {
    return (
      <div style={{ ...chartPanelStyle(), textAlign: "center", padding: 48, color: T.text2 }}>
        Add deals to unlock pipeline insights — funnel, forecast, aging, and probability maps.
      </div>
    );
  }

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{
          margin: 0, fontSize: 26, fontWeight: 600, color: T.text0,
          fontFamily: "var(--crm-display)", letterSpacing: "-0.02em",
        }}>
          Pipeline insights
        </h2>
        <p style={{ margin: "6px 0 0", fontSize: 13, color: T.text2 }}>
          Premium viz for coverage, aging, and forecast — {openDeals.length} open · {fmt(totalOpen)} pipeline · {fmt(Math.round(totalWeighted))} weighted
        </p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10, marginBottom: 16 }}>
        {[
          { label: "Open value", value: fmt(totalOpen), color: T.accent },
          { label: "Weighted", value: fmt(Math.round(totalWeighted)), color: T.blue },
          { label: "Commit", value: fmt(forecast[0].value), color: T.green },
          { label: "Open deals", value: String(openDeals.length), color: T.copper },
        ].map((k) => (
          <div key={k.label} style={{ ...chartPanelStyle(), padding: "14px 16px" }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: T.text3, textTransform: "uppercase", letterSpacing: "0.06em" }}>{k.label}</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: k.color, marginTop: 6, fontVariantNumeric: "tabular-nums" }}>{k.value}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 14, marginBottom: 14 }}>
        {/* Funnel */}
        <div style={chartPanelStyle()}>
          <div style={{ fontSize: 14, fontWeight: 700, color: T.text0, marginBottom: 4 }}>Conversion funnel</div>
          <div style={{ fontSize: 11, color: T.text3, marginBottom: 14 }}>Live occupancy by stage · bar width shows depth</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "center" }}>
            {funnel.map((f) => (
              <div key={f.stage} style={{ width: `${f.width}%`, minWidth: "40%", maxWidth: "100%" }}>
                <div style={{
                  background: `linear-gradient(90deg, ${f.color}, ${f.color}99)`,
                  borderRadius: 8,
                  padding: "10px 14px",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  boxShadow: `0 0 20px ${f.color}22`,
                }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: "#071410" }}>{f.stage}</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: "#071410", opacity: 0.85 }}>
                    {f.count} · {fmt(f.value)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Forecast bands */}
        <div style={chartPanelStyle()}>
          <div style={{ fontSize: 14, fontWeight: 700, color: T.text0, marginBottom: 4 }}>Forecast bands</div>
          <div style={{ fontSize: 11, color: T.text3, marginBottom: 8 }}>Commit vs best case vs full coverage</div>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={forecast} layout="vertical" margin={{ ...chartMargin, left: 8 }}>
              <CartesianGrid {...chartGridProps} horizontal={false} />
              <XAxis type="number" tick={chartAxisTick} tickFormatter={moneyTick} axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey="name" width={110} tick={chartAxisTick} axisLine={false} tickLine={false} />
              <Tooltip content={<PremiumTooltip />} />
              <Bar dataKey="value" name="Value" radius={[0, 8, 8, 0]} barSize={22}>
                {forecast.map((r) => <Cell key={r.name} fill={r.fill} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 14, marginBottom: 14 }}>
        {/* Value + weighted composition */}
        <div style={chartPanelStyle()}>
          <div style={{ fontSize: 14, fontWeight: 700, color: T.text0, marginBottom: 4 }}>Value vs weighted</div>
          <div style={{ fontSize: 11, color: T.text3, marginBottom: 8 }}>Stage dollars · probability-weighted overlay</div>
          <ResponsiveContainer width="100%" height={260}>
            <ComposedChart data={composition} margin={chartMargin}>
              <defs>
                <linearGradient id="gradValue" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={T.accent} stopOpacity={0.85} />
                  <stop offset="100%" stopColor={T.accent} stopOpacity={0.25} />
                </linearGradient>
              </defs>
              <CartesianGrid {...chartGridProps} />
              <XAxis dataKey="stage" tick={{ ...chartAxisTick, fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis tick={chartAxisTick} tickFormatter={moneyTick} axisLine={false} tickLine={false} />
              <Tooltip content={<PremiumTooltip />} />
              <Legend wrapperStyle={{ fontSize: 11, color: T.text2 }} />
              <Bar dataKey="value" name="Pipeline $" fill="url(#gradValue)" radius={[6, 6, 0, 0]} barSize={26} />
              <Line type="monotone" dataKey="weighted" name="Weighted $" stroke={T.copper} strokeWidth={2.5} dot={{ r: 4, fill: T.copper }} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        {/* Aging stacked */}
        <div style={chartPanelStyle()}>
          <div style={{ fontSize: 14, fontWeight: 700, color: T.text0, marginBottom: 4 }}>Stage aging heatmap</div>
          <div style={{ fontSize: 11, color: T.text3, marginBottom: 8 }}>Deal counts by days in stage</div>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={aging} margin={chartMargin}>
              <CartesianGrid {...chartGridProps} />
              <XAxis dataKey="stage" tick={{ ...chartAxisTick, fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis allowDecimals={false} tick={chartAxisTick} axisLine={false} tickLine={false} />
              <Tooltip content={<PremiumTooltip />} />
              <Legend wrapperStyle={{ fontSize: 11, color: T.text2 }} />
              <Bar dataKey="0–7d" stackId="a" fill={T.green} />
              <Bar dataKey="8–14d" stackId="a" fill={T.blue} />
              <Bar dataKey="15–30d" stackId="a" fill={T.copper} />
              <Bar dataKey="31–60d" stackId="a" fill={T.orange} />
              <Bar dataKey="60d+" stackId="a" fill={T.red} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 14 }}>
        {/* Scatter bubble */}
        <div style={chartPanelStyle()}>
          <div style={{ fontSize: 14, fontWeight: 700, color: T.text0, marginBottom: 4 }}>Probability map</div>
          <div style={{ fontSize: 11, color: T.text3, marginBottom: 8 }}>
            X = days in stage · Y = win probability · bubble ≈ deal size
          </div>
          {scatter.length === 0 ? (
            <div style={{ color: T.text3, fontSize: 13, padding: 32, textAlign: "center" }}>No open deals to plot</div>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <ScatterChart margin={{ top: 10, right: 16, bottom: 8, left: 0 }}>
                <CartesianGrid {...chartGridProps} />
                <XAxis type="number" dataKey="x" name="Days" tick={chartAxisTick} axisLine={false} tickLine={false} unit="d" />
                <YAxis type="number" dataKey="y" name="Prob" tick={chartAxisTick} axisLine={false} tickLine={false} unit="%" domain={[0, 100]} />
                <ZAxis type="number" dataKey="z" range={[60, 400]} />
                <Tooltip
                  cursor={{ strokeDasharray: "3 3", stroke: T.bg5 }}
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const d = payload[0].payload as typeof scatter[0];
                    return (
                      <div style={{
                        background: "rgba(13,16,21,0.94)", border: `1px solid ${T.bg4}`,
                        borderRadius: 12, padding: "10px 14px", boxShadow: T.shadow.elevated,
                      }}>
                        <div style={{ fontWeight: 700, color: T.text0, marginBottom: 4 }}>{d.title}</div>
                        <div style={{ fontSize: 12, color: T.text2 }}>{d.stage} · {fmt(d.value)}</div>
                        <div style={{ fontSize: 12, color: T.text2 }}>{d.x}d in stage · {d.y}% prob</div>
                      </div>
                    );
                  }}
                />
                <Scatter name="Deals" data={scatter}>
                  {scatter.map((d) => <Cell key={d.id} fill={d.fill} fillOpacity={0.85} />)}
                </Scatter>
              </ScatterChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Health donut + area spark of stage values */}
        <div style={chartPanelStyle()}>
          <div style={{ fontSize: 14, fontWeight: 700, color: T.text0, marginBottom: 4 }}>Deal health</div>
          <div style={{ fontSize: 11, color: T.text3, marginBottom: 8 }}>Open-deal health mix</div>
          <ResponsiveContainer width="100%" height={180}>
            <PieChart>
              <Pie
                data={health.length ? health : [{ name: "None", value: 1, fill: T.bg4 }]}
                dataKey="value"
                nameKey="name"
                innerRadius={48}
                outerRadius={72}
                paddingAngle={3}
                stroke="none"
              >
                {(health.length ? health : [{ fill: T.bg4 }]).map((r, i) => (
                  <Cell key={i} fill={r.fill} />
                ))}
              </Pie>
              <Tooltip content={<PremiumTooltip />} />
            </PieChart>
          </ResponsiveContainer>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center" }}>
            {health.map((h) => (
              <span key={h.name} style={{ fontSize: 11, color: T.text2, display: "flex", alignItems: "center", gap: 5 }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: h.fill }} />
                {h.name} {h.value}
              </span>
            ))}
          </div>
          <div style={{ marginTop: 12 }}>
            <ResponsiveContainer width="100%" height={80}>
              <AreaChart data={composition}>
                <defs>
                  <linearGradient id="sparkPipe" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={T.accent} stopOpacity={0.45} />
                    <stop offset="100%" stopColor={T.accent} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <Area type="monotone" dataKey="value" stroke={T.accent} fill="url(#sparkPipe)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}
