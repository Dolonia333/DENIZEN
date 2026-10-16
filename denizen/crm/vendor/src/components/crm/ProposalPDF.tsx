import { useCallback, useState } from "react";
import { type Quote } from "@/lib/crm-data";
import { appendAudit } from "@/lib/signature-store";
import { downloadProposalPdf } from "@/lib/proposal-pdf";
import type { ProposalBranding } from "@/lib/proposal-document";

interface Props {
  quote: Quote;
  branding: ProposalBranding;
}

export function useProposalPDF() {
  const [busy, setBusy] = useState(false);

  const downloadPDF = useCallback(async (quote: Quote, branding: ProposalBranding) => {
    setBusy(true);
    try {
      await downloadProposalPdf(quote, branding);
      appendAudit(quote.portalToken, {
        event: "downloaded",
        at: new Date().toISOString(),
        detail: "Proposal PDF downloaded",
      });
    } finally {
      setBusy(false);
    }
  }, []);

  return { downloadPDF, busy };
}

export function ProposalPDFButton({
  quote,
  branding,
  style,
}: Props & { style?: React.CSSProperties }) {
  const { downloadPDF, busy } = useProposalPDF();

  return (
    <button aria-label="Action"
      type="button"
      disabled={busy}
      onClick={(e) => {
        e.stopPropagation();
        void downloadPDF(quote, branding);
      }}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "6px 14px",
        borderRadius: 8,
        border: "none",
        background: `${branding.accentColor}22`,
        color: branding.accentColor,
        fontSize: 14,
        fontWeight: 600,
        cursor: busy ? "wait" : "pointer",
        opacity: busy ? 0.7 : 1,
        transition: "all 0.15s",
        ...style,
      }}
      onMouseEnter={(e) => { if (!busy) e.currentTarget.style.background = `${branding.accentColor}44`; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = `${branding.accentColor}22`; }}
    >
      {busy ? "Generating…" : "📄 Download PDF"}
    </button>
  );
}
