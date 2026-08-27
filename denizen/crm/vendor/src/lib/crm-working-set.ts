/**
 * Working-set filters for the personal CRM board.
 * A row belongs in open pipeline only if it answers: who, what, next step, by when.
 * Watchlist / seed / expired rows stay out of pipeline $ and open-deal counts.
 */

import type { Contact, Deal, Task, Company } from "@/lib/crm-data";

function norm(s: unknown): string {
  return String(s || "").trim().toLowerCase();
}

const CLOSED_STATUSES = new Set([
  "lost", "disqualified", "won", "closed", "void",
]);

const NON_PIPELINE_STATUSES = new Set([
  "watchlist", "expired", "parked", "archived",
]);

export function isWatchlistDeal(d: Deal): boolean {
  const status = norm(d.status);
  const stage = norm(d.stage);
  const tags = (d.tags || []).map(norm);
  if (status === "watchlist" || status === "parked") return true;
  if (tags.includes("watchlist") || tags.includes("not-pipeline") || tags.includes("federal-rfp")) return true;
  if (stage.includes("watch") || stage.includes("research")) return true;
  return false;
}

export function isClosedDeal(d: Deal): boolean {
  const status = norm(d.status);
  const stage = norm(d.stage);
  if (CLOSED_STATUSES.has(status)) return true;
  if (stage === "closed won" || stage === "closed lost") return true;
  if (stage.includes("lost") || stage.includes("disqual")) return true;
  return false;
}

export function isExpiredDeal(d: Deal): boolean {
  const status = norm(d.status);
  const stage = norm(d.stage);
  if (status === "expired") return true;
  if (stage.includes("expired")) return true;
  return false;
}

/** Live pursuits only — not watchlist, not seed leftovers, not expired history. */
export function isOpenPipelineDeal(d: Deal): boolean {
  if (isClosedDeal(d)) return false;
  if (isWatchlistDeal(d)) return false;
  if (isExpiredDeal(d)) return false;
  if (NON_PIPELINE_STATUSES.has(norm(d.status))) return false;
  return true;
}

export function isOpenTask(t: Task): boolean {
  if (t.done) return false;
  const st = norm(t.status);
  return !["done", "closed", "completed"].includes(st);
}

export function isOverdueTask(t: Task, today = new Date().toISOString().slice(0, 10)): boolean {
  if (!isOpenTask(t)) return false;
  const due = String(t.due || "").slice(0, 10);
  return Boolean(due && due < today);
}

/** At-risk = live deal with next date (closeDate) already missed. */
export function isAtRiskWorkingDeal(d: Deal, today = new Date().toISOString().slice(0, 10)): boolean {
  if (!isOpenPipelineDeal(d)) return false;
  if (norm(d.health) === "at-risk") return true;
  const next = String(d.closeDate || "").slice(0, 10);
  return Boolean(next && next < today);
}

export function activeCompanies(companies: Company[]): Company[] {
  return companies.filter((c) => {
    const st = norm((c as { status?: string }).status);
    return !["archived", "void", "deleted"].includes(st);
  });
}

export interface WorkingSetSummary {
  pipelineDeals: Deal[];
  pipelineValue: number;
  watchlistDeals: Deal[];
  expiredDeals: Deal[];
  openTasks: Task[];
  overdueTasks: Task[];
  atRiskDeals: Deal[];
  contacts: Contact[];
  companies: Company[];
}

export function buildWorkingSet(input: {
  deals: Deal[];
  contacts: Contact[];
  tasks: Task[];
  companies?: Company[];
  today?: string;
}): WorkingSetSummary {
  const today = input.today || new Date().toISOString().slice(0, 10);
  const pipelineDeals = input.deals.filter(isOpenPipelineDeal);
  const watchlistDeals = input.deals.filter(isWatchlistDeal);
  const expiredDeals = input.deals.filter(isExpiredDeal);
  const openTasks = input.tasks.filter(isOpenTask);
  const overdueTasks = openTasks.filter((t) => isOverdueTask(t, today));
  const atRiskDeals = pipelineDeals.filter((d) => isAtRiskWorkingDeal(d, today));
  const companies = activeCompanies(input.companies || []);
  return {
    pipelineDeals,
    pipelineValue: pipelineDeals.reduce((s, d) => s + Number(d.value || 0), 0),
    watchlistDeals,
    expiredDeals,
    openTasks,
    overdueTasks,
    atRiskDeals,
    contacts: input.contacts,
    companies,
  };
}
