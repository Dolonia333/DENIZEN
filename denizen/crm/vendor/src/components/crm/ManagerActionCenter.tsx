import { useMemo, useState } from "react";
import { T, S, fmt, type Quota, type QuotaProposal, type Deal, TEAM_MEMBERS, getQuotaDaysRemaining } from "@/lib/crm-data";

interface ActionItem {
  id: string;
  category: "approval" | "at-risk" | "capacity" | "milestone";
  severity: "critical" | "warning" | "info";
  title: string;
  description: string;
  icon: string;
  memberId?: string;
  memberName?: string;
  actionLabel?: string;
  onAction?: () => void;
}

interface Props {
  quotas: Quota[];
  deals: Deal[];
  proposals: QuotaProposal[];
  onScrollToProposals?: () => void;
  onDrilldown?: (memberId: string) => void;
}

const SEVERITY_META = {
  critical: { color: "#f85b5b", bg: "#f85b5b14", border: "#f85b5b44", label: "Critical" },
  warning: { color: "#fbbf24", bg: "#fbbf2414", border: "#fbbf2444", label: "Warning" },
  info: { color: "#4d9ef7", bg: "#4d9ef714", border: "#4d9ef744", label: "Info" },
};

const CATEGORY_META = {
  approval: { label: "Approvals", icon: "📋", color: "#a78bfa" },
  "at-risk": { label: "At-Risk", icon: "⚠️", color: "#fbbf24" },
  capacity: { label: "Capacity", icon: "🔥", color: "#f85b5b" },
  milestone: { label: "Milestones", icon: "🎯", color: "#22d3a0" },
};

export function ManagerActionCenter({ quotas, deals, proposals, onScrollToProposals, onDrilldown }: Props) {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [filterCat, setFilterCat] = useState<string>("all");

  const actions = useMemo(() => {
    const items: ActionItem[] = [];

    proposals.filter(p => p.proposalStatus === "pending" || p.proposalStatus === "counter").forEach(p => {
      items.push({
        id: `proposal-${p.id}`,
        category: "approval",
        severity: "warning",
        icon: p.proposalStatus === "counter" ? "🔄" : "📩",
        title: `${p.proposalStatus === "counter" ? "Counter-proposal" : "Pending proposal"}: ${p.assigneeName}`,
        description: `${p.type} quota — ${p.period} target of ${p.type === "Revenue" ? fmt(p.targetValue) : p.targetValue}${p.counterValue ? ` (counter: ${p.type === "Revenue" ? fmt(p.counterValue) : p.counterValue})` : ""}`,
        memberId: p.assigneeId,
        memberName: p.assigneeName,
        actionLabel: "Review",
        onAction: onScrollToProposals,
      });
    });

    quotas.filter(q => q.status === "at-risk" || q.status === "behind").forEach(q => {
      const days = getQuotaDaysRemaining(q);
      const pct = Math.round((q.currentValue / q.targetValue) * 100);
      items.push({
        id: `risk-${q.id}`,
        category: "at-risk",
        severity: q.status === "behind" ? "critical" : "warning",
        icon: q.status === "behind" ? "🚨" : "⚠️",
        title: `${q.assigneeName} is ${q.status === "behind" ? "behind" : "at risk"} on ${q.type}`,
        description: `${pct}% attained with ${days} day${days !== 1 ? "s" : ""} remaining — needs ${q.type === "Revenue" ? fmt(q.targetValue - q.currentValue) : (q.targetValue - q.currentValue)} more`,
        memberId: q.assigneeId,
        memberName: q.assigneeName,
        actionLabel: "Details",
        onAction: () => onDrilldown?.(q.assigneeId),
      });
    });

    const nonManagers = TEAM_MEMBERS.filter(m => m.role !== "manager");
    nonManagers.forEach(member => {
      const activeDeals = deals.filter(d => d.ownerId === member.id && !["Closed Won", "Closed Lost"].includes(d.stage));
      const capacity = 12;
      const load = Math.round((activeDeals.length / capacity) * 100);
      if (load >= 90) {
        items.push({
          id: `capacity-over-${member.id}`,
          category: "capacity",
          severity: "critical",
          icon: "🔥",
          title: `${member.name} is overloaded (${load}%)`,
          description: `${activeDeals.length} active deals against ~${capacity} max — consider redistributing`,
          memberId: member.id,
          memberName: member.name,
        });
      } else if (load < 30 && activeDeals.length > 0) {
        items.push({
          id: `capacity-under-${member.id}`,
          category: "capacity",
          severity: "info",
          icon: "💤",
          title: `${member.name} is underloaded (${load}%)`,
          description: `Only ${activeDeals.length} active deals — bandwidth for ${capacity - activeDeals.length} more`,
          memberId: member.id,
          memberName: member.name,
        });
      }
    });

    quotas.filter(q => {
      const pct = (q.currentValue / q.targetValue) * 100;
      return pct >= 90 && pct < 100 && q.status !== "achieved";
    }).forEach(q => {
      const pct = Math.round((q.currentValue / q.targetValue) * 100);
      items.push({
        id: `milestone-${q.id}`,
        category: "milestone",
        severity: "info",
        icon: "🎯",
        title: `${q.assigneeName} is ${pct}% to ${q.type} target!`,
        description: `Only ${q.type === "Revenue" ? fmt(q.targetValue - q.currentValue) : (q.targetValue - q.currentValue)} away from hitting quota`,
        memberId: q.assigneeId,
        memberName: q.assigneeName,
        actionLabel: "View",
        onAction: () => onDrilldown?.(q.assigneeId),
      });
    });

    const order = { critical: 0, warning: 1, info: 2 };
    items.sort((a, b) => order[a.severity] - order[b.severity]);
    return items;
  }, [quotas, deals, proposals, onScrollToProposals, onDrilldown]);

  const visible = actions.filter(a => !dismissed.has(a.id) && (filterCat === "all" || a.category === filterCat));
  const counts = {
    all: actions.filter(a => !dismissed.has(a.id)).length,
    approval: actions.filter(a => !dismissed.has(a.id) && a.category === "approval").length,
    "at-risk": actions.filter(a => !dismissed.has(a.id) && a.category === "at-risk").length,
    capacity: actions.filter(a => !dismissed.has(a.id) && a.category === "capacity").length,
    milestone: actions.filter(a => !dismissed.has(a.id) && a.category === "milestone").length,
  };

  if (actions.length === 0) return null;

  const criticalCount = actions.filter(a => !dismissed.has(a.id) && a.severity === "critical").length;
  const warningCount = actions.filter(a => !dismissed.has(a.id) && a.severity === "warning").length;

  return (
    <div style={{ marginBottom: 24 }}>
      {/* Header bar */}
      <div style={{
        background: `linear-gradient(135deg, ${T.bg2}, ${T.bg3})`,
        border: `1px solid ${T.bg4}`,
        borderRadius: `${T.radius.lg} ${T.radius.lg} 0 0`,
        padding: "16px 24px",
        display: "flex", justifyContent: "space-between", alignItems: "center",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{
            width: 36, height: 36, borderRadius: T.radius.md,
            background: `linear-gradient(135deg, #a78bfa33, #4d9ef722)`,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 18,
          }}>🎛️</div>
          <div>
            <h3 style={{ fontSize: 16, fontWeight: 800, color: T.text0, margin: 0, letterSpacing: "-0.02em" }}>
              Action Center
            </h3>
            <div style={{ fontSize: 14, color: T.text3, marginTop: 2, display: "flex", gap: 12 }}>
              {criticalCount > 0 && (
                <span style={{ color: "#f85b5b", fontWeight: 700 }}>● {criticalCount} critical</span>
              )}
              {warningCount > 0 && (
                <span style={{ color: "#fbbf24", fontWeight: 700 }}>● {warningCount} warning</span>
              )}
              <span>{counts.all} total item{counts.all !== 1 ? "s" : ""}</span>
            </div>
          </div>
        </div>
        {dismissed.size > 0 && (
          <button aria-label="Action" onClick={() => setDismissed(new Set())}
            style={{ ...S.btnGhost as React.CSSProperties, fontSize: 14, padding: "5px 12px" }}>
            ↩ Restore {dismissed.size}
          </button>
        )}
      </div>

      {/* Summary cards row */}
      <div style={{
        display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 0,
        borderLeft: `1px solid ${T.bg4}`, borderRight: `1px solid ${T.bg4}`,
      }}>
        {(["approval", "at-risk", "capacity", "milestone"] as const).map((cat, i) => {
          const meta = CATEGORY_META[cat];
          const count = counts[cat];
          const isActive = filterCat === cat;
          return (
            <button aria-label="Action" key={cat} onClick={() => setFilterCat(filterCat === cat ? "all" : cat)} style={{
              padding: "14px 16px", border: "none", cursor: "pointer",
              background: isActive ? `${meta.color}0d` : T.bg2,
              borderBottom: isActive ? `2px solid ${meta.color}` : `1px solid ${T.bg4}`,
              borderRight: i < 3 ? `1px solid ${T.bg4}` : "none",
              display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
              transition: "all 0.15s ease",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: 16 }}>{meta.icon}</span>
                <span style={{
                  fontSize: 22, fontWeight: 900, color: count > 0 ? meta.color : T.text3,
                  lineHeight: 1,
                }}>{count}</span>
              </div>
              <span style={{
                fontSize: 14, fontWeight: 700, color: isActive ? meta.color : T.text3,
                textTransform: "uppercase", letterSpacing: "0.05em",
              }}>{meta.label}</span>
            </button>
          );
        })}
      </div>

      {/* Action items list */}
      <div style={{
        background: T.bg2,
        border: `1px solid ${T.bg4}`, borderTop: "none",
        borderRadius: `0 0 ${T.radius.lg} ${T.radius.lg}`,
        overflow: "hidden",
      }}>
        {visible.length === 0 ? (
          <div style={{ textAlign: "center", padding: "32px 20px", color: T.text3, fontSize: 14 }}>
            {dismissed.size > 0 ? "All items dismissed — click Restore to bring them back" : "No action items in this category"}
          </div>
        ) : (
          <div>
            {visible.map((item, idx) => {
              const sev = SEVERITY_META[item.severity];
              const member = TEAM_MEMBERS.find(m => m.id === item.memberId);
              return (
                <div key={item.id} style={{
                  padding: "14px 20px",
                  borderBottom: idx < visible.length - 1 ? `1px solid ${T.bg4}55` : "none",
                  display: "grid",
                  gridTemplateColumns: "auto 1fr auto auto",
                  alignItems: "center", gap: 14,
                  transition: "background 0.15s",
                }} onMouseEnter={e => (e.currentTarget.style.background = `${sev.color}08`)}
                   onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                  {/* Severity indicator + avatar */}
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{
                      width: 3, height: 32, borderRadius: 2,
                      background: sev.color,
                      flexShrink: 0,
                    }} />
                    {member ? (
                      <div style={{
                        width: 30, height: 30, borderRadius: T.radius.full, flexShrink: 0,
                        background: `linear-gradient(135deg, ${T.purple}, ${T.blue})`,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: 14, fontWeight: 800, color: "#fff",
                      }}>{member.avatar}</div>
                    ) : (
                      <div style={{
                        width: 30, height: 30, borderRadius: T.radius.full, flexShrink: 0,
                        background: `${sev.color}18`,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: 14,
                      }}>{item.icon}</div>
                    )}
                  </div>

                  {/* Content */}
                  <div style={{ minWidth: 0 }}>
                    <div style={{
                      fontSize: 14, fontWeight: 700, color: T.text0,
                      display: "flex", alignItems: "center", gap: 8,
                    }}>
                      <span style={{
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      }}>{item.title}</span>
                      <span style={{
                        fontSize: 14, fontWeight: 800, padding: "1px 6px",
                        borderRadius: T.radius.full,
                        background: sev.bg, color: sev.color,
                        border: `1px solid ${sev.border}`,
                        flexShrink: 0, textTransform: "uppercase",
                      }}>{sev.label}</span>
                    </div>
                    <div style={{
                      fontSize: 14, color: T.text2, marginTop: 3,
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}>{item.description}</div>
                  </div>

                  {/* Action button */}
                  <div>
                    {item.actionLabel && item.onAction && (
                      <button aria-label="Action" onClick={item.onAction} style={{
                        padding: "6px 16px", borderRadius: T.radius.md,
                        fontSize: 14, fontWeight: 700,
                        background: `${sev.color}18`, color: sev.color,
                        border: `1px solid ${sev.color}33`, cursor: "pointer",
                        transition: "all 0.15s",
                      }}>{item.actionLabel}</button>
                    )}
                  </div>

                  {/* Dismiss */}
                  <button aria-label="Action" onClick={() => setDismissed(prev => new Set([...prev, item.id]))} style={{
                    width: 24, height: 24, borderRadius: T.radius.full,
                    background: "transparent", color: T.text3, border: "none",
                    cursor: "pointer", fontSize: 14, display: "flex",
                    alignItems: "center", justifyContent: "center",
                    transition: "all 0.15s",
                  }} title="Dismiss"
                     onMouseEnter={e => { e.currentTarget.style.background = `${T.bg4}`; e.currentTarget.style.color = T.text1; }}
                     onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = T.text3; }}
                  >✕</button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
