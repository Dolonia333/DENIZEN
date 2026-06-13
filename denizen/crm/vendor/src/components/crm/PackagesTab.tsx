import { useState, useMemo } from "react";
import { T, S, fmt, initialBranding, type Package, type Quote, type Contact } from "@/lib/crm-data";
import { sendCrmEmail } from "@/lib/crm-api";
import { proposalPdfBase64 } from "@/lib/proposal-pdf";

interface Props {
  packages: Package[];
  quotes: Quote[];
  contacts: Contact[];
  onUpdatePackages: (pkgs: Package[] | ((prev: Package[]) => Package[])) => void;
  onAddQuote: (quote: Quote) => void;
}

const PRESET_COLORS = ["#6366f1", "#f0b429", "#10b981", "#ef4444", "#8b5cf6", "#3b82f6", "#f97316", "#ec4899", "#14b8a6", "#f43f5e"];
const EMOJI_PICKS = ["🚀", "⚡", "🏢", "💎", "🌟", "🔥", "🎯", "💡", "🛡️", "🧩", "📊", "🤖"];

const empty = (): Package => ({
  id: Date.now(), name: "", tier: "custom", tagline: "", color: "#6366f1", icon: "🚀",
  lineItems: [{ id: 1, name: "", price: 0, unit: "/mo", included: true }],
  features: [""], addOns: [], bestFor: [""],
  setupFee: 0, minContract: "monthly",
});

export function PackagesTab({ packages, quotes, contacts, onUpdatePackages, onAddQuote }: Props) {
  const [editing, setEditing] = useState<Package | null>(null);
  const [sendModal, setSendModal] = useState<Package | null>(null);
  const [sendClient, setSendClient] = useState("");
  const [sendEmail, setSendEmail] = useState("");
  const [sendMessage, setSendMessage] = useState("");

  const openEditor = (pkg: Package) => setEditing({ ...pkg, lineItems: pkg.lineItems.map(l => ({ ...l })), features: [...pkg.features], bestFor: [...pkg.bestFor], addOns: pkg.addOns.map(a => ({ ...a })) });
  const openNew = () => openEditor(empty());

  const save = () => {
    if (!editing || !editing.name) return;
    const exists = packages.find(p => p.id === editing.id);
    if (exists) {
      onUpdatePackages(prev => prev.map(p => p.id === editing.id ? editing : p));
    } else {
      onUpdatePackages(prev => [...prev, editing]);
    }
    setEditing(null);
  };

  const duplicate = (pkg: Package) => {
    const dupe = { ...pkg, id: Date.now(), name: `${pkg.name} (Copy)`, lineItems: pkg.lineItems.map(l => ({ ...l, id: Date.now() + l.id })), features: [...pkg.features], bestFor: [...pkg.bestFor], addOns: pkg.addOns.map(a => ({ ...a, id: Date.now() + a.id })) };
    onUpdatePackages(prev => [...prev, dupe]);
  };

  const remove = (id: number) => onUpdatePackages(prev => prev.filter(p => p.id !== id));

  const handleSend = async () => {
    if (!sendModal || !sendClient) return;
    const pkg = sendModal;
    const items = pkg.lineItems.filter(l => l.included).map((l, i) => ({ id: i + 1, name: l.name, price: l.price, unit: l.unit }));
    if (pkg.setupFee) items.push({ id: items.length + 1, name: "Setup Fee", price: pkg.setupFee, unit: "one-time" });
    const monthlyTotal = items.filter(i => i.unit === "/mo").reduce((s, i) => s + i.price, 0);
    const onetimeTotal = items.filter(i => i.unit !== "/mo").reduce((s, i) => s + i.price, 0);
    const newQuote: Quote = {
      id: Date.now(), submissionId: 0, clientName: sendClient, company: "",
      createdAt: new Date().toISOString().split("T")[0], status: "quoted",
      recommendedPackage: pkg.name, aiReasoning: "",
      lineItems: items, monthlyTotal, onetimeTotal,
      notes: sendMessage, validUntil: new Date(Date.now() + 30 * 86400000).toISOString().split("T")[0],
      portalToken: `tok_${Date.now()}`, portalViewedAt: null, portalSignedAt: null,
      portalPaidAt: null, signature: null, portalActivity: [],
    };
    onAddQuote(newQuote);
    const contact = contacts.find((c) => c.name === sendClient);
    if (sendEmail.trim()) {
      const body = sendMessage.trim() || `Hi ${sendClient},\n\nI've put together the ${pkg.name} package for you (${fmt(monthlyTotal)}/mo).\n\nPlease see the attached proposal PDF for full details.\n\nLet me know if you'd like to walk through it.\n\n— Team`;
      let attachments: { filename: string; content: string }[] | undefined;
      try {
        const pdf = await proposalPdfBase64(newQuote, {
          companyName: initialBranding.companyName,
          tagline: initialBranding.tagline,
          accentColor: pkg.color || initialBranding.accentColor,
          logoEmoji: pkg.icon || initialBranding.logoEmoji,
        });
        attachments = [{ filename: pdf.filename, content: pdf.base64 }];
      } catch {
        /* PDF generation failed — still send email without attachment */
      }
      await sendCrmEmail({
        contactId: contact?.id,
        toEmail: sendEmail.trim(),
        subject: `Your ${pkg.name} package`,
        body,
        attachments,
      });
    }
    setSendModal(null); setSendClient(""); setSendEmail(""); setSendMessage("");
  };

  // Analytics
  const analytics = useMemo(() => {
    const pkgQuoteCounts: Record<string, { total: number; won: number; totalValue: number }> = {};
    quotes.forEach(q => {
      if (!pkgQuoteCounts[q.recommendedPackage]) pkgQuoteCounts[q.recommendedPackage] = { total: 0, won: 0, totalValue: 0 };
      pkgQuoteCounts[q.recommendedPackage].total++;
      pkgQuoteCounts[q.recommendedPackage].totalValue += q.monthlyTotal;
      if (q.status === "won") pkgQuoteCounts[q.recommendedPackage].won++;
    });
    const mostQuoted = Object.entries(pkgQuoteCounts).sort((a, b) => b[1].total - a[1].total)[0];
    return { pkgQuoteCounts, mostQuoted };
  }, [quotes]);

  const monthlyOf = (pkg: Package) => pkg.lineItems.filter(l => l.included && l.unit === "/mo").reduce((s, l) => s + l.price, 0);
  const onetimeOf = (pkg: Package) => pkg.lineItems.filter(l => l.included && (l.unit === "one-time")).reduce((s, l) => s + l.price, 0) + (pkg.setupFee || 0);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: T.text0, margin: 0, letterSpacing: "-0.02em" }}>Packages</h1>
          <p style={{ fontSize: 13, color: T.text2, marginTop: 4 }}>{packages.length} packages · Build, edit & send to clients</p>
        </div>
        <button onClick={openNew} style={{ ...S.btn, fontSize: 12, padding: "8px 16px" }}>+ New Package</button>
      </div>

      {/* Package grid */}
      <div className="crm-packages-grid" style={{ display: "grid", gap: 16 }}>
        {packages.map(pkg => {
          const mo = monthlyOf(pkg);
          const ot = onetimeOf(pkg);
          const stats = analytics.pkgQuoteCounts[pkg.name];
          return (
            <div key={pkg.id} style={{
              background: `linear-gradient(145deg,${T.bg2},${T.bg3}88)`,
              border: `1px solid ${T.bg4}`, borderRadius: T.radius.lg,
              padding: "24px", position: "relative", overflow: "hidden",
              borderTop: `3px solid ${pkg.color}`,
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                <div style={{ fontSize: 28 }}>{pkg.icon}</div>
                {stats && (
                  <div style={{ fontSize: 10, color: T.text3, textAlign: "right" }}>
                    {stats.total} quoted · {stats.won} won
                  </div>
                )}
              </div>
              <div style={{ fontSize: 18, fontWeight: 700, color: T.text0, marginBottom: 4 }}>{pkg.name}</div>
              <div style={{ fontSize: 12, color: T.text2, marginBottom: 16 }}>{pkg.tagline}</div>

              <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 4 }}>
                <span style={{ fontSize: 28, fontWeight: 800, color: pkg.color, fontFamily: "'JetBrains Mono', monospace" }}>{fmt(mo)}</span>
                <span style={{ fontSize: 12, color: T.text3 }}>/mo</span>
              </div>
              {ot > 0 && <div style={{ fontSize: 11, color: T.text3, marginBottom: 8 }}>+ {fmt(ot)} one-time</div>}
              {pkg.minContract && pkg.minContract !== "monthly" && (
                <div style={{ fontSize: 10, color: T.text3, marginBottom: 12 }}>Min: {pkg.minContract}</div>
              )}

              <div style={{ fontSize: 10, color: T.text3, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>Features</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 12 }}>
                {pkg.features.filter(f => f).slice(0, 5).map((f, i) => (
                  <div key={i} style={{ fontSize: 12, color: T.text1, display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ color: pkg.color }}>✓</span> {f}
                  </div>
                ))}
                {pkg.features.filter(f => f).length > 5 && (
                  <div style={{ fontSize: 11, color: T.text3 }}>+{pkg.features.filter(f => f).length - 5} more</div>
                )}
              </div>

              <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 16 }}>
                {pkg.bestFor.filter(b => b).map((b, i) => (
                  <span key={i} style={{ fontSize: 10, padding: "2px 8px", borderRadius: T.radius.sm, background: `${pkg.color}18`, color: pkg.color }}>{b}</span>
                ))}
              </div>

              {pkg.addOns.length > 0 && (
                <div style={{ paddingTop: 10, borderTop: `1px solid ${T.bg4}`, marginBottom: 12 }}>
                  <div style={{ fontSize: 10, color: T.text3, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Add-ons</div>
                  {pkg.addOns.map(a => (
                    <div key={a.id} style={{ fontSize: 11, color: T.text2, display: "flex", justifyContent: "space-between", padding: "2px 0" }}>
                      <span>{a.name}</span>
                      <span style={{ fontFamily: "'JetBrains Mono', monospace", color: T.text1 }}>{fmt(a.price)}{a.unit}</span>
                    </div>
                  ))}
                </div>
              )}

              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <button onClick={() => openEditor(pkg)} style={{ ...S.btnGhost, fontSize: 11, padding: "5px 12px" }}>✏ Edit</button>
                <button onClick={() => duplicate(pkg)} style={{ ...S.btnGhost, fontSize: 11, padding: "5px 12px" }}>📋 Duplicate</button>
                <button onClick={() => remove(pkg.id)} style={{ ...S.btnGhost, fontSize: 11, padding: "5px 12px", color: T.red, borderColor: `${T.red}33` }}>🗑 Delete</button>
                <button onClick={() => setSendModal(pkg)} style={{ ...S.btn, fontSize: 11, padding: "5px 12px" }}>📩 Send to Client</button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Analytics section */}
      {quotes.length > 0 && (
        <div style={{ marginTop: 24, ...S.card }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: T.text0, marginBottom: 16 }}>📊 Package Analytics</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 14 }}>
            {analytics.mostQuoted && (
              <div style={{ background: T.bg3, borderRadius: T.radius.md, padding: "14px 16px" }}>
                <div style={{ fontSize: 10, color: T.text3, textTransform: "uppercase", fontWeight: 600, marginBottom: 6 }}>Most Quoted</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: T.accent }}>{analytics.mostQuoted[0]}</div>
                <div style={{ fontSize: 11, color: T.text3 }}>{analytics.mostQuoted[1].total} times</div>
              </div>
            )}
            {Object.entries(analytics.pkgQuoteCounts).map(([name, data]) => (
              <div key={name} style={{ background: T.bg3, borderRadius: T.radius.md, padding: "14px 16px" }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: T.text1, marginBottom: 6 }}>{name}</div>
                <div style={{ display: "flex", gap: 16, fontSize: 11 }}>
                  <span style={{ color: T.text2 }}>Avg: <strong style={{ color: T.accent }}>{fmt(data.total > 0 ? Math.round(data.totalValue / data.total) : 0)}/mo</strong></span>
                  <span style={{ color: T.text2 }}>Win: <strong style={{ color: data.total > 0 ? T.green : T.text3 }}>{data.total > 0 ? Math.round((data.won / data.total) * 100) : 0}%</strong></span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── EDITOR PANEL ── */}
      {editing && (
        <div style={S.modalBg} onClick={() => setEditing(null)}>
          <div style={{ ...S.modalBox, width: 900, maxWidth: "96vw", display: "grid", gridTemplateColumns: "1fr 340px", gap: 24 }} onClick={e => e.stopPropagation()}>
            {/* Editor */}
            <div style={{ maxHeight: "80vh", overflowY: "auto", paddingRight: 12 }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: T.text0, marginBottom: 20 }}>
                {packages.find(p => p.id === editing.id) ? "Edit Package" : "New Package"}
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
                <div>
                  <div style={{ ...S.label }}>Name *</div>
                  <input value={editing.name} onChange={e => setEditing(p => p && { ...p, name: e.target.value })} style={{ ...S.input }} placeholder="Growth Package" />
                </div>
                <div>
                  <div style={{ ...S.label }}>Tagline</div>
                  <input value={editing.tagline} onChange={e => setEditing(p => p && { ...p, tagline: e.target.value })} style={{ ...S.input }} placeholder="Perfect for growing teams" />
                </div>
              </div>

              {/* Color + Icon */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
                <div>
                  <div style={{ ...S.label }}>Colour</div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {PRESET_COLORS.map(c => (
                      <button key={c} onClick={() => setEditing(p => p && { ...p, color: c })} style={{
                        width: 24, height: 24, borderRadius: 6, background: c, border: editing.color === c ? "2px solid #fff" : "2px solid transparent",
                        cursor: "pointer",
                      }} />
                    ))}
                    <input type="color" value={editing.color} onChange={e => setEditing(p => p && { ...p, color: e.target.value })}
                      style={{ width: 24, height: 24, border: "none", padding: 0, cursor: "pointer", borderRadius: 4 }} />
                  </div>
                </div>
                <div>
                  <div style={{ ...S.label }}>Icon</div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {EMOJI_PICKS.map(e => (
                      <button key={e} onClick={() => setEditing(p => p && { ...p, icon: e })} style={{
                        width: 28, height: 28, borderRadius: 6, fontSize: 16, background: editing.icon === e ? `${T.accent}22` : T.bg4,
                        border: editing.icon === e ? `1px solid ${T.accent}` : `1px solid transparent`, cursor: "pointer",
                        display: "flex", alignItems: "center", justifyContent: "center",
                      }}>{e}</button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Contract + Setup */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
                <div>
                  <div style={{ ...S.label }}>Setup Fee ($)</div>
                  <input type="number" value={editing.setupFee || ""} onChange={e => setEditing(p => p && { ...p, setupFee: Number(e.target.value) || 0 })} style={{ ...S.input }} placeholder="0" />
                </div>
                <div>
                  <div style={{ ...S.label }}>Min Contract</div>
                  <select value={editing.minContract || "monthly"} onChange={e => setEditing(p => p && { ...p, minContract: e.target.value })} style={{ ...S.input }}>
                    <option value="monthly">Monthly</option>
                    <option value="quarterly">Quarterly</option>
                    <option value="annual">Annual</option>
                  </select>
                </div>
              </div>

              {/* Line Items */}
              <div style={{ marginBottom: 16 }}>
                <div style={{ ...S.label }}>Line Items</div>
                {editing.lineItems.map((item, idx) => (
                  <div key={item.id} style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 6 }}>
                    <input value={item.name} placeholder="Service name" onChange={e => setEditing(p => {
                      if (!p) return p;
                      const items = [...p.lineItems]; items[idx] = { ...items[idx], name: e.target.value }; return { ...p, lineItems: items };
                    })} style={{ ...S.input, flex: 2 }} />
                    <input type="number" value={item.price || ""} placeholder="$" onChange={e => setEditing(p => {
                      if (!p) return p;
                      const items = [...p.lineItems]; items[idx] = { ...items[idx], price: Number(e.target.value) || 0 }; return { ...p, lineItems: items };
                    })} style={{ ...S.input, flex: 0.6, textAlign: "right" }} />
                    <select value={item.unit} onChange={e => setEditing(p => {
                      if (!p) return p;
                      const items = [...p.lineItems]; items[idx] = { ...items[idx], unit: e.target.value }; return { ...p, lineItems: items };
                    })} style={{ ...S.input, flex: 0.5 }}>
                      <option value="/mo">/mo</option>
                      <option value="one-time">one-time</option>
                      <option value="included">included</option>
                    </select>
                    <button onClick={() => setEditing(p => {
                      if (!p) return p;
                      const items = [...p.lineItems]; items[idx] = { ...items[idx], included: !items[idx].included }; return { ...p, lineItems: items };
                    })} style={{
                      width: 28, height: 28, borderRadius: 6, border: `1px solid ${item.included ? T.green + "66" : T.bg4}`,
                      background: item.included ? `${T.green}22` : T.bg4, color: item.included ? T.green : T.text3,
                      cursor: "pointer", fontSize: 10, display: "flex", alignItems: "center", justifyContent: "center",
                    }} title={item.included ? "Included" : "Add-on"}>
                      {item.included ? "✓" : "○"}
                    </button>
                    <button onClick={() => setEditing(p => p && { ...p, lineItems: p.lineItems.filter((_, i) => i !== idx) })}
                      style={{ background: "none", border: "none", color: T.red, fontSize: 14, cursor: "pointer" }}>✕</button>
                  </div>
                ))}
                <button onClick={() => setEditing(p => p && { ...p, lineItems: [...p.lineItems, { id: Date.now(), name: "", price: 0, unit: "/mo", included: true }] })}
                  style={{ ...S.btnGhost, fontSize: 11, padding: "4px 10px", marginTop: 4 }}>+ Add Item</button>
              </div>

              {/* Features */}
              <div style={{ marginBottom: 16 }}>
                <div style={{ ...S.label }}>Features</div>
                {editing.features.map((f, idx) => (
                  <div key={idx} style={{ display: "flex", gap: 6, marginBottom: 4 }}>
                    <input value={f} placeholder="e.g. Up to 25 users" onChange={e => setEditing(p => {
                      if (!p) return p;
                      const feats = [...p.features]; feats[idx] = e.target.value; return { ...p, features: feats };
                    })} style={{ ...S.input, flex: 1 }} />
                    <button onClick={() => setEditing(p => p && { ...p, features: p.features.filter((_, i) => i !== idx) })}
                      style={{ background: "none", border: "none", color: T.red, fontSize: 14, cursor: "pointer" }}>✕</button>
                  </div>
                ))}
                <button onClick={() => setEditing(p => p && { ...p, features: [...p.features, ""] })}
                  style={{ ...S.btnGhost, fontSize: 11, padding: "4px 10px" }}>+ Add Feature</button>
              </div>

              {/* Best For */}
              <div style={{ marginBottom: 16 }}>
                <div style={{ ...S.label }}>Best For Tags</div>
                {editing.bestFor.map((b, idx) => (
                  <div key={idx} style={{ display: "flex", gap: 6, marginBottom: 4 }}>
                    <input value={b} placeholder="e.g. 11-50 employees" onChange={e => setEditing(p => {
                      if (!p) return p;
                      const bf = [...p.bestFor]; bf[idx] = e.target.value; return { ...p, bestFor: bf };
                    })} style={{ ...S.input, flex: 1 }} />
                    <button onClick={() => setEditing(p => p && { ...p, bestFor: p.bestFor.filter((_, i) => i !== idx) })}
                      style={{ background: "none", border: "none", color: T.red, fontSize: 14, cursor: "pointer" }}>✕</button>
                  </div>
                ))}
                <button onClick={() => setEditing(p => p && { ...p, bestFor: [...p.bestFor, ""] })}
                  style={{ ...S.btnGhost, fontSize: 11, padding: "4px 10px" }}>+ Add Tag</button>
              </div>

              <div style={{ display: "flex", gap: 10 }}>
                <button onClick={save} disabled={!editing.name} style={{ ...S.btn, fontSize: 12, opacity: editing.name ? 1 : 0.5 }}>Save Package</button>
                <button onClick={() => setEditing(null)} style={{ ...S.btnGhost, fontSize: 12 }}>Cancel</button>
              </div>
            </div>

            {/* Live Preview */}
            <div style={{ background: T.bg1, borderRadius: T.radius.lg, padding: 20, border: `1px solid ${T.bg4}`, position: "sticky", top: 0, alignSelf: "start" }}>
              <div style={{ fontSize: 10, color: T.text3, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 12 }}>Preview</div>
              <div style={{ borderTop: `3px solid ${editing.color}`, borderRadius: T.radius.md, background: T.bg2, padding: 16, border: `1px solid ${T.bg4}` }}>
                <div style={{ fontSize: 24, marginBottom: 6 }}>{editing.icon}</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: T.text0, marginBottom: 2 }}>{editing.name || "Package Name"}</div>
                <div style={{ fontSize: 11, color: T.text2, marginBottom: 12 }}>{editing.tagline || "Tagline goes here"}</div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 4, marginBottom: 4 }}>
                  <span style={{ fontSize: 22, fontWeight: 800, color: editing.color, fontFamily: "'JetBrains Mono', monospace" }}>
                    {fmt(editing.lineItems.filter(l => l.included && l.unit === "/mo").reduce((s, l) => s + l.price, 0))}
                  </span>
                  <span style={{ fontSize: 11, color: T.text3 }}>/mo</span>
                </div>
                {(editing.setupFee || 0) > 0 && <div style={{ fontSize: 10, color: T.text3, marginBottom: 6 }}>+ {fmt(editing.setupFee || 0)} setup</div>}
                <div style={{ display: "flex", flexDirection: "column", gap: 3, marginTop: 8 }}>
                  {editing.features.filter(f => f).map((f, i) => (
                    <div key={i} style={{ fontSize: 11, color: T.text1, display: "flex", alignItems: "center", gap: 4 }}>
                      <span style={{ color: editing.color, fontSize: 10 }}>✓</span> {f}
                    </div>
                  ))}
                </div>
                {editing.bestFor.filter(b => b).length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 3, marginTop: 10 }}>
                    {editing.bestFor.filter(b => b).map((b, i) => (
                      <span key={i} style={{ fontSize: 9, padding: "2px 6px", borderRadius: 4, background: `${editing.color}18`, color: editing.color }}>{b}</span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── SEND TO CLIENT MODAL ── */}
      {sendModal && (
        <div style={S.modalBg} onClick={() => setSendModal(null)}>
          <div style={{ ...S.modalBox, width: 520 }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 16, fontWeight: 700, color: T.text0, marginBottom: 20 }}>📩 Send "{sendModal.name}" to Client</div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
              <div>
                <div style={{ ...S.label }}>Client Name *</div>
                <select value={sendClient} onChange={e => {
                  setSendClient(e.target.value);
                  const c = contacts.find(ct => ct.name === e.target.value);
                  if (c) setSendEmail(c.email);
                }} style={{ ...S.input }}>
                  <option value="">— Select or type —</option>
                  {contacts.map(c => <option key={c.id} value={c.name}>{c.name} ({c.company})</option>)}
                </select>
              </div>
              <div>
                <div style={{ ...S.label }}>Email</div>
                <input value={sendEmail} onChange={e => setSendEmail(e.target.value)} placeholder="client@company.com" style={{ ...S.input }} />
              </div>
            </div>

            <div style={{ ...S.label }}>Personal Message (optional)</div>
            <textarea value={sendMessage} onChange={e => setSendMessage(e.target.value)} placeholder="Hi, I've put together a package for you..."
              style={{ ...S.input, minHeight: 60, resize: "vertical", marginBottom: 16 }} />

            {/* Preview */}
            <div style={{ background: T.bg3, borderRadius: T.radius.md, padding: 14, border: `1px solid ${T.bg4}`, marginBottom: 16, borderLeft: `3px solid ${sendModal.color}` }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <span style={{ fontSize: 18 }}>{sendModal.icon}</span>
                <span style={{ fontSize: 14, fontWeight: 700, color: T.text0 }}>{sendModal.name}</span>
              </div>
              <div style={{ fontSize: 13, fontWeight: 700, color: sendModal.color, fontFamily: "'JetBrains Mono', monospace" }}>
                {fmt(monthlyOf(sendModal))}/mo
                {onetimeOf(sendModal) > 0 && <span style={{ color: T.text3, fontWeight: 400, marginLeft: 8 }}>+ {fmt(onetimeOf(sendModal))} one-time</span>}
              </div>
            </div>

            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button onClick={() => setSendModal(null)} style={{ ...S.btnGhost, fontSize: 12 }}>Cancel</button>
              <button onClick={handleSend} disabled={!sendClient} style={{ ...S.btn, fontSize: 12, opacity: sendClient ? 1 : 0.5 }}>
                Send & Create Quote
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
