import { NAV_ITEMS } from "@/lib/crm-data";

/** Legacy tab ids from pre-consolidation UI — map to top-level tab + optional sub-tab. */
const TAB_ALIASES: Record<string, { tab: string; subTab?: string }> = {
  pipeline: { tab: "sales", subTab: "pipeline" },
  tasks: { tab: "schedule", subTab: "tasks" },
  leads: { tab: "sales", subTab: "leads" },
  hub: { tab: "sales", subTab: "hub" },
  "sales-hub": { tab: "sales", subTab: "hub" },
};

export const CRM_SUBNAV_EVENT = "crm-subnav";

export function resolveCrmNav(id: string): { tab: string; subTab?: string } {
  const alias = TAB_ALIASES[id];
  if (alias) return alias;
  return { tab: id };
}

export function isKnownCrmTab(id: string): boolean {
  if (TAB_ALIASES[id]) return true;
  return NAV_ITEMS.some((item) => item.id === id)
    || id === "tasks"
    || id === "hub"
    || id === "sales-hub";
}

export function dispatchCrmSubNav(tab: string, subTab: string) {
  window.dispatchEvent(new CustomEvent(CRM_SUBNAV_EVENT, { detail: { tab, subTab } }));
}
