import { useMemo, useState, useEffect, useCallback } from "react";
import { T, calcLeadScore, type Contact, type Deal, type Note, type EmailLogEntry, type Task } from "@/lib/crm-data";
import {
  DEFAULT_LEAD_MODEL_STATE,
  CONFUSION_MATRIX_LABELS,
  applyTrainModelV2,
  type LeadModelState,
  type ConfusionMatrix,
} from "@/lib/crm-lead-model";
import { BarChart, Bar, LineChart, Line, ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid, RadarChart, PolarGrid, PolarAngleAxis, Radar, Cell } from "recharts";
import { MiniRing } from "./shared/MiniRing";
import { DashboardEmptyState } from "./shared/DashboardEmptyState";

interface Props {
  contacts: Contact[];
  deals: Deal[];
  notes?: Note[];
  emailLog?: EmailLogEntry[];
  tasks?: Task[];
  leadModelState?: LeadModelState;
  onLeadModelStateChange?: (state: LeadModelState) => void;
}

interface TooltipPayloadItem {
  name?: string;
  value?: number;
  color?: string;
  stroke?: string;
}

interface ChartTooltipProps {
  active?: boolean;
  payload?: TooltipPayloadItem[];
  label?: string;
}

const ChartTooltip = ({ active, payload, label }: ChartTooltipProps) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: T.bg2, border: `1px solid ${T.bg4}`, borderRadius: T.radius.md, padding: "8px 12px", fontSize: 11 }}>
      <div style={{ color: T.text3, marginBottom: 4 }}>{label}</div>
      {payload.map((p, i) => (
        <div key={i} style={{ color: p.color || p.stroke, fontWeight: 600 }}>{p.name}: {p.value}</div>
      ))}
    </div>
  );
};

function computeScoreFactors(contacts: Contact[], deals: Deal[]) {
  const wonContacts = new Set(deals.filter(d => d.stage === "Closed Won").map(d => d.contact));
  const factors = [
    { name: "Engagement", weight: 0.3, desc: "Email opens & note activity" },
    { name: "Company Fit", weight: 0.2, desc: "Enterprise tags & company signals" },
    { name: "Recency", weight: 0.2, desc: "Time since last contact" },
    { name: "History", weight: 0.15, desc: "Past win patterns" },
    { name: "Intent", weight: 0.15, desc: "Warm / enterprise tags" },
  ];
  if (wonContacts.size > 0) {
    factors[0].weight = 0.35; factors[3].weight = 0.2; factors[4].weight = 0.1;
  }
  return factors;
}

function ConfusionMatrixCard({ matrix }: { matrix: ConfusionMatrix }) {
  const cells: { key: keyof ConfusionMatrix; accent: string }[] = [
    { key: "truePos", accent: T.green },
    { key: "falseNeg", accent: T.orange },
    { key: "falsePos", accent: T.red },
    { key: "trueNeg", accent: T.blue },
  ];
  const total = cells.reduce((s, c) => s + (matrix[c.key] || 0), 0) || 1;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
      {cells.map(({ key, accent }) => {
        const meta = CONFUSION_MATRIX_LABELS[key];
        const n = matrix[key] || 0;
        const pct = Math.round((n / total) * 100);
        return (
          <div key={key} style={{
            padding: "12px 12px", borderRadius: T.radius.md,
            background: `${accent}10`, border: `1px solid ${accent}33`, textAlign: "center",
          }}>
            <div style={{ fontSize: 22, fontWeight: 800, color: accent, fontFamily: "'JetBrains Mono', monospace" }}>
              {n}
            </div>
            <div style={{ fontSize: 11, fontWeight: 700, color: T.text1, marginTop: 4 }}>{meta.short}</div>
            <div style={{ fontSize: 10, color: T.text3, marginTop: 2 }}>{pct}% of sample</div>
            <div style={{ fontSize: 10, color: T.text2, marginTop: 4, lineHeight: 1.35 }}>{meta.hint}</div>
          </div>
        );
      })}
    </div>
  );
}

export function LeadGenTab({
  contacts, deals, notes = [], emailLog = [], tasks = [],
  leadModelState = DEFAULT_LEAD_MODEL_STATE,
  onLeadModelStateChange,
}: Props) {
  const factors = useMemo(() => computeScoreFactors(contacts, deals), [contacts, deals]);
  const [isTraining, setIsTraining] = useState(false);
  const [displayAccuracy, setDisplayAccuracy] = useState(leadModelState.estimatedAccuracy);

  useEffect(() => {
    setDisplayAccuracy(leadModelState.estimatedAccuracy);
  }, [leadModelState.estimatedAccuracy]);

  const scoredContacts = useMemo(() => {
    return contacts
      .filter(c => c.status !== "Customer")
      .map(c => ({ ...c, aiScore: calcLeadScore(c, emailLog, deals, notes, tasks) }))
      .sort((a, b) => b.aiScore - a.aiScore);
  }, [contacts, deals, notes, emailLog, tasks]);

  const radarData = useMemo(() => factors.map((f) => ({
    feature: f.name,
    importance: Math.round(f.weight * 100),
  })), [factors]);

  const scoreBuckets = useMemo(() => {
    const buckets = [
      { range: "0–39", count: 0, color: T.red },
      { range: "40–59", count: 0, color: T.orange },
      { range: "60–79", count: 0, color: T.accent },
      { range: "80+", count: 0, color: T.green },
    ];
    for (const c of scoredContacts) {
      if (c.aiScore < 40) buckets[0].count++;
      else if (c.aiScore < 60) buckets[1].count++;
      else if (c.aiScore < 80) buckets[2].count++;
      else buckets[3].count++;
    }
    return buckets;
  }, [scoredContacts]);

  const trainingChartData = useMemo(() =>
    leadModelState.trainingHistory.map((p) => ({
      epoch: `E${p.epoch}`,
      accuracy: p.accuracy,
      loss: p.loss,
    })),
  [leadModelState.trainingHistory]);

  const handleTrainModel = useCallback(() => {
    if (isTraining || leadModelState.version === "v2") return;
    setIsTraining(true);
    const startAcc = leadModelState.estimatedAccuracy;
    const start = performance.now();
    const duration = 3000;

    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      setDisplayAccuracy(Math.round(startAcc + (78 - startAcc) * t));
      if (t < 1) {
        requestAnimationFrame(tick);
      } else {
        const next = applyTrainModelV2(leadModelState);
        onLeadModelStateChange?.(next);
        setDisplayAccuracy(78);
        setIsTraining(false);
      }
    };
    requestAnimationFrame(tick);
  }, [isTraining, leadModelState, onLeadModelStateChange]);

  const cardStyle = {
    background: `linear-gradient(145deg,${T.bg2},${T.bg3}88)`,
    border: `1px solid ${T.bg4}`, borderRadius: T.radius.lg, padding: "14px 14px",
  };

  const avgScore = scoredContacts.length
    ? Math.round(scoredContacts.reduce((s, c) => s + c.aiScore, 0) / scoredContacts.length)
    : 0;

  const modelLabel = leadModelState.version === "v2" ? "Rules v2" : "Rules v1";

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: T.text0, margin: 0, letterSpacing: "-0.02em" }}>🎯 Lead Scoring</h1>
          <p style={{ fontSize: 13, color: T.text2, marginTop: 4 }}>
            Rule-based scores from contacts, deals, emails, tasks, and notes — updates live as your data changes
          </p>
        </div>
        <button
          type="button"
          disabled={isTraining || leadModelState.version === "v2"}
          onClick={handleTrainModel}
          style={{
            padding: "10px 18px", borderRadius: T.radius.md, border: "none", cursor: isTraining || leadModelState.version === "v2" ? "not-allowed" : "pointer",
            background: `linear-gradient(135deg, ${T.purple}, #7c3aed)`,
            color: "#fff", fontSize: 12, fontWeight: 700, opacity: isTraining || leadModelState.version === "v2" ? 0.65 : 1,
            position: "relative", overflow: "hidden",
          }}
        >
          {isTraining ? "Optimizing algorithmic weights…" : leadModelState.version === "v2" ? "Model Trained (v2)" : "Train Model (v2)"}
        </button>
      </div>

      {isTraining && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 2000, background: "rgba(8,13,24,0.72)",
          display: "flex", alignItems: "center", justifyContent: "center", backdropFilter: "blur(4px)",
        }}>
          <div style={{ textAlign: "center" }}>
            <div className="crm-training-spinner" style={{
              width: 48, height: 48, border: `3px solid ${T.bg4}`,
              borderTopColor: T.purple, borderRadius: "50%", margin: "0 auto 16px",
            }} />
            <div style={{ fontSize: 14, fontWeight: 600, color: T.text0 }}>Optimizing algorithmic weights…</div>
            <div style={{ fontSize: 12, color: T.text2, marginTop: 6 }}>Est. Accuracy {displayAccuracy}%</div>
          </div>
        </div>
      )}

      <div className="crm-stats-grid" style={{ display: "grid", gap: 10, marginBottom: 16 }}>
        {[
          { label: "Scoring Model", value: modelLabel, color: T.purple },
          { label: "Est. Accuracy", value: `${displayAccuracy}%`, color: T.blue, animate: true, ring: displayAccuracy },
          { label: "Scored Leads", value: String(scoredContacts.length), color: T.blue },
          { label: "Avg Score", value: String(avgScore), color: T.accent, ring: Math.min(avgScore, 100) },
          { label: "Hot Leads (80+)", value: String(scoredContacts.filter(c => c.aiScore >= 80).length), color: T.green },
        ].map(s => (
          <div key={s.label} style={{ ...cardStyle, display: "flex", alignItems: "center", gap: 10, minHeight: 84 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 10, color: T.text3, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>{s.label}</div>
              <div style={{
                fontSize: 22, fontWeight: 800, color: s.color, fontFamily: "'JetBrains Mono', monospace",
                transition: s.animate ? "color 0.3s ease" : undefined, lineHeight: 1.1,
              }}>{s.value}</div>
            </div>
            {s.ring != null && (
              <div style={{ position: "relative", width: 48, height: 48, flexShrink: 0 }}>
                <MiniRing segments={[{ value: Math.max(s.ring, 1), color: s.color, label: s.label }, { value: Math.max(100 - s.ring, 0), color: T.bg4, label: "rest" }]} size={48} stroke={5} />
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="crm-dashboard-grid" style={{ display: "grid", gap: 14, marginBottom: 14 }}>
        <div style={cardStyle}>
          <div style={{ fontSize: 14, fontWeight: 600, color: T.text0, marginBottom: 16 }}>Confusion Matrix</div>
          <ConfusionMatrixCard matrix={leadModelState.confusionMatrix} />
        </div>

        <div style={cardStyle}>
          <div style={{ fontSize: 14, fontWeight: 600, color: T.text0, marginBottom: 16 }}>Training History</div>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={trainingChartData}>
              <CartesianGrid strokeDasharray="3 3" stroke={T.bg4} vertical={false} />
              <XAxis dataKey="epoch" tick={{ fontSize: 10, fill: T.text3 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10, fill: T.text3 }} axisLine={false} tickLine={false} domain={[40, 100]} />
              <Tooltip content={<ChartTooltip />} />
              <Line type="monotone" dataKey="accuracy" name="Accuracy %" stroke={T.purple} strokeWidth={2} dot={{ r: 3, fill: T.purple }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="crm-dashboard-grid" style={{ display: "grid", gap: 14, marginBottom: 14 }}>
        <div style={cardStyle}>
          <div style={{ fontSize: 14, fontWeight: 600, color: T.text0, marginBottom: 16 }}>Score Factors</div>
          <ResponsiveContainer width="100%" height={220}>
            <RadarChart data={radarData}>
              <PolarGrid stroke={T.bg4} />
              <PolarAngleAxis dataKey="feature" tick={{ fontSize: 10, fill: T.text3 }} />
              <Radar name="Weight" dataKey="importance" stroke={T.accent} fill={T.accent} fillOpacity={0.2} strokeWidth={2} />
              <Tooltip content={<ChartTooltip />} />
            </RadarChart>
          </ResponsiveContainer>
          <div style={{ fontSize: 11, color: T.text3, marginTop: 8 }}>
            {factors.map(f => `${f.name} (${Math.round(f.weight * 100)}%)`).join(" · ")}
          </div>
        </div>

        <div style={cardStyle}>
          <div style={{ fontSize: 14, fontWeight: 600, color: T.text0, marginBottom: 16 }}>Score Distribution</div>
          {scoredContacts.length === 0 ? (
            <DashboardEmptyState icon="📊" title="No scored leads yet" subtitle="Add non-customer contacts to populate the score histogram." />
          ) : (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={scoreBuckets} barSize={28}>
              <CartesianGrid strokeDasharray="3 3" stroke={T.bg4} vertical={false} />
              <XAxis dataKey="range" tick={{ fontSize: 10, fill: T.text3 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10, fill: T.text3 }} axisLine={false} tickLine={false} allowDecimals={false} domain={[0, "auto"]} />
              <Tooltip content={<ChartTooltip />} />
              <Bar dataKey="count" name="Leads" radius={[4, 4, 0, 0]}>
                {scoreBuckets.map((b, i) => <Cell key={i} fill={b.color} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          )}
        </div>
      </div>

      <div style={cardStyle}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: T.text0 }}>Top Scored Leads</div>
          <div style={{ fontSize: 11, color: T.text3 }}>Ranked by composite score</div>
        </div>
        {scoredContacts.length === 0 ? (
          <div style={{ textAlign: "center", padding: "32px 0", color: T.text3, fontSize: 13 }}>Add contacts to see lead scores</div>
        ) : (
          <div className="crm-panel-scroll">
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {scoredContacts.slice(0, 12).map((c, i) => {
                const scoreColor = c.aiScore >= 75 ? T.green : c.aiScore >= 50 ? T.accent : "#94a3b8";
                return (
                  <div key={c.id} style={{
                    display: "flex", alignItems: "center", gap: 12, padding: "12px 14px",
                    background: i === 0 ? `${T.accent}08` : "transparent",
                    border: `1px solid ${i === 0 ? `${T.accent}33` : T.bg4}`, borderRadius: T.radius.md,
                  }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: T.text3, width: 20, textAlign: "center", fontFamily: "'JetBrains Mono', monospace" }}>#{i + 1}</div>
                    <div style={{
                      width: 32, height: 32, borderRadius: T.radius.md,
                      background: `linear-gradient(135deg,${scoreColor},${T.bg4})`,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 13, fontWeight: 700, color: "#fff", flexShrink: 0,
                    }}>{c.name[0]}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: T.text0 }}>{c.name}</div>
                      <div style={{ fontSize: 11, color: T.text2 }}>{c.company} · {c.status}</div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{ width: 60, height: 6, background: T.bg4, borderRadius: 3, overflow: "hidden" }}>
                        <div style={{ height: "100%", width: `${c.aiScore}%`, background: scoreColor, borderRadius: 3, transition: "width 0.35s ease" }} />
                      </div>
                      <span style={{ fontSize: 13, fontWeight: 700, color: scoreColor, fontFamily: "'JetBrains Mono', monospace", minWidth: 28, textAlign: "right" }}>{c.aiScore}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
