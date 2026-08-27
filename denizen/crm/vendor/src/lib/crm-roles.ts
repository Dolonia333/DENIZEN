// Role / persona dashboard system.
// Each role gets its own KPI set, widget layout, accent, and default landing tab —
// the same idea as Salesforce "App Launcher" personas or HubSpot role-based homes.
// Layouts are also industry-aware: getRoleLayout() can swap in an industry
// spotlight widget and re-point KPI labels via the terminology system.

export type KpiId =
  | "pipeline-value"
  | "weighted-pipeline"
  | "won-value"
  | "open-deals"
  | "contacts"
  | "customers"
  | "tasks-due"
  | "overdue-tasks"
  | "new-leads"
  | "meetings-today"
  | "at-risk-count"
  | "win-rate"
  | "avg-deal"
  | "active-sequences"
  | "renewals-due"
  | "response-rate"
  | "qualified-leads"
  | "conversion-rate"
  | "total-revenue"
  | "quota-attainment";

export type WidgetId =
  | "pipeline-by-stage"
  | "revenue-trend"
  | "tasks-due"
  | "follow-ups"
  | "top-leads"
  | "at-risk-deals"
  | "recent-activity"
  | "leaderboard"
  | "goals"
  | "funnel"
  | "active-sequences"
  | "meetings-today"
  | "lead-sources"
  | "quota-progress"
  | "accounts-health"
  | "renewals"
  | "new-leads-list"
  | "forecast"
  | "industry-spotlight";

export interface CrmRole {
  id: string;
  label: string;
  icon: string;
  blurb: string;
  accent: string;
  defaultTab: string;
  kpis: KpiId[];
  widgets: WidgetId[];
}

export const CRM_ROLES: CrmRole[] = [
  {
    id: "me",
    label: "My Board",
    icon: "📋",
    blurb: "Working set only — real deals, real next steps, $0 unless signed",
    accent: "#f0b429",
    defaultTab: "dashboard",
    kpis: ["open-deals", "pipeline-value", "tasks-due", "at-risk-count"],
    widgets: ["tasks-due", "follow-ups", "at-risk-deals", "meetings-today", "recent-activity"],
  },
  {
    id: "rep",
    label: "Sales Rep",
    icon: "💼",
    blurb: "Your deals, your follow-ups, your day",
    accent: "#f0b429",
    defaultTab: "dashboard",
    kpis: ["open-deals", "pipeline-value", "won-value", "tasks-due"],
    widgets: ["pipeline-by-stage", "follow-ups", "tasks-due", "meetings-today", "top-leads"],
  },
  {
    id: "manager",
    label: "Sales Manager",
    icon: "📊",
    blurb: "Team pipeline, forecast & performance",
    accent: "#8b5cf6",
    defaultTab: "dashboard",
    kpis: ["weighted-pipeline", "pipeline-value", "won-value", "win-rate"],
    widgets: ["pipeline-by-stage", "leaderboard", "forecast", "at-risk-deals", "revenue-trend"],
  },
  {
    id: "sdr",
    label: "SDR / BDR",
    icon: "🎯",
    blurb: "Prospecting, sequences & booked meetings",
    accent: "#4d9ef7",
    defaultTab: "dashboard",
    kpis: ["new-leads", "active-sequences", "meetings-today", "tasks-due"],
    widgets: ["new-leads-list", "active-sequences", "top-leads", "lead-sources", "tasks-due"],
  },
  {
    id: "account",
    label: "Account Manager",
    icon: "🤝",
    blurb: "Retention, renewals & account health",
    accent: "#22d3a0",
    defaultTab: "dashboard",
    kpis: ["customers", "renewals-due", "at-risk-count", "won-value"],
    widgets: ["accounts-health", "renewals", "at-risk-deals", "recent-activity", "tasks-due"],
  },
  {
    id: "marketing",
    label: "Marketing",
    icon: "📣",
    blurb: "Funnel, lead sources & conversion",
    accent: "#fb923c",
    defaultTab: "marketing",
    kpis: ["new-leads", "qualified-leads", "conversion-rate", "contacts"],
    widgets: ["funnel", "lead-sources", "revenue-trend", "top-leads", "recent-activity"],
  },
  {
    id: "support",
    label: "Support Agent",
    icon: "🎧",
    blurb: "Tickets, SLAs & customer history",
    accent: "#06b6d4",
    defaultTab: "support",
    kpis: ["tasks-due", "overdue-tasks", "contacts", "customers"],
    widgets: ["tasks-due", "recent-activity", "follow-ups", "accounts-health"],
  },
  {
    id: "exec",
    label: "Founder / Exec",
    icon: "👑",
    blurb: "Revenue, growth & the whole business",
    accent: "#f85b5b",
    defaultTab: "dashboard",
    kpis: ["total-revenue", "pipeline-value", "open-deals", "at-risk-count"],
    widgets: ["revenue-trend", "pipeline-by-stage", "at-risk-deals", "goals", "recent-activity"],
  },
];

export const DEFAULT_ROLE_ID = "me";

export function getRole(id: string | null | undefined): CrmRole {
  return CRM_ROLES.find((r) => r.id === id) || CRM_ROLES[0];
}

// Roles that should surface the industry spotlight (the deal/account-centric ones).
const SPOTLIGHT_ROLES = new Set(["me", "rep", "manager", "account", "exec"]);

export interface RoleLayout {
  role: CrmRole;
  kpis: KpiId[];
  widgets: WidgetId[];
}

/**
 * Resolve the dashboard layout for a role within an industry. Every industry
 * gets a tailored spotlight for the deal-centric roles — the spotlight renderer
 * (RoleDashboard) builds a vertical-specific panel from the industry config, so
 * even brand-new or custom industries reshape the dashboard automatically.
 */
export function getRoleLayout(roleId: string, _industryId: string): RoleLayout {
  const role = getRole(roleId);
  const widgets = [...role.widgets];

  if (SPOTLIGHT_ROLES.has(role.id)) {
    // Replace the generic pipeline widget with the industry spotlight when present,
    // otherwise insert it second so it sits high on the page.
    const pipeIdx = widgets.indexOf("pipeline-by-stage");
    if (pipeIdx >= 0) widgets.splice(pipeIdx, 1, "industry-spotlight");
    else widgets.splice(1, 0, "industry-spotlight");
  }

  return { role, kpis: role.kpis, widgets };
}
