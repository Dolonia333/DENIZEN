import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import { T, type Contact, type Deal } from "@/lib/crm-data";
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, Legend,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";

// ─── TYPES ───────────────────────────────────────────────────────────────────
interface Lead {
  id: number; name: string; company: string; status: string; value: number;
  stage: string; notes: string; owner: string;
}
interface ActiveDeal {
  id: number; name: string; owner: string; amount: number;
  closeDate: string; probability: number; stage: string;
}
interface ChartDataPoint { label: string; value: number; color: string; }
interface ChartConfig {
  id: string; title: string; type: "bar" | "line" | "pie";
  data: ChartDataPoint[]; backup: ChartDataPoint[] | null;
  description: string; valuePrefix: string; valueSuffix: string;
}
interface PanelConfig {
  id: string; title: string; type: "leads" | "deals" | "chart" | "kpi";
  x: number; y: number; w: number; h: number;
  minW: number; minH: number; maxW: number; maxH: number;
  chartId?: string;
}
interface DiscussionItem {
  id: number; sourceType: "lead" | "deal" | "chart"; sourceId: string | number;
  title: string; snapshot: Record<string, any>; notes: string;
  status: "Needs Review" | "In Progress" | "Resolved"; pulledAt: string;
}

// ─── MOCK DATA ───────────────────────────────────────────────────────────────
const COLORS = ["#f0b429","#4d9ef7","#22d3a0","#f85b5b","#8b5cf6","#fb923c","#ec4899","#06b6d4"];

function leadHeat(contact: Contact): string {
  const score = Number(contact.score) || 0;
  if (score >= 70 || /hot|customer/i.test(contact.status)) return "Hot";
  if (score >= 40 || /warm|qualified|prospect/i.test(contact.status)) return "Warm";
  return "Cold";
}

function contactsToLeads(contacts: Contact[], deals: Deal[]): Lead[] {
  return contacts.map((c) => {
    const related = deals.filter((d) => d.contact === c.name);
    const value = related.reduce((s, d) => s + (Number(d.value) || 0), 0);
    const top = related.sort((a, b) => (b.value || 0) - (a.value || 0))[0];
    return {
      id: c.id,
      name: c.name,
      company: c.company || "—",
      status: leadHeat(c),
      value,
      stage: top?.stage || c.status || "Discovery",
      notes: c.leadSource ? `Source: ${c.leadSource}` : "",
      owner: top?.ownerId || "Unassigned",
    };
  });
}

function openDealsToActive(deals: Deal[]): ActiveDeal[] {
  return deals
    .filter((d) => !/closed (won|lost)/i.test(String(d.stage || "")))
    .map((d) => ({
      id: d.id,
      name: d.title,
      owner: d.ownerId || "Unassigned",
      amount: Number(d.value) || 0,
      closeDate: d.closeDate || new Date().toISOString().slice(0, 10),
      probability: Number(d.probability) || 50,
      stage: d.stage,
    }));
}

const initialCharts: ChartConfig[] = [
  {
    id: "revenue", title: "Quarterly Revenue", type: "bar",
    description: "Total closed revenue per quarter this fiscal year. Q4 spike driven by year-end enterprise renewals.",
    valuePrefix: "$", valueSuffix: "",
    data: [
      { label:"Q1",value:187000,color:COLORS[0] },{ label:"Q2",value:240000,color:COLORS[1] },
      { label:"Q3",value:198000,color:COLORS[2] },{ label:"Q4",value:312000,color:COLORS[3] },
    ], backup: null,
  },
  {
    id: "pipeline", title: "Pipeline by Stage", type: "pie",
    description: "Current deal value distribution across pipeline stages. Proposal stage holds the largest share at $215K.",
    valuePrefix: "$", valueSuffix: "",
    data: [
      { label:"Discovery",value:98000,color:COLORS[4] },{ label:"Qualified",value:71000,color:COLORS[5] },
      { label:"Demo",value:52000,color:COLORS[1] },{ label:"Proposal",value:215000,color:COLORS[0] },
      { label:"Negotiation",value:84000,color:COLORS[2] },
    ], backup: null,
  },
  {
    id: "performance", title: "Monthly Closed Deals", type: "line",
    description: "Number of deals closed each month. Trending upward — June had the best performance at 11 deals.",
    valuePrefix: "", valueSuffix: " deals",
    data: [
      { label:"Jan",value:4,color:COLORS[1] },{ label:"Feb",value:7,color:COLORS[1] },
      { label:"Mar",value:5,color:COLORS[1] },{ label:"Apr",value:9,color:COLORS[1] },
      { label:"May",value:6,color:COLORS[1] },{ label:"Jun",value:11,color:COLORS[1] },
    ], backup: null,
  },
];

const initialPanels: PanelConfig[] = [
  { id:"leads", title:"Leads Pipeline", type:"leads", x:0, y:0, w:480, h:400, minW:320, minH:280, maxW:900, maxH:700 },
  { id:"deals", title:"Active Deals", type:"deals", x:500, y:0, w:480, h:400, minW:320, minH:280, maxW:900, maxH:700 },
  { id:"chart-revenue", title:"Revenue", type:"chart", chartId:"revenue", x:0, y:420, w:320, h:380, minW:260, minH:300, maxW:700, maxH:600 },
  { id:"chart-pipeline", title:"Pipeline", type:"chart", chartId:"pipeline", x:340, y:420, w:320, h:380, minW:260, minH:300, maxW:700, maxH:600 },
  { id:"chart-performance", title:"Performance", type:"chart", chartId:"performance", x:680, y:420, w:320, h:380, minW:260, minH:300, maxW:700, maxH:600 },
];

const STATUS_COLORS: Record<string, string> = {
  "Hot":"#f85b5b","Warm":"#fb923c","Cold":"#4d9ef7",
  "Needs Review":"#fb923c","In Progress":"#4d9ef7","Resolved":"#22d3a0",
};

const STAGE_ICONS: Record<string, string> = {
  Discovery: "🔍", Qualified: "✅", Demo: "🖥️", Proposal: "📄", Negotiation: "🤝",
};

const fmt$ = (v: number) => "$" + v.toLocaleString();

// ─── CUSTOM CHART TOOLTIP ────────────────────────────────────────────────────
const CustomTooltip = ({ active, payload, label, prefix, suffix }: any) => {
  if (!active || !payload?.length) return null;

  return (
    <div style={{
      background: T.bg2, border: `1px solid ${T.bg4}`, borderRadius: 10,
      padding: "10px 14px", fontSize: 12, boxShadow: T.shadow.card,
    }}>
      <div style={{ color: T.text3, marginBottom: 6, fontWeight: 600, fontSize: 11 }}>{label}</div>
      {payload.map((p: any, i: number) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: p.color || p.fill || p.payload?.color }} />
          <span style={{ color: T.text1, fontWeight: 600, fontFamily: "'JetBrains Mono', monospace" }}>
            {prefix}{typeof p.value === "number" ? p.value.toLocaleString() : p.value}{suffix}
          </span>
        </div>
      ))}
    </div>
  );
};

const PieLabelRenderer = ({ cx, cy, midAngle, innerRadius, outerRadius, percent, name }: any) => {
  if (percent < 0.08) return null;
  const RADIAN = Math.PI / 180;
  const radius = innerRadius + (outerRadius - innerRadius) * 0.5;
  const x = cx + radius * Math.cos(-midAngle * RADIAN);
  const y = cy + radius * Math.sin(-midAngle * RADIAN);
  return (
    <text x={x} y={y} fill="#fff" textAnchor="middle" dominantBaseline="central" fontSize={10} fontWeight={700}>
      {`${(percent * 100).toFixed(0)}%`}
    </text>
  );
};

interface SalesTeamDashboardProps {
  contacts?: Contact[];
  deals?: Deal[];
}

// ─── COMPONENT ───────────────────────────────────────────────────────────────
export function SalesTeamDashboard({ contacts = [], deals = [] }: SalesTeamDashboardProps) {
  const leads = useMemo(() => contactsToLeads(contacts, deals), [contacts, deals]);
  const activeDeals = useMemo(() => openDealsToActive(deals), [deals]);
  const [panels, setPanels] = useState<PanelConfig[]>(initialPanels);
  const [charts, setCharts] = useState<ChartConfig[]>(initialCharts);

  useEffect(() => {
    const open = deals.filter((d) => !/closed lost/i.test(String(d.stage || "")));
    const byStage: Record<string, number> = {};
    for (const d of open) {
      const stage = d.stage || "Other";
      byStage[stage] = (byStage[stage] || 0) + (Number(d.value) || 0);
    }
    const entries = Object.entries(byStage);
    if (!entries.length) return;
    const data = entries.map(([label, value], i) => ({
      label, value, color: COLORS[i % COLORS.length],
    }));
    const total = data.reduce((s, d) => s + d.value, 0);
    setCharts((prev) => prev.map((c) => (
      c.id === "pipeline"
        ? {
          ...c,
          data,
          description: `Live pipeline: ${fmt$(total)} across ${open.length} deals.`,
        }
        : c
    )));
  }, [deals]);
  const [discussions, setDiscussions] = useState<DiscussionItem[]>([]);
  const [discussionOpen, setDiscussionOpen] = useState(false);
  const [discSearch, setDiscSearch] = useState("");
  const [discFilter, setDiscFilter] = useState<string>("all");
  const [editingChart, setEditingChart] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState<string | null>(null);
  const [titleDraft, setTitleDraft] = useState("");
  const [editingCell, setEditingCell] = useState<{ chartId: string; idx: number; field: "label" | "value" } | null>(null);
  const [cellDraft, setCellDraft] = useState("");
  const [colorPicker, setColorPicker] = useState<{ chartId: string; idx: number } | null>(null);
  const [discussionPanelWidth, setDiscussionPanelWidth] = useState(() => {
    try {
      const saved = localStorage.getItem("meridian_discussionWidth");
      return saved ? Math.max(280, Math.min(700, Number(saved))) : 392;
    } catch { return 392; }
  });
  const discResizeRef = useRef<{ startX: number; startW: number } | null>(null);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!discResizeRef.current) return;
      const delta = discResizeRef.current.startX - e.clientX;
      const newW = Math.max(280, Math.min(700, discResizeRef.current.startW + delta));
      setDiscussionPanelWidth(newW);
    };
    const onUp = () => {
      if (discResizeRef.current) {
        discResizeRef.current = null;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        try { localStorage.setItem("meridian_discussionWidth", String(discussionPanelWidth)); } catch {}
      }
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, [discussionPanelWidth]);

  const containerRef = useRef<HTMLDivElement>(null);
  const resizeRef = useRef<{
    panelId: string; startX: number; startY: number;
    startW: number; startH: number; startPX: number; startPY: number;
    dir: string;
  } | null>(null);

  // ─── KPI CALCULATIONS ─────────────────────────────────────────────────────
  const kpis = useMemo(() => {
    const totalPipeline = activeDeals.reduce((s, d) => s + d.amount, 0);
    const weightedPipeline = activeDeals.reduce((s, d) => s + d.amount * (d.probability / 100), 0);
    const avgDealSize = activeDeals.length ? Math.round(totalPipeline / activeDeals.length) : 0;
    const hotLeads = leads.filter(l => l.status === "Hot").length;
    const wonValue = deals
      .filter((d) => /closed won/i.test(String(d.stage || "")))
      .reduce((s, d) => s + (Number(d.value) || 0), 0);
    const avgProbability = activeDeals.length
      ? Math.round(activeDeals.reduce((s, d) => s + d.probability, 0) / activeDeals.length)
      : 0;
    const closingSoon = activeDeals.filter(d => {
      const days = Math.ceil((new Date(d.closeDate).getTime() - Date.now()) / (1000*60*60*24));
      return days <= 30 && days > 0;
    }).length;
    return { totalPipeline, weightedPipeline, avgDealSize, hotLeads, totalRevenue: wonValue, avgProbability, closingSoon };
  }, [activeDeals, leads, deals]);

  // ─── RESIZE LOGIC ──────────────────────────────────────────────────────────
  const handleResizeStart = useCallback((e: React.MouseEvent, panelId: string, dir: string) => {
    e.preventDefault(); e.stopPropagation();
    const panel = panels.find(p => p.id === panelId);
    if (!panel) return;
    resizeRef.current = { panelId, startX: e.clientX, startY: e.clientY, startW: panel.w, startH: panel.h, startPX: panel.x, startPY: panel.y, dir };
  }, [panels]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!resizeRef.current) return;
      const { panelId, startX, startY, startW, startH, startPX, startPY, dir } = resizeRef.current;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      setPanels(prev => prev.map(p => {
        if (p.id !== panelId) return p;
        let { x, y, w, h } = { x: startPX, y: startPY, w: startW, h: startH };
        if (dir.includes("r")) w = Math.max(p.minW, Math.min(p.maxW, startW + dx));
        if (dir.includes("l")) { w = Math.max(p.minW, Math.min(p.maxW, startW - dx)); x = startPX + (startW - w); }
        if (dir.includes("b")) h = Math.max(p.minH, Math.min(p.maxH, startH + dy));
        if (dir.includes("t")) { h = Math.max(p.minH, Math.min(p.maxH, startH - dy)); y = startPY + (startH - h); }
        return { ...p, x, y, w, h };
      }));
    };
    const onUp = () => { resizeRef.current = null; };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, []);

  // ─── CHART ACTIONS ─────────────────────────────────────────────────────────
  const updateChart = useCallback((id: string, fn: (c: ChartConfig) => ChartConfig) => {
    setCharts(prev => prev.map(c => c.id === id ? fn(c) : c));
  }, []);

  const saveChart = (id: string) => {
    updateChart(id, c => ({ ...c, backup: null }));
    setEditingChart(null);
  };
  const resetChart = (id: string) => {
    updateChart(id, c => c.backup ? { ...c, data: c.backup, backup: null } : c);
    setEditingChart(null);
  };
  const startEditChart = (id: string) => {
    updateChart(id, c => ({ ...c, backup: c.backup || [...c.data.map(d => ({ ...d }))] }));
    setEditingChart(id);
  };
  const toggleChartType = (id: string) => {
    const order: ("bar" | "line" | "pie")[] = ["bar", "line", "pie"];
    updateChart(id, c => ({ ...c, type: order[(order.indexOf(c.type) + 1) % 3] }));
  };
  const addDataPoint = (id: string) => {
    updateChart(id, c => ({ ...c, data: [...c.data, { label: "New", value: 0, color: COLORS[c.data.length % COLORS.length] }] }));
  };
  const removeDataPoint = (id: string, idx: number) => {
    updateChart(id, c => ({ ...c, data: c.data.filter((_, i) => i !== idx) }));
  };

  // ─── DISCUSSION ACTIONS ────────────────────────────────────────────────────
  const pullToDiscuss = useCallback((sourceType: DiscussionItem["sourceType"], sourceId: string | number, title: string, snapshot: Record<string, any>) => {
    setDiscussions(prev => [{
      id: Date.now(), sourceType, sourceId, title, snapshot,
      notes: "", status: "Needs Review", pulledAt: new Date().toISOString(),
    }, ...prev]);
    setDiscussionOpen(true);
  }, []);

  const updateDiscussion = useCallback((id: number, updates: Partial<DiscussionItem>) => {
    setDiscussions(prev => prev.map(d => d.id === id ? { ...d, ...updates } : d));
  }, []);

  const filteredDiscussions = useMemo(() => {
    let items = discussions;
    if (discFilter !== "all") {
      if (["lead","deal","chart"].includes(discFilter)) items = items.filter(d => d.sourceType === discFilter);
      else items = items.filter(d => d.status === discFilter);
    }
    if (discSearch) {
      const q = discSearch.toLowerCase();
      items = items.filter(d => d.title.toLowerCase().includes(q) || JSON.stringify(d.snapshot).toLowerCase().includes(q));
    }
    return items;
  }, [discussions, discFilter, discSearch]);

  // ─── RESIZE HANDLES ────────────────────────────────────────────────────────
  const handleStyle = (dir: string): React.CSSProperties => {
    const base: React.CSSProperties = { position:"absolute", zIndex:10, opacity:0, transition:"opacity 0.15s" };
    const size = 8;
    if (dir === "r") return { ...base, right:-3, top:size, bottom:size, width:6, cursor:"ew-resize" };
    if (dir === "l") return { ...base, left:-3, top:size, bottom:size, width:6, cursor:"ew-resize" };
    if (dir === "b") return { ...base, bottom:-3, left:size, right:size, height:6, cursor:"ns-resize" };
    if (dir === "t") return { ...base, top:-3, left:size, right:size, height:6, cursor:"ns-resize" };
    if (dir === "tr") return { ...base, top:-4, right:-4, width:10, height:10, cursor:"nesw-resize", borderRadius:"50%" };
    if (dir === "tl") return { ...base, top:-4, left:-4, width:10, height:10, cursor:"nwse-resize", borderRadius:"50%" };
    if (dir === "br") return { ...base, bottom:-4, right:-4, width:10, height:10, cursor:"nwse-resize", borderRadius:"50%" };
    if (dir === "bl") return { ...base, bottom:-4, left:-4, width:10, height:10, cursor:"nesw-resize", borderRadius:"50%" };
    return base;
  };
  const DIRS = ["t","r","b","l","tr","tl","br","bl"];

  // ─── RENDER CHART ──────────────────────────────────────────────────────────
  const renderChart = (chart: ChartConfig, panelW: number, panelH: number) => {
    const isEditing = editingChart === chart.id;
    const chartH = panelH - (isEditing ? 260 : 150);
    const totalValue = chart.data.reduce((s, d) => s + d.value, 0);

    return (
      <div style={{ height: "100%", display:"flex", flexDirection:"column" }}>
        {/* Title row */}
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:4, gap:8, flexWrap:"wrap" }}>
          <div style={{ display:"flex", alignItems:"center", gap:6, flex:1, minWidth:0 }}>
            {editingTitle === chart.id ? (
              <input autoFocus value={titleDraft} onChange={e => setTitleDraft(e.target.value)}
                onBlur={() => { updateChart(chart.id, c => ({ ...c, title: titleDraft || c.title })); setEditingTitle(null); }}
                onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                style={{ background:T.bg4, border:`1px solid ${T.bg5}`, borderRadius:4, color:T.text0, fontSize:14, fontWeight:700, padding:"2px 6px", width:"100%" }}
              />
            ) : (
              <span onClick={() => { setEditingTitle(chart.id); setTitleDraft(chart.title); }}
                style={{ fontSize:14, fontWeight:700, color:T.text0, cursor:"pointer", letterSpacing:"-0.01em" }}
                title="Click to edit title">{chart.title}</span>
            )}
          </div>
          <div style={{ display:"flex", gap:4 }}>
            <button onClick={() => toggleChartType(chart.id)} title="Switch chart type"
              style={smallBtn}>⇄ {chart.type}</button>
            {!isEditing ? (
              <button onClick={() => startEditChart(chart.id)} style={smallBtn}>✏️ Edit</button>
            ) : (
              <>
                <button onClick={() => saveChart(chart.id)} style={{ ...smallBtn, background:`${T.green}22`, color:T.green }}>✓ Save</button>
                <button onClick={() => resetChart(chart.id)} style={{ ...smallBtn, background:`${T.red}22`, color:T.red }}>↺ Reset</button>
              </>
            )}
            <button onClick={() => {
              const summary = chart.data.map(d => `${d.label}: ${d.value}`).join(", ");
              pullToDiscuss("chart", chart.id, chart.title, { type: chart.type, summary, data: chart.data });
            }} style={{ ...smallBtn, background:`${T.purple}22`, color:T.purple }} title="Pull to Discussion">💬</button>
          </div>
        </div>

        {/* Description */}
        <p style={{ fontSize: 11, color: T.text3, margin: "0 0 6px", lineHeight: 1.4 }}>
          {chart.description}
        </p>

        {/* Summary stat */}
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 8 }}>
          <span style={{ fontSize: 20, fontWeight: 800, color: T.text0, fontFamily: "'JetBrains Mono', monospace" }}>
            {chart.valuePrefix}{totalValue.toLocaleString()}{chart.valueSuffix}
          </span>
          <span style={{ fontSize: 11, color: T.text3 }}>total across {chart.data.length} segments</span>
        </div>

        {/* Chart visualization */}
        <div style={{ flex:1, minHeight:0 }}>
          <ResponsiveContainer width="100%" height={Math.max(120, chartH)}>
            {chart.type === "bar" ? (
              <BarChart data={chart.data}>
                <CartesianGrid strokeDasharray="3 3" stroke={T.bg4} />
                <XAxis dataKey="label" tick={{ fill:T.text3, fontSize:11 }} axisLine={{ stroke:T.bg4 }} />
                <YAxis tick={{ fill:T.text3, fontSize:10 }} axisLine={{ stroke:T.bg4 }}
                  tickFormatter={(v: number) => chart.valuePrefix === "$" ? `$${(v/1000).toFixed(0)}k` : String(v)} />
                <Tooltip content={<CustomTooltip prefix={chart.valuePrefix} suffix={chart.valueSuffix} />} />
                <Bar dataKey="value" name="Value" radius={[6,6,0,0]}>
                  {chart.data.map((d, i) => <Cell key={i} fill={d.color} />)}
                </Bar>
              </BarChart>
            ) : chart.type === "line" ? (
              <LineChart data={chart.data}>
                <CartesianGrid strokeDasharray="3 3" stroke={T.bg4} />
                <XAxis dataKey="label" tick={{ fill:T.text3, fontSize:11 }} axisLine={{ stroke:T.bg4 }} />
                <YAxis tick={{ fill:T.text3, fontSize:10 }} axisLine={{ stroke:T.bg4 }} allowDecimals={false} />
                <Tooltip content={<CustomTooltip prefix={chart.valuePrefix} suffix={chart.valueSuffix} />} />
                <Line type="monotone" dataKey="value" stroke={chart.data[0]?.color || COLORS[0]} strokeWidth={2.5}
                  dot={{ fill: chart.data[0]?.color || COLORS[0], r: 5, strokeWidth: 2, stroke: T.bg2 }}
                  activeDot={{ r: 7, strokeWidth: 2, stroke: T.bg2 }} />
              </LineChart>
            ) : (
              <PieChart>
                <Pie data={chart.data} dataKey="value" nameKey="label" cx="50%" cy="50%"
                  innerRadius="30%" outerRadius="65%" paddingAngle={2} strokeWidth={0}
                  label={PieLabelRenderer} labelLine={false}>
                  {chart.data.map((d, i) => <Cell key={i} fill={d.color} />)}
                </Pie>
                <Tooltip content={<CustomTooltip prefix={chart.valuePrefix} suffix={chart.valueSuffix} />} />
                <Legend
                  formatter={(value: string) => <span style={{ color: T.text2, fontSize: 10 }}>{value}</span>}
                  wrapperStyle={{ fontSize: 10, paddingTop: 4 }}
                />
              </PieChart>
            )}
          </ResponsiveContainer>
        </div>

        {/* Edit panel */}
        {isEditing && (
          <div style={{ marginTop:6, maxHeight:150, overflowY:"auto", borderTop:`1px solid ${T.bg4}`, paddingTop:8 }}>
            {chart.data.map((dp, idx) => (
              <div key={idx} style={{ display:"flex", alignItems:"center", gap:6, marginBottom:4, fontSize:12 }}>
                <div style={{ position:"relative" }}>
                  <div onClick={() => setColorPicker(colorPicker?.chartId === chart.id && colorPicker.idx === idx ? null : { chartId:chart.id, idx })}
                    style={{ width:16, height:16, borderRadius:4, background:dp.color, cursor:"pointer", border:`1px solid ${T.bg5}` }} />
                  {colorPicker?.chartId === chart.id && colorPicker.idx === idx && (
                    <div style={{ position:"absolute", top:20, left:0, zIndex:20, background:T.bg2, border:`1px solid ${T.bg4}`, borderRadius:8, padding:6, display:"flex", gap:4, flexWrap:"wrap", width:120 }}>
                      {COLORS.map(c => (
                        <div key={c} onClick={() => { updateChart(chart.id, ch => ({ ...ch, data:ch.data.map((d,i) => i===idx?{...d,color:c}:d) })); setColorPicker(null); }}
                          style={{ width:20, height:20, borderRadius:4, background:c, cursor:"pointer", border: dp.color===c?`2px solid #fff`:`1px solid ${T.bg5}` }} />
                      ))}
                    </div>
                  )}
                </div>
                {editingCell?.chartId === chart.id && editingCell.idx === idx && editingCell.field === "label" ? (
                  <input autoFocus value={cellDraft} onChange={e => setCellDraft(e.target.value)}
                    onBlur={() => { updateChart(chart.id, c => ({...c, data:c.data.map((d,i)=>i===idx?{...d,label:cellDraft||d.label}:d)})); setEditingCell(null); }}
                    onKeyDown={e => { if(e.key==="Enter")(e.target as HTMLInputElement).blur(); }}
                    style={{ background:T.bg4, border:`1px solid ${T.bg5}`, borderRadius:3, color:T.text1, fontSize:11, padding:"1px 4px", width:60 }} />
                ) : (
                  <span onClick={() => { setEditingCell({chartId:chart.id,idx,field:"label"}); setCellDraft(dp.label); }}
                    style={{ color:T.text2, cursor:"pointer", minWidth:50 }}>{dp.label}</span>
                )}
                {editingCell?.chartId === chart.id && editingCell.idx === idx && editingCell.field === "value" ? (
                  <input autoFocus type="number" value={cellDraft} onChange={e => setCellDraft(e.target.value)}
                    onBlur={() => { updateChart(chart.id, c => ({...c, data:c.data.map((d,i)=>i===idx?{...d,value:Number(cellDraft)||0}:d)})); setEditingCell(null); }}
                    onKeyDown={e => { if(e.key==="Enter")(e.target as HTMLInputElement).blur(); }}
                    style={{ background:T.bg4, border:`1px solid ${T.bg5}`, borderRadius:3, color:T.text1, fontSize:11, padding:"1px 4px", width:70 }} />
                ) : (
                  <span onClick={() => { setEditingCell({chartId:chart.id,idx,field:"value"}); setCellDraft(String(dp.value)); }}
                    style={{ color:T.accent, cursor:"pointer", fontVariantNumeric:"tabular-nums" }}>{dp.value.toLocaleString()}</span>
                )}
                <button onClick={() => removeDataPoint(chart.id, idx)} style={{ ...smallBtn, padding:"1px 5px", color:T.red, fontSize:10 }}>−</button>
              </div>
            ))}
            <button onClick={() => addDataPoint(chart.id)} style={{ ...smallBtn, marginTop:4, color:T.green }}>+ Add point</button>
          </div>
        )}
      </div>
    );
  };

  // ─── RENDER LEADS TABLE ────────────────────────────────────────────────────
  const renderLeads = () => {
    const hotCount = leads.filter(l => l.status === "Hot").length;
    const warmCount = leads.filter(l => l.status === "Warm").length;
    const coldCount = leads.filter(l => l.status === "Cold").length;
    const totalVal = leads.reduce((s, l) => s + l.value, 0);

    return (
      <div style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden" }}>
        {/* Lead summary bar */}
        <div style={{ display: "flex", gap: 12, marginBottom: 10, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: STATUS_COLORS.Hot }} />
            <span style={{ fontSize: 11, color: T.text2 }}>{hotCount} Hot</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: STATUS_COLORS.Warm }} />
            <span style={{ fontSize: 11, color: T.text2 }}>{warmCount} Warm</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: STATUS_COLORS.Cold }} />
            <span style={{ fontSize: 11, color: T.text2 }}>{coldCount} Cold</span>
          </div>
          <span style={{ fontSize: 11, color: T.text3, marginLeft: "auto" }}>
            Total: <strong style={{ color: T.accent }}>{fmt$(totalVal)}</strong>
          </span>
        </div>

        <div style={{ overflowY: "auto", flex: 1 }}>
          <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12 }}>
            <thead>
              <tr style={{ borderBottom:`1px solid ${T.bg4}` }}>
                {["Name","Company","Status","Value","Stage","Owner",""].map(h => (
                  <th key={h} style={{ textAlign:"left", padding:"8px 6px", color:T.text3, fontWeight:600, fontSize:11 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {leads.map(lead => (
                <tr key={lead.id} style={{ borderBottom:`1px solid ${T.bg4}10` }}>
                  <td style={{ padding:"8px 6px", color:T.text1, fontWeight:500 }}>
                    <div>{lead.name}</div>
                    <div style={{ fontSize: 10, color: T.text3, marginTop: 1 }}>{lead.notes}</div>
                  </td>
                  <td style={{ padding:"8px 6px", color:T.text2 }}>{lead.company}</td>
                  <td style={{ padding:"8px 6px" }}>
                    <span style={{ fontSize:10, padding:"2px 8px", borderRadius:999, background:`${STATUS_COLORS[lead.status]}18`, color:STATUS_COLORS[lead.status], fontWeight:600 }}>{lead.status}</span>
                  </td>
                  <td style={{ padding:"8px 6px", color:T.accent, fontVariantNumeric:"tabular-nums", fontWeight: 600 }}>{fmt$(lead.value)}</td>
                  <td style={{ padding:"8px 6px" }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 4, color: T.text2 }}>
                      <span style={{ fontSize: 12 }}>{STAGE_ICONS[lead.stage] || "📋"}</span>
                      {lead.stage}
                    </span>
                  </td>
                  <td style={{ padding:"8px 6px", color:T.text2 }}>{lead.owner}</td>
                  <td style={{ padding:"8px 6px" }}>
                    <button onClick={() => pullToDiscuss("lead", lead.id, lead.name, { company:lead.company, status:lead.status, value:lead.value, stage:lead.stage, notes:lead.notes, owner:lead.owner })}
                      style={{ ...smallBtn, background:`${T.purple}22`, color:T.purple, fontSize:10 }} title="Pull to Discuss">💬</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  // ─── RENDER DEALS TABLE ────────────────────────────────────────────────────
  const renderDeals = () => {
    const highProb = activeDeals.filter(d => d.probability >= 70);
    const weightedTotal = activeDeals.reduce((s, d) => s + d.amount * (d.probability / 100), 0);

    return (
      <div style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden" }}>
        {/* Deal summary */}
        <div style={{ display: "flex", gap: 16, marginBottom: 10, flexWrap: "wrap", fontSize: 11 }}>
          <div>
            <span style={{ color: T.text3 }}>Weighted Value: </span>
            <strong style={{ color: T.green }}>{fmt$(Math.round(weightedTotal))}</strong>
          </div>
          <div>
            <span style={{ color: T.text3 }}>High Confidence: </span>
            <strong style={{ color: T.accent }}>{highProb.length} deals</strong>
          </div>
        </div>

        <div style={{ overflowY:"auto", flex:1 }}>
          <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12 }}>
            <thead>
              <tr style={{ borderBottom:`1px solid ${T.bg4}` }}>
                {["Deal","Owner","Amount","Close Date","Probability","Stage",""].map(h => (
                  <th key={h} style={{ textAlign:"left", padding:"8px 6px", color:T.text3, fontWeight:600, fontSize:11 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {activeDeals.map(deal => {
                const daysUntilClose = Math.ceil((new Date(deal.closeDate).getTime() - Date.now()) / (1000*60*60*24));
                const isUrgent = daysUntilClose <= 14 && daysUntilClose > 0;
                return (
                  <tr key={deal.id} style={{ borderBottom:`1px solid ${T.bg4}10` }}>
                    <td style={{ padding:"8px 6px", color:T.text1, fontWeight:500 }}>
                      <div>{deal.name}</div>
                      {isUrgent && <div style={{ fontSize: 9, color: T.red, fontWeight: 700, marginTop: 1 }}>⚠ Closing in {daysUntilClose}d</div>}
                    </td>
                    <td style={{ padding:"8px 6px", color:T.text2 }}>{deal.owner}</td>
                    <td style={{ padding:"8px 6px", color:T.accent, fontVariantNumeric:"tabular-nums", fontWeight: 600 }}>{fmt$(deal.amount)}</td>
                    <td style={{ padding:"8px 6px", color: isUrgent ? T.red : T.text2, fontWeight: isUrgent ? 600 : 400 }}>{deal.closeDate}</td>
                    <td style={{ padding:"8px 6px" }}>
                      <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                        <div style={{ width:48, height:6, borderRadius:3, background:T.bg4, overflow:"hidden" }}>
                          <div style={{ width:`${deal.probability}%`, height:"100%", borderRadius:3,
                            background: deal.probability>70 ? T.green : deal.probability>40 ? T.accent : T.red,
                            transition: "width 0.3s"
                          }} />
                        </div>
                        <span style={{ color: deal.probability>70 ? T.green : deal.probability>40 ? T.accent : T.red, fontSize:11, fontWeight:700, fontFamily:"'JetBrains Mono', monospace" }}>
                          {deal.probability}%
                        </span>
                      </div>
                    </td>
                    <td style={{ padding:"8px 6px" }}>
                      <span style={{ display: "flex", alignItems: "center", gap: 4, color: T.text2 }}>
                        <span style={{ fontSize: 12 }}>{STAGE_ICONS[deal.stage] || "📋"}</span>
                        {deal.stage}
                      </span>
                    </td>
                    <td style={{ padding:"8px 6px" }}>
                      <button onClick={() => pullToDiscuss("deal", deal.id, deal.name, { owner:deal.owner, amount:deal.amount, closeDate:deal.closeDate, probability:deal.probability, stage:deal.stage })}
                        style={{ ...smallBtn, background:`${T.purple}22`, color:T.purple, fontSize:10 }} title="Pull to Discuss">💬</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  // ─── MAIN RENDER ───────────────────────────────────────────────────────────
  const isMobile = useIsMobile();

  const kpiCards = [
    { label: "Total Pipeline", value: fmt$(kpis.totalPipeline), sub: `${activeDeals.length} active deals`, color: T.accent, icon: "📊" },
    { label: "Weighted Forecast", value: fmt$(Math.round(kpis.weightedPipeline)), sub: "Probability-adjusted", color: T.green, icon: "🎯" },
    { label: "Avg Deal Size", value: fmt$(kpis.avgDealSize), sub: "Across pipeline", color: COLORS[1], icon: "💰" },
    { label: "Avg Win Probability", value: `${kpis.avgProbability}%`, sub: `${kpis.closingSoon} closing within 30d`, color: COLORS[4], icon: "📈" },
    { label: "YTD Revenue", value: fmt$(kpis.totalRevenue), sub: "All quarters combined", color: COLORS[0], icon: "🏆" },
    { label: "Hot Leads", value: String(kpis.hotLeads), sub: `of ${leads.length} total leads`, color: STATUS_COLORS.Hot, icon: "🔥" },
  ];

  return (
    <div style={{ position:"relative", height:"100%" }}>
      {/* Header */}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:16, flexWrap:"wrap", gap:10 }}>
        <div>
          <h1 style={{ fontSize:22, fontWeight:700, color:T.text0, margin:0, letterSpacing:"-0.02em" }}>Sales Team Dashboard</h1>
          <p style={{ fontSize:12, color:T.text3, margin:"4px 0 0" }}>
            Overview of your pipeline, revenue, and team performance. Click 💬 on any item to pull it into a team discussion.
          </p>
        </div>
        <button onClick={() => setDiscussionOpen(p => !p)}
          style={{
            padding:"8px 16px", borderRadius:10, fontSize:13, fontWeight:600, cursor:"pointer",
            background: discussionOpen ? T.purple : `${T.purple}22`,
            color: discussionOpen ? "#fff" : T.purple,
            border:`1px solid ${discussionOpen ? T.purple : `${T.purple}44`}`,
            transition:"all 0.15s",
          }}>
          💬 Team Discussion {discussions.length > 0 && <span style={{ marginLeft:6, background:`${T.red}`, color:"#fff", borderRadius:999, padding:"1px 6px", fontSize:10, fontWeight:700 }}>{discussions.length}</span>}
        </button>
      </div>

      {/* KPI Cards Row */}
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(2, 1fr)" : "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, marginBottom: 20 }}>
        {kpiCards.map(k => (
          <div key={k.label} style={{
            background: `linear-gradient(145deg,${T.bg2},${T.bg3}88)`,
            border: `1px solid ${T.bg4}`, borderRadius: 12, padding: "14px 16px",
            transition: "border-color 0.15s",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
              <span style={{ fontSize: 14 }}>{k.icon}</span>
              <span style={{ fontSize: 10, color: T.text3, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>{k.label}</span>
            </div>
            <div style={{ fontSize: 20, fontWeight: 800, color: k.color, fontFamily: "'JetBrains Mono', monospace" }}>{k.value}</div>
            <div style={{ fontSize: 10, color: T.text3, marginTop: 2 }}>{k.sub}</div>
          </div>
        ))}
      </div>

      {/* Owner Performance Breakdown */}
      {(() => {
        const owners = [...new Set([...activeDeals.map(d => d.owner), ...leads.map(l => l.owner)])];
        const ownerColors: Record<string, string> = { Marcus: COLORS[1], Sarah: COLORS[2], James: COLORS[0], Anya: COLORS[4] };
        const ownerData = owners.map(owner => {
          const ownerDeals = activeDeals.filter(d => d.owner === owner);
          const ownerLeads = leads.filter(l => l.owner === owner);
          const pipelineValue = ownerDeals.reduce((s, d) => s + d.amount, 0);
          const weightedValue = ownerDeals.reduce((s, d) => s + d.amount * (d.probability / 100), 0);
          const avgProb = ownerDeals.length ? Math.round(ownerDeals.reduce((s, d) => s + d.probability, 0) / ownerDeals.length) : 0;
          const hotLeads = ownerLeads.filter(l => l.status === "Hot").length;
          const highProbDeals = ownerDeals.filter(d => d.probability >= 70).length;
          const maxPipeline = Math.max(...owners.map(o => activeDeals.filter(d => d.owner === o).reduce((s, d) => s + d.amount, 0)), 1);
          return { owner, deals: ownerDeals.length, leads: ownerLeads.length, pipelineValue, weightedValue, avgProb, hotLeads, highProbDeals, color: ownerColors[owner] || COLORS[5], barPct: Math.round((pipelineValue / maxPipeline) * 100) };
        });
        return (
          <div style={{ marginBottom: 20 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
              <span style={{ fontSize: 15, fontWeight: 700, color: T.text0 }}>👥 Rep Performance</span>
              <span style={{ fontSize: 11, color: T.text3 }}>Pipeline ownership & win probability by sales rep</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fit, minmax(240px, 1fr))", gap: 12 }}>
              {ownerData.map(rep => (
                <div key={rep.owner} style={{
                  background: `linear-gradient(145deg,${T.bg2},${T.bg3}88)`,
                  border: `1px solid ${T.bg4}`, borderRadius: 12, padding: "16px 18px",
                  transition: "border-color 0.15s, box-shadow 0.15s",
                }}>
                  {/* Rep header */}
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                    <div style={{
                      width: 36, height: 36, borderRadius: "50%",
                      background: `linear-gradient(135deg, ${rep.color}, ${rep.color}88)`,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 14, fontWeight: 800, color: "#fff",
                    }}>{rep.owner.charAt(0)}</div>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: T.text0 }}>{rep.owner}</div>
                      <div style={{ fontSize: 10, color: T.text3 }}>{rep.deals} deals · {rep.leads} leads</div>
                    </div>
                    {rep.highProbDeals > 0 && (
                      <span style={{ marginLeft: "auto", fontSize: 9, padding: "2px 7px", borderRadius: 999, background: `${T.green}18`, color: T.green, fontWeight: 700 }}>
                        {rep.highProbDeals} likely win{rep.highProbDeals > 1 ? "s" : ""}
                      </span>
                    )}
                  </div>

                  {/* Pipeline bar */}
                  <div style={{ marginBottom: 10 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 4 }}>
                      <span style={{ color: T.text3 }}>Pipeline</span>
                      <span style={{ color: rep.color, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>{fmt$(rep.pipelineValue)}</span>
                    </div>
                    <div style={{ height: 6, background: T.bg4, borderRadius: 3 }}>
                      <div style={{ height: "100%", borderRadius: 3, width: `${rep.barPct}%`, background: rep.color, transition: "width 0.3s ease" }} />
                    </div>
                  </div>

                  {/* Stat grid */}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    <div style={{ background: T.bg3, borderRadius: 8, padding: "8px 10px" }}>
                      <div style={{ fontSize: 9, color: T.text3, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>Weighted</div>
                      <div style={{ fontSize: 14, fontWeight: 800, color: T.green, fontFamily: "'JetBrains Mono', monospace", marginTop: 2 }}>{fmt$(Math.round(rep.weightedValue))}</div>
                    </div>
                    <div style={{ background: T.bg3, borderRadius: 8, padding: "8px 10px" }}>
                      <div style={{ fontSize: 9, color: T.text3, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>Win Prob</div>
                      <div style={{ fontSize: 14, fontWeight: 800, color: rep.avgProb >= 60 ? T.green : rep.avgProb >= 40 ? T.accent : STATUS_COLORS.Hot, fontFamily: "'JetBrains Mono', monospace", marginTop: 2 }}>{rep.avgProb}%</div>
                    </div>
                  </div>

                  {/* Hot leads indicator */}
                  {rep.hotLeads > 0 && (
                    <div style={{ marginTop: 8, fontSize: 10, color: STATUS_COLORS.Hot, display: "flex", alignItems: "center", gap: 4 }}>
                      🔥 {rep.hotLeads} hot lead{rep.hotLeads > 1 ? "s" : ""} in pipeline
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      <div style={{
        display:"flex",
        gap: isMobile ? 16 : 0,
        flexDirection: isMobile ? "column" : "row",
        paddingRight: !isMobile && discussionOpen ? discussionPanelWidth + 24 : 0,
      }}>
        {/* Canvas area */}
        <div ref={containerRef} style={{
          flex:1, minWidth: 0, position:"relative", minHeight: isMobile ? "auto" : 820,
          ...(isMobile ? { display:"flex", flexDirection:"column", gap:16 } : {}),
        }}>
          {panels.map(panel => {
            const chart = panel.chartId ? charts.find(c => c.id === panel.chartId) : null;
            return (
              <div key={panel.id}
                className="sales-panel"
                style={{
                  ...(isMobile ? { position:"relative" as const, width:"100%", minHeight: panel.type === "chart" ? 380 : 320 } : { position:"absolute" as const, left:panel.x, top:panel.y, width:panel.w, height:panel.h }),
                  background:`linear-gradient(145deg,${T.bg2},${T.bg3}88)`,
                  border:`1px solid ${T.bg4}`, borderRadius:14,
                  padding:16, display:"flex", flexDirection:"column",
                  overflow:"hidden", transition: resizeRef.current?.panelId === panel.id ? "none" : "box-shadow 0.2s",
                  boxShadow: T.shadow.card,
                }}>
                {/* Panel title */}
                <div style={{ fontSize:14, fontWeight:700, color:T.text0, marginBottom:10, letterSpacing:"-0.01em" }}>
                  {panel.type !== "chart" && panel.title}
                </div>

                {/* Content */}
                {panel.type === "leads" && renderLeads()}
                {panel.type === "deals" && renderDeals()}
                {panel.type === "chart" && chart && renderChart(chart, panel.w, panel.h)}

                {/* Resize handles */}
                {!isMobile && DIRS.map(dir => (
                  <div key={dir}
                    className="resize-handle"
                    onMouseDown={e => handleResizeStart(e, panel.id, dir)}
                    style={handleStyle(dir)} />
                ))}
              </div>
            );
          })}
        </div>

        {/* Discussion sidebar */}
        {discussionOpen && (
          <div style={{
            width: isMobile ? "100%" : discussionPanelWidth,
            minWidth: isMobile ? "auto" : discussionPanelWidth,
            flexShrink: 0,
            position: isMobile ? "relative" : "fixed",
            top: isMobile ? undefined : 92,
            right: isMobile ? undefined : 16,
            bottom: isMobile ? undefined : 16,
            height: isMobile ? "auto" : "auto",
            zIndex: isMobile ? 1 : 80,
            background: T.bg0,
            border: `1px solid ${T.bg4}`,
            boxShadow: T.shadow.elevated,
            opacity: 1,
            isolation: "isolate",
            mixBlendMode: "normal",
            padding:20,
            overflowY:"auto",
            maxHeight: isMobile ? 500 : "none",
            borderRadius: isMobile ? 14 : 12,
            ...(isMobile ? { marginTop:16 } : {}),
          }}>
            {/* Drag resize handle on left edge */}
            {!isMobile && (
              <div
                onMouseDown={e => {
                  e.preventDefault();
                  discResizeRef.current = { startX: e.clientX, startW: discussionPanelWidth };
                  document.body.style.cursor = "col-resize";
                  document.body.style.userSelect = "none";
                }}
                style={{
                  position: "absolute", left: 0, top: 0, bottom: 0, width: 6,
                  cursor: "col-resize", zIndex: 10,
                  background: "transparent",
                  transition: "background 0.15s",
                }}
                onMouseEnter={e => (e.currentTarget.style.background = `${T.purple}44`)}
                onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
              />
            )}
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:16 }}>
              <span style={{ fontSize:16, fontWeight:700, color:T.text0 }}>💬 Team Discussion</span>
              <button onClick={() => setDiscussionOpen(false)} style={{ background:"none", border:"none", color:T.text3, fontSize:18, cursor:"pointer" }}>✕</button>
            </div>

            {/* Search & filter */}
            <input value={discSearch} onChange={e => setDiscSearch(e.target.value)} placeholder="Search discussions…"
              style={{ background:T.bg3, border:`1px solid ${T.bg4}`, borderRadius:8, color:T.text1, padding:"8px 12px", width:"100%", fontSize:12, marginBottom:10, outline:"none", boxSizing:"border-box" }} />
            <div style={{ display:"flex", gap:4, marginBottom:16, flexWrap:"wrap" }}>
              {["all","lead","deal","chart","Needs Review","In Progress","Resolved"].map(f => (
                <button key={f} onClick={() => setDiscFilter(f)} style={{
                  padding:"4px 10px", borderRadius:999, fontSize:10, fontWeight:600, cursor:"pointer",
                  background: discFilter === f ? `${T.accent}22` : T.bg3,
                  color: discFilter === f ? T.accent : T.text3,
                  border:`1px solid ${discFilter === f ? `${T.accent}44` : T.bg4}`,
                }}>{f === "all" ? "All" : f.charAt(0).toUpperCase() + f.slice(1)}</button>
              ))}
            </div>

            {filteredDiscussions.length === 0 && (
              <div style={{ textAlign:"center", padding:40, color:T.text3, fontSize:13 }}>
                No items yet — click 💬 on any lead, deal, or chart to pull it here.
              </div>
            )}

            {filteredDiscussions.map(item => (
              <div key={item.id} style={{ background:T.bg2, border:`1px solid ${T.bg4}`, borderRadius:10, padding:14, marginBottom:10 }}>
                <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:8, gap:6 }}>
                  <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                    <span style={{ fontSize:12, padding:"2px 8px", borderRadius:999, background:`${T.purple}18`, color:T.purple, fontWeight:600 }}>
                      {item.sourceType}
                    </span>
                    <span style={{ fontSize:13, fontWeight:600, color:T.text0 }}>{item.title}</span>
                  </div>
                  <select value={item.status} onChange={e => updateDiscussion(item.id, { status: e.target.value as DiscussionItem["status"] })}
                    style={{ background:T.bg4, border:`1px solid ${T.bg5}`, borderRadius:6, color: STATUS_COLORS[item.status] || T.text2, fontSize:10, fontWeight:600, padding:"2px 6px", cursor:"pointer" }}>
                    <option value="Needs Review">Needs Review</option>
                    <option value="In Progress">In Progress</option>
                    <option value="Resolved">Resolved</option>
                  </select>
                </div>

                {/* Snapshot data */}
                <div style={{ background:T.bg3, borderRadius:8, padding:10, marginBottom:8, fontSize:11, color:T.text2 }}>
                  {Object.entries(item.snapshot).filter(([k]) => k !== "data").map(([k, v]) => (
                    <div key={k} style={{ display:"flex", justifyContent:"space-between", padding:"2px 0" }}>
                      <span style={{ color:T.text3 }}>{k}</span>
                      <span style={{ color:T.text1 }}>{typeof v === "number" && v > 999 ? fmt$(v) : String(v)}</span>
                    </div>
                  ))}
                </div>

                {/* Notes */}
                <textarea value={item.notes} onChange={e => updateDiscussion(item.id, { notes: e.target.value })}
                  placeholder="Add team notes…"
                  style={{ width:"100%", background:T.bg4, border:`1px solid ${T.bg5}`, borderRadius:6, color:T.text1, fontSize:12, padding:8, resize:"vertical", minHeight:50, outline:"none", boxSizing:"border-box" }} />

                <div style={{ fontSize:10, color:T.text3, marginTop:6 }}>
                  Pulled {new Date(item.pulledAt).toLocaleString()}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <style>{`
        .sales-panel:hover .resize-handle { opacity:1 !important; background:${T.accent}44; }
        .sales-panel:hover .resize-handle:hover { background:${T.accent}88; }
      `}</style>
    </div>
  );
}

const smallBtn: React.CSSProperties = {
  background:T.bg4, border:`1px solid ${T.bg5}`, borderRadius:6,
  color:T.text2, fontSize:11, padding:"3px 8px", cursor:"pointer",
  transition:"all 0.1s", whiteSpace:"nowrap",
};
