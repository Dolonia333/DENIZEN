import { useEffect, useState, useCallback } from "react";
import { T, S, fmt } from "@/lib/crm-data";
import { fetchPublicQuote, postPortalEvent, signPublicQuote, createPortalCheckout, fetchStripeStatus, type PublicQuote } from "@/lib/crm-api";
import { SignaturePad, type SignatureDraft } from "@/components/crm/SignaturePad";
import { useProposalPDF } from "@/components/crm/ProposalPDF";
import type { ProposalBranding } from "@/lib/proposal-document";
import type { Quote } from "@/lib/crm-data";

function toQuote(pq: PublicQuote): Quote {
  return {
    id: pq.id,
    submissionId: 0,
    clientName: pq.clientName,
    company: pq.company,
    createdAt: new Date().toISOString().slice(0, 10),
    status: pq.status,
    recommendedPackage: pq.recommendedPackage,
    aiReasoning: "",
    lineItems: pq.lineItems,
    monthlyTotal: pq.monthlyTotal,
    onetimeTotal: pq.onetimeTotal,
    notes: "",
    validUntil: pq.validUntil,
    portalToken: pq.portalToken,
    portalViewedAt: null,
    portalSignedAt: pq.signatures?.[0]?.signedAt || null,
    portalPaidAt: null,
    signature: pq.signatures?.[0]?.value || null,
    portalActivity: [],
  };
}

type SignerView = {
  id: string;
  method: "typed" | "drawn";
  value: string;
  signerName: string;
  signerEmail?: string;
  signerRole?: string;
  signedAt: string;
  lockedAt: string;
};

export function PortalPage({ token }: { token: string }) {
  const [loading, setLoading] = useState(true);
  const [quote, setQuote] = useState<PublicQuote | null>(null);
  const [expired, setExpired] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signers, setSigners] = useState<SignerView[]>([]);
  const [addingMore, setAddingMore] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [stripeReady, setStripeReady] = useState(false);
  const [paying, setPaying] = useState(false);
  const { downloadPDF } = useProposalPDF();

  const branding: ProposalBranding = quote?.branding || {
    companyName: "Meridian",
    tagline: "Pro Workspace",
    accentColor: "#f0b429",
    logoEmoji: "M",
  };

  const load = useCallback(async () => {
    setLoading(true);
    const result = await fetchPublicQuote(token);
    if (!result.ok || !result.quote) {
      setError(result.error || "not_found");
      setQuote(null);
      setLoading(false);
      return;
    }
    setQuote(result.quote);
    setExpired(!!result.expired);
    setSigners((result.quote.signatures || []).map((s) => ({
      id: s.id,
      method: s.method as "typed" | "drawn",
      value: s.value,
      signerName: s.signerName,
      signerEmail: s.signerEmail,
      signerRole: s.signerRole,
      signedAt: s.signedAt,
      lockedAt: s.lockedAt,
    })));
    setLoading(false);
  }, [token]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    void fetchStripeStatus().then((s) => setStripeReady(s.configured));
  }, []);

  useEffect(() => {
    const hash = window.location.hash || "";
    if (hash.includes("paid=1")) {
      void load();
      void postPortalEvent(token, "paid", "Returned from Stripe checkout");
    }
  }, [token, load]);

  useEffect(() => {
    if (!quote || expired) return;
    const flagKey = `meridian_portal_opened_${token}`;
    if (sessionStorage.getItem(flagKey)) return;
    sessionStorage.setItem(flagKey, "1");
    void postPortalEvent(token, "portal_opened", "Client opened shareable portal");
  }, [token, quote, expired]);

  const handleSign = async (draft: SignatureDraft) => {
    setErrorMsg(null);
    const result = await signPublicQuote(token, {
      method: draft.method,
      value: draft.value,
      signerName: draft.signerName,
      signerEmail: draft.signerEmail,
      signerRole: draft.signerRole,
      consent: draft.consent,
      userAgent: navigator.userAgent,
    });
    if (!result.ok) {
      setErrorMsg(result.error || "Sign failed");
      return;
    }
    if (result.quote) {
      setQuote(result.quote);
      setSigners((result.quote.signatures || []).map((s) => ({
        id: s.id,
        method: s.method as "typed" | "drawn",
        value: s.value,
        signerName: s.signerName,
        signerEmail: s.signerEmail,
        signerRole: s.signerRole,
        signedAt: s.signedAt,
        lockedAt: s.lockedAt,
      })));
    }
    setAddingMore(false);
  };

  if (loading) return <ErrorScreen icon="⏳" title="Loading proposal…" body="Please wait." />;
  if (error || !quote) return <ErrorScreen icon="🔗" title="Portal link invalid" body="This proposal could not be found. Please ask your account manager to resend the link." />;
  if (expired) return <ErrorScreen icon="⏰" title="This link has expired" body={`This proposal expired on ${quote.validUntil}. Please request a fresh link.`} />;

  const hasSigned = signers.length > 0;
  const isPaid = Boolean(quote.portalPaidAt);

  const handlePay = async () => {
    setPaying(true);
    setErrorMsg(null);
    const result = await createPortalCheckout(token);
    setPaying(false);
    if (!result.ok || !result.url) {
      setErrorMsg(result.error || "Payment unavailable");
      return;
    }
    window.location.href = result.url;
  };

  return (
    <div style={{ minHeight: "100vh", background: T.bg1, color: T.text1, padding: "32px 16px 64px" }}>
      <div style={{ maxWidth: 720, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, background: `linear-gradient(135deg,${branding.accentColor},#d97706)`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>{branding.logoEmoji}</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: T.text0 }}>{branding.companyName}</div>
            <div style={{ fontSize: 14, color: T.text3 }}>{branding.tagline}</div>
          </div>
        </div>

        <div style={{ background: `linear-gradient(145deg,${T.bg2},${T.bg3}88)`, border: `1px solid ${T.bg4}`, borderRadius: T.radius.lg, padding: 24, marginBottom: 16 }}>
          <div style={{ fontSize: 14, textTransform: "uppercase", letterSpacing: "0.08em", color: T.text3 }}>Proposal · PROP-{String(quote.id).padStart(4, "0")}</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: T.text0, marginTop: 4 }}>{quote.company}</div>
          <div style={{ fontSize: 14, color: T.text2, marginTop: 2 }}>Prepared for {quote.clientName} · {quote.recommendedPackage}</div>
          <div style={{ marginTop: 18, paddingTop: 16, borderTop: `1px solid ${T.bg4}` }}>
            {quote.lineItems.map((i) => (
              <div key={i.id} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", fontSize: 14 }}>
                <span style={{ color: T.text1 }}>{i.name}</span>
                <span style={{ color: T.accent, fontWeight: 600, fontFamily: "'JetBrains Mono', monospace" }}>{fmt(i.price)}{i.unit}</span>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 14, paddingTop: 12, borderTop: `2px solid ${T.bg5}` }}>
            <div>
              <div style={{ fontSize: 14, color: T.text3 }}>Monthly</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: T.accent, fontFamily: "'JetBrains Mono', monospace" }}>{fmt(quote.monthlyTotal)}</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 14, color: T.text3 }}>One-time</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: T.purple, fontFamily: "'JetBrains Mono', monospace" }}>{fmt(quote.onetimeTotal)}</div>
            </div>
          </div>
        </div>

        <div style={{ background: `linear-gradient(145deg,${T.bg2},${T.bg3}88)`, border: `1px solid ${T.bg4}`, borderRadius: T.radius.lg, padding: 24 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: T.text0 }}>✍️ Signatures ({signers.length})</div>
            {hasSigned && <span style={{ fontSize: 14, padding: "3px 9px", borderRadius: 10, background: `${T.green}18`, color: T.green, fontWeight: 700 }}>🔒 LOCKED</span>}
          </div>

          {signers.map((sig, idx) => (
            <SignerCard key={sig.id} sig={sig} index={idx} onDownload={() => downloadPDF(toQuote(quote), branding)} />
          ))}

          {(!hasSigned || addingMore) && (
            <div style={{ marginTop: hasSigned ? 16 : 0 }}>
              {errorMsg && <div style={{ padding: "10px 14px", background: `${T.red}12`, border: `1px solid ${T.red}44`, borderRadius: T.radius.md, marginBottom: 12, fontSize: 14, color: T.red }}>{errorMsg}</div>}
              <SignaturePad
                defaultName={hasSigned ? "" : quote.clientName}
                showRole={hasSigned}
                consent={`I agree to the ${quote.recommendedPackage} plan for ${quote.company} at ${fmt(quote.monthlyTotal)}/mo.`}
                onSign={(d) => { void handleSign(d); }}
              />
            </div>
          )}

          {hasSigned && !addingMore && (
            <button aria-label="Action" onClick={() => { setAddingMore(true); setErrorMsg(null); }} style={{ ...(S.btnGhost as React.CSSProperties), width: "100%", marginTop: 14 }}>
              + Add another signer
            </button>
          )}
        </div>

        {hasSigned && stripeReady && (
          <div style={{ background: `linear-gradient(145deg,${T.bg2},${T.bg3}88)`, border: `1px solid ${T.bg4}`, borderRadius: T.radius.lg, padding: 24, marginTop: 16 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: T.text0, marginBottom: 8 }}>💳 Payment</div>
            {isPaid ? (
              <div style={{ fontSize: 14, color: T.green, fontWeight: 600 }}>✓ Payment received — thank you!</div>
            ) : (
              <>
                <div style={{ fontSize: 14, color: T.text2, marginBottom: 14 }}>
                  Pay {fmt(quote.monthlyTotal + quote.onetimeTotal)} securely via Stripe (first invoice).
                </div>
                <button aria-label="Action" onClick={() => { void handlePay(); }} disabled={paying} style={{ ...(S.btn as React.CSSProperties), width: "100%", opacity: paying ? 0.7 : 1 }}>
                  {paying ? "Redirecting…" : `Pay ${fmt(quote.monthlyTotal + quote.onetimeTotal)}`}
                </button>
              </>
            )}
          </div>
        )}

        <div style={{ textAlign: "center", fontSize: 14, color: T.text3, marginTop: 24 }}>
          Powered by {branding.companyName} · Signatures sync to your team workspace
        </div>
      </div>
    </div>
  );
}

function SignerCard({ sig, index, onDownload }: { sig: SignerView; index: number; onDownload: () => void }) {
  return (
    <div style={{ background: T.bg3, borderRadius: T.radius.md, padding: 16, marginBottom: 12, border: `1px solid ${T.bg4}` }}>
      <div style={{ fontSize: 14, color: T.text3, fontWeight: 700, marginBottom: 8 }}>Signer #{index + 1} · {sig.signerName}</div>
      {sig.method === "drawn" ? (
        <img src={sig.value} alt="" style={{ maxWidth: "100%", maxHeight: 100, background: "#fff", borderRadius: 6 }} />
      ) : (
        <div style={{ fontFamily: "'Caveat', cursive", fontSize: 32, color: T.accent }}>{sig.value}</div>
      )}
      <div style={{ fontSize: 14, color: T.text3, marginTop: 8 }}>{new Date(sig.signedAt).toLocaleString()}</div>
      <button aria-label="Action" onClick={onDownload} style={{ ...(S.btn as React.CSSProperties), marginTop: 10, width: "100%" }}>📄 Download PDF</button>
    </div>
  );
}

function ErrorScreen({ icon, title, body }: { icon: string; title: string; body: string }) {
  return (
    <div style={{ minHeight: "100vh", background: T.bg1, color: T.text1, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{ textAlign: "center", maxWidth: 400 }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>{icon}</div>
        <div style={{ fontSize: 18, fontWeight: 700, color: T.text0, marginBottom: 6 }}>{title}</div>
        <div style={{ fontSize: 14, color: T.text3 }}>{body}</div>
      </div>
    </div>
  );
}
