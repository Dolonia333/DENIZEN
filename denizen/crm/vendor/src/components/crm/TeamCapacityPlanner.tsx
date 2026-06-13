import { useMemo } from "react";
import { T, S, fmt, type Quota, type Deal, TEAM_MEMBERS, getQuotaDaysRemaining } from "@/lib/crm-data";

interface Props {
  quotas: Quota[];
  deals: Deal[];
}

interface MemberCapacity {
  memberId: string;
  name: string;
  avatar: string;
  activeDeals: number;
  avgDealValue: number;
  closedThisPeriod: number;
  revenueQuota: Quota | null;
  dealsQuota: Quota | null;
  dealsPace: number; // deals per day
  revenuePerDeal: number;
  estimatedCapacity: number; // max deals they can handle
  currentLoad: number; // 0-100%
  headroom: number; // deals they can still take
  daysRemaining: number;
  health: "underloaded" | "optimal" | "heavy" | "overloaded";
}

function computeCapacity(memberId: string, quotas: Quota[], deals: Deal[]): MemberCapacity | null {
  const member = TEAM_MEMBERS.find(m => m.id === memberId);
  if (!member || member.role === "manager") return null;

  const activeDeals = deals.filter(d => d.ownerId === memberId && !["Closed Won", "Closed Lost"].includes(d.stage));
  const closedDeals = deals.filter(d => d.ownerId === memberId && d.stage === "Closed Won");
  const revenueQuota = quotas.find(q => q.assigneeId === memberId && q.type === "Revenue") || null;
  const dealsQuota = quotas.find(q => q.assigneeId === memberId && q.type === "Deals Closed") || null;
  const primaryQuota = revenueQuota || dealsQuota || quotas.find(q => q.assigneeId === memberId);
  const daysRemaining = primaryQuota ? getQuotaDaysRemaining(primaryQuota) : 0;

  const avgDealValue = closedDeals.length > 0
    ? Math.round(closedDeals.reduce((s, d) => s + d.value, 0) / closedDeals.length)
    : activeDeals.length > 0
      ? Math.round(activeDeals.reduce((s, d) => s + d.value, 0) / activeDeals.length)
      : 20000;

  // Estimate deals pace from quota progress
  const start = primaryQuota ? new Date(primaryQuota.startDate).getTime() : Date.now() - 30 * 86400000;
  const daysElapsed = Math.max(1, Math.ceil((Date.now() - start) / 86400000));
  const dealsPace = closedDeals.length / daysElapsed;

  // Estimate capacity: based on typical rep handling ~8-15 active deals
  const baseCapacity = 12;
  const paceMultiplier = dealsPace > 0 ? Math.min(1.5, Math.max(0.5, dealsPace * 10)) : 1;
  const estimatedCapacity = Math.round(baseCapacity * paceMultiplier);

  const currentLoad = Math.min(100, Math.round((activeDeals.length / Math.max(1, estimatedCapacity)) * 100));
  const headroom = Math.max(0, estimatedCapacity - activeDeals.length);

  const health: MemberCapacity["health"] =
    currentLoad < 40 ? "underloaded" :
    currentLoad < 70 ? "optimal" :
    currentLoad < 90 ? "heavy" : "overloaded";

  return {
    memberId,
    name: member.name,
    avatar: member.avatar,
    activeDeals: activeDeals.length,
    avgDealValue,
    closedThisPeriod: closedDeals.length,
    revenueQuota,
    dealsQuota,
    dealsPace,
    revenuePerDeal: avgDealValue,
    estimatedCapacity,
    currentLoad,
    headroom,
    daysRemaining,
    health,
  };
}

const HEALTH_META = {
  underloaded: { label: "Underloaded", color: "#4d9ef7", bg: "#4d9ef718", icon: "💤" },
  optimal: { label: "Optimal", color: "#22d3a0", bg: "#22d3a018", icon: "✅" },
  heavy: { label: "Heavy", color: "#fbbf24", bg: "#fbbf2418", icon: "⚡" },
  overloaded: { label: "Overloaded", color: "#f85b5b", bg: "#f85b5b18", icon: "🔥" },
};

export function TeamCapacityPlanner({ quotas, deals }: Props) {
  const capacities = useMemo(() => {
    const memberIds = [...new Set(TEAM_MEMBERS.filter(m => m.role !== "manager").map(m => m.id))];
    return memberIds.map(id => computeCapacity(id, quotas, deals)).filter(Boolean) as MemberCapacity[];
  }, [quotas, deals]);

  const totalActive = capacities.reduce((s, c) => s + c.activeDeals, 0);
  const totalCapacity = capacities.reduce((s, c) => s + c.estimatedCapacity, 0);
  const totalHeadroom = capacities.reduce((s, c) => s + c.headroom, 0);
  const teamLoad = totalCapacity > 0 ? Math.round((totalActive / totalCapacity) * 100) : 0;

  return (
    <div style={{ ...S.card as React.CSSProperties, padding: "20px 24px", marginBottom: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h3 style={{ fontSize: 14, fontWeight: 700, color: T.text0, margin: 0 }}>👥 Team Capacity Planner</h3>
        <div style={{ display: "flex", gap: 12, fontSize: 11 }}>
          <span style={{ color: T.text3 }}>{totalActive} active deals</span>
          <span style={{ color: "#22d3a0" }}>{totalHeadroom} deal headroom</span>
        </div>
      </div>

      {/* Team Load Bar */}
      <div style={{
        padding: "12px 18px", borderRadius: T.radius.md, marginBottom: 16,
        background: `linear-gradient(135deg, ${T.bg3}, ${T.bg2})`,
        border: `1px solid ${T.bg4}`,
        display: "flex", justifyContent: "space-between", alignItems: "center",
      }}>
        <div style={{ flex: 1, marginRight: 20 }}>
          <div style={{ fontSize: 10, color: T.text3, marginBottom: 4 }}>TEAM UTILIZATION</div>
          <div style={{ position: "relative", height: 10, background: T.bg4, borderRadius: T.radius.full, overflow: "hidden" }}>
            <div style={{
              height: "100%", borderRadius: T.radius.full, transition: "width 0.4s",
              width: `${teamLoad}%`,
              background: teamLoad < 50 ? "#4d9ef7" : teamLoad < 75 ? "#22d3a0" : teamLoad < 90 ? "#fbbf24" : "#f85b5b",
            }} />
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{
            fontSize: 24, fontWeight: 800, fontFamily: "'JetBrains Mono', monospace",
            color: teamLoad < 50 ? "#4d9ef7" : teamLoad < 75 ? "#22d3a0" : teamLoad < 90 ? "#fbbf24" : "#f85b5b",
          }}>{teamLoad}%</div>
          <div style={{ fontSize: 10, color: T.text3 }}>{totalActive}/{totalCapacity} capacity</div>
        </div>
      </div>

      {/* Member Cards */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {capacities.map(c => {
          const hm = HEALTH_META[c.health];
          return (
            <div key={c.memberId} style={{
              padding: "14px 18px", borderRadius: T.radius.md,
              background: T.bg2, border: `1px solid ${T.bg4}`,
              borderLeft: `3px solid ${hm.color}`,
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{
                    width: 28, height: 28, borderRadius: T.radius.full,
                    background: `linear-gradient(135deg, ${T.purple}, ${T.blue})`,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 10, fontWeight: 700, color: "#fff",
                  }}>{c.avatar}</div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: T.text0 }}>{c.name}</div>
                    <div style={{ fontSize: 11, color: T.text3 }}>
                      {c.daysRemaining > 0 ? `${c.daysRemaining} days remaining` : "No active period"}
                    </div>
                  </div>
                </div>
                <span style={{
                  fontSize: 10, padding: "3px 10px", borderRadius: T.radius.full,
                  background: hm.bg, color: hm.color, fontWeight: 600,
                }}>{hm.icon} {hm.label}</span>
              </div>

              {/* Load Bar */}
              <div style={{ position: "relative", height: 6, background: T.bg4, borderRadius: T.radius.full, overflow: "hidden", marginBottom: 10 }}>
                <div style={{
                  height: "100%", width: `${c.currentLoad}%`, borderRadius: T.radius.full,
                  background: hm.color, transition: "width 0.3s",
                }} />
              </div>

              {/* Stats */}
              <div style={{ display: "flex", gap: 16, fontSize: 11, flexWrap: "wrap" }}>
                <div>
                  <span style={{ color: T.text3 }}>Active: </span>
                  <span style={{ fontWeight: 700, color: T.text0, fontFamily: "'JetBrains Mono', monospace" }}>{c.activeDeals}</span>
                  <span style={{ color: T.text3 }}> / {c.estimatedCapacity} max</span>
                </div>
                <div>
                  <span style={{ color: T.text3 }}>Headroom: </span>
                  <span style={{ fontWeight: 700, color: c.headroom > 3 ? "#22d3a0" : c.headroom > 0 ? "#fbbf24" : "#f85b5b", fontFamily: "'JetBrains Mono', monospace" }}>
                    +{c.headroom} deals
                  </span>
                </div>
                <div>
                  <span style={{ color: T.text3 }}>Closed: </span>
                  <span style={{ fontWeight: 600, color: T.text1, fontFamily: "'JetBrains Mono', monospace" }}>{c.closedThisPeriod}</span>
                </div>
                <div>
                  <span style={{ color: T.text3 }}>Avg deal: </span>
                  <span style={{ fontWeight: 600, color: T.text1, fontFamily: "'JetBrains Mono', monospace" }}>{fmt(c.avgDealValue)}</span>
                </div>
                <div>
                  <span style={{ color: T.text3 }}>Pace: </span>
                  <span style={{ fontWeight: 600, color: T.text1, fontFamily: "'JetBrains Mono', monospace" }}>
                    {(Math.round(c.dealsPace * 70) / 10)}/wk
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
