import { useState, useMemo } from "react";
import { T, S, fmt, type Quota, type QuotaPeriod, TEAM_MEMBERS, getQuotaDaysRemaining } from "@/lib/crm-data";
import { toast } from "sonner";

interface Props {
  quotas: Quota[];
}

const PERIOD_LABELS: Record<QuotaPeriod, string> = {
  weekly: "Weekly", monthly: "Monthly", quarterly: "Quarterly", annual: "Annual",
};

interface Scenario {
  quota: Quota;
  currentDailyRate: number;
  daysRemaining: number;
  daysElapsed: number;
  daysTotal: number;
  originalProjected: number;
  originalPct: number;
}

interface SavedSnapshot {
  id: number;
  name: string;
  quotaId: number;
  quotaLabel: string;
  memberName: string;
  rateMultiplier: number;
  projectedPct: number;
  projectedValue: number;
  savedAt: string;
}

function buildScenario(q: Quota): Scenario {
  const start = new Date(q.startDate).getTime();
  const end = new Date(q.endDate).getTime();
  const now = Date.now();
  const daysTotal = Math.max(1, Math.ceil((end - start) / 86400000));
  const daysElapsed = Math.max(1, Math.ceil((Math.min(now, end) - start) / 86400000));
  const daysRemaining = getQuotaDaysRemaining(q);
  const currentDailyRate = q.currentValue / daysElapsed;
  const originalProjected = Math.round(currentDailyRate * daysTotal);

  return {
    quota: q,
    currentDailyRate,
    daysRemaining,
    daysElapsed,
    daysTotal,
    originalProjected,
    originalPct: Math.round((originalProjected / q.targetValue) * 100),
  };
}

export function QuotaWhatIf({ quotas }: Props) {
  const activeQuotas = useMemo(() => quotas.filter(q => q.status !== "achieved"), [quotas]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [rateMultiplier, setRateMultiplier] = useState(100);
  const [snapshots, setSnapshots] = useState<SavedSnapshot[]>([]);
  const [snapshotName, setSnapshotName] = useState("");
  const [showSnapshots, setShowSnapshots] = useState(false);

  const selected = activeQuotas.find(q => q.id === selectedId) || activeQuotas[0];
  const scenario = useMemo(() => selected ? buildScenario(selected) : null, [selected]);

  const adjusted = useMemo(() => {
    if (!scenario) return null;
    const mult = rateMultiplier / 100;
    const newRate = scenario.currentDailyRate * mult;
    const projected = Math.round(scenario.quota.currentValue + newRate * scenario.daysRemaining);
    const pct = Math.round((projected / scenario.quota.targetValue) * 100);
    return { rate: newRate, projected, pct };
  }, [scenario, rateMultiplier]);

  if (activeQuotas.length === 0 || !scenario || !adjusted) return null;

  const member = TEAM_MEMBERS.find(m => m.id === scenario.quota.assigneeId);
  const delta = adjusted.pct - scenario.originalPct;
  const projColor = adjusted.pct >= 100 ? "#22d3a0" : adjusted.pct >= 80 ? "#4d9ef7" : adjusted.pct >= 60 ? "#fbbf24" : "#f85b5b";

  const neededRemaining = scenario.quota.targetValue - scenario.quota.currentValue;
  const neededRate = scenario.daysRemaining > 0 ? neededRemaining / scenario.daysRemaining : 0;
  const neededMultiplier = scenario.currentDailyRate > 0
    ? Math.round((neededRate / scenario.currentDailyRate) * 100) : 0;

  const handleSaveSnapshot = () => {
    const name = snapshotName.trim() || `${scenario.quota.assigneeName} @ ${rateMultiplier}%`;
    const snap: SavedSnapshot = {
      id: Date.now(),
      name,
      quotaId: scenario.quota.id,
      quotaLabel: `${scenario.quota.type} · ${PERIOD_LABELS[scenario.quota.period]}`,
      memberName: scenario.quota.assigneeName,
      rateMultiplier,
      projectedPct: adjusted.pct,
      projectedValue: adjusted.projected,
      savedAt: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    };
    setSnapshots(prev => [...prev, snap]);
    setSnapshotName("");
    toast.success(`📌 Snapshot "${name}" saved`);
  };

  const handleDeleteSnapshot = (id: number) => {
    setSnapshots(prev => prev.filter(s => s.id !== id));
  };

  const handleLoadSnapshot = (snap: SavedSnapshot) => {
    const q = activeQuotas.find(q => q.id === snap.quotaId);
    if (q) {
      setSelectedId(q.id);
      setRateMultiplier(snap.rateMultiplier);
      toast.success(`Loaded snapshot "${snap.name}"`);
    }
  };

  return (
    <div style={{ ...S.card as React.CSSProperties, padding: "20px 24px", marginBottom: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h3 style={{ fontSize: 14, fontWeight: 700, color: T.text0, margin: 0 }}>🧪 What-If Scenarios</h3>
        <div style={{ display: "flex", gap: 8 }}>
          {snapshots.length > 0 && (
            <button aria-label="Action" onClick={() => setShowSnapshots(!showSnapshots)} style={{
              ...S.btnGhost as React.CSSProperties, fontSize: 14, padding: "4px 10px",
              color: showSnapshots ? T.accent : T.text3,
            }}>📌 {snapshots.length} saved</button>
          )}
          <span style={{ fontSize: 14, color: T.text3 }}>Adjust pace to forecast</span>
        </div>
      </div>

      {/* Saved Snapshots Panel */}
      {showSnapshots && snapshots.length > 0 && (
        <div style={{
          marginBottom: 16, padding: "12px 16px", borderRadius: T.radius.md,
          background: T.bg3, border: `1px solid ${T.bg4}`,
        }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: T.text2, marginBottom: 8 }}>SAVED SNAPSHOTS</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {snapshots.map(snap => {
              const snapColor = snap.projectedPct >= 100 ? "#22d3a0" : snap.projectedPct >= 80 ? "#4d9ef7" : snap.projectedPct >= 60 ? "#fbbf24" : "#f85b5b";
              return (
                <div key={snap.id} style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  padding: "8px 12px", borderRadius: T.radius.md,
                  background: T.bg2, border: `1px solid ${T.bg4}`,
                }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: T.text0 }}>{snap.name}</div>
                    <div style={{ fontSize: 14, color: T.text3 }}>
                      {snap.memberName} · {snap.quotaLabel} · {snap.rateMultiplier}% pace
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{
                      fontSize: 14, fontWeight: 800, color: snapColor,
                      fontFamily: "'JetBrains Mono', monospace",
                    }}>{snap.projectedPct}%</span>
                    <button aria-label="Action" onClick={() => handleLoadSnapshot(snap)} style={{
                      ...S.btnGhost as React.CSSProperties, fontSize: 14, padding: "3px 8px",
                    }}>Load</button>
                    <button aria-label="Action" onClick={() => handleDeleteSnapshot(snap.id)} style={{
                      background: "none", border: "none", color: T.text3,
                      cursor: "pointer", fontSize: 14, padding: 2,
                    }}>✕</button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Quota Selector */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {activeQuotas.map(q => {
            const m = TEAM_MEMBERS.find(m => m.id === q.assigneeId);
            const isSelected = q.id === (selected?.id);
            return (
              <button aria-label="Action" key={q.id} onClick={() => { setSelectedId(q.id); setRateMultiplier(100); }} style={{
                padding: "6px 12px", borderRadius: T.radius.md, fontSize: 14, fontWeight: 600,
                background: isSelected ? `${T.accent}22` : T.bg3,
                color: isSelected ? T.accent : T.text3,
                border: `1px solid ${isSelected ? `${T.accent}66` : T.bg4}`,
                cursor: "pointer",
              }}>{m?.avatar} {q.type}</button>
            );
          })}
        </div>
      </div>

      {/* Scenario Panel */}
      <div style={{
        padding: "18px 20px", borderRadius: T.radius.md,
        background: `linear-gradient(135deg, ${T.bg3}, ${T.bg2})`,
        border: `1px solid ${T.bg4}`,
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{
              width: 32, height: 32, borderRadius: T.radius.full,
              background: `linear-gradient(135deg, ${T.purple}, ${T.blue})`,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 14, fontWeight: 700, color: "#fff",
            }}>{member?.avatar}</div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: T.text0 }}>{scenario.quota.assigneeName}</div>
              <div style={{ fontSize: 14, color: T.text3 }}>
                {scenario.quota.type} · {PERIOD_LABELS[scenario.quota.period]} · {scenario.daysRemaining} days left
              </div>
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{
              fontSize: 28, fontWeight: 800, color: projColor,
              fontFamily: "'JetBrains Mono', monospace",
            }}>{adjusted.pct}%</div>
            <div style={{ fontSize: 14, color: delta >= 0 ? "#22d3a0" : "#f85b5b", fontWeight: 600 }}>
              {delta > 0 ? "+" : ""}{delta}% vs current pace
            </div>
          </div>
        </div>

        {/* Rate Slider */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
            <label style={{ fontSize: 14, color: T.text2, fontWeight: 600 }}>Daily Pace Adjustment</label>
            <span style={{
              fontSize: 14, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace",
              color: rateMultiplier > 100 ? "#22d3a0" : rateMultiplier < 100 ? "#f85b5b" : T.text1,
            }}>{rateMultiplier}%</span>
          </div>
          <input
            type="range" min={20} max={250} value={rateMultiplier}
            onChange={e = aria-label="range"> setRateMultiplier(Number(e.target.value))}
            style={{ width: "100%", accentColor: T.accent, cursor: "pointer" }}
          />
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, color: T.text3, marginTop: 2 }}>
            <span>20% slower</span>
            <span>100% current</span>
            <span>250% aggressive</span>
          </div>
        </div>

        {/* Quick Presets */}
        <div style={{ display: "flex", gap: 6, marginBottom: 16, flexWrap: "wrap" }}>
          {[
            { label: "50% slower", value: 50 },
            { label: "Current pace", value: 100 },
            { label: "50% faster", value: 150 },
            { label: "Double down", value: 200 },
            ...(neededMultiplier > 0 && neededMultiplier <= 300
              ? [{ label: `Hit target (${neededMultiplier}%)`, value: neededMultiplier }]
              : []),
          ].map(preset => (
            <button aria-label="Action" key={preset.value} onClick={() => setRateMultiplier(preset.value)} style={{
              padding: "4px 10px", borderRadius: T.radius.full, fontSize: 14, fontWeight: 600,
              background: rateMultiplier === preset.value ? `${T.accent}22` : T.bg4,
              color: rateMultiplier === preset.value ? T.accent : T.text3,
              border: `1px solid ${rateMultiplier === preset.value ? `${T.accent}66` : "transparent"}`,
              cursor: "pointer",
            }}>{preset.label}</button>
          ))}
        </div>

        {/* Comparison */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div style={{
            padding: "12px 14px", borderRadius: T.radius.md, background: T.bg4,
            borderLeft: `3px solid ${T.text3}`,
          }}>
            <div style={{ fontSize: 14, color: T.text3, marginBottom: 4 }}>CURRENT PACE</div>
            <div style={{ fontSize: 14, color: T.text2 }}>
              Rate: <span style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 600 }}>
                {scenario.quota.type === "Revenue" ? fmt(Math.round(scenario.currentDailyRate)) : (Math.round(scenario.currentDailyRate * 10) / 10)}
              </span>/day
            </div>
            <div style={{ fontSize: 14, color: T.text2 }}>
              Projected: <span style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 600 }}>
                {scenario.quota.type === "Revenue" ? fmt(scenario.originalProjected) : scenario.originalProjected}
              </span>
            </div>
            <div style={{ fontSize: 14, color: T.text2 }}>
              Attainment: <span style={{ fontWeight: 700 }}>{scenario.originalPct}%</span>
            </div>
          </div>

          <div style={{
            padding: "12px 14px", borderRadius: T.radius.md, background: `${projColor}0a`,
            borderLeft: `3px solid ${projColor}`,
          }}>
            <div style={{ fontSize: 14, color: projColor, marginBottom: 4 }}>ADJUSTED SCENARIO</div>
            <div style={{ fontSize: 14, color: T.text1 }}>
              Rate: <span style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 600, color: projColor }}>
                {scenario.quota.type === "Revenue" ? fmt(Math.round(adjusted.rate)) : (Math.round(adjusted.rate * 10) / 10)}
              </span>/day
            </div>
            <div style={{ fontSize: 14, color: T.text1 }}>
              Projected: <span style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, color: projColor }}>
                {scenario.quota.type === "Revenue" ? fmt(adjusted.projected) : adjusted.projected}
              </span>
            </div>
            <div style={{ fontSize: 14, color: T.text1 }}>
              Attainment: <span style={{ fontWeight: 800, color: projColor }}>{adjusted.pct}%</span>
            </div>
          </div>
        </div>

        {/* Progress visualization */}
        <div style={{ marginTop: 14 }}>
          <div style={{ position: "relative", height: 8, background: T.bg4, borderRadius: T.radius.full, overflow: "visible" }}>
            <div style={{
              height: "100%", width: `${Math.min(100, Math.round((scenario.quota.currentValue / scenario.quota.targetValue) * 100))}%`,
              borderRadius: T.radius.full, background: T.text3, transition: "width 0.3s",
            }} />
            <div style={{
              position: "absolute", top: -4, height: 16, width: 2,
              background: T.text3, opacity: 0.5,
              left: `${Math.min(100, scenario.originalPct)}%`, borderRadius: 1,
            }} title={`Current pace: ${scenario.originalPct}%`} />
            <div style={{
              position: "absolute", top: -4, height: 16, width: 3,
              background: projColor,
              left: `${Math.min(100, adjusted.pct)}%`, borderRadius: 1,
              transition: "left 0.3s",
            }} title={`Adjusted: ${adjusted.pct}%`} />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, color: T.text3, marginTop: 4 }}>
            <span>Current: {Math.round((scenario.quota.currentValue / scenario.quota.targetValue) * 100)}%</span>
            <span>Target: {scenario.quota.type === "Revenue" ? fmt(scenario.quota.targetValue) : scenario.quota.targetValue}</span>
          </div>
        </div>

        {/* Save Snapshot */}
        <div style={{
          display: "flex", gap: 8, marginTop: 14, paddingTop: 14,
          borderTop: `1px solid ${T.bg4}`,
        }}>
          <input
            value={snapshotName}
            onChange={e = aria-label="input"> setSnapshotName(e.target.value)}
            placeholder={`${scenario.quota.assigneeName} @ ${rateMultiplier}%`}
            style={{ ...S.input as React.CSSProperties, flex: 1, fontSize: 14, padding: "6px 10px" }}
          />
          <button aria-label="Save" onClick={handleSaveSnapshot} style={{
            ...S.btn as React.CSSProperties, fontSize: 14, padding: "6px 14px", whiteSpace: "nowrap",
          }}>📌 Save Snapshot</button>
        </div>
      </div>
    </div>
  );
}
