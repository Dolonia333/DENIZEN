import type { Contact, Deal } from "@/lib/crm-data";
import type { EmailTemplate } from "@/components/crm/EmailTemplatesTab";

export interface MergeContext {
  name?: string;
  company?: string;
  email?: string;
  dealTitle?: string;
  dealValue?: string;
  senderName?: string;
}

export function buildMergeContext(
  contact: Contact | null | undefined,
  deal: Deal | null | undefined,
  senderName: string,
): MergeContext {
  const value = deal?.value != null ? `$${Number(deal.value).toLocaleString()}` : "";
  return {
    name: contact?.name || "",
    company: contact?.company || "",
    email: contact?.email || "",
    dealTitle: deal?.title || "",
    dealValue: value,
    senderName: senderName || "Team",
  };
}

export function mergeEmailFields(text: string, ctx: MergeContext): string {
  return String(text || "")
    .replace(/\{\{name\}\}/g, ctx.name || "")
    .replace(/\{\{company\}\}/g, ctx.company || "")
    .replace(/\{\{email\}\}/g, ctx.email || "")
    .replace(/\{\{deal\.title\}\}/g, ctx.dealTitle || "")
    .replace(/\{\{deal\.value\}\}/g, ctx.dealValue || "")
    .replace(/\{\{sender\.name\}\}/g, ctx.senderName || "Team");
}

export function applyTemplate(
  template: EmailTemplate | null | undefined,
  ctx: MergeContext,
): { subject: string; body: string } {
  if (!template) return { subject: "", body: "" };
  return {
    subject: mergeEmailFields(template.subject, ctx),
    body: mergeEmailFields(template.body, ctx),
  };
}
