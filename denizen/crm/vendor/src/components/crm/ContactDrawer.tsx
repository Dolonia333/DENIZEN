import { useState } from "react";
import { T, fmt, badgeStyle, CONTACT_FREQUENCIES, type Contact, type Deal, type Note, type Task, type EmailLogEntry, type Meeting, type AuditEntry } from "@/lib/crm-data";
import { ContactTimeline } from "./ContactTimeline";
import { shareToGlobalChat } from "@/components/GlobalTeamChat";
import type { IndustryConfig } from "@/lib/industry-config";

interface Props {
  contact: Contact;
  deals: Deal[];
  notes: Note[];
  tasks: Task[];
  emailLog: EmailLogEntry[];
  meetings: Meeting[];
  auditLog: AuditEntry[];
  onClose: () => void;
  onEdit: () => void;
  onSendEmail?: (contactId: number) => void;
  industryConfig?: IndustryConfig;
}

export function ContactDrawer({ contact, deals, notes, tasks, emailLog, meetings, auditLog, onClose, onEdit, onSendEmail, industryConfig }: Props) {
  const [dt, setDt] = useState<"overview" | "timeline" | "deals" | "scoring">("overview");
  const cDeals = deals.filter(d => d.contact === contact.name);
  const cNotes = notes.filter(n => n.contact === contact.name);
  const cTasks = tasks.filter(t => t.contact === contact.name);
  const cEmails = emailLog.filter(e => e.contactId === contact.id || e.to === contact.name);

  const scoreColor = contact.score >= 80 ? T.green : contact.score >= 50 ? T.accent : "#6366f1";

  // Score breakdown factors
  const scoreFactors = (() => {
    const factors: { label: string; impact: number; emoji: string }[] = [];
    
    // Status
    if (contact.status === "Customer") factors.push({ label: "Customer status", impact: 30, emoji: "⭐" });
    else if (contact.status === "Prospect") factors.push({ label: "Prospect status", impact: 15, emoji: "🎯" });
    else factors.push({ label: "Lead status (baseline)", impact: 0, emoji: "📋" });

    // Email engagement
    const opens = cEmails.reduce((s, e) => s + (e.opens?.length || 0), 0);
    if (opens > 0) factors.push({ label: `${opens} email opens`, impact: Math.min(opens * 5, 20), emoji: "📧" });
    else if (cEmails.length > 0) factors.push({ label: "Emails sent, no opens", impact: 0, emoji: "📧" });

    // Deals
    const openDeals = cDeals.filter(d => d.stage !== "Closed Lost");
    if (openDeals.length > 0) factors.push({ label: `${openDeals.length} active deal(s)`, impact: 15, emoji: "💼" });
    if (openDeals.some(d => ["Proposal", "Negotiation"].includes(d.stage))) {
      factors.push({ label: "Deal in late stage", impact: 10, emoji: "🔥" });
    }

    // Recency
    const days = Math.floor((Date.now() - new Date(contact.lastContact).getTime()) / 86400000);
    if (days < 7) factors.push({ label: `Contacted ${days}d ago`, impact: 10, emoji: "✅" });
    else if (days > 60) factors.push({ label: `No contact in ${days}d`, impact: -15, emoji: "⚠️" });
    else factors.push({ label: `Last contact ${days}d ago`, impact: 0, emoji: "📅" });

    // Notes
    const noteCount = cNotes.length;
    if (noteCount > 0) factors.push({ label: `${noteCount} notes logged`, impact: Math.min(noteCount * 2, 10), emoji: "📝" });

    // Tags
    if (contact.tags?.includes("Enterprise") || contact.tags?.includes("High Value")) {
      factors.push({ label: "Enterprise/High Value tag", impact: 10, emoji: "🏢" });
    }
    if (contact.tags?.includes("Cold")) {
      factors.push({ label: "Cold tag", impact: -5, emoji: "❄️" });
    }

    return factors.sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact));
  })();

  return (
    <div onClick={onClose} className="animate-fade-in" style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 900, backdropFilter: "blur(2px)" }}>
      <div onClick={e => e.stopPropagation()} className="animate-slide-in-right crm-drawer" style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: 420, maxWidth: "100vw", background: T.bg1, borderLeft: `1px solid ${T.bg4}`, display: "flex", flexDirection: "column" }}>
        {/* Header */}
        <div style={{ padding: "20px 20px 0" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <button aria-label="Close" onClick={onClose} style={{ background: "none", border: "none", color: T.text2, fontSize: 14, cursor: "pointer" }}>← Back</button>
            <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
              <button aria-label="Action" onClick={() => shareToGlobalChat({
                title: contact.name, type: "lead", color: scoreColor,
                snapshot: { "Company": contact.company, "Email": contact.email, "Status": contact.status, "Score": `${contact.score}`, "Last Contact": contact.lastContact },
                status: contact.status === "Customer" ? "Resolved" : "In Progress",
              })} style={{ background: `${T.purple}15`, border: `1px solid ${T.purple}33`, borderRadius: T.radius.sm, padding: "4px 10px", color: T.purple, fontSize: 14, cursor: "pointer", fontWeight: 600 }}>💬 Share</button>
              {onSendEmail && contact.email && (
                <button aria-label="Action" onClick={() => onSendEmail(contact.id)} style={{ background: `${T.blue}15`, border: `1px solid ${T.blue}33`, borderRadius: T.radius.sm, padding: "4px 10px", color: T.blue, fontSize: 14, cursor: "pointer", fontWeight: 600 }}>✉ Email</button>
              )}
              <button aria-label="Edit" onClick={onEdit} style={{ background: T.bg3, border: `1px solid ${T.bg4}`, borderRadius: T.radius.sm, padding: "4px 10px", color: T.text2, fontSize: 14, cursor: "pointer" }}>✎ Edit</button>
              <span style={badgeStyle(contact.score >= 80 ? "#6ee7b7" : "#fcd34d", contact.score >= 80 ? "#064e3b" : "#451a03")}>Score {contact.score}</span>
              <span style={badgeStyle(T.text1, T.bg4)}>{contact.status}</span>
            </div>
          </div>

          <div style={{ display: "flex", gap: 14, alignItems: "center", marginBottom: 16 }}>
            <div style={{ width: 48, height: 48, borderRadius: T.radius.lg, background: contact.avatar ? "none" : `linear-gradient(135deg,${scoreColor},${T.bg4})`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, fontWeight: 800, color: "#fff", flexShrink: 0, overflow: "hidden" }}>{contact.avatar ? <img src={contact.avatar} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : contact.name[0]}</div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: T.text0 }}>{contact.name}</div>
              <div style={{ fontSize: 14, color: T.text2 }}>{contact.company}</div>
              <div style={{ fontSize: 14, color: T.text3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{contact.email}</div>
            </div>
          </div>

          <div style={{ display: "flex", borderBottom: `1px solid ${T.bg4}` }}>
            {(["overview", "timeline", "deals", "scoring"] as const).map(t => (
              <button aria-label="Action" key={t} onClick={() => setDt(t)} style={{ flex: 1, padding: "8px 0", background: "none", border: "none", borderBottom: `2px solid ${dt === t ? T.accent : "transparent"}`, color: dt === t ? T.accent : T.text2, fontSize: 14, fontWeight: dt === t ? 700 : 400, cursor: "pointer", textTransform: "capitalize" }}>
                {t === "scoring" ? "Score" : t}{t === "deals" && cDeals.length > 0 ? ` (${cDeals.length})` : ""}
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: "auto", padding: 20 }}>
          {dt === "overview" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                {([["Email", contact.email], ["Phone", contact.phone], ["Company", contact.company], ["Status", contact.status], ["Follow-up", CONTACT_FREQUENCIES.find(f => f.value === contact.contactFrequency)?.label || "Not set"], ["Last Contact", contact.lastContact], ["Interactions", contact.interactions + " logged"]] as [string, string][]).map(([label, val]) => (
                  <div key={label} style={{ background: T.bg2, borderRadius: T.radius.md, padding: "10px 12px", overflow: "hidden" }}>
                    <div style={{ fontSize: 14, color: T.text3, fontWeight: 600, textTransform: "uppercase", marginBottom: 2 }}>{label}</div>
                    <div style={{ fontSize: 14, color: T.text1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{val}</div>
                  </div>
                ))}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                {([["Open Deals", cDeals.filter(d => !["Closed Won", "Closed Lost"].includes(d.stage)).length, "◆"], ["Pipeline", fmt(cDeals.reduce((s, d) => s + d.value, 0)), "💰"], ["Emails", cEmails.length, "✉️"], ["Tasks", cTasks.length, "◇"]] as [string, string | number, string][]).map(([label, val, icon]) => (
                  <div key={label} style={{ background: T.bg2, borderRadius: T.radius.md, padding: "12px", textAlign: "center" }}>
                    <div style={{ fontSize: 16, marginBottom: 4 }}>{icon}</div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: T.text0, fontFamily: "'JetBrains Mono', monospace" }}>{val}</div>
                    <div style={{ fontSize: 14, color: T.text3, marginTop: 2 }}>{label}</div>
                  </div>
                ))}
              </div>
              {contact.tags.length > 0 && (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {contact.tags.map(tag => <span key={tag} style={badgeStyle(T.text1, T.bg4)}>{tag}</span>)}
                </div>
              )}
              {/* Custom Fields */}
              {industryConfig && (() => {
                const contactFields = industryConfig.customFields.filter(f => f.entity === "contact");
                const cfv = contact.customFieldValues || {};
                const filledFields = contactFields.filter(f => cfv[f.id] !== undefined && cfv[f.id] !== "" && cfv[f.id] !== false);
                if (filledFields.length === 0) return null;
                return (
                  <div>
                    <div style={{ fontSize: 14, color: T.text3, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>Custom Fields</div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                      {filledFields.map(f => (
                        <div key={f.id} style={{ background: T.bg2, borderRadius: T.radius.md, padding: "10px 12px", overflow: "hidden" }}>
                          <div style={{ fontSize: 14, color: T.text3, fontWeight: 600, textTransform: "uppercase", marginBottom: 2 }}>{f.label}</div>
                          <div style={{ fontSize: 14, color: T.text1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {f.type === "checkbox" ? (cfv[f.id] ? "✓ Yes" : "✗ No") : String(cfv[f.id])}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}
            </div>
          )}

          {dt === "timeline" && (
            <ContactTimeline
              contact={contact}
              deals={deals}
              notes={notes}
              tasks={tasks}
              emailLog={emailLog}
              meetings={meetings}
              auditLog={auditLog}
            />
          )}

          {dt === "deals" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {cDeals.length === 0 ? (
                <div style={{ textAlign: "center", padding: 32, color: T.text3 }}>
                  <div style={{ fontSize: 24, marginBottom: 8 }}>◆</div>
                  No deals yet
                </div>
              ) : cDeals.map(d => (
                <div key={d.id} style={{ background: T.bg2, borderRadius: T.radius.md, padding: "14px 16px", border: `1px solid ${T.bg4}` }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: T.text0 }}>{d.title}</div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: T.accent, fontFamily: "'JetBrains Mono', monospace" }}>{fmt(d.value)}</div>
                  </div>
                  <div style={{ fontSize: 14, color: T.text3, marginTop: 6, display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <span style={badgeStyle(T.text1, T.bg3)}>{d.stage}</span>
                    <span>{d.probability}% prob</span>
                    <span>Closes {d.closeDate}</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {dt === "scoring" && (
            <div>
              {/* Score gauge */}
              <div style={{ textAlign: "center", marginBottom: 20 }}>
                <div style={{
                  fontSize: 48, fontWeight: 900, color: scoreColor,
                  fontFamily: "'JetBrains Mono', monospace", lineHeight: 1,
                }}>{contact.score}</div>
                <div style={{ fontSize: 14, color: T.text3, marginTop: 4 }}>/ 100 lead score</div>
                <div style={{
                  height: 6, background: T.bg4, borderRadius: 3, marginTop: 12, maxWidth: 200, margin: "12px auto 0",
                }}>
                  <div style={{
                    height: "100%", borderRadius: 3, width: `${contact.score}%`,
                    background: `linear-gradient(90deg, ${scoreColor}88, ${scoreColor})`,
                  }} />
                </div>
              </div>

              {/* Factor breakdown */}
              <div style={{ fontSize: 14, fontWeight: 600, color: T.text0, marginBottom: 12 }}>Score Breakdown</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {scoreFactors.map((f, i) => (
                  <div key={i} style={{
                    display: "flex", alignItems: "center", gap: 10,
                    background: T.bg2, borderRadius: T.radius.md, padding: "10px 12px",
                  }}>
                    <span style={{ fontSize: 16, width: 24, textAlign: "center" }}>{f.emoji}</span>
                    <span style={{ flex: 1, fontSize: 14, color: T.text2 }}>{f.label}</span>
                    <span style={{
                      fontWeight: 700, fontFamily: "'JetBrains Mono', monospace", fontSize: 14,
                      color: f.impact > 0 ? T.green : f.impact < 0 ? T.red : T.text3,
                    }}>
                      {f.impact > 0 ? "+" : ""}{f.impact}
                    </span>
                  </div>
                ))}
              </div>
              <div style={{ fontSize: 14, color: T.text3, marginTop: 12, fontStyle: "italic", textAlign: "center" }}>
                Base score: 40 · Final = base + factors (capped 0–100)
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
