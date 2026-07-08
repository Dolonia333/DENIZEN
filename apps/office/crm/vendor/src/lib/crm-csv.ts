import type { Contact, Deal, Task, Company, Note } from "@/lib/crm-data";
import { STAGES } from "@/lib/crm-data";
import type { CustomFieldDef } from "@/lib/industry-config";

export type CsvImportKind = "contacts" | "deals" | "tasks" | "companies" | "notes" | "unknown";

/** RFC 4180-style CSV parser (quoted fields, escaped quotes, newlines in quotes). */
export function parseCsv(text: string): { headers: string[]; rows: string[][] } {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const s = String(text || "").replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  for (let i = 0; i < s.length; i += 1) {
    const c = s[i];
    const next = s[i + 1];
    if (inQuotes) {
      if (c === '"' && next === '"') {
        field += '"';
        i += 1;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += c;
    }
  }
  row.push(field);
  if (row.some((cell) => cell.length > 0) || rows.length > 0) {
    rows.push(row);
  }

  while (rows.length && rows[rows.length - 1].every((c) => !c.trim())) {
    rows.pop();
  }
  if (!rows.length) return { headers: [], rows: [] };

  const headers = rows[0].map((h) => h.trim());
  return { headers, rows: rows.slice(1) };
}

function headerIndex(headers: string[]): Map<string, number> {
  const map = new Map<string, number>();
  headers.forEach((h, i) => {
    map.set(normalizeHeader(h), i);
  });
  return map;
}

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/[_-]+/g, " ");
}

function pick(row: string[], map: Map<string, number>, ...aliases: string[]): string {
  for (const alias of aliases) {
    const idx = map.get(normalizeHeader(alias));
    if (idx !== undefined && row[idx] != null) {
      return String(row[idx]).trim();
    }
  }
  return "";
}

export function detectCsvKind(headers: string[]): CsvImportKind {
  const keys = new Set(headers.map(normalizeHeader));
  const has = (...names: string[]) => names.some((n) => keys.has(normalizeHeader(n)));
  if (has("title", "deal", "deal title") && has("stage", "value", "amount")) return "deals";
  if (has("due", "priority") && has("title", "task")) return "tasks";
  if (has("domain", "industry", "mrr", "arr") && has("name", "company")) return "companies";
  if (has("text", "note", "body") && has("contact", "date", "type")) return "notes";
  if (has("name", "email", "contact")) return "contacts";
  return "unknown";
}

function parseCustomFields(
  row: string[],
  map: Map<string, number>,
  headers: string[],
  customFields: CustomFieldDef[],
  entity: "contact" | "deal",
): Record<string, unknown> | undefined {
  const defs = customFields.filter((f) => f.entity === entity);
  if (!defs.length) return undefined;
  const out: Record<string, unknown> = {};
  for (const cf of defs) {
    const val = pick(row, map, cf.label, cf.id, `cf ${cf.label}`);
    if (val) out[cf.id] = cf.type === "number" ? Number(val) || val : val;
  }
  for (const h of headers) {
    const nh = normalizeHeader(h);
    const def = defs.find((f) => normalizeHeader(f.label) === nh || f.id === nh);
    if (def && !out[def.id]) {
      const idx = map.get(nh);
      if (idx !== undefined && row[idx]) {
        out[def.id] = def.type === "number" ? Number(row[idx]) || row[idx] : row[idx];
      }
    }
  }
  return Object.keys(out).length ? out : undefined;
}

export function parseCsvContacts(csv: string, customFields: CustomFieldDef[] = []): Partial<Contact>[] {
  const { headers, rows } = parseCsv(csv);
  if (!headers.length) return [];
  const map = headerIndex(headers);
  const today = new Date().toISOString().slice(0, 10);

  return rows
    .map((row, i) => {
      const name = pick(row, map, "name", "contact", "full name");
      if (!name) return null;
      const tagsRaw = pick(row, map, "tags", "tag");
      const scoreRaw = pick(row, map, "score", "lead score");
      return {
        id: Date.now() + i,
        name,
        company: pick(row, map, "company", "organization", "org"),
        email: pick(row, map, "email", "email address"),
        phone: pick(row, map, "phone", "telephone", "mobile"),
        status: pick(row, map, "status") || "Lead",
        tags: tagsRaw ? tagsRaw.split(/[;|]/).map((t) => t.trim()).filter(Boolean) : [],
        score: Number.parseInt(scoreRaw, 10) || 50,
        lastContact: pick(row, map, "last contact", "lastcontact", "last contacted") || today,
        interactions: Number.parseInt(pick(row, map, "interactions"), 10) || 0,
        leadSource: pick(row, map, "lead source", "source") || undefined,
        customFieldValues: parseCustomFields(row, map, headers, customFields, "contact"),
      } satisfies Partial<Contact>;
    })
    .filter((c): c is Partial<Contact> => c !== null);
}

export function parseCsvDeals(csv: string, customFields: CustomFieldDef[] = []): Partial<Deal>[] {
  const { headers, rows } = parseCsv(csv);
  if (!headers.length) return [];
  const map = headerIndex(headers);
  const today = new Date().toISOString().slice(0, 10);

  return rows
    .map((row, i) => {
      const title = pick(row, map, "title", "deal", "deal title", "name");
      if (!title) return null;
      const valueRaw = pick(row, map, "value", "amount", "deal value");
      const value = Number(String(valueRaw).replace(/[$,]/g, "")) || 0;
      const stage = pick(row, map, "stage", "pipeline stage") || "Lead";
      const normalizedStage = STAGES.find((s) => s.toLowerCase() === stage.toLowerCase()) || stage;
      const probRaw = pick(row, map, "probability", "prob", "win probability");
      return {
        id: Date.now() + i,
        title,
        contact: pick(row, map, "contact", "contact name", "account"),
        value,
        stage: normalizedStage,
        probability: Number.parseInt(probRaw, 10) || 25,
        closeDate: pick(row, map, "close date", "closedate", "expected close") || today,
        daysInStage: Number.parseInt(pick(row, map, "days in stage", "daysinstage"), 10) || 0,
        health: pick(row, map, "health") || "good",
        leadSource: pick(row, map, "lead source", "source") || undefined,
        customFieldValues: parseCustomFields(row, map, headers, customFields, "deal"),
      } satisfies Partial<Deal>;
    })
    .filter((d): d is Partial<Deal> => d !== null);
}

export function parseCsvTasks(csv: string): Partial<Task>[] {
  const { headers, rows } = parseCsv(csv);
  if (!headers.length) return [];
  const map = headerIndex(headers);
  return rows
    .map((row, i) => {
      const title = pick(row, map, "title", "task", "task title");
      if (!title) return null;
      return {
        id: Date.now() + i,
        title,
        contact: pick(row, map, "contact", "contact name"),
        due: pick(row, map, "due", "due date"),
        priority: pick(row, map, "priority") || "Medium",
        done: /^(true|yes|1|done)$/i.test(pick(row, map, "done", "completed", "status")),
        status: "todo" as const,
        description: pick(row, map, "description", "notes") || undefined,
      } satisfies Partial<Task>;
    })
    .filter((t): t is Partial<Task> => t !== null);
}

export function parseCsvCompanies(csv: string): Partial<Company>[] {
  const { headers, rows } = parseCsv(csv);
  if (!headers.length) return [];
  const map = headerIndex(headers);
  return rows
    .map((row, i) => {
      const name = pick(row, map, "name", "company");
      if (!name) return null;
      const tagsRaw = pick(row, map, "tags");
      return {
        id: Date.now() + i,
        name,
        domain: pick(row, map, "domain", "website domain"),
        industry: pick(row, map, "industry"),
        size: pick(row, map, "size", "employees"),
        mrr: Number(String(pick(row, map, "mrr")).replace(/[$,]/g, "")) || 0,
        arr: Number(String(pick(row, map, "arr")).replace(/[$,]/g, "")) || 0,
        health: pick(row, map, "health") || "good",
        tags: tagsRaw ? tagsRaw.split(/[;|]/).map((t) => t.trim()).filter(Boolean) : [],
        website: pick(row, map, "website", "url"),
        notes: pick(row, map, "notes", "description"),
        linkedContacts: [],
        linkedDeals: [],
      } satisfies Partial<Company>;
    })
    .filter((c): c is Partial<Company> => c !== null);
}

export function parseCsvNotes(csv: string): Partial<Note>[] {
  const { headers, rows } = parseCsv(csv);
  if (!headers.length) return [];
  const map = headerIndex(headers);
  const today = new Date().toISOString().slice(0, 10);
  return rows
    .map((row, i) => {
      const text = pick(row, map, "text", "note", "body", "content");
      if (!text) return null;
      return {
        id: Date.now() + i,
        contact: pick(row, map, "contact", "contact name"),
        text,
        date: pick(row, map, "date", "created") || today,
        type: pick(row, map, "type", "note type") || "Call",
      } satisfies Partial<Note>;
    })
    .filter((n): n is Partial<Note> => n !== null);
}

export type CsvAutoResult = {
  kind: CsvImportKind;
  contacts: Partial<Contact>[];
  deals: Partial<Deal>[];
  tasks: Partial<Task>[];
  companies: Partial<Company>[];
  notes: Partial<Note>[];
  headers: string[];
  rows: string[][];
};

export function parseCsvAuto(csv: string, customFields: CustomFieldDef[] = []): CsvAutoResult {
  const { headers, rows } = parseCsv(csv);
  const kind = detectCsvKind(headers);
  const empty = { contacts: [] as Partial<Contact>[], deals: [] as Partial<Deal>[], tasks: [] as Partial<Task>[], companies: [] as Partial<Company>[], notes: [] as Partial<Note>[] };
  if (kind === "deals") return { kind, ...empty, deals: parseCsvDeals(csv, customFields), headers, rows };
  if (kind === "tasks") return { kind, ...empty, tasks: parseCsvTasks(csv), headers, rows };
  if (kind === "companies") return { kind, ...empty, companies: parseCsvCompanies(csv), headers, rows };
  if (kind === "notes") return { kind, ...empty, notes: parseCsvNotes(csv), headers, rows };
  return { kind: "contacts", ...empty, contacts: parseCsvContacts(csv, customFields), headers, rows };
}
