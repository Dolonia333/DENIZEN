import { useMemo } from "react";
import { T, fmt, STAGE_COLORS, type Deal, type Contact, type MetricSnapshot } from "@/lib/crm-data";
import { BarChart, Bar, PieChart, Pie, Cell, ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid, LineChart, Line } from "recharts";
import { MiniRing } from "./shared/MiniRing";
import { DashboardEmptyState } from "./shared/DashboardEmptyState";

interface Props {
  deals: Deal[];
  contacts: Contact[];
  metricSnapshots?: MetricSnapshot[];
}

const ChartTooltip = ({ active, payload, label }: { active?: boolean; payload?: { name?: string; value?: number; color?: string; fill?: string }[]; label?: string }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: T.bg2, border: `1px solid ${T.bg4}`, borderRadius: T.radius.md, padding: "8px 12px", fontSize: 14 }}>
      <div style={{ color: T.text3, marginBottom: 4 }}>{label}</div>
      {payload.map((p, i) => (
        <div key={i} style={{ color: p.color || p.fill, fontWeight: 600 }}>{p.name}: {typeof p.value === "number" && p.value > 100 ? fmt(p.value) : p.value}</div>
      ))}
    </div>
  );
};

export function AnalyticsTab({ deals, contacts, metricSnapshots = [] }: Props) {
  const openDeals = deals.filter(d => !["Closed Won", "Closed Lost"].includes(d.stage));
  const wonDeals = deals.filter(d => d.stage === "Closed Won");
  const lostDeals = deals.filter(d => d.stage === "Closed Lost");
  const winRate = wonDeals.length + lostDeals.length > 0 ? Math.round((wonDeals.length / (wonDeals.length + lostDeals.length)) * 100) : 0;
  const avgDealSize = openDeals.length > 0 ? Math.round(openDeals.reduce((s, d) => s + d.value, 0) / openDeals.length) : 0;
  const avgScore = contacts.length > 0 ? Math.round(contacts.reduce((s, c) => s + c.score, 0) / contacts.length) : 0;

  const metrics = [
    { label: "Win Rate", value: `${winRate}%`, color: T.green },
    { label: "Avg Deal Size", value: fmt(avgDealSize), color: T.accent },
    { label: "Avg Lead Score", value: String(avgScore), color: T.blue },
    { label: "Total Revenue", value: fmt(wonDeals.reduce((s, d) => s + d.value, 0)), color: T.purple },
  ];

  const stageData = useMemo(() => {
    const stages = ["Lead", "Qualified", "Proposal", "Negotiation", "Closed Won"];
    return stages.map(s => ({
      name: s.replace("Closed ", ""),
      value: deals.filter(d => d.stage === s).reduce((sum, d) => sum + d.value, 0),
      count: deals.filter(d => d.stage === s).length,
      fill: STAGE_COLORS[s] || T.bg4,
    }));
  }, [deals]);

  const statusPie = useMemo(() => {
    const statuses: Record<string, number> = {};
    contacts.forEach(c => { statuses[c.status] = (statuses[c.status] || 0) + 1; });
    const colors: Record<string, string> = { Lead: T.blue, Prospect: T.accent, Customer: T.green };
    return Object.entries(statuses).map(([name, value]) => ({ name, value, fill: colors[name] || T.purple }));
  }, [contacts]);

  const funnelData = useMemo(() => {
    const stages = ["Lead", "Qualified", "Proposal", "Negotiation", "Closed Won"];
    const counts = stages.map(s => deals.filter(d => {
      const si = stages.indexOf(d.stage);
      return si >= stages.indexOf(s);
    }).length);
    const values = stages.map(s => deals.filter(d => {
      const si = stages.indexOf(d.stage);
      return si >= stages.indexOf(s);
    }).reduce((sum, d) => sum + (d.value || 0), 0));
    return stages.map((s, i) => {
      const prev = i === 0 ? counts[0] : counts[i - 1];
      const stepRate = i === 0 ? 100 : (prev ? Math.round((counts[i] / prev) * 100) : 0);
      const dropOff = i === 0 ? 0 : Math.max(0, prev - counts[i]);
      return {
        stage: s.replace("Closed ", ""),
        count: counts[i],
        value: values[i],
        rate: i === 0 ? 100 : Math.round((counts[i] / (counts[0] || 1)) * 100),
        stepRate,
        dropOff,
        fill: STAGE_COLORS[s],
      };
    });
  }, [deals]);

  const trendData = useMemo(() => {
    return [...metricSnapshots]
      .sort((a, b) => String(a.date).localeCompare(String(b.date)))
      .slice(-30)
      .map((s) => ({
        date: String(s.date).slice(5),
        pipeline: s.pipelineValue,
        won: s.wonValue,
        contacts: s.contacts,
        overdue: s.overdueTasks,
      }));
  }, [metricSnapshots]);

  const cardStyle = {
    background: `linear-gradient(145deg,${T.bg2},${T.bg3}88)`,
    border: `1px solid ${T.bg4}`, borderRadius: T.radius.lg, padding: "14px 14px",
  };

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: T.text0, margin: 0, letterSpacing: "-0.02em" }}>Analytics</h1>
        <p style={{ fontSize: 14, color: T.text2, marginTop: 4 }}>
          Sales performance metrics{trendData.length ? ` · ${trendData.length} daily snapshots` : ""}
        </p>
      </div>

      <div className="crm-stats-grid" style={{ display: "grid", gap: 10, marginBottom: 20 }}>
        {metrics.map((m, idx) => {
          const hints = [
            `${wonDeals.length} won · ${lostDeals.length} lost`,
            `${openDeals.length} open deals`,
            `${contacts.length} contacts`,
            `${wonDeals.length} closed won`,
          ];
          const ringVal = idx === 0 ? winRate : idx === 2 ? Math.min(avgScore, 100) : null;
          return (
            <div key={m.label} style={{ ...cardStyle, display: "flex", alignItems: "center", gap: 12, minHeight: 88 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, color: T.text3, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>{m.label}</div>
                <div style={{ fontSize: 24, fontWeight: 800, color: m.color, fontFamily: "'JetBrains Mono', monospace", lineHeight: 1.1 }}>{m.value}</div>
                <div style={{ fontSize: 14, color: T.text3, marginTop: 6 }}>{hints[idx]}</div>
              </div>
              {ringVal != null && (
                <div style={{ position: "relative", width: 52, height: 52, flexShrink: 0 }}>
                  <MiniRing segments={[{ value: Math.max(ringVal, 1), color: m.color, label: m.label }, { value: Math.max(100 - ringVal, 0), color: T.bg4, label: "rest" }]} size={52} stroke={5} />
                  <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 700, color: m.color, fontFamily: "'JetBrains Mono', monospace" }}>{ringVal}%</div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div style={{ ...cardStyle, marginBottom: 14 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: T.text0, marginBottom: 16 }}>Pipeline & revenue trends</div>
        {trendData.length >= 2 ? (
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={trendData}>
              <CartesianGrid strokeDasharray="3 3" stroke={T.bg4} vertical={false} />
              <XAxis dataKey="date" tick={{ fontSize: 14, fill: T.text3 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 14, fill: T.text3 }} axisLine={false} tickLine={false} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} width={40} />
              <Tooltip content={<ChartTooltip />} />
              <Line type="monotone" dataKey="pipeline" name="Pipeline" stroke={T.accent} strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="won" name="Won" stroke={T.green} strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <DashboardEmptyState icon="📈" title="No trend history yet" subtitle="Daily snapshots appear here once pipeline activity is recorded." />
        )}
      </div>

      <div className="crm-dashboard-grid" style={{ display: "grid", gap: 14, marginBottom: 14 }}>
        <div style={cardStyle}>
          <div style={{ fontSize: 14, fontWeight: 600, color: T.text0, marginBottom: 16 }}>Pipeline Value by Stage</div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={stageData} barSize={28}>
              <CartesianGrid strokeDasharray="3 3" stroke={T.bg4} vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 14, fill: T.text3 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 14, fill: T.text3 }} axisLine={false} tickLine={false} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
              <Tooltip content={<ChartTooltip />} />
              <Bar dataKey="value" name="Value" radius={[4, 4, 0, 0]}>
                {stageData.map((s, i) => <Cell key={i} fill={s.fill} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div style={cardStyle}>
          <div style={{ fontSize: 14, fontWeight: 600, color: T.text0, marginBottom: 16 }}>Contact Distribution</div>
          {statusPie.length === 0 ? (
            <DashboardEmptyState icon="👥" title="No contacts yet" subtitle="Add contacts to see Lead / Prospect / Customer mix." />
          ) : (
          <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap", justifyContent: "center" }}>
            <ResponsiveContainer width={150} height={150}>
              <PieChart>
                <Pie data={statusPie} cx="50%" cy="50%" innerRadius={38} outerRadius={62} dataKey="value" strokeWidth={0}>
                  {statusPie.map((d, i) => <Cell key={i} fill={d.fill} />)}
                </Pie>
                <Tooltip content={<ChartTooltip />} />
              </PieChart>
            </ResponsiveContainer>
            <div style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 120 }}>
              {statusPie.map(d => (
                <div key={d.name} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ width: 10, height: 10, borderRadius: "50%", background: d.fill, flexShrink: 0 }} />
                  <span style={{ fontSize: 14, color: T.text2 }}>{d.name}</span>
                  <span style={{ fontSize: 14, fontWeight: 700, color: T.text0, fontFamily: "'JetBrains Mono', monospace", marginLeft: "auto" }}>{d.value}</span>
                </div>
              ))}
            </div>
          </div>
          )}
        </div>
      </div>

      <div style={{ ...cardStyle, marginBottom: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6, gap: 8, flexWrap: "wrap" }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: T.text0 }}>Conversion Funnel</div>
          <div style={{ fontSize: 14, color: T.text3 }}>Cumulative reach + step conversion</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 16 }}>
          {funnelData.map((f, i) => (
            <div key={f.stage}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4, gap: 8, flexWrap: "wrap" }}>
                <span style={{ fontSize: 14, color: T.text1, fontWeight: 600 }}>
                  {f.stage}
                  {i > 0 && (
                    <span style={{ marginLeft: 8, fontSize: 14, color: f.stepRate >= 50 ? T.green : T.orange, fontWeight: 700 }}>
                      {f.stepRate}% from prior
                    </span>
                  )}
                </span>
                <span style={{ fontSize: 14, color: T.text3, fontFamily: "'JetBrains Mono', monospace" }}>
                  {f.count} deals · {fmt(f.value)} · {f.rate}% of top
                  {f.dropOff > 0 ? ` · −${f.dropOff} drop` : ""}
                </span>
              </div>
              <div style={{ height: 14, background: T.bg4, borderRadius: 7, overflow: "hidden", position: "relative" }}>
                <div style={{
                  height: "100%", width: `${Math.max(f.rate, f.count > 0 ? 8 : 0)}%`,
                  background: `linear-gradient(90deg, ${f.fill}, ${f.fill}88)`,
                  borderRadius: 7, transition: "width 0.5s ease",
                  boxShadow: f.rate > 0 ? `0 0 12px ${f.fill}33` : undefined,
                }} />
              </div>
            </div>
          ))}
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
            <thead>
              <tr>
                {["Stage", "Deals", "Pipeline $", "vs Top", "Step conv.", "Drop-off"].map(h => (
                  <th key={h} style={{ textAlign: "left", padding: "6px 8px", color: T.text3, borderBottom: `1px solid ${T.bg4}`, fontWeight: 600 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {funnelData.map((f) => (
                <tr key={`row-${f.stage}`}>
                  <td style={{ padding: "7px 8px", color: T.text0, borderBottom: `1px solid ${T.bg4}` }}>
                    <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 4, background: f.fill, marginRight: 6 }} />
                    {f.stage}
                  </td>
                  <td style={{ padding: "7px 8px", color: T.text1, fontFamily: "'JetBrains Mono', monospace", borderBottom: `1px solid ${T.bg4}` }}>{f.count}</td>
                  <td style={{ padding: "7px 8px", color: T.text1, fontFamily: "'JetBrains Mono', monospace", borderBottom: `1px solid ${T.bg4}` }}>{fmt(f.value)}</td>
                  <td style={{ padding: "7px 8px", color: T.text1, fontFamily: "'JetBrains Mono', monospace", borderBottom: `1px solid ${T.bg4}` }}>{f.rate}%</td>
                  <td style={{ padding: "7px 8px", color: f.stepRate >= 50 ? T.green : T.orange, fontFamily: "'JetBrains Mono', monospace", borderBottom: `1px solid ${T.bg4}`, fontWeight: 700 }}>{f.stepRate}%</td>
                  <td style={{ padding: "7px 8px", color: f.dropOff ? T.red : T.text3, fontFamily: "'JetBrains Mono', monospace", borderBottom: `1px solid ${T.bg4}` }}>{f.dropOff || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
