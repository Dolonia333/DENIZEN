import type { CrmWorkspaceState } from "@/lib/crm-api";
import type { Contact, Deal, Note, Task, Company, AuditEntry } from "@/lib/crm-data";
import type { CustomFieldDef } from "@/lib/industry-config";

export type ImportMode = "append" | "skip_duplicates" | "update_by_email" | "replace";
export type RestoreMode = "merge" | "replace";

export type DuplicateGroup = {
  key: string;
  reason: "email" | "name_company";
  contacts: Contact[];
};

export type DataQualityIssue = {
  id: string;
  severity: "error" | "warn" | "info";
  category: string;
  message: string;
  entityType?: string;
  entityId?: number;
  entityName?: string;
};

export type DataQualityReport = {
  issues: DataQualityIssue[];
  counts: { errors: number; warnings: number; info: number };
};

export type BulkContactPatch = {
  status?: string;
  addTags?: string[];
  removeTags?: string[];
  scoreDelta?: number;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function nextEntityId(list: { id?: number }[]): number {
  const ids = list.map((r) => Number(r?.id) || 0);
  return ids.length ? Math.max(...ids) + 1 : Date.now();
}

export function contactDedupeKey(c: Pick<Contact, "email" | "name" | "company">): string | null {
  const email = String(c.email || "").trim().toLowerCase();
  if (email) return `email:${email}`;
  const name = String(c.name || "").trim().toLowerCase();
  const company = String(c.company || "").trim().toLowerCase();
  if (name && company) return `nameco:${name}|${company}`;
  if (name) return `name:${name}`;
  return null;
}

export function findDuplicateContacts(contacts: Contact[]): DuplicateGroup[] {
  const byEmail = new Map<string, Contact[]>();
  const byNameCo = new Map<string, Contact[]>();

  for (const c of contacts) {
    const email = String(c.email || "").trim().toLowerCase();
    if (email) {
      const list = byEmail.get(email) || [];
      list.push(c);
      byEmail.set(email, list);
    }
    const name = String(c.name || "").trim().toLowerCase();
    const company = String(c.company || "").trim().toLowerCase();
    if (name && company) {
      const k = `${name}|${company}`;
      const list = byNameCo.get(k) || [];
      list.push(c);
      byNameCo.set(k, list);
    }
  }

  const groups: DuplicateGroup[] = [];
  const seen = new Set<number>();

  for (const [key, list] of byEmail) {
    if (list.length < 2) continue;
    for (const c of list) seen.add(c.id);
    groups.push({ key: `email:${key}`, reason: "email", contacts: list });
  }

  for (const [key, list] of byNameCo) {
    const fresh = list.filter((c) => !seen.has(c.id));
    if (fresh.length < 2) continue;
    groups.push({ key: `nameco:${key}`, reason: "name_company", contacts: fresh });
  }

  return groups;
}

export function mergeContacts(primary: Contact, others: Contact[]): Contact {
  const merged: Contact = { ...primary };
  const tags = new Set(merged.tags || []);
  let interactions = merged.interactions || 0;
  let score = merged.score || 50;
  const cf: Record<string, unknown> = { ...(merged.customFieldValues || {}) };

  for (const o of others) {
    (o.tags || []).forEach((t) => tags.add(t));
    interactions += o.interactions || 0;
    score = Math.max(score, o.score || 0);
    if (!merged.phone && o.phone) merged.phone = o.phone;
    if (!merged.email && o.email) merged.email = o.email;
    if (!merged.company && o.company) merged.company = o.company;
    if (o.customFieldValues) {
      for (const [k, v] of Object.entries(o.customFieldValues)) {
        if (cf[k] == null || cf[k] === "") cf[k] = v;
      }
    }
    if (o.lastContact && (!merged.lastContact || o.lastContact > merged.lastContact)) {
      merged.lastContact = o.lastContact;
    }
    if (o.status === "Customer") merged.status = "Customer";
    else if (o.status === "Prospect" && merged.status === "Lead") merged.status = "Prospect";
  }

  merged.tags = [...tags];
  merged.interactions = interactions;
  merged.score = score;
  merged.customFieldValues = cf;
  return merged;
}

export function applyContactImport(
  existing: Contact[],
  incoming: Contact[],
  mode: ImportMode,
): Contact[] {
  if (mode === "replace") return incoming.map((c, i) => ({ ...c, id: c.id || Date.now() + i }));

  const out = [...existing];
  const indexByKey = new Map<string, number>();
  out.forEach((c, i) => {
    const k = contactDedupeKey(c);
    if (k) indexByKey.set(k, i);
  });

  for (let i = 0; i < incoming.length; i += 1) {
    const row = incoming[i];
    const key = contactDedupeKey(row);
    const emailKey = String(row.email || "").trim().toLowerCase();

    if (mode === "skip_duplicates" && key && indexByKey.has(key)) continue;

    if (mode === "update_by_email" && emailKey && indexByKey.has(`email:${emailKey}`)) {
      const idx = indexByKey.get(`email:${emailKey}`)!;
      out[idx] = { ...out[idx], ...row, id: out[idx].id };
      continue;
    }

    const id = row.id || Date.now() + i;
    const contact = { ...row, id } as Contact;
    out.push(contact);
    const k = contactDedupeKey(contact);
    if (k) indexByKey.set(k, out.length - 1);
  }

  return out;
}

export function applyDealImport(existing: Deal[], incoming: Deal[], mode: ImportMode): Deal[] {
  if (mode === "replace") return incoming.map((d, i) => ({ ...d, id: d.id || Date.now() + i }));

  const out = [...existing];
  const byTitleContact = new Map<string, number>();
  out.forEach((d, i) => {
    const k = `${String(d.title).toLowerCase()}|${String(d.contact).toLowerCase()}`;
    byTitleContact.set(k, i);
  });

  for (let i = 0; i < incoming.length; i += 1) {
    const row = incoming[i];
    const k = `${String(row.title || "").toLowerCase()}|${String(row.contact || "").toLowerCase()}`;

    if (mode === "skip_duplicates" && byTitleContact.has(k)) continue;

    if (mode === "update_by_email" && byTitleContact.has(k)) {
      const idx = byTitleContact.get(k)!;
      out[idx] = { ...out[idx], ...row, id: out[idx].id };
      continue;
    }

    const id = row.id || Date.now() + i;
    const deal = { ...row, id } as Deal;
    out.push(deal);
    byTitleContact.set(k, out.length - 1);
  }

  return out;
}

export function bulkPatchContacts(contacts: Contact[], ids: Set<number>, patch: BulkContactPatch): Contact[] {
  return contacts.map((c) => {
    if (!ids.has(c.id)) return c;
    let next = { ...c };
    if (patch.status) next.status = patch.status;
    if (patch.addTags?.length) {
      const tags = new Set(next.tags || []);
      patch.addTags.forEach((t) => tags.add(t));
      next.tags = [...tags];
    }
    if (patch.removeTags?.length) {
      next.tags = (next.tags || []).filter((t) => !patch.removeTags!.includes(t));
    }
    if (patch.scoreDelta) {
      next.score = Math.max(0, Math.min(100, (next.score || 50) + patch.scoreDelta));
    }
    return next;
  });
}

export function analyzeDataQuality(state: {
  contacts?: Contact[];
  deals?: Deal[];
  tasks?: Task[];
  companies?: Company[];
  notes?: Note[];
}): DataQualityReport {
  const issues: DataQualityIssue[] = [];
  const contacts = state.contacts || [];
  const deals = state.deals || [];
  const contactNames = new Set(contacts.map((c) => c.name));
  const contactEmails = new Set(contacts.map((c) => String(c.email || "").toLowerCase()).filter(Boolean));

  for (const c of contacts) {
    if (!String(c.email || "").trim()) {
      issues.push({
        id: `contact-no-email-${c.id}`,
        severity: "warn",
        category: "Contacts",
        message: "Missing email address",
        entityType: "contact",
        entityId: c.id,
        entityName: c.name,
      });
    } else if (!EMAIL_RE.test(c.email)) {
      issues.push({
        id: `contact-bad-email-${c.id}`,
        severity: "error",
        category: "Contacts",
        message: "Invalid email format",
        entityType: "contact",
        entityId: c.id,
        entityName: c.name,
      });
    }
    if (!String(c.name || "").trim()) {
      issues.push({
        id: `contact-no-name-${c.id}`,
        severity: "error",
        category: "Contacts",
        message: "Missing name",
        entityType: "contact",
        entityId: c.id,
      });
    }
  }

  for (const d of deals) {
    if (d.contact && !contactNames.has(d.contact)) {
      issues.push({
        id: `deal-orphan-${d.id}`,
        severity: "warn",
        category: "Deals",
        message: `Deal contact "${d.contact}" not found in contacts`,
        entityType: "deal",
        entityId: d.id,
        entityName: d.title,
      });
    }
    if (!d.value || d.value <= 0) {
      issues.push({
        id: `deal-no-value-${d.id}`,
        severity: "info",
        category: "Deals",
        message: "Deal has no value set",
        entityType: "deal",
        entityId: d.id,
        entityName: d.title,
      });
    }
  }

  const dupes = findDuplicateContacts(contacts);
  for (const g of dupes) {
    issues.push({
      id: `dup-${g.key}`,
      severity: "warn",
      category: "Duplicates",
      message: `${g.contacts.length} contacts share ${g.reason === "email" ? "the same email" : "name + company"}: ${g.contacts.map((c) => c.name).join(", ")}`,
    });
  }

  const staleDays = 60;
  const today = Date.now();
  for (const c of contacts) {
    if (!c.lastContact) continue;
    const days = Math.floor((today - new Date(c.lastContact).getTime()) / 86400000);
    if (days >= staleDays && c.status !== "Customer") {
      issues.push({
        id: `stale-${c.id}`,
        severity: "info",
        category: "Engagement",
        message: `No contact in ${days} days`,
        entityType: "contact",
        entityId: c.id,
        entityName: c.name,
      });
    }
  }

  for (const t of state.tasks || []) {
    if (t.contact && !contactNames.has(t.contact)) {
      issues.push({
        id: `task-orphan-${t.id}`,
        severity: "info",
        category: "Tasks",
        message: `Task linked to unknown contact "${t.contact}"`,
        entityType: "task",
        entityId: t.id,
        entityName: t.title,
      });
    }
  }

  if (contacts.length && contactEmails.size < contacts.filter((c) => c.email).length) {
    issues.push({
      id: "duplicate-emails-global",
      severity: "warn",
      category: "Duplicates",
      message: "Some contacts share duplicate email addresses",
    });
  }

  return {
    issues,
    counts: {
      errors: issues.filter((i) => i.severity === "error").length,
      warnings: issues.filter((i) => i.severity === "warn").length,
      info: issues.filter((i) => i.severity === "info").length,
    },
  };
}

export function parseWorkspaceJson(text: string): { ok: true; state: CrmWorkspaceState } | { ok: false; error: string } {
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object") {
      return { ok: false, error: "File must contain a JSON object" };
    }
    const state = parsed.state && typeof parsed.state === "object" ? parsed.state : parsed;
    if (!Array.isArray(state.contacts) && !Array.isArray(state.deals) && !state.industryConfig) {
      return { ok: false, error: "Unrecognized backup format — expected workspace fields (contacts, deals, etc.)" };
    }
    return { ok: true, state: state as CrmWorkspaceState };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Invalid JSON" };
  }
}

export function restoreWorkspace(current: CrmWorkspaceState, imported: CrmWorkspaceState, mode: RestoreMode): CrmWorkspaceState {
  if (mode === "replace") return { ...imported };
  return {
    ...current,
    ...imported,
    contacts: imported.contacts ?? current.contacts,
    deals: imported.deals ?? current.deals,
    notes: imported.notes ?? current.notes,
    tasks: imported.tasks ?? current.tasks,
    companies: imported.companies ?? current.companies,
    goals: imported.goals ?? current.goals,
    sequences: imported.sequences ?? current.sequences,
    sequenceEnrollments: imported.sequenceEnrollments ?? current.sequenceEnrollments,
    submissions: imported.submissions ?? current.submissions,
    quotes: imported.quotes ?? current.quotes,
    packages: imported.packages ?? current.packages,
    meetings: imported.meetings ?? current.meetings,
    automations: imported.automations ?? current.automations,
    emailTemplates: imported.emailTemplates ?? current.emailTemplates,
    emailLog: imported.emailLog ?? current.emailLog,
    auditLog: imported.auditLog ?? current.auditLog,
    noteBoards: imported.noteBoards ?? current.noteBoards,
    industryConfig: imported.industryConfig ?? current.industryConfig,
    contactGroups: imported.contactGroups ?? current.contactGroups,
    contactGroupMap: imported.contactGroupMap ?? current.contactGroupMap,
    crmQuotas: imported.crmQuotas ?? current.crmQuotas,
    intakeQuestions: imported.intakeQuestions ?? current.intakeQuestions,
  };
}

export function appendAudit(
  log: AuditEntry[],
  entry: Omit<AuditEntry, "id" | "at"> & { at?: string },
): AuditEntry[] {
  const row: AuditEntry = {
    id: nextEntityId(log),
    at: entry.at || new Date().toISOString(),
    user: entry.user || "You",
    action: entry.action,
    entity: entry.entity,
    entityName: entry.entityName,
    field: entry.field,
    from: entry.from,
    to: entry.to,
  };
  return [row, ...log].slice(0, 500);
}

export function exportContactGdpr(contacts: Contact[], contactId: number): Record<string, unknown> | null {
  const c = contacts.find((x) => x.id === contactId);
  if (!c) return null;
  return {
    exportedAt: new Date().toISOString(),
    contact: c,
  };
}

/** Map CSV header → canonical field id for manual column mapping UI */
export const CONTACT_FIELD_ALIASES: Record<string, string[]> = {
  name: ["name", "contact", "full name", "contact name"],
  email: ["email", "email address", "e-mail"],
  company: ["company", "organization", "org", "account"],
  phone: ["phone", "telephone", "mobile", "cell"],
  status: ["status", "lead status"],
  tags: ["tags", "tag", "labels"],
  score: ["score", "lead score"],
  lastContact: ["last contact", "lastcontact", "last contacted"],
  leadSource: ["lead source", "source"],
};

export const DEAL_FIELD_ALIASES: Record<string, string[]> = {
  title: ["title", "deal", "deal title", "name"],
  contact: ["contact", "contact name", "account"],
  value: ["value", "amount", "deal value"],
  stage: ["stage", "pipeline stage"],
  probability: ["probability", "prob", "win probability"],
  closeDate: ["close date", "closedate", "expected close"],
  health: ["health"],
  leadSource: ["lead source", "source"],
};

export function buildColumnMapping(
  headers: string[],
  aliases: Record<string, string[]>,
): Record<string, string> {
  const norm = (h: string) => h.trim().toLowerCase().replace(/[_-]+/g, " ");
  const mapping: Record<string, string> = {};
  for (const header of headers) {
    const nh = norm(header);
    for (const [field, list] of Object.entries(aliases)) {
      if (list.some((a) => norm(a) === nh)) {
        mapping[header] = field;
        break;
      }
    }
  }
  return mapping;
}

export function parseContactsWithMapping(
  rows: string[][],
  headers: string[],
  mapping: Record<string, string>,
  customFields: CustomFieldDef[] = [],
): Partial<Contact>[] {
  const colIndex = new Map(headers.map((h, i) => [h, i]));
  const today = new Date().toISOString().slice(0, 10);
  const contactCf = customFields.filter((f) => f.entity === "contact");

  return rows
    .map((row, i) => {
      const get = (field: string) => {
        const header = Object.entries(mapping).find(([, f]) => f === field)?.[0];
        if (!header) return "";
        const idx = colIndex.get(header);
        return idx !== undefined ? String(row[idx] ?? "").trim() : "";
      };
      const name = get("name");
      if (!name) return null;
      const tagsRaw = get("tags");
      const customFieldValues: Record<string, unknown> = {};
      for (const cf of contactCf) {
        const header = Object.entries(mapping).find(([, f]) => f === `cf:${cf.id}`)?.[0]
          || headers.find((h) => normHeader(h) === normHeader(cf.label));
        if (header) {
          const idx = colIndex.get(header);
          if (idx !== undefined && row[idx]) customFieldValues[cf.id] = row[idx];
        }
      }
      return {
        id: Date.now() + i,
        name,
        company: get("company"),
        email: get("email"),
        phone: get("phone"),
        status: get("status") || "Lead",
        tags: tagsRaw ? tagsRaw.split(/[;|]/).map((t) => t.trim()).filter(Boolean) : [],
        score: Number.parseInt(get("score"), 10) || 50,
        lastContact: get("lastContact") || today,
        interactions: 0,
        leadSource: get("leadSource") || undefined,
        customFieldValues: Object.keys(customFieldValues).length ? customFieldValues : undefined,
      } satisfies Partial<Contact>;
    })
    .filter((c): c is Partial<Contact> => c !== null);
}

function normHeader(h: string): string {
  return h.trim().toLowerCase().replace(/[_-]+/g, " ");
}

export type ClearableEntity =
  | "contacts" | "deals" | "notes" | "tasks" | "companies"
  | "submissions" | "quotes" | "meetings" | "emailLog" | "auditLog";

export const CLEARABLE_ENTITIES: { id: ClearableEntity; label: string; warn: string }[] = [
  { id: "contacts", label: "Contacts", warn: "Removes all contacts (deals may become orphaned)" },
  { id: "deals", label: "Deals", warn: "Removes all pipeline deals" },
  { id: "notes", label: "Notes", warn: "Removes contact call logs" },
  { id: "tasks", label: "Tasks", warn: "Removes all tasks" },
  { id: "companies", label: "Companies", warn: "Removes company records" },
  { id: "submissions", label: "Intake submissions", warn: "Removes intake form submissions" },
  { id: "quotes", label: "Quotes", warn: "Removes quotes and portal links" },
  { id: "meetings", label: "Meetings", warn: "Removes scheduled meetings" },
  { id: "emailLog", label: "Email log", warn: "Clears sent email history" },
  { id: "auditLog", label: "Audit log", warn: "Clears change history" },
];
