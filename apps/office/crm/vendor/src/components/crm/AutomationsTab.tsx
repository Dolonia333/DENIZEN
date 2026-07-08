import { useState } from "react";
import { T, S, AUTO_TRIGGERS, AUTO_ACTIONS, type Automation, type AutomationRun } from "@/lib/crm-data";

interface Props {
  automations: Automation[];
  automationRuns?: AutomationRun[];
  onUpdate: (automations: Automation[]) => void;
}

export function AutomationsTab({ automations, automationRuns = [], onUpdate }: Props) {
  const [editing, setEditing] = useState<Automation | null>(null);
  const [showNew, setShowNew] = useState(false);

  const card = { background: `linear-gradient(145deg,${T.bg2},${T.bg3}88)`, border: `1px solid ${T.bg4}`, borderRadius: T.radius.lg, padding: "20px 22px", marginBottom: 14 };

  const handleToggle = (id: number) => {
    onUpdate(automations.map(a => a.id === id ? { ...a, active: !a.active } : a));
  };

  const handleDelete = (id: number) => {
    onUpdate(automations.filter(a => a.id !== id));
  };

  const handleSave = () => {
    if (!editing) return;
    const trigger = AUTO_TRIGGERS.find(t => t.id === editing.trigger);
    const action = AUTO_ACTIONS.find(a => a.id === editing.action);
    const updated = {
      ...editing,
      triggerLabel: trigger?.label || editing.trigger,
      actionLabel: action?.label || editing.action,
    };
    const exists = automations.find(a => a.id === updated.id);
    onUpdate(exists ? automations.map(a => a.id === updated.id ? updated : a) : [...automations, updated]);
    setEditing(null);
    setShowNew(false);
  };

  const startNew = () => {
    setEditing({
      id: Date.now(), name: "", active: true,
      trigger: AUTO_TRIGGERS[0].id, triggerLabel: AUTO_TRIGGERS[0].label,
      conditions: "", action: AUTO_ACTIONS[0].id, actionLabel: AUTO_ACTIONS[0].label,
      actionDetail: "", runCount: 0, lastRun: null,
    });
    setShowNew(true);
  };

  const activeCount = automations.filter(a => a.active).length;
  const totalRuns = automations.reduce((s, a) => s + a.runCount, 0);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: T.text0, margin: 0, letterSpacing: "-0.02em" }}>⚡ Automations</h1>
          <p style={{ fontSize: 13, color: T.text2, marginTop: 4 }}>
            {automations.length} workflows · {activeCount} active · {totalRuns} total runs
          </p>
        </div>
        <button onClick={startNew} style={S.btn as React.CSSProperties}>+ New Automation</button>
      </div>

      {/* Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 12, marginBottom: 20 }}>
        {[
          { label: "Active Workflows", value: activeCount, color: T.green, icon: "✓" },
          { label: "Total Runs", value: totalRuns, color: T.blue, icon: "▶" },
          { label: "Triggers Available", value: AUTO_TRIGGERS.length, color: T.purple, icon: "⚡" },
          { label: "Actions Available", value: AUTO_ACTIONS.length, color: T.accent, icon: "◆" },
        ].map(stat => (
          <div key={stat.label} style={{ ...card, padding: 16, textAlign: "center" }}>
            <div style={{ fontSize: 22, fontWeight: 800, color: stat.color }}>{stat.value}</div>
            <div style={{ fontSize: 11, color: T.text3, marginTop: 4 }}>{stat.label}</div>
          </div>
        ))}
      </div>

      {/* List */}
      {automations.map(a => (
        <div key={a.id} style={{ ...card, display: "flex", alignItems: "center", gap: 16 }}>
          <button onClick={() => handleToggle(a.id)} style={{
            width: 40, height: 22, borderRadius: 11, border: "none", cursor: "pointer",
            background: a.active ? T.green : T.bg4, position: "relative", transition: "all 0.2s", flexShrink: 0,
          }}>
            <div style={{
              width: 16, height: 16, borderRadius: "50%", background: "#fff", position: "absolute",
              top: 3, left: a.active ? 21 : 3, transition: "left 0.2s",
            }} />
          </button>

          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: T.text0 }}>{a.name || "Unnamed Workflow"}</div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
              <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: T.radius.xs, background: `${T.purple}18`, color: T.purple, fontWeight: 600 }}>
                ⚡ {a.triggerLabel}
              </span>
              <span style={{ color: T.text3, fontSize: 14 }}>→</span>
              <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: T.radius.xs, background: `${T.accent}18`, color: T.accent, fontWeight: 600 }}>
                ◆ {a.actionLabel}
              </span>
              {a.conditions && (
                <span style={{ fontSize: 10, color: T.text3, fontStyle: "italic" }}>
                  when {a.conditions}
                </span>
              )}
            </div>
            {a.actionDetail && (
              <div style={{ fontSize: 11, color: T.text3, marginTop: 4 }}>→ {a.actionDetail}</div>
            )}
          </div>

          <div style={{ textAlign: "right", flexShrink: 0 }}>
            <div style={{ fontSize: 12, color: T.text2 }}>{a.runCount} runs</div>
            <div style={{ fontSize: 10, color: T.text3 }}>{a.lastRun ? `Last: ${a.lastRun}` : "Never run"}</div>
          </div>

          <div style={{ display: "flex", gap: 4 }}>
            <button onClick={() => { setEditing({ ...a }); setShowNew(true); }} style={{ ...S.btnGhost as React.CSSProperties, padding: "6px 10px", fontSize: 11 }}>✎</button>
            <button onClick={() => handleDelete(a.id)} style={{ ...S.btnGhost as React.CSSProperties, padding: "6px 10px", fontSize: 11, color: T.red }}>✕</button>
          </div>
        </div>
      ))}

      {automationRuns.length > 0 && (
        <div style={{ marginTop: 8, marginBottom: 20 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: T.text0, marginBottom: 12 }}>Recent runs</div>
          {automationRuns.slice(0, 12).map((run) => (
            <div key={run.id} style={{ ...card, padding: "12px 16px", display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: T.text1 }}>{run.name}</div>
                <div style={{ fontSize: 11, color: T.text3, marginTop: 4 }}>
                  {run.trigger} → {run.action}{run.detail ? ` · ${run.detail}` : ""}
                </div>
              </div>
              <div style={{ fontSize: 10, color: T.text3, flexShrink: 0 }}>
                {new Date(run.at).toLocaleString()}
              </div>
            </div>
          ))}
        </div>
      )}

      {automations.length === 0 && (
        <div style={{ ...card, textAlign: "center", padding: 48 }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>⚡</div>
          <div style={{ fontSize: 14, color: T.text2, marginBottom: 8 }}>No automations yet</div>
          <div style={{ fontSize: 12, color: T.text3, marginBottom: 16 }}>Create workflows to automate repetitive tasks</div>
          <button onClick={startNew} style={S.btn as React.CSSProperties}>Create First Automation</button>
        </div>
      )}

      {/* Editor Modal */}
      {showNew && editing && (
        <div onClick={() => { setShowNew(false); setEditing(null); }} style={S.modalBg as React.CSSProperties}>
          <div onClick={e => e.stopPropagation()} className="animate-scale-in" style={S.modalBox as React.CSSProperties}>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: T.text0, margin: "0 0 20px" }}>
              {automations.find(a => a.id === editing.id) ? "Edit" : "New"} Automation
            </h2>

            <div style={{ marginBottom: 16 }}>
              <label style={S.label as React.CSSProperties}>Workflow Name</label>
              <input value={editing.name} onChange={e => setEditing(p => p ? { ...p, name: e.target.value } : null)}
                style={S.input as React.CSSProperties} placeholder="e.g., New Lead → Welcome Task" />
            </div>

            {/* Visual trigger → action flow */}
            <div style={{ background: T.bg3, border: `1px solid ${T.bg4}`, borderRadius: T.radius.lg, padding: 20, marginBottom: 16 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
                {/* Trigger */}
                <div style={{ flex: 1, minWidth: 200 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: T.purple, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 6 }}>⚡ When this happens</div>
                  <select value={editing.trigger} onChange={e => setEditing(p => p ? { ...p, trigger: e.target.value } : null)}
                    style={{ ...S.input as React.CSSProperties, borderColor: `${T.purple}44` }}>
                    {AUTO_TRIGGERS.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
                  </select>
                </div>

                <div style={{ fontSize: 24, color: T.accent, fontWeight: 300, flexShrink: 0 }}>→</div>

                {/* Action */}
                <div style={{ flex: 1, minWidth: 200 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: T.accent, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 6 }}>◆ Do this</div>
                  <select value={editing.action} onChange={e => setEditing(p => p ? { ...p, action: e.target.value } : null)}
                    style={{ ...S.input as React.CSSProperties, borderColor: `${T.accent}44` }}>
                    {AUTO_ACTIONS.map(a => <option key={a.id} value={a.id}>{a.label}</option>)}
                  </select>
                </div>
              </div>
            </div>

            <div style={{ marginBottom: 12 }}>
              <label style={S.label as React.CSSProperties}>Conditions (optional)</label>
              <input value={editing.conditions} onChange={e => setEditing(p => p ? { ...p, conditions: e.target.value } : null)}
                style={S.input as React.CSSProperties} placeholder="e.g., stage = Proposal, value > 10000" />
            </div>

            <div style={{ marginBottom: 12 }}>
              <label style={S.label as React.CSSProperties}>Action Details</label>
              <input value={editing.actionDetail} onChange={e => setEditing(p => p ? { ...p, actionDetail: e.target.value } : null)}
                style={S.input as React.CSSProperties} placeholder="Task title, field=value, or n8n webhook URL" />
            </div>

            <div style={{ display: "flex", gap: 8, marginTop: 20 }}>
              <button onClick={handleSave} style={S.btn as React.CSSProperties}>Save Automation</button>
              <button onClick={() => { setShowNew(false); setEditing(null); }} style={S.btnGhost as React.CSSProperties}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
