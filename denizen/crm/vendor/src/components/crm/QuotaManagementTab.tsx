import { useState, useMemo, useCallback, useRef } from "react";
import { T, S, fmt, type Quota, type QuotaPeriod, type Deal, type QuotaProposal, type ReportSchedule, DEFAULT_QUOTA_TYPES, TEAM_MEMBERS, calcQuotaStatus, getQuotaDaysRemaining, getQuotaPeriodDates, computeQuotaValueFromDeals } from "@/lib/crm-data";
import { toast } from "sonner";
import { QuotaLeaderboard } from "./QuotaLeaderboard";
import { QuotaAchievementToast } from "./QuotaAchievementToast";
import { QuotaCharts } from "./QuotaCharts";
import { QuotaDrilldown } from "./QuotaDrilldown";
import { QuotaNegotiation } from "./QuotaNegotiation";
import { QuotaReportScheduler } from "./QuotaReportScheduler";
import { exportQuotasCsv, exportQuotasPdf } from "./QuotaExport";
import { QuotaTemplates } from "./QuotaTemplates";
import { QuotaForecast } from "./QuotaForecast";
import { QuotaHistory } from "./QuotaHistory";
import { QuotaWhatIf } from "./QuotaWhatIf";
import { TeamCapacityPlanner } from "./TeamCapacityPlanner";
import { ManagerActionCenter } from "./ManagerActionCenter";
import { DealAssignmentRecommender } from "./DealAssignmentRecommender";

interface Props {
  quotas: Quota[];
  onUpdateQuotas: (quotas: Quota[]) => void;
  isManager: boolean;
  currentUserId?: string;
  deals?: Deal[];
}

const STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  "on-track": { label: "On Track", color: "#22d3a0", bg: "#22d3a018" },
  "at-risk": { label: "At Risk", color: "#fbbf24", bg: "#fbbf2418" },
  "behind": { label: "Behind", color: "#f85b5b", bg: "#f85b5b18" },
  "achieved": { label: "Achieved", color: "#4d9ef7", bg: "#4d9ef718" },
};

const PERIOD_LABELS: Record<QuotaPeriod, string> = {
  weekly: "Weekly", monthly: "Monthly", quarterly: "Quarterly", annual: "Annual",
};

export function QuotaManagementTab({ quotas, onUpdateQuotas, isManager, currentUserId = "john", deals = [] }: Props) {
  const [modal, setModal] = useState<"add" | "edit" | null>(null);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [customTypes, setCustomTypes] = useState<string[]>([]);
  const [filter, setFilter] = useState<string>("all");
  const [drilldownQuota, setDrilldownQuota] = useState<Quota | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [activeNav, setActiveNav] = useState("actions");
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [proposals, setProposals] = useState<QuotaProposal[]>([
    { id: 1, assigneeId: "john", assigneeName: "John Doe", type: "Revenue", period: "quarterly", targetValue: 150000, stretchGoal: 180000, proposedBy: "james", proposedAt: "2026-03-20", proposalStatus: "pending", managerNote: "Q2 target based on Q1 performance trajectory." },
    { id: 2, assigneeId: "sarah", assigneeName: "Sarah Kim", type: "Deals Closed", period: "monthly", targetValue: 10, proposedBy: "james", proposedAt: "2026-03-18", proposalStatus: "counter", counterValue: 8, counterNote: "Taking over 2 new accounts, need ramp time." },
  ]);
  const [reportSchedules, setReportSchedules] = useState<ReportSchedule[]>([
    { id: 1, frequency: "weekly", dayOfWeek: 1, recipientIds: ["james"], enabled: true, createdAt: "2026-03-01", lastSent: "2026-03-17" },
  ]);

  const allTypes = [...DEFAULT_QUOTA_TYPES, ...customTypes];

  // Auto-compute values from deals for Revenue/Deals Closed quotas, then recalculate statuses
  const liveQuotas = useMemo(() =>
    quotas.map(q => {
      const autoTypes = ["Revenue", "Deals Closed"];
      const currentValue = autoTypes.includes(q.type) ? computeQuotaValueFromDeals(q, deals) : q.currentValue;
      const updated = { ...q, currentValue };
      return { ...updated, status: calcQuotaStatus(updated) };
    }),
    [quotas, deals]
  );

  const handleDrilldown = useCallback((memberId: string, type?: string) => {
    const q = liveQuotas.find(q => q.assigneeId === memberId && (!type || q.type === type)) || liveQuotas.find(q => q.assigneeId === memberId);
    if (q) setDrilldownQuota(q);
  }, [liveQuotas]);

  const displayQuotas = useMemo(() => {
    let list = isManager ? liveQuotas : liveQuotas.filter(q => q.assigneeId === currentUserId);
    if (filter !== "all") list = list.filter(q => q.status === filter);
    return list;
  }, [liveQuotas, isManager, currentUserId, filter]);

  const openAdd = () => {
    setForm({ assigneeId: TEAM_MEMBERS[0].id, type: allTypes[0], period: "monthly", targetValue: "", stretchGoal: "", currentValue: "0" });
    setEditId(null);
    setModal("add");
  };

  const openEdit = (q: Quota) => {
    setForm({
      assigneeId: q.assigneeId, type: q.type, period: q.period,
      targetValue: String(q.targetValue), stretchGoal: q.stretchGoal ? String(q.stretchGoal) : "",
      currentValue: String(q.currentValue),
    });
    setEditId(q.id);
    setModal("edit");
  };

  const handleSave = () => {
    const member = TEAM_MEMBERS.find(m => m.id === form.assigneeId);
    if (!member || !form.targetValue) return;
    const dates = getQuotaPeriodDates(form.period as QuotaPeriod);
    const base: Quota = {
      id: editId || Date.now(),
      assigneeId: form.assigneeId,
      assigneeName: member.name,
      type: form.type || allTypes[0],
      period: (form.period as QuotaPeriod) || "monthly",
      targetValue: Number(form.targetValue),
      stretchGoal: form.stretchGoal ? Number(form.stretchGoal) : undefined,
      currentValue: Number(form.currentValue) || 0,
      startDate: dates.startDate,
      endDate: dates.endDate,
      createdBy: "james",
      status: "on-track",
    };
    base.status = calcQuotaStatus(base);
    if (editId) {
      onUpdateQuotas(quotas.map(q => q.id === editId ? base : q));
    } else {
      onUpdateQuotas([...quotas, base]);
    }
    setModal(null); setForm({});
  };

  const handleDelete = (id: number) => {
    onUpdateQuotas(quotas.filter(q => q.id !== id));
  };

  // Auto-create quota when a proposal is accepted
  const handleProposalAccepted = useCallback((proposal: QuotaProposal, finalValue: number) => {
    const member = TEAM_MEMBERS.find(m => m.id === proposal.assigneeId);
    if (!member) return;
    const dates = getQuotaPeriodDates(proposal.period);
    const newQuota: Quota = {
      id: Date.now() + Math.random(),
      assigneeId: proposal.assigneeId,
      assigneeName: member.name,
      type: proposal.type,
      period: proposal.period,
      targetValue: finalValue,
      stretchGoal: proposal.stretchGoal,
      currentValue: 0,
      startDate: dates.startDate,
      endDate: dates.endDate,
      createdBy: proposal.proposedBy,
      status: "on-track",
    };
    newQuota.status = calcQuotaStatus(newQuota);
    onUpdateQuotas([...quotas, newQuota]);
    toast.success(`✅ Quota created: ${proposal.type} → ${member.name} (${proposal.type === "Revenue" ? fmt(finalValue) : finalValue})`);
  }, [quotas, onUpdateQuotas]);

  // Team member view: summary banner
  const myQuotas = liveQuotas.filter(q => q.assigneeId === currentUserId);
  const overallProgress = myQuotas.length > 0
    ? Math.round(myQuotas.reduce((s, q) => s + Math.min(100, (q.currentValue / q.targetValue) * 100), 0) / myQuotas.length)
    : 0;
  const primaryQuota = myQuotas.find(q => q.type === "Revenue" && q.period === "monthly") || myQuotas[0];

  // Manager stats
  const managerStats = useMemo(() => {
    const achieved = liveQuotas.filter(q => q.status === "achieved").length;
    const onTrack = liveQuotas.filter(q => q.status === "on-track").length;
    const atRisk = liveQuotas.filter(q => q.status === "at-risk").length;
    const behind = liveQuotas.filter(q => q.status === "behind").length;
    return { achieved, onTrack, atRisk, behind, total: liveQuotas.length };
  }, [liveQuotas]);

  const progressBarColor = (status: string) => STATUS_META[status]?.color || T.text3;

  const renderProgressBar = (q: Quota) => {
    const pct = Math.min(100, Math.round((q.currentValue / q.targetValue) * 100));
    const color = progressBarColor(q.status);
    return (
      <div style={{ position: "relative", height: 8, background: T.bg4, borderRadius: T.radius.full, overflow: "hidden" }}>
        <div style={{
          height: "100%", width: `${pct}%`, borderRadius: T.radius.full,
          background: color, transition: "width 0.4s ease",
        }} />
        {q.stretchGoal && (
          <div style={{
            position: "absolute", top: 0, bottom: 0, left: `${Math.min(100, (q.targetValue / q.stretchGoal) * 100)}%`,
            width: 2, background: T.text3, opacity: 0.5,
          }} title={`Target: ${q.targetValue}`} />
        )}
      </div>
    );
  };

  // ─── TEAM MEMBER VIEW ──────────────────────────────────────────────────────
  if (!isManager) {
    return (
      <div style={{ maxWidth: 720, margin: "0 auto" }}>
        <QuotaAchievementToast quotas={liveQuotas} />
        {/* Summary Banner */}
        {primaryQuota && (
          <div style={{
            ...S.card as React.CSSProperties,
            background: `linear-gradient(135deg, ${T.bg2}, ${T.bg3})`,
            marginBottom: 24, padding: "24px 28px",
            borderLeft: `4px solid ${progressBarColor(primaryQuota.status)}`,
          }}>
            <div style={{ fontSize: 14, color: T.text2, marginBottom: 4 }}>Quota Health</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: T.text0, marginBottom: 8 }}>
              You're {overallProgress}% to your {PERIOD_LABELS[primaryQuota.period].toLowerCase()} {primaryQuota.type.toLowerCase()} goal
            </div>
            <div style={{ display: "flex", gap: 20, fontSize: 14, color: T.text2 }}>
              <span>{myQuotas.filter(q => q.status === "achieved").length} achieved</span>
              <span>{myQuotas.filter(q => q.status === "on-track").length} on track</span>
              <span>{myQuotas.filter(q => q.status === "at-risk" || q.status === "behind").length} need attention</span>
            </div>
          </div>
        )}

        {/* Quota Cards */}
        <div style={{ display: "grid", gap: 16 }}>
          {myQuotas.map(q => {
            const pct = Math.min(100, Math.round((q.currentValue / q.targetValue) * 100));
            const days = getQuotaDaysRemaining(q);
            const meta = STATUS_META[q.status];
            return (
              <div key={q.id} style={{ ...S.card as React.CSSProperties, padding: "20px 24px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: T.text0 }}>{q.type}</div>
                    <div style={{ fontSize: 14, color: T.text3, marginTop: 2 }}>
                      {PERIOD_LABELS[q.period]} · {days} day{days !== 1 ? "s" : ""} remaining
                    </div>
                  </div>
                  <span style={{
                    fontSize: 14, padding: "3px 10px", borderRadius: T.radius.full,
                    background: meta.bg, color: meta.color, fontWeight: 600,
                  }}>{meta.label}</span>
                </div>
                {renderProgressBar(q)}
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 10, fontSize: 14, color: T.text2 }}>
                  <span>
                    {q.type === "Revenue" ? fmt(q.currentValue) : q.currentValue} / {q.type === "Revenue" ? fmt(q.targetValue) : q.targetValue}
                  </span>
                  <span style={{ fontWeight: 700, color: meta.color }}>{pct}%</span>
                </div>
                {q.stretchGoal && (
                  <div style={{ fontSize: 14, color: T.text3, marginTop: 6 }}>
                    Stretch goal: {q.type === "Revenue" ? fmt(q.stretchGoal) : q.stretchGoal}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {myQuotas.length === 0 && (
          <div style={{ textAlign: "center", padding: 60, color: T.text3, fontSize: 14 }}>
            No quotas assigned to you yet.
          </div>
        )}

        {/* Proposals for team member */}
        <div style={{ marginTop: 20 }}>
          <QuotaNegotiation proposals={proposals} onUpdateProposals={setProposals} isManager={false} currentUserId={currentUserId} onQuotaCreated={handleProposalAccepted} />
        </div>
      </div>
    );
  }

  // ─── MANAGER VIEW ──────────────────────────────────────────────────────────

  const SECTIONS = [
    { id: "actions", icon: "🎯", label: "Actions" },
    { id: "overview", icon: "📊", label: "Overview" },
    { id: "forecast", icon: "🔮", label: "Forecasting" },
    { id: "team", icon: "👥", label: "Team" },
    { id: "workflows", icon: "⚙️", label: "Workflows" },
    { id: "quotas", icon: "📋", label: "All Quotas" },
  ] as const;




  const toggleSection = (id: string) => setCollapsed(p => ({ ...p, [id]: !p[id] }));

  const scrollToSection = (id: string) => {
    setActiveNav(id);
    // Expand if collapsed
    if (collapsed[id]) setCollapsed(p => ({ ...p, [id]: false }));
    setTimeout(() => {
      sectionRefs.current[id]?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
  };

  const SectionHeader = ({ id, icon, title, subtitle }: { id: string; icon: string; title: string; subtitle?: string }) => (
    <div
      ref={el => { sectionRefs.current[id] = el; }}
      style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: collapsed[id] ? 0 : 16, marginTop: 8, cursor: "pointer", scrollMarginTop: 56 }}
      onClick={() => toggleSection(id)}
    >
      <span style={{ fontSize: 18 }}>{icon}</span>
      <div style={{ flex: 1 }}>
        <h2 style={{ fontSize: 15, fontWeight: 700, color: T.text0, margin: 0, lineHeight: 1.2 }}>{title}</h2>
        {subtitle && !collapsed[id] && <p style={{ fontSize: 14, color: T.text3, margin: 0, marginTop: 2 }}>{subtitle}</p>}
      </div>
      <span style={{
        fontSize: 14, color: T.text3, fontWeight: 600, padding: "2px 8px",
        borderRadius: T.radius.full, background: T.bg3, transition: "transform 0.2s",
        transform: collapsed[id] ? "rotate(-90deg)" : "rotate(0deg)",
        display: "inline-block",
      }}>▼</span>
      <div style={{ flex: 1, height: 1, background: T.bg4 }} />
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
      <QuotaAchievementToast quotas={liveQuotas} />

      {/* ═══ STICKY SECTION NAV ═══ */}
      <div style={{
        position: "sticky", top: 0, zIndex: 20,
        display: "flex", gap: 4, padding: "8px 0 12px",
        background: T.bg0,
        borderBottom: `1px solid ${T.bg4}`,
        marginBottom: 16,
      }}>
        {SECTIONS.map(s => (
          <button aria-label="Action"
            key={s.id}
            onClick={() => scrollToSection(s.id)}
            style={{
              padding: "6px 14px", borderRadius: T.radius.full, fontSize: 14, fontWeight: 600,
              background: activeNav === s.id ? `${T.accent}18` : "transparent",
              color: activeNav === s.id ? T.accent : T.text3,
              border: `1px solid ${activeNav === s.id ? `${T.accent}44` : "transparent"}`,
              cursor: "pointer", transition: "all 0.15s",
              display: "flex", alignItems: "center", gap: 5,
            }}
          >
            <span style={{ fontSize: 14 }}>{s.icon}</span>
            {s.label}
          </button>
        ))}
      </div>

      {/* ═══ ACTION CENTER ═══ */}
      <SectionHeader id="actions" icon="🎯" title="Action Center" subtitle="Pending approvals, alerts, and critical items" />
      {!collapsed["actions"] && (
        <ManagerActionCenter
          quotas={liveQuotas}
          deals={deals}
          proposals={proposals}
          onDrilldown={(memberId) => handleDrilldown(memberId)}
        />
      )}

      {/* ═══ OVERVIEW ═══ */}
      <SectionHeader id="overview" icon="📊" title="Performance Overview" subtitle="Real-time quota health across your team" />
      {!collapsed["overview"] && (<>
        {/* Stats Row */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 10, marginBottom: 16 }}>
          {[
            { label: "Total Quotas", value: managerStats.total, color: T.text0, emoji: "📋" },
            { label: "Achieved", value: managerStats.achieved, color: STATUS_META.achieved.color, emoji: "🏆" },
            { label: "On Track", value: managerStats.onTrack, color: STATUS_META["on-track"].color, emoji: "✅" },
            { label: "At Risk", value: managerStats.atRisk, color: STATUS_META["at-risk"].color, emoji: "⚡" },
            { label: "Behind", value: managerStats.behind, color: STATUS_META.behind.color, emoji: "🚨" },
          ].map(s => (
            <div key={s.label} style={{
              ...S.card as React.CSSProperties, padding: "14px 16px",
              display: "flex", alignItems: "center", gap: 12,
              borderLeft: `3px solid ${s.color}`,
            }}>
              <span style={{ fontSize: 20 }}>{s.emoji}</span>
              <div>
                <div style={{ fontSize: 22, fontWeight: 800, color: s.color, lineHeight: 1 }}>{s.value}</div>
                <div style={{ fontSize: 14, color: T.text3, marginTop: 2, textTransform: "uppercase", letterSpacing: "0.04em", fontWeight: 600 }}>{s.label}</div>
              </div>
            </div>
          ))}
        </div>
        {/* Leaderboard + Charts side by side */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 20 }}>
          <QuotaLeaderboard quotas={liveQuotas} />
          <QuotaCharts quotas={liveQuotas} onDrilldown={handleDrilldown} />
        </div>
      </>)}

      {/* ═══ FORECASTING & ANALYSIS ═══ */}
      <SectionHeader id="forecast" icon="🔮" title="Forecasting & Analysis" subtitle="Projected outcomes, scenarios, and historical trends" />
      {!collapsed["forecast"] && (<>
        <QuotaForecast quotas={liveQuotas} />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 20 }}>
          <QuotaWhatIf quotas={liveQuotas} />
          <QuotaHistory quotas={liveQuotas} />
        </div>
      </>)}

      {/* ═══ TEAM MANAGEMENT ═══ */}
      <SectionHeader id="team" icon="👥" title="Team Management" subtitle="Capacity planning, deal assignment, and resource allocation" />
      {!collapsed["team"] && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 20 }}>
          <TeamCapacityPlanner quotas={liveQuotas} deals={deals} />
          <DealAssignmentRecommender deals={deals} quotas={liveQuotas} />
        </div>
      )}

      {/* ═══ WORKFLOWS ═══ */}
      <SectionHeader id="workflows" icon="⚙️" title="Workflows & Configuration" subtitle="Templates, proposals, exports, and scheduling" />
      {!collapsed["workflows"] && (<>
        <QuotaTemplates onAssignFromTemplate={(newQuotas) => onUpdateQuotas([...quotas, ...newQuotas])} />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 20 }}>
          <QuotaNegotiation proposals={proposals} onUpdateProposals={setProposals} isManager={true} currentUserId={currentUserId} onQuotaCreated={handleProposalAccepted} />
          <QuotaReportScheduler schedules={reportSchedules} onUpdateSchedules={setReportSchedules} />
        </div>
      </>)}

      {/* ═══ QUOTA TABLE ═══ */}
      <SectionHeader id="quotas" icon="📋" title="All Quotas" subtitle="View, filter, and manage individual quota assignments" />

      {!collapsed["quotas"] && (<>
        {/* Toolbar */}
        <div style={{
          display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 12, flexWrap: "wrap",
          padding: "10px 16px", borderRadius: T.radius.md, background: T.bg2, border: `1px solid ${T.bg4}`,
        }}>
          <div style={{ display: "flex", gap: 6 }}>
            {["all", "on-track", "at-risk", "behind", "achieved"].map(f => (
              <button aria-label="Action" key={f} onClick={() => setFilter(f)} style={{
                padding: "5px 12px", borderRadius: T.radius.full, fontSize: 14, fontWeight: 600,
                background: filter === f ? `${(STATUS_META[f] || {}).color || T.accent}22` : T.bg3,
                color: filter === f ? (STATUS_META[f] || {}).color || T.accent : T.text3,
                border: `1px solid ${filter === f ? `${(STATUS_META[f] || {}).color || T.accent}66` : T.bg4}`,
                cursor: "pointer", transition: "all 0.15s",
              }}>{f === "all" ? `All (${managerStats.total})` : `${STATUS_META[f]?.label} (${f === "on-track" ? managerStats.onTrack : f === "at-risk" ? managerStats.atRisk : f === "behind" ? managerStats.behind : managerStats.achieved})`}</button>
            ))}
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button aria-label="Add" onClick={openAdd} style={S.btn as React.CSSProperties}>+ Assign Quota</button>
            <button aria-label="Action" onClick={() => exportQuotasCsv(liveQuotas)} style={{ ...S.btnGhost as React.CSSProperties, fontSize: 14, padding: "6px 12px" }}>📥 CSV</button>
            <button aria-label="Action" onClick={() => exportQuotasPdf(liveQuotas)} style={{ ...S.btnGhost as React.CSSProperties, fontSize: 14, padding: "6px 12px" }}>📄 PDF</button>
          </div>
        </div>

        {/* Table */}
        <div style={{ ...S.card as React.CSSProperties, padding: 0, overflow: "hidden", marginBottom: 20 }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${T.bg4}` }}>
                  {["Team Member", "Quota Type", "Period", "Target", "Current", "Progress", "Status", "Actions"].map(h => (
                    <th key={h} style={{ padding: "12px 14px", textAlign: "left", fontSize: 14, fontWeight: 700, color: T.text3, textTransform: "uppercase", letterSpacing: "0.06em" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {displayQuotas.map(q => {
                  const pct = Math.min(100, Math.round((q.currentValue / q.targetValue) * 100));
                  const meta = STATUS_META[q.status];
                  const member = TEAM_MEMBERS.find(m => m.id === q.assigneeId);
                  return (
                    <tr key={q.id} onClick={() => setDrilldownQuota(q)} style={{ borderBottom: `1px solid ${T.bg4}08`, cursor: "pointer", transition: "background 0.15s" }} onMouseEnter={e => (e.currentTarget.style.background = `${T.bg3}66`)} onMouseLeave={e => (e.currentTarget.style.background = "")}>
                      <td style={{ padding: "12px 14px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <div style={{
                            width: 28, height: 28, borderRadius: T.radius.full,
                            background: `linear-gradient(135deg, ${T.purple}, ${T.blue})`,
                            display: "flex", alignItems: "center", justifyContent: "center",
                            fontSize: 14, fontWeight: 700, color: "#fff",
                          }}>{member?.avatar || "?"}</div>
                          <span style={{ color: T.text1, fontWeight: 600 }}>{q.assigneeName}</span>
                        </div>
                      </td>
                      <td style={{ padding: "12px 14px", color: T.text1 }}>{q.type}</td>
                      <td style={{ padding: "12px 14px", color: T.text2 }}>{PERIOD_LABELS[q.period]}</td>
                      <td style={{ padding: "12px 14px", color: T.text1, fontFamily: "'JetBrains Mono', monospace" }}>
                        {q.type === "Revenue" ? fmt(q.targetValue) : q.targetValue}
                        {q.stretchGoal && <span style={{ color: T.text3, fontSize: 14 }}> / {q.type === "Revenue" ? fmt(q.stretchGoal) : q.stretchGoal}</span>}
                      </td>
                      <td style={{ padding: "12px 14px", color: T.text1, fontFamily: "'JetBrains Mono', monospace" }}>
                        {q.type === "Revenue" ? fmt(q.currentValue) : q.currentValue}
                      </td>
                      <td style={{ padding: "12px 14px", width: 140 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <div style={{ flex: 1 }}>{renderProgressBar(q)}</div>
                          <span style={{ fontSize: 14, fontWeight: 700, color: meta.color, minWidth: 32 }}>{pct}%</span>
                        </div>
                      </td>
                      <td style={{ padding: "12px 14px" }}>
                        <span style={{
                          fontSize: 14, padding: "3px 10px", borderRadius: T.radius.full,
                          background: meta.bg, color: meta.color, fontWeight: 600,
                        }}>{meta.label}</span>
                      </td>
                      <td style={{ padding: "12px 14px" }}>
                        <div style={{ display: "flex", gap: 6 }}>
                          <button aria-label="Action" onClick={(e) => { e.stopPropagation(); openEdit(q); }} style={{ ...S.btnGhost as React.CSSProperties, padding: "4px 10px", fontSize: 14 }}>Edit</button>
                          <button aria-label="Action" onClick={(e) => { e.stopPropagation(); handleDelete(q.id); }} style={{ ...S.btnGhost as React.CSSProperties, padding: "4px 10px", fontSize: 14, color: T.red }}>✕</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {displayQuotas.length === 0 && (
            <div style={{ textAlign: "center", padding: 40, color: T.text3, fontSize: 14 }}>
              No quotas found. Click "Assign Quota" to get started.
            </div>
          )}
        </div>
      </>)}

      {/* Add/Edit Modal */}
      {modal && (
        <div style={S.modalBg as React.CSSProperties} onClick={() => setModal(null)}>
          <div style={S.modalBox as React.CSSProperties} onClick={e => e.stopPropagation()}>
            <h3 style={{ fontSize: 18, fontWeight: 700, color: T.text0, marginBottom: 20 }}>
              {modal === "edit" ? "Edit Quota" : "Assign New Quota"}
            </h3>

            <div style={{ marginBottom: 12 }}>
              <label style={S.label as React.CSSProperties}>Team Member</label>
              <select value={form.assigneeId || ""} onChange={e => setForm(p => ({ ...p, assigneeId: e.target.value }))}
                style={S.input as React.CSSProperties}>
                {TEAM_MEMBERS.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </div>

            <div style={{ marginBottom: 12 }}>
              <label style={S.label as React.CSSProperties}>Quota Type</label>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <select value={form.type || ""} onChange={e => setForm(p => ({ ...p, type: e.target.value }))}
                  style={{ ...S.input as React.CSSProperties, flex: 1 }}>
                  {allTypes.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
                <button aria-label="Action" onClick={() => {
                  const name = prompt("Enter custom quota type:");
                  if (name?.trim()) { setCustomTypes(p => [...p, name.trim()]); setForm(p => ({ ...p, type: name.trim() })); }
                }} style={{ ...S.btnGhost as React.CSSProperties, whiteSpace: "nowrap", fontSize: 14 }}>+ Custom</button>
              </div>
            </div>

            <div style={{ marginBottom: 12 }}>
              <label style={S.label as React.CSSProperties}>Period</label>
              <select value={form.period || "monthly"} onChange={e => setForm(p => ({ ...p, period: e.target.value }))}
                style={S.input as React.CSSProperties}>
                {(["weekly", "monthly", "quarterly", "annual"] as QuotaPeriod[]).map(p => (
                  <option key={p} value={p}>{PERIOD_LABELS[p]}</option>
                ))}
              </select>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
              <div>
                <label style={S.label as React.CSSProperties}>Target Value</label>
                <input type="number" value={form.targetValue || ""} placeholder="e.g. 50000"
                  onChange={e = aria-label="e.g. 50000"> setForm(p => ({ ...p, targetValue: e.target.value }))}
                  style={S.input as React.CSSProperties} />
              </div>
              <div>
                <label style={S.label as React.CSSProperties}>Stretch Goal (optional)</label>
                <input type="number" value={form.stretchGoal || ""} placeholder="e.g. 65000"
                  onChange={e = aria-label="e.g. 65000"> setForm(p => ({ ...p, stretchGoal: e.target.value }))}
                  style={S.input as React.CSSProperties} />
              </div>
            </div>

            <div style={{ marginBottom: 20 }}>
              <label style={S.label as React.CSSProperties}>Current Value (manual override)</label>
              <input type="number" value={form.currentValue || "0"}
                onChange={e = aria-label="number"> setForm(p => ({ ...p, currentValue: e.target.value }))}
                style={S.input as React.CSSProperties} />
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <button aria-label="Action" onClick={() => setModal(null)} style={S.btnGhost as React.CSSProperties}>Cancel</button>
              <button aria-label="Save" onClick={handleSave} style={S.btn as React.CSSProperties}>
                {modal === "edit" ? "Save Changes" : "Assign Quota"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Drilldown Panel */}
      {drilldownQuota && (
        <QuotaDrilldown
          quota={drilldownQuota}
          memberQuotas={liveQuotas}
          onClose={() => setDrilldownQuota(null)}
        />
      )}
    </div>
  );
}
