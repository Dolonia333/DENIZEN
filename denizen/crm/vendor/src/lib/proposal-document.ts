import { type Quote, fmt } from "@/lib/crm-data";
import { getSignatures } from "@/lib/signature-store";

export interface ProposalBranding {
  companyName: string;
  tagline: string;
  accentColor: string;
  logoEmoji: string;
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

export function generateProposalHTML(quote: Quote, branding: ProposalBranding): string {
  const accent = branding.accentColor;
  const monthlyItems = quote.lineItems.filter((i) => i.unit === "/mo");
  const onetimeItems = quote.lineItems.filter((i) => i.unit !== "/mo");
  const today = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Proposal - ${escapeHtml(quote.company)}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: Inter, -apple-system, BlinkMacSystemFont, sans-serif; color: #1a1a2e; background: #fff; }
  .page { width: 794px; min-height: 1123px; padding: 48px 56px; position: relative; background: #fff; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 40px; padding-bottom: 20px; border-bottom: 3px solid ${accent}; }
  .logo { display: flex; align-items: center; gap: 12px; }
  .logo-icon { width: 48px; height: 48px; border-radius: 12px; background: linear-gradient(135deg, ${accent}, #d97706); display: flex; align-items: center; justify-content: center; font-size: 24px; font-weight: 800; color: #fff; }
  .company-name { font-size: 28px; font-weight: 800; color: #1a1a2e; }
  .company-tagline { font-size: 12px; color: #64748b; margin-top: 2px; }
  .doc-info { text-align: right; font-size: 12px; color: #64748b; line-height: 1.8; }
  .title { font-size: 32px; font-weight: 800; color: #1a1a2e; }
  .subtitle { font-size: 14px; color: #64748b; margin-top: 6px; margin-bottom: 28px; }
  .client-box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 20px; margin-bottom: 24px; display: flex; gap: 40px; }
  .label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; color: #94a3b8; font-weight: 600; margin-bottom: 4px; }
  .value { font-size: 14px; font-weight: 600; color: #1a1a2e; }
  .section-title { font-size: 16px; font-weight: 700; margin: 20px 0 12px; padding-left: 12px; border-left: 4px solid ${accent}; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
  th { text-align: left; font-size: 10px; text-transform: uppercase; color: #94a3b8; padding: 8px 12px; border-bottom: 2px solid #e2e8f0; }
  th:last-child, td:last-child { text-align: right; }
  td { padding: 12px; font-size: 14px; border-bottom: 1px solid #f1f5f9; }
  .totals { background: #1a1a2e; border-radius: 12px; padding: 20px 24px; margin-bottom: 24px; display: flex; justify-content: space-between; color: #fff; }
  .total-label { font-size: 10px; text-transform: uppercase; color: #94a3b8; }
  .total-value { font-size: 22px; font-weight: 800; color: ${accent}; }
  .notes, .reasoning { font-size: 13px; color: #64748b; line-height: 1.7; margin-bottom: 20px; }
  .footer { margin-top: 40px; padding-top: 12px; border-top: 1px solid #f1f5f9; text-align: center; font-size: 10px; color: #94a3b8; }
</style></head><body>
<div class="page">
  <div class="header">
    <div class="logo">
      <div class="logo-icon">${branding.logoEmoji}</div>
      <div>
        <div class="company-name">${escapeHtml(branding.companyName)}</div>
        <div class="company-tagline">${escapeHtml(branding.tagline)}</div>
      </div>
    </div>
    <div class="doc-info">
      <div><strong>Proposal #${String(quote.id).padStart(4, "0")}</strong></div>
      <div>Date: ${today}</div>
      <div>Valid until: ${escapeHtml(quote.validUntil)}</div>
      <div>Status: ${escapeHtml(quote.status.toUpperCase())}</div>
    </div>
  </div>
  <div class="title">Service Proposal</div>
  <div class="subtitle">Prepared for ${escapeHtml(quote.clientName)} at ${escapeHtml(quote.company)}</div>
  <div class="client-box">
    <div><div class="label">Client</div><div class="value">${escapeHtml(quote.clientName)}</div></div>
    <div><div class="label">Company</div><div class="value">${escapeHtml(quote.company)}</div></div>
    <div><div class="label">Package</div><div class="value">✦ ${escapeHtml(quote.recommendedPackage)}</div></div>
  </div>
  ${monthlyItems.length ? `<div class="section-title">Monthly Services</div><table><thead><tr><th>Service</th><th>Amount</th></tr></thead><tbody>${monthlyItems.map((i) => `<tr><td>${escapeHtml(i.name)}</td><td>${fmt(i.price)}/mo</td></tr>`).join("")}</tbody></table>` : ""}
  ${onetimeItems.length ? `<div class="section-title">One-Time Services</div><table><thead><tr><th>Service</th><th>Amount</th></tr></thead><tbody>${onetimeItems.map((i) => `<tr><td>${escapeHtml(i.name)}</td><td>${fmt(i.price)}</td></tr>`).join("")}</tbody></table>` : ""}
  <div class="totals">
    <div><div class="total-label">Monthly</div><div class="total-value">${fmt(quote.monthlyTotal)}</div></div>
    <div><div class="total-label">One-Time</div><div class="total-value" style="color:#fff">${fmt(quote.onetimeTotal)}</div></div>
    <div><div class="total-label">First Month</div><div class="total-value">${fmt(quote.monthlyTotal + quote.onetimeTotal)}</div></div>
  </div>
  ${quote.aiReasoning ? `<div class="section-title">Recommendation</div><div class="reasoning">${escapeHtml(quote.aiReasoning)}</div>` : ""}
  ${quote.notes ? `<div class="section-title">Notes</div><div class="notes">${escapeHtml(quote.notes)}</div>` : ""}
  ${renderSignatures(quote, branding)}
  <div class="footer">${escapeHtml(branding.companyName)} · Valid until ${escapeHtml(quote.validUntil)} · Generated ${today}</div>
</div>
</body></html>`;
}

function renderSignatures(quote: Quote, branding: ProposalBranding): string {
  const sigs = getSignatures(quote.portalToken);
  if (!sigs.length) {
    return `<div style="margin-top:32px;display:flex;gap:48px">
      <div style="flex:1;border-top:2px solid #e2e8f0;padding-top:8px;font-size:11px;color:#94a3b8">${escapeHtml(branding.companyName)} Representative</div>
      <div style="flex:1;border-top:2px solid #e2e8f0;padding-top:8px;font-size:11px;color:#94a3b8">${escapeHtml(quote.clientName)}</div>
    </div>`;
  }
  const primary = sigs[0];
  const mark = primary.method === "drawn"
    ? `<img src="${primary.value}" alt="signature" style="max-height:56px" />`
    : `<div style="font-size:28px">${escapeHtml(primary.value)}</div>`;
  return `<div style="margin-top:32px">
    <div style="font-size:10px;font-weight:700;color:#059669;margin-bottom:8px">✓ ELECTRONICALLY SIGNED</div>
    ${mark}
    <div style="border-top:1px solid #e2e8f0;padding-top:8px;font-size:11px;color:#94a3b8">${escapeHtml(primary.signerName)} · ${new Date(primary.signedAt).toLocaleString()}</div>
  </div>`;
}

export function proposalFilename(quote: Quote): string {
  const slug = (quote.company || quote.clientName || "proposal").replace(/[^\w.-]+/g, "_").slice(0, 40);
  return `proposal-${slug}-${String(quote.id).padStart(4, "0")}.pdf`;
}
