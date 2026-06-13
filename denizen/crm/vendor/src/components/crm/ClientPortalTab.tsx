import { useEffect, useState } from "react";
import { T, fmt, S, type Quote, type Package } from "@/lib/crm-data";
import { SignaturePad, type SignatureDraft } from "./SignaturePad";
import { AuditTrailViewer, GlobalAuditViewer } from "./AuditTrailViewer";
import {
  addSignature,
  appendAudit,
  buildPortalUrl,
  getSignature,
  getSignatures,
  isTokenExpired,
  type SignatureRecord,
} from "@/lib/signature-store";
import { createPortalCheckout, fetchStripeStatus } from "@/lib/crm-api";


interface Props {
  quotes: Quote[];
  packages: Package[];
}

type PortalStep = "review" | "customize" | "sign" | "pay" | "confirmed";

export function ClientPortalTab({ quotes, packages }: Props) {
  const [selectedQuote, setSelectedQuote] = useState<Quote | null>(null);
  const [step, setStep] = useState<PortalStep>("review");
  const [addOns, setAddOns] = useState<Set<string>>(new Set());



  const [signatureName, setSignatureName] = useState("");
  const [signed, setSigned] = useState(false);
  const [savedSig, setSavedSig] = useState<SignatureRecord | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);
  const [payMethod, setPayMethod] = useState<"card" | "invoice">("card");
  const [processing, setProcessing] = useState(false);
  const [stripeReady, setStripeReady] = useState(false);

  useEffect(() => {
    void fetchStripeStatus().then((s) => setStripeReady(s.configured));
  }, []);

  const pkg = selectedQuote ? packages.find(p => p.name === selectedQuote.recommendedPackage) : null;

  // Load any existing signature when a quote is opened
  useEffect(() => {
    if (!selectedQuote) { setSavedSig(null); setSigned(false); return; }
    const existing = getSignature(selectedQuote.portalToken);
    setSavedSig(existing);
    setSigned(!!existing);
  }, [selectedQuote]);

  const toggleAddOn = (name: string) => {
    setAddOns(prev => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });
  };


  const addOnTotal = pkg ? pkg.addOns.filter(a => addOns.has(a.name)).reduce((s, a) => s + a.price, 0) : 0;
  const grandMonthly = (selectedQuote?.monthlyTotal || 0) + addOnTotal;

  const handleSign = (draft: SignatureDraft) => {
    if (!selectedQuote) return;
    const token = selectedQuote.portalToken;
    const result = addSignature(token, draft);
    if (result.ok === false) {
      appendAudit(token, {
        event: "lock_attempt_blocked",
        at: new Date().toISOString(),
        detail: result.reason,
      });
      return;
    }
    const rec = result.record;
    appendAudit(token, {
      event: "signed",
      at: rec.signedAt,
      detail: `${rec.method} signature by ${rec.signerName} (in-app)`,
      userAgent: rec.userAgent,
      signerId: rec.id,
      signerName: rec.signerName,
    });
    setSavedSig(rec);
    setSigned(true);
    setSignatureName(rec.signerName);
    setTimeout(() => setStep("pay"), 900);
  };

  const handleCopyLink = async () => {
    if (!selectedQuote) return;
    const url = buildPortalUrl(selectedQuote.portalToken);
    try {
      await navigator.clipboard.writeText(url);
      appendAudit(selectedQuote.portalToken, {
        event: "link_copied",
        at: new Date().toISOString(),
        detail: "Rep copied shareable portal link",
      });
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 1800);
    } catch {
      window.prompt("Copy portal link:", url);
    }
  };


  const handlePay = async () => {
    if (!selectedQuote) return;
    if (payMethod === "invoice") {
      appendAudit(selectedQuote.portalToken, {
        event: "portal_opened",
        at: new Date().toISOString(),
        detail: "Client chose invoice payment — team follow-up required",
      });
      setStep("confirmed");
      return;
    }
    if (!stripeReady) {
      window.open(buildPortalUrl(selectedQuote.portalToken), "_blank");
      return;
    }
    setProcessing(true);
    const result = await createPortalCheckout(selectedQuote.portalToken);
    setProcessing(false);
    if (result.ok && result.url) {
      window.location.href = result.url;
    } else {
      setProcessing(false);
      setStep("confirmed");
    }
  };

  const cardStyle = {
    background: `linear-gradient(145deg,${T.bg2},${T.bg3}88)`,
    border: `1px solid ${T.bg4}`, borderRadius: T.radius.lg, padding: "20px 22px",
  };

  const stepIndicator = (
    <div style={{ display: "flex", gap: 4, marginBottom: 24, justifyContent: "center" }}>
      {(["review", "customize", "sign", "pay"] as PortalStep[]).map((s, i) => {
        const steps: PortalStep[] = ["review", "customize", "sign", "pay"];
        const currentIdx = steps.indexOf(step === "confirmed" ? "pay" : step);
        const isActive = i <= currentIdx;
        return (
          <div key={s} style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <div style={{
              width: 28, height: 28, borderRadius: "50%",
              background: isActive ? T.accent : T.bg4,
              color: isActive ? "#080d18" : T.text3,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 11, fontWeight: 700, transition: "all 0.3s",
            }}>{i + 1}</div>
            <span style={{ fontSize: 11, color: isActive ? T.text1 : T.text3, fontWeight: isActive ? 600 : 400 }}>
              {s === "review" ? "Review" : s === "customize" ? "Add-ons" : s === "sign" ? "Sign" : "Pay"}
            </span>
            {i < 3 && <div style={{ width: 24, height: 2, background: isActive ? T.accent : T.bg4, borderRadius: 1, transition: "all 0.3s" }} />}
          </div>
        );
      })}
    </div>
  );

  // Quote selection
  if (!selectedQuote) {
    return (
      <div>
        <div style={{ marginBottom: 24 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: T.text0, margin: 0, letterSpacing: "-0.02em" }}>🔗 Client Portal</h1>
          <p style={{ fontSize: 13, color: T.text2, marginTop: 4 }}>Shareable quote review, e-sign & payment</p>
        </div>

        {quotes.length === 0 ? (
          <div style={{ ...cardStyle, textAlign: "center", padding: "60px 20px" }}>
            <div style={{ fontSize: 40, marginBottom: 12, opacity: 0.3 }}>📋</div>
            <div style={{ fontSize: 15, color: T.text2, marginBottom: 6 }}>No quotes yet</div>
            <div style={{ fontSize: 12, color: T.text3 }}>Generate quotes from the Intake tab first</div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {quotes.map(q => {
              const sigs = getSignatures(q.portalToken);
              return (
                <div key={q.id} className="crm-card-hover" style={{
                  ...cardStyle, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12,
                }}>
                  <div onClick={() => { setSelectedQuote(q); setStep("review"); }} style={{ cursor: "pointer", flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{ fontSize: 15, fontWeight: 600, color: T.text0 }}>{q.clientName}</div>
                      {sigs.length > 0 && (
                        <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 10, background: `${T.green}18`, color: T.green, fontWeight: 700 }}>
                          ✓ SIGNED · {sigs.length} 🔒
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 12, color: T.text3, marginTop: 2 }}>{q.company} · {q.recommendedPackage} plan</div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 18, fontWeight: 800, color: T.accent, fontFamily: "'JetBrains Mono', monospace" }}>{fmt(q.monthlyTotal)}<span style={{ fontSize: 11, fontWeight: 400 }}>/mo</span></div>
                      <div style={{ fontSize: 11, color: T.text3 }}>Valid until {q.validUntil}</div>
                    </div>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          const url = buildPortalUrl(q.portalToken);
                          navigator.clipboard?.writeText(url).then(() => {
                            appendAudit(q.portalToken, { event: "link_copied", at: new Date().toISOString(), detail: "Rep copied portal link from list" });
                          }).catch(() => window.prompt("Portal link:", url));
                        }}
                        style={{ fontSize: 11, padding: "5px 10px", borderRadius: 6, border: `1px solid ${T.bg5}`, background: T.bg3, color: T.text2, cursor: "pointer" }}
                      >
                        🔗 Copy link
                      </button>
                      <a
                        href={`#/portal/${q.portalToken}`}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        style={{ fontSize: 11, padding: "5px 10px", borderRadius: 6, border: `1px solid ${T.bg5}`, background: T.bg3, color: T.text2, cursor: "pointer", textDecoration: "none" }}
                      >
                        ↗ Open
                      </a>
                    </div>
                  </div>
                </div>
              );
            })}

          </div>
        )}

        {quotes.length > 0 && (
          <div style={{ marginTop: 32 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: T.text0, marginBottom: 4 }}>📊 Global Portal Activity</div>
            <div style={{ fontSize: 12, color: T.text3, marginBottom: 12 }}>
              All portal events across every quote. Filter by quote, signer, or event type.
            </div>
            <GlobalAuditViewer
              tokenLabels={Object.fromEntries(quotes.map(q => [q.portalToken, `${q.company} · ${q.recommendedPackage}`]))}
            />
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16, flexWrap: "wrap", gap: 12 }}>
        <div>
          <button onClick={() => { setSelectedQuote(null); setStep("review"); setAddOns(new Set()); setSigned(false); setSignatureName(""); }}
            style={{ background: "none", border: "none", color: T.text3, cursor: "pointer", fontSize: 12, marginBottom: 6 }}>← Back to quotes</button>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: T.text0, margin: 0, letterSpacing: "-0.02em" }}>
            Quote for {selectedQuote.clientName}
          </h1>
          <p style={{ fontSize: 13, color: T.text2, marginTop: 4 }}>{selectedQuote.company} · {selectedQuote.recommendedPackage}</p>
        </div>
      </div>

      {/* Portal audit trail — visible in all steps */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", color: T.text3, fontWeight: 700 }}>
            📋 Portal Audit Trail
          </div>
          {isTokenExpired(selectedQuote.validUntil) ? (
            <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 10, background: `${T.red}18`, color: T.red, fontWeight: 700 }}>
              ⏰ LINK EXPIRED
            </span>
          ) : (
            <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 10, background: `${T.green}18`, color: T.green, fontWeight: 700 }}>
              ● ACTIVE
            </span>
          )}
        </div>
        <AuditTrailViewer token={selectedQuote.portalToken} />
      </div>

      {stepIndicator}

      {/* STEP: REVIEW */}
      {step === "review" && (
        <div className="animate-fade-in">
          <div style={cardStyle}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: T.text0 }}>📄 Proposal Summary</div>
              <div style={{
                fontSize: 11, padding: "4px 10px", borderRadius: T.radius.sm,
                background: `${T.green}18`, color: T.green, fontWeight: 600,
              }}>{selectedQuote.status}</div>
            </div>

            <div style={{ background: `${T.accent}08`, border: `1px solid ${T.accent}22`, borderRadius: T.radius.md, padding: "14px 16px", marginBottom: 16 }}>
              <div style={{ fontSize: 12, color: T.accent, fontWeight: 600, marginBottom: 6 }}>💡 AI Recommendation</div>
              <div style={{ fontSize: 13, color: T.text2, lineHeight: 1.6 }}>{selectedQuote.aiReasoning}</div>
            </div>

            <div style={{ fontSize: 12, fontWeight: 700, color: T.text3, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}>Line Items</div>
            {selectedQuote.lineItems.map(item => (
              <div key={item.id} style={{
                display: "flex", justifyContent: "space-between", alignItems: "center",
                padding: "10px 0", borderBottom: `1px solid ${T.bg4}`,
              }}>
                <span style={{ fontSize: 13, color: T.text1 }}>{item.name}</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: T.accent, fontFamily: "'JetBrains Mono', monospace" }}>
                  {fmt(item.price)}{item.unit && <span style={{ fontSize: 10, fontWeight: 400, color: T.text3 }}>{item.unit}</span>}
                </span>
              </div>
            ))}

            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 16, padding: "12px 0", borderTop: `2px solid ${T.bg5}` }}>
              <div>
                <div style={{ fontSize: 12, color: T.text3 }}>Monthly</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: T.accent, fontFamily: "'JetBrains Mono', monospace" }}>{fmt(selectedQuote.monthlyTotal)}</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 12, color: T.text3 }}>One-time</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: T.purple, fontFamily: "'JetBrains Mono', monospace" }}>{fmt(selectedQuote.onetimeTotal)}</div>
              </div>
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, marginTop: 16, justifyContent: "flex-end" }}>
            <button onClick={() => setStep("customize")} style={S.btn as React.CSSProperties}>Continue to Add-ons →</button>
          </div>
        </div>
      )}

      {/* STEP: CUSTOMIZE */}
      {step === "customize" && pkg && (
        <div className="animate-fade-in">
          <div style={cardStyle}>
            <div style={{ fontSize: 16, fontWeight: 700, color: T.text0, marginBottom: 16 }}>🎛 Optional Add-ons</div>
            {pkg.addOns.length === 0 ? (
              <div style={{ padding: 20, textAlign: "center", color: T.text3, fontSize: 13 }}>No add-ons available for this plan</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {pkg.addOns.map(a => {
                  const selected = addOns.has(a.name);
                  return (
                    <button key={a.id} onClick={() => toggleAddOn(a.name)} style={{
                      display: "flex", justifyContent: "space-between", alignItems: "center",
                      padding: "14px 16px", background: selected ? `${T.accent}12` : T.bg3,
                      border: `1px solid ${selected ? T.accent : T.bg4}`, borderRadius: T.radius.md,
                      cursor: "pointer", textAlign: "left", transition: "all 0.15s",
                    }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <div style={{
                          width: 20, height: 20, borderRadius: 4,
                          border: `2px solid ${selected ? T.accent : T.bg5}`,
                          background: selected ? T.accent : "transparent",
                          display: "flex", alignItems: "center", justifyContent: "center",
                          color: "#080d18", fontSize: 12, fontWeight: 700, transition: "all 0.15s",
                        }}>{selected ? "✓" : ""}</div>
                        <span style={{ fontSize: 13, color: T.text1, fontWeight: 500 }}>{a.name}</span>
                      </div>
                      <span style={{ fontSize: 13, fontWeight: 700, color: T.accent, fontFamily: "'JetBrains Mono', monospace" }}>
                        +{fmt(a.price)}{a.unit && <span style={{ fontSize: 10, fontWeight: 400, color: T.text3 }}>{a.unit}</span>}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

            {addOns.size > 0 && (
              <div style={{ marginTop: 16, padding: "12px 16px", background: `${T.accent}08`, borderRadius: T.radius.md, display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontSize: 13, color: T.text2 }}>New monthly total</span>
                <span style={{ fontSize: 16, fontWeight: 800, color: T.accent, fontFamily: "'JetBrains Mono', monospace" }}>{fmt(grandMonthly)}/mo</span>
              </div>
            )}
          </div>

          <div style={{ display: "flex", gap: 8, marginTop: 16, justifyContent: "space-between" }}>
            <button onClick={() => setStep("review")} style={S.btnGhost as React.CSSProperties}>← Back</button>
            <button onClick={() => setStep("sign")} style={S.btn as React.CSSProperties}>Continue to Sign →</button>
          </div>
        </div>
      )}

      {/* STEP: SIGN */}
      {step === "sign" && (
        <div className="animate-fade-in">
          <div style={cardStyle}>
            <div style={{ fontSize: 16, fontWeight: 700, color: T.text0, marginBottom: 16 }}>✍️ Electronic Signature</div>

            <div style={{ background: T.bg3, borderRadius: T.radius.md, padding: "16px 20px", marginBottom: 16, fontSize: 12, color: T.text2, lineHeight: 1.7 }}>
              By signing below, I <strong style={{ color: T.text0 }}>{selectedQuote.clientName}</strong> of <strong style={{ color: T.text0 }}>{selectedQuote.company}</strong> agree
              to the {selectedQuote.recommendedPackage} plan at <strong style={{ color: T.accent }}>{fmt(grandMonthly)}/mo</strong> plus one-time fees
              of <strong style={{ color: T.purple }}>{fmt(selectedQuote.onetimeTotal)}</strong>. This agreement is valid until {selectedQuote.validUntil}.
            </div>

            {!signed ? (
              <SignaturePad
                defaultName={selectedQuote.clientName}
                consent={`I agree to the ${selectedQuote.recommendedPackage} plan for ${selectedQuote.company} at ${fmt(grandMonthly)}/mo plus ${fmt(selectedQuote.onetimeTotal)} one-time, valid until ${selectedQuote.validUntil}.`}
                onSign={handleSign}
              />
            ) : (
              <div>
                <div className="animate-scale-in" style={{
                  display: "flex", alignItems: "center", gap: 10, padding: "16px 20px",
                  background: `${T.green}12`, border: `1px solid ${T.green}33`, borderRadius: T.radius.md, marginBottom: 14,
                }}>
                  <span style={{ fontSize: 20 }}>✅</span>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: T.green }}>Signed successfully</div>
                    <div style={{ fontSize: 12, color: T.text3 }}>
                      {savedSig ? `${new Date(savedSig.signedAt).toLocaleString()} · ${savedSig.method} signature` : "Redirecting to payment…"}
                    </div>
                  </div>
                </div>
                {savedSig && (
                  <div style={{ background: T.bg3, borderRadius: T.radius.md, padding: 14 }}>
                    {savedSig.method === "drawn" ? (
                      <img src={savedSig.value} alt={`Signature of ${savedSig.signerName}`} style={{ maxWidth: "100%", maxHeight: 100, background: "#fff", borderRadius: 6 }} />
                    ) : (
                      <div style={{ fontFamily: "'Caveat', cursive", fontSize: 32, color: T.accent }}>{savedSig.value}</div>
                    )}
                    <div style={{ marginTop: 8, fontSize: 12, color: T.text2 }}>
                      <strong style={{ color: T.text0 }}>{savedSig.signerName}</strong>
                      {savedSig.signerEmail ? <span> · {savedSig.signerEmail}</span> : null}
                    </div>
                  </div>
                )}
              </div>
            )}

          </div>

          {!signed && (
            <div style={{ marginTop: 16 }}>
              <button onClick={() => setStep("customize")} style={S.btnGhost as React.CSSProperties}>← Back</button>
            </div>
          )}
        </div>
      )}

      {/* STEP: PAY */}
      {step === "pay" && (
        <div className="animate-fade-in">
          <div style={cardStyle}>
            <div style={{ fontSize: 16, fontWeight: 700, color: T.text0, marginBottom: 16 }}>💳 Payment</div>

            <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
              {(["card", "invoice"] as const).map(m => (
                <button key={m} onClick={() => setPayMethod(m)} style={{
                  flex: 1, padding: "14px 16px", background: payMethod === m ? `${T.accent}12` : T.bg3,
                  border: `1px solid ${payMethod === m ? T.accent : T.bg4}`, borderRadius: T.radius.md,
                  cursor: "pointer", textAlign: "center", transition: "all 0.15s",
                }}>
                  <div style={{ fontSize: 18, marginBottom: 4 }}>{m === "card" ? "💳" : "📄"}</div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: payMethod === m ? T.accent : T.text2 }}>
                    {m === "card" ? "Credit Card" : "Invoice"}
                  </div>
                </button>
              ))}
            </div>

            {payMethod === "card" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 16 }}>
                <div>
                  <label style={S.label as React.CSSProperties}>Card Number</label>
                  <input placeholder="4242 4242 4242 4242" style={S.input as React.CSSProperties} />
                </div>
                <div style={{ display: "flex", gap: 12 }}>
                  <div style={{ flex: 1 }}>
                    <label style={S.label as React.CSSProperties}>Expiry</label>
                    <input placeholder="MM/YY" style={S.input as React.CSSProperties} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={S.label as React.CSSProperties}>CVC</label>
                    <input placeholder="123" style={S.input as React.CSSProperties} />
                  </div>
                </div>
              </div>
            )}

            {payMethod === "invoice" && (
              <div style={{ padding: "16px 20px", background: `${T.blue}08`, borderRadius: T.radius.md, marginBottom: 16 }}>
                <div style={{ fontSize: 13, color: T.text2, lineHeight: 1.6 }}>
                  An invoice for <strong style={{ color: T.accent }}>{fmt(selectedQuote.onetimeTotal + grandMonthly)}</strong> will be sent to <strong style={{ color: T.blue }}>{selectedQuote.clientName}</strong> at their registered email. Payment is due within 30 days.
                </div>
              </div>
            )}

            <div style={{ padding: "14px 16px", background: T.bg3, borderRadius: T.radius.md, marginBottom: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                <span style={{ fontSize: 12, color: T.text3 }}>First month</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: T.text1, fontFamily: "'JetBrains Mono', monospace" }}>{fmt(grandMonthly)}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                <span style={{ fontSize: 12, color: T.text3 }}>One-time setup</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: T.text1, fontFamily: "'JetBrains Mono', monospace" }}>{fmt(selectedQuote.onetimeTotal)}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", paddingTop: 8, borderTop: `1px solid ${T.bg4}` }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: T.text0 }}>Total due today</span>
                <span style={{ fontSize: 16, fontWeight: 800, color: T.accent, fontFamily: "'JetBrains Mono', monospace" }}>{fmt(grandMonthly + selectedQuote.onetimeTotal)}</span>
              </div>
            </div>

            <button onClick={handlePay} disabled={processing} style={{
              ...S.btn as React.CSSProperties, width: "100%", padding: "14px 20px", fontSize: 15,
              opacity: processing ? 0.7 : 1, cursor: processing ? "not-allowed" : "pointer",
            }}>
              {processing ? "⟳ Processing…" : `Pay ${fmt(grandMonthly + selectedQuote.onetimeTotal)}`}
            </button>
          </div>

          {!processing && (
            <div style={{ marginTop: 16 }}>
              <button onClick={() => setStep("sign")} style={S.btnGhost as React.CSSProperties}>← Back</button>
            </div>
          )}
        </div>
      )}

      {/* STEP: CONFIRMED */}
      {step === "confirmed" && (
        <div className="animate-scale-in" style={{ ...cardStyle, textAlign: "center", padding: "48px 24px" }}>
          <div style={{ fontSize: 56, marginBottom: 16 }}>🎉</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: T.text0, marginBottom: 8 }}>Welcome aboard!</div>
          <div style={{ fontSize: 14, color: T.text2, marginBottom: 24, maxWidth: 400, margin: "0 auto 24px" }}>
            Payment confirmed for {selectedQuote.company}. Your {selectedQuote.recommendedPackage} plan is now active.
          </div>
          <div style={{ display: "inline-flex", flexDirection: "column", gap: 8, padding: "16px 24px", background: T.bg3, borderRadius: T.radius.md }}>
            <div style={{ fontSize: 12, color: T.text3 }}>Receipt</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: T.accent, fontFamily: "'JetBrains Mono', monospace" }}>{fmt(grandMonthly + selectedQuote.onetimeTotal)}</div>
            <div style={{ fontSize: 11, color: T.text3 }}>Ref: INV-{Date.now().toString(36).toUpperCase()}</div>
          </div>
          <div style={{ marginTop: 24 }}>
            <button onClick={() => { setSelectedQuote(null); setStep("review"); setAddOns(new Set()); setSigned(false); setSignatureName(""); }}
              style={S.btnGhost as React.CSSProperties}>← Back to quotes</button>
          </div>
        </div>
      )}
    </div>
  );
}
