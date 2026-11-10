import type { IntakeQuestion } from "@/lib/crm-data";
import { defaultIntakeQuestions } from "@/lib/crm-data";

export const INTAKE_FIELD_TYPES = [
  { id: "text", label: "Short text" },
  { id: "textarea", label: "Long text" },
  { id: "select", label: "Dropdown" },
  { id: "multiselect", label: "Multi-select" },
  { id: "number", label: "Number" },
  { id: "email", label: "Email" },
  { id: "phone", label: "Phone" },
] as const;

export type IntakeFieldType = (typeof INTAKE_FIELD_TYPES)[number]["id"];

const OPTION_TYPES = new Set<string>(["select", "multiselect"]);

export function nextIntakeQuestionId(list: IntakeQuestion[]): number {
  const ids = list.map((q) => Number(q?.id) || 0);
  return ids.length ? Math.max(...ids) + 1 : 1;
}

export function createBlankIntakeQuestion(list: IntakeQuestion[]): IntakeQuestion {
  return {
    id: nextIntakeQuestionId(list),
    label: "New question",
    type: "text",
    required: false,
    icon: "•",
    options: [],
    placeholder: "",
  };
}

/** Normalize a question list for storage / public form render. */
export function normalizeIntakeQuestions(raw: unknown): IntakeQuestion[] {
  if (!Array.isArray(raw)) return [...defaultIntakeQuestions];
  const out: IntakeQuestion[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const label = String(row.label || "").trim().slice(0, 200);
    if (!label) continue;
    const type = String(row.type || "text").trim().toLowerCase() || "text";
    const known = INTAKE_FIELD_TYPES.some((t) => t.id === type) ? type : "text";
    const options = Array.isArray(row.options)
      ? row.options.map((o) => String(o || "").trim()).filter(Boolean).slice(0, 40)
      : [];
    out.push({
      id: Number(row.id) || out.length + 1,
      label,
      type: known,
      required: Boolean(row.required),
      icon: String(row.icon || "•").slice(0, 8) || "•",
      placeholder: String(row.placeholder || "").slice(0, 200) || undefined,
      ...(OPTION_TYPES.has(known) ? { options: options.length ? options : ["Option 1"] } : {}),
    });
    if (out.length >= 40) break;
  }
  return out.length ? out : [...defaultIntakeQuestions];
}

export function moveIntakeQuestion(list: IntakeQuestion[], id: number, dir: -1 | 1): IntakeQuestion[] {
  const idx = list.findIndex((q) => q.id === id);
  if (idx < 0) return list;
  const next = idx + dir;
  if (next < 0 || next >= list.length) return list;
  const copy = [...list];
  const [row] = copy.splice(idx, 1);
  copy.splice(next, 0, row);
  return copy;
}

export function updateIntakeQuestion(
  list: IntakeQuestion[],
  id: number,
  patch: Partial<IntakeQuestion>,
): IntakeQuestion[] {
  return list.map((q) => {
    if (q.id !== id) return q;
    const next = { ...q, ...patch, id: q.id };
    if (patch.type && OPTION_TYPES.has(patch.type) && !(next.options?.length)) {
      next.options = ["Option 1", "Option 2"];
    }
    if (patch.type && !OPTION_TYPES.has(patch.type)) {
      delete next.options;
    }
    return next;
  });
}

export function removeIntakeQuestion(list: IntakeQuestion[], id: number): IntakeQuestion[] {
  if (list.length <= 1) return list;
  return list.filter((q) => q.id !== id);
}

export function parseOptionsText(text: string): string[] {
  return String(text || "")
    .split(/\n|,/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 40);
}

export function embedSnippet(orgSlug: string, pageUrl: string): string {
  const src = pageUrl || `/crm/intake.html?org=${encodeURIComponent(orgSlug)}`;
  return `<iframe src="${src}" title="Intake form" width="100%" height="720" style="border:0;border-radius:12px;max-width:560px" loading="lazy"></iframe>`;
}
