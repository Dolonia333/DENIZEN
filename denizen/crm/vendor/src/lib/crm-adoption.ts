import type { Contact, Deal, Task, TeamPolicy, UsageLogEntry, SupportTicket, MarketingCampaign } from "./crm-data";
import { DEFAULT_TEAM_POLICY } from "./crm-data";

export function resolveTeamPolicy(raw?: Partial<TeamPolicy> | null): TeamPolicy {
  return { ...DEFAULT_TEAM_POLICY, ...(raw || {}) };
}

export function logUsage(
  entries: UsageLogEntry[],
  user: string,
  action: string,
  entity?: string,
  entityId?: number,
): UsageLogEntry[] {
  const id = entries.length ? Math.max(...entries.map((e) => e.id)) + 1 : Date.now();
  return [{ id, user, action, entity, entityId, at: new Date().toISOString() }, ...entries].slice(0, 500);
}

export function validateDeal(deal: Partial<Deal>, policy: TeamPolicy): string[] {
  const missing: string[] = [];
  const fields = policy.requiredDealFields || [];
  if (fields.includes("ownerId") && policy.requireOwnerOnDeal && !deal.ownerId?.trim()) {
    missing.push("owner");
  }
  if (fields.includes("stage") && !deal.stage?.trim()) missing.push("stage");
  if (fields.includes("value") && (deal.value == null || deal.value <= 0)) missing.push("value");
  if (fields.includes("contact") && !deal.contact?.trim()) missing.push("contact");
  if (fields.includes("closeDate") && !deal.closeDate?.trim()) missing.push("close date");
  return missing;
}

export function validateContact(contact: Partial<Contact>, policy: TeamPolicy): string[] {
  const missing: string[] = [];
  const fields = policy.requiredContactFields || [];
  if (fields.includes("email") && !contact.email?.trim()) missing.push("email");
  if (fields.includes("name") && !contact.name?.trim()) missing.push("name");
  if (fields.includes("company") && !contact.company?.trim()) missing.push("company");
  return missing;
}

export function filterMyDeals(deals: Deal[], userName: string): Deal[] {
  const me = userName.trim().toLowerCase();
  if (!me) return deals;
  return deals.filter((d) => {
    const owner = (d.ownerId || "").toLowerCase();
    if (!owner) return false;
    return owner === me || owner.includes(me) || me.includes(owner);
  });
}

export function filterMyTasks(tasks: Task[], userName: string): Task[] {
  const me = userName.trim().toLowerCase();
  if (!me) return tasks.filter((t) => !t.done);
  return tasks.filter((t) => !t.done && (!t.assignee || t.assignee.toLowerCase() === me));
}

export function filterMyTickets(tickets: SupportTicket[], userName: string): SupportTicket[] {
  const me = userName.trim().toLowerCase();
  if (!me) return tickets.filter((t) => t.status !== "closed");
  return tickets.filter((t) => t.status !== "closed" && (!t.assignee || t.assignee.toLowerCase() === me));
}

export function computeAdoptionMetrics(
  usageLog: UsageLogEntry[],
  teamMembers: string[],
  days = 7,
): { user: string; actions: number; lastAt: string | null; inactive: boolean }[] {
  const since = Date.now() - days * 86400000;
  const byUser = new Map<string, { actions: number; lastAt: string | null }>();
  for (const name of teamMembers) byUser.set(name, { actions: 0, lastAt: null });
  for (const entry of usageLog) {
    const row = byUser.get(entry.user) || { actions: 0, lastAt: null };
    row.actions += 1;
    if (!row.lastAt || entry.at > row.lastAt) row.lastAt = entry.at;
    byUser.set(entry.user, row);
  }
  return [...byUser.entries()].map(([user, v]) => ({
    user,
    actions: v.actions,
    lastAt: v.lastAt,
    inactive: !v.lastAt || new Date(v.lastAt).getTime() < since,
  }));
}

export function inactiveUsers(
  usageLog: UsageLogEntry[],
  teamMembers: string[],
  inactiveDays: number,
): string[] {
  const cutoff = Date.now() - inactiveDays * 86400000;
  return computeAdoptionMetrics(usageLog, teamMembers, inactiveDays)
    .filter((m) => m.inactive && teamMembers.includes(m.user))
    .map((m) => m.user);
}

export function campaignLeadQuality(
  contacts: Contact[],
  groupIds: number[],
  contactGroupMap: Record<number, number[]>,
  emailLog: { contactId: number }[],
  deals: Deal[],
): { total: number; qualified: number; rate: number } {
  const ids = new Set<number>();
  for (const [cId, gIds] of Object.entries(contactGroupMap)) {
    if (gIds.some((g) => groupIds.includes(g))) ids.add(Number(cId));
  }
  const total = ids.size;
  if (!total) return { total: 0, qualified: 0, rate: 0 };
  let qualified = 0;
  for (const id of ids) {
    const c = contacts.find((x) => x.id === id);
    if (!c) continue;
    const hasDeal = deals.some((d) => d.contact === c.name && !/closed lost/i.test(d.stage));
    const engaged = emailLog.some((e) => e.contactId === id) || c.interactions > 0;
    if (c.score >= 60 || hasDeal || engaged) qualified += 1;
  }
  return { total, qualified, rate: Math.round((qualified / total) * 100) };
}

export function summarizeCampaigns(campaigns: MarketingCampaign[]): {
  active: number; enrolled: number; sent: number;
} {
  const active = campaigns.filter((c) => c.status === "active").length;
  const enrolled = campaigns.reduce((s, c) => s + (c.enrolledCount || 0), 0);
  const sent = campaigns.reduce((s, c) => s + (c.sentCount || 0), 0);
  return { active, enrolled, sent };
}
