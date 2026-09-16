/**
 * Detect / purge bundled CRM sample data so orgs track real records only.
 * Sample load remains available via Data Management → Load sample CRM data.
 */

import {
  initialContacts,
  initialDeals,
  type Contact,
  type Deal,
  type Note,
  type Task,
  type Company,
  type Goal,
  type Sequence,
  type Submission,
  type Quote,
  type Package,
  type Meeting,
  type Automation,
  type EmailLogEntry,
  type AuditEntry,
} from "@/lib/crm-data";

const DEMO_CONTACT_EMAILS = new Set(
  initialContacts.map((c) => String(c.email || "").toLowerCase()).filter(Boolean),
);
const DEMO_DEAL_TITLES = new Set(initialDeals.map((d) => String(d.title || "")));

export function isCrmDemoSeedContacts(contacts: Contact[] | undefined | null): boolean {
  if (!Array.isArray(contacts) || contacts.length === 0) return false;
  const emails = contacts.map((c) => String(c.email || "").toLowerCase()).filter(Boolean);
  const hits = emails.filter((e) => DEMO_CONTACT_EMAILS.has(e)).length;
  return hits >= 2 && hits >= Math.ceil(emails.length * 0.5);
}

export function isCrmDemoSeedDeals(deals: Deal[] | undefined | null): boolean {
  if (!Array.isArray(deals) || deals.length === 0) return false;
  const titles = deals.map((d) => String(d.title || ""));
  const hits = titles.filter((t) => DEMO_DEAL_TITLES.has(t)).length;
  return hits >= 2 && hits >= Math.ceil(titles.length * 0.5);
}

/** True when local CRM looks like the bundled Acme / Bright Labs sample set. */
export function isCrmDemoSeedWorkspace(state: {
  contacts?: Contact[];
  deals?: Deal[];
}): boolean {
  return isCrmDemoSeedContacts(state.contacts) || isCrmDemoSeedDeals(state.deals);
}

export type CrmDemoPurgeSetters = {
  setContacts: (v: Contact[]) => void;
  setDeals: (v: Deal[]) => void;
  setNotes: (v: Note[]) => void;
  setTasks: (v: Task[]) => void;
  setCompanies: (v: Company[]) => void;
  setGoals: (v: Goal[]) => void;
  setSequences: (v: Sequence[]) => void;
  setSubmissions: (v: Submission[]) => void;
  setQuotes: (v: Quote[]) => void;
  setPackages: (v: Package[]) => void;
  setMeetings: (v: Meeting[]) => void;
  setAutomations: (v: Automation[]) => void;
  setEmailLog: (v: EmailLogEntry[]) => void;
  setAuditLog: (v: AuditEntry[]) => void;
};

/** Wipe sample CRM entities from local state + demo flag. Returns true if purged. */
export function purgeCrmDemoSeedIfPresent(
  state: { contacts?: Contact[]; deals?: Deal[] },
  setters: CrmDemoPurgeSetters,
): boolean {
  if (!isCrmDemoSeedWorkspace(state)) return false;
  setters.setContacts([]);
  setters.setDeals([]);
  setters.setNotes([]);
  setters.setTasks([]);
  setters.setCompanies([]);
  setters.setGoals([]);
  setters.setSequences([]);
  setters.setSubmissions([]);
  setters.setQuotes([]);
  setters.setPackages([]);
  setters.setMeetings([]);
  setters.setAutomations([]);
  setters.setEmailLog([]);
  setters.setAuditLog([]);
  try {
    localStorage.removeItem("meridian_demo_loaded");
  } catch {
    /* ignore */
  }
  return true;
}
