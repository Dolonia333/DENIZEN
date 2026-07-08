import { useState, useCallback, useMemo } from "react";
import { T, fmt, STAGES as DEFAULT_STAGES, STAGE_COLORS, type Deal, type Contact, type Note, type EmailLogEntry, type AuditEntry, type DealComment } from "@/lib/crm-data";
import { useMobile } from "@/lib/crm-hooks";
import { shareToGlobalChat } from "@/components/GlobalTeamChat";
import type { IndustryConfig } from "@/lib/industry-config";

const STAGE_COLOR_PALETTE = ["#6366f1", "#f0b429", "#3b82f6", "#8b5cf6", "#10b981", "#ef4444", "#ec4899", "#14b8a6", "#f97316", "#06b6d4"];
let _stageList: string[] = [];
function setStageList(stages: string[]) { _stageList = stages; }
function getStageColor(stage: string): string {
  if (STAGE_COLORS[stage]) return STAGE_COLORS[stage];
  const idx = _stageList.indexOf(stage);
  if (idx >= 0) return STAGE_COLOR_PALETTE[idx % STAGE_COLOR_PALETTE.length];
  // Hash-based fallback
  let hash = 0;
  for (let i = 0; i < stage.length; i++) hash = stage.charCodeAt(i) + ((hash << 5) - hash);
  return STAGE_COLOR_PALETTE[Math.abs(hash) % STAGE_COLOR_PALETTE.length];
}
interface Props {
  deals: Deal[];
  contacts: Contact[];
  notes?: Note[];
  emailLog?: EmailLogEntry[];
  auditLog?: AuditEntry[];
  dealComments?: DealComment[];
  onAddDealComment?: (comment: DealComment) => void;
  currentUserName?: string;
  onDealStageChange: (dealId: number, newStage: string) => void;
  onEditDeal: (deal: Deal) => void;
  onDeleteDeal: (id: number) => void;
  industryConfig?: IndustryConfig;
}

function formatTimelineTime(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  const diff = (Date.now() - t) / 1000;
  if (diff < 3600) return `${Math.max(1, Math.floor(diff / 60))}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 14) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(t).toLocaleDateString();
}

function buildDealTimeline(
  deal: Deal,
  notes: Note[],
  emailLog: EmailLogEntry[],
  auditLog: AuditEntry[],
  stageColor: string,
) {
  const items: { icon: string; label: string; time: string; color: string; sortAt: number }[] = [];

  for (const n of notes.filter((x) => x.contact === deal.contact)) {
    items.push({
      icon: "📝",
      label: n.text.length > 100 ? `${n.text.slice(0, 100)}…` : n.text,
      time: formatTimelineTime(n.date),
      color: T.blue,
      sortAt: Date.parse(n.date) || 0,
    });
  }
  for (const e of emailLog.filter((x) => x.to === deal.contact || x.toEmail === deal.contact)) {
    items.push({
      icon: "✉️",
      label: `Email sent: ${e.subject}`,
      time: formatTimelineTime(e.sentAt),
      color: T.purple,
      sortAt: Date.parse(e.sentAt) || 0,
    });
    if (e.opens?.length) {
      items.push({
        icon: "👁️",
        label: `Opened "${e.subject}" (${e.opens.length}×)`,
        time: formatTimelineTime(e.opens[e.opens.length - 1].at),
        color: T.green,
        sortAt: Date.parse(e.opens[e.opens.length - 1].at) || 0,
      });
    }
  }
  for (const a of auditLog.filter((x) =>
    x.entity === "deal" && (x.entityName === deal.title || x.entityName?.includes(deal.title)),
  )) {
    items.push({
      icon: "📋",
      label: `${a.user} ${a.action} ${a.entityName}${a.field ? ` (${a.field})` : ""}`,
      time: formatTimelineTime(a.at),
      color: T.accent,
      sortAt: Date.parse(a.at) || 0,
    });
  }

  items.push({
    icon: "🎯",
    label: `Deal in pipeline — ${deal.title}`,
    time: deal.closeDate ? `Close ${deal.closeDate}` : "Open",
    color: T.blue,
    sortAt: Date.parse(deal.closeDate) || 0,
  });
  if (deal.health === "at-risk") {
    items.push({
      icon: "⚠️",
      label: "Flagged at-risk — follow up soon",
      time: "Current",
      color: T.orange,
      sortAt: Date.now(),
    });
  }
  items.push({
    icon: "⏱️",
    label: `In ${deal.stage} for ${deal.daysInStage} days`,
    time: "Current",
    color: stageColor,
    sortAt: Date.now() - 1,
  });

  return items.sort((a, b) => b.sortAt - a.sortAt);
}

// Apple-style ring chart component
function MiniRing({ segments, size = 72, stroke = 6 }: { segments: { value: number; color: string; label: string }[]; size?: number; stroke?: number }) {
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const total = segments.reduce((s, seg) => s + seg.value, 0) || 1;
  let offset = 0;

  return (
    <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={T.bg4} strokeWidth={stroke} opacity={0.3} />
      {segments.map((seg, i) => {
        const len = (seg.value / total) * circ;
        const gap = segments.length > 1 ? 3 : 0;
        const el = (
          <circle
            key={i}
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={seg.color}
            strokeWidth={stroke}
            strokeDasharray={`${Math.max(0, len - gap)} ${circ}`}
            strokeDashoffset={-offset}
            strokeLinecap="round"
            style={{ transition: "stroke-dasharray 0.6s ease, stroke-dashoffset 0.6s ease" }}
          />
        );
        offset += len;
        return el;
      })}
    </svg>
  );
}

// ── Deal Detail Slideout ──
function DealSlideout({ deal, deals, contacts, stages, notes, emailLog, auditLog, dealComments, onAddDealComment, currentUserName, onClose, onStageChange, onEdit }: {
  deal: Deal; deals: Deal[]; contacts: Contact[]; stages: string[];
  notes: Note[]; emailLog: EmailLogEntry[]; auditLog: AuditEntry[];
  dealComments: DealComment[]; onAddDealComment?: (c: DealComment) => void; currentUserName?: string;
  onClose: () => void;
  onStageChange: (id: number, stage: string) => void; onEdit: (d: Deal) => void;
}) {
  const [commentDraft, setCommentDraft] = useState("");
  const STAGES = stages;
  const color = getStageColor(deal.stage) || T.bg4;
  const stageIndex = STAGES.indexOf(deal.stage);
  const isAtRisk = deal.health === "at-risk";

  const timeline = useMemo(
    () => buildDealTimeline(deal, notes, emailLog, auditLog, color),
    [deal, notes, emailLog, auditLog, color],
  );

  const dealNotes = useMemo(
    () => notes
      .filter((n) => n.contact === deal.contact)
      .map((n) => ({ text: n.text, date: n.date, author: n.type || "Note" })),
    [notes, deal.contact],
  );

  const threadComments = useMemo(
    () => dealComments.filter((c) => c.dealId === deal.id).sort((a, b) => String(b.at).localeCompare(String(a.at))),
    [dealComments, deal.id],
  );

  const contactEmails = useMemo(
    () => emailLog.filter((e) => e.to === deal.contact || e.toEmail === deal.contact),
    [emailLog, deal.contact],
  );

  // Similar deals
  const similarDeals = useMemo(() =>
    deals.filter(d => d.id !== deal.id && d.contact === deal.contact).slice(0, 3),
  [deals, deal]);

  const glass = {
    background: `linear-gradient(145deg, ${T.bg2}cc, ${T.bg3}66)`,
    backdropFilter: "blur(12px)",
    border: `1px solid ${T.bg4}66`,
    borderRadius: T.radius.lg,
  };

  return (
    <>
      {/* Overlay */}
      <div onClick={onClose} style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)",
        backdropFilter: "blur(4px)", zIndex: 999,
        animation: "fadeIn 0.2s ease",
      }} />
      {/* Panel */}
      <div style={{
        position: "fixed", top: 0, right: 0, bottom: 0, width: 480, maxWidth: "95vw",
        background: `linear-gradient(180deg, ${T.bg1}, ${T.bg0})`,
        borderLeft: `1px solid ${T.bg4}66`, zIndex: 1000,
        overflowY: "auto", animation: "slideInRight 0.3s cubic-bezier(0.4,0,0.2,1)",
      }}>
        {/* Header */}
        <div style={{ padding: "24px 24px 0", position: "sticky", top: 0, background: T.bg1, zIndex: 1, paddingBottom: 16, borderBottom: `1px solid ${T.bg4}44` }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color, marginBottom: 6 }}>
                {deal.stage}
              </div>
              <h2 style={{ fontSize: 22, fontWeight: 800, color: T.text0, margin: 0, letterSpacing: "-0.03em" }}>{deal.title}</h2>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
                {(() => { const co = contacts.find(c => c.name === deal.contact); return (
                  <div style={{ width: 22, height: 22, borderRadius: "50%", background: co?.avatar ? "none" : `linear-gradient(135deg,${color},${T.bg4})`, overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, color: "#fff", flexShrink: 0 }}>
                    {co?.avatar ? <img src={co.avatar} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : deal.contact?.[0] || "?"}
                  </div>
                ); })()}
                <span style={{ fontSize: 13, color: T.text2 }}>{deal.contact}</span>
              </div>
            </div>
            <button onClick={onClose} style={{
              background: T.bg4, border: "none", color: T.text2, cursor: "pointer",
              width: 32, height: 32, borderRadius: T.radius.sm, fontSize: 16,
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>×</button>
          </div>

          {/* Quick stats */}
          <div style={{ display: "flex", gap: 12, marginTop: 8 }}>
            <div style={{ ...glass, padding: "12px 16px", flex: 1, textAlign: "center" }}>
              <div style={{ fontSize: 20, fontWeight: 800, color: T.text0, fontFamily: "'Inter', sans-serif" }}>{fmt(deal.value)}</div>
              <div style={{ fontSize: 10, color: T.text3, marginTop: 2 }}>Value</div>
            </div>
            <div style={{ ...glass, padding: "12px 16px", flex: 1, textAlign: "center" }}>
              <div style={{ fontSize: 20, fontWeight: 800, color, fontFamily: "'Inter', sans-serif" }}>{deal.probability}%</div>
              <div style={{ fontSize: 10, color: T.text3, marginTop: 2 }}>Probability</div>
            </div>
            <div style={{ ...glass, padding: "12px 16px", flex: 1, textAlign: "center" }}>
              <div style={{ fontSize: 20, fontWeight: 800, color: isAtRisk ? T.orange : T.green, fontFamily: "'Inter', sans-serif" }}>
                {deal.daysInStage}d
              </div>
              <div style={{ fontSize: 10, color: T.text3, marginTop: 2 }}>In Stage</div>
            </div>
          </div>
        </div>

        <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 24 }}>
          {/* Stage Progress */}
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: T.text3, marginBottom: 12 }}>
              Stage Progress
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              {STAGES.map((s, i) => {
                const sc = getStageColor(s);
                const isActive = i <= stageIndex;
                const isCurrent = s === deal.stage;
                return (
                  <div key={s} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
                    <div style={{
                      height: 4, width: "100%", borderRadius: 2,
                      background: isActive ? sc : T.bg4,
                      boxShadow: isCurrent ? `0 0 8px ${sc}55` : "none",
                      transition: "all 0.3s",
                    }} />
                    <span style={{
                      fontSize: 8, fontWeight: 600, color: isCurrent ? sc : (isActive ? T.text2 : T.text3),
                      textAlign: "center", lineHeight: 1.2,
                    }}>{s}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Health & Close Date */}
          <div style={{ ...glass, padding: 16, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{
                width: 10, height: 10, borderRadius: "50%",
                background: isAtRisk ? T.orange : T.green,
                boxShadow: `0 0 8px ${isAtRisk ? T.orange : T.green}55`,
              }} />
              <span style={{ fontSize: 13, fontWeight: 600, color: isAtRisk ? T.orange : T.green }}>
                {isAtRisk ? "At Risk" : "Healthy"}
              </span>
            </div>
            <div style={{ fontSize: 12, color: T.text2 }}>
              Close: <span style={{ fontWeight: 600, color: T.text1 }}>{deal.closeDate}</span>
            </div>
          </div>

          {/* Activity Timeline */}
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: T.text3, marginBottom: 12 }}>
              Activity Timeline
            </div>
            <div style={{ position: "relative", paddingLeft: 24 }}>
              <div style={{ position: "absolute", left: 7, top: 4, bottom: 4, width: 1, background: `linear-gradient(180deg, ${color}44, ${T.bg4}22)` }} />
              {timeline.map((item, i) => (
                <div key={i} style={{ position: "relative", marginBottom: 16, display: "flex", alignItems: "flex-start", gap: 12 }}>
                  <div style={{
                    position: "absolute", left: -20, top: 2,
                    width: 14, height: 14, borderRadius: "50%",
                    background: T.bg2, border: `2px solid ${item.color}`,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 8,
                  }}>{item.icon}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12, color: T.text1, fontWeight: 500 }}>{item.label}</div>
                    <div style={{ fontSize: 10, color: T.text3, marginTop: 2 }}>{item.time}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Email engagement */}
          {contactEmails.length > 0 && (
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: T.text3, marginBottom: 12 }}>
                Email engagement
              </div>
              {contactEmails.slice(0, 6).map((e) => (
                <div key={e.id} style={{ ...glass, padding: 12, marginBottom: 8 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: T.text1 }}>{e.subject}</div>
                  <div style={{ fontSize: 11, color: T.text3, marginTop: 4 }}>
                    Sent {formatTimelineTime(e.sentAt)}
                    {(e.opens?.length || 0) > 0 && ` · ${e.opens!.length} open${e.opens!.length > 1 ? "s" : ""}`}
                    {(e.clicks || 0) > 0 && ` · ${e.clicks} click${e.clicks! > 1 ? "s" : ""}`}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Deal comments */}
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: T.text3, marginBottom: 12 }}>
              Team comments
            </div>
            {onAddDealComment && (
              <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                <input
                  value={commentDraft}
                  onChange={(ev) => setCommentDraft(ev.target.value)}
                  placeholder="Add a comment…"
                  style={{ flex: 1, background: T.bg3, border: `1px solid ${T.bg4}`, borderRadius: T.radius.md, color: T.text1, padding: "8px 12px", fontSize: 12 }}
                />
                <button
                  onClick={() => {
                    const text = commentDraft.trim();
                    if (!text) return;
                    onAddDealComment({
                      id: Date.now(),
                      dealId: deal.id,
                      user: currentUserName || "Team",
                      text,
                      at: new Date().toISOString(),
                    });
                    setCommentDraft("");
                  }}
                  style={{ background: T.accent, color: T.bg0, border: "none", borderRadius: T.radius.md, padding: "8px 14px", fontWeight: 700, fontSize: 12, cursor: "pointer" }}
                >
                  Post
                </button>
              </div>
            )}
            {threadComments.length === 0 ? (
              <div style={{ ...glass, padding: 14, fontSize: 12, color: T.text3 }}>No team comments yet.</div>
            ) : threadComments.map((c) => (
              <div key={c.id} style={{ ...glass, padding: 14, marginBottom: 8 }}>
                <div style={{ fontSize: 12, color: T.text1, lineHeight: 1.5 }}>{c.text}</div>
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, fontSize: 10, color: T.text3 }}>
                  <span>{c.user}</span>
                  <span>{formatTimelineTime(c.at)}</span>
                </div>
              </div>
            ))}
          </div>

          {/* Notes */}
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: T.text3, marginBottom: 12 }}>
              Notes
            </div>
            {dealNotes.length === 0 ? (
              <div style={{ ...glass, padding: 14, fontSize: 12, color: T.text3 }}>No notes for {deal.contact} yet.</div>
            ) : dealNotes.map((note, i) => (
              <div key={i} style={{ ...glass, padding: 14, marginBottom: 8 }}>
                <div style={{ fontSize: 12, color: T.text1, lineHeight: 1.5 }}>{note.text}</div>
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, fontSize: 10, color: T.text3 }}>
                  <span>{note.author}</span>
                  <span>{note.date}</span>
                </div>
              </div>
            ))}
          </div>

          {/* Related Deals */}
          {similarDeals.length > 0 && (
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: T.text3, marginBottom: 12 }}>
                Other Deals — {deal.contact}
              </div>
              {similarDeals.map(d => (
                <div key={d.id} style={{ ...glass, padding: 12, marginBottom: 6, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: T.text1 }}>{d.title}</div>
                    <div style={{ fontSize: 10, color: T.text3 }}>{d.stage}</div>
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: T.text0 }}>{fmt(d.value)}</div>
                </div>
              ))}
            </div>
          )}

          {/* Actions */}
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => { onEdit(deal); onClose(); }} style={{
              flex: 1, padding: "10px 0", fontSize: 13, fontWeight: 700,
              background: `${T.accent}15`, border: `1px solid ${T.accent}33`,
              borderRadius: T.radius.md, color: T.accent, cursor: "pointer",
            }}>Edit Deal</button>
            {!["Closed Won", "Closed Lost"].includes(deal.stage) && (
              <button onClick={() => { onStageChange(deal.id, STAGES[stageIndex + 1]); onClose(); }} style={{
                flex: 1, padding: "10px 0", fontSize: 13, fontWeight: 700,
                background: T.accent, border: "none",
                borderRadius: T.radius.md, color: T.bg0, cursor: "pointer",
              }}>Advance →</button>
            )}
          </div>
        </div>
      </div>

      <style>{`
        @keyframes slideInRight { from { transform: translateX(100%); } to { transform: translateX(0); } }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
      `}</style>
    </>
  );
}

// ── Pipeline Velocity Metrics ──
function VelocityMetrics({ deals, stages }: { deals: Deal[]; stages: string[] }) {
  const STAGES = stages;
  const stageMetrics = useMemo(() => {
    const active = STAGES.filter(s => !["Closed Won", "Closed Lost"].includes(s));
    return active.map(stage => {
      const stageDeals = deals.filter(d => d.stage === stage);
      const avg = stageDeals.length ? Math.round(stageDeals.reduce((s, d) => s + d.daysInStage, 0) / stageDeals.length) : 0;
      const maxDays = Math.max(...deals.map(d => d.daysInStage), 1);
      return { stage, avg, count: stageDeals.length, pct: avg / maxDays, color: getStageColor(stage) };
    });
  }, [deals]);

  const bottleneck = useMemo(() => {
    const sorted = [...stageMetrics].sort((a, b) => b.avg - a.avg);
    return sorted[0]?.avg > 0 ? sorted[0] : null;
  }, [stageMetrics]);

  const totalVelocity = useMemo(() => stageMetrics.reduce((s, m) => s + m.avg, 0), [stageMetrics]);

  const glass = {
    background: `linear-gradient(135deg, ${T.bg2}dd, ${T.bg3}99)`,
    backdropFilter: "blur(20px)",
    border: `1px solid ${T.bg4}88`,
    borderRadius: T.radius.xl,
  };

  return (
    <div style={{ marginTop: 28 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
        <h3 style={{ fontSize: 16, fontWeight: 800, color: T.text0, margin: 0, letterSpacing: "-0.02em" }}>
          Pipeline Velocity
        </h3>
        <span style={{
          fontSize: 10, padding: "3px 10px", borderRadius: T.radius.full,
          background: `${T.blue}15`, color: T.blue, fontWeight: 600, border: `1px solid ${T.blue}33`,
        }}>
          {totalVelocity}d avg cycle
        </span>
      </div>

      <div style={{ ...glass, padding: 20 }}>
        {/* Bottleneck alert */}
        {bottleneck && bottleneck.avg > 5 && (
          <div style={{
            display: "flex", alignItems: "center", gap: 10, padding: "10px 14px",
            background: `${T.orange}10`, border: `1px solid ${T.orange}33`,
            borderRadius: T.radius.md, marginBottom: 16,
          }}>
            <span style={{ fontSize: 16 }}>⚠️</span>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: T.orange }}>
                Bottleneck detected: {bottleneck.stage}
              </div>
              <div style={{ fontSize: 11, color: T.text3, marginTop: 2 }}>
                Deals spend an average of {bottleneck.avg} days here — consider reviewing stalled deals
              </div>
            </div>
          </div>
        )}

        {/* Stage bars */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {stageMetrics.map(m => (
            <div key={m.stage}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ width: 8, height: 8, borderRadius: "50%", background: m.color }} />
                  <span style={{ fontSize: 12, fontWeight: 600, color: T.text1 }}>{m.stage}</span>
                  <span style={{ fontSize: 10, color: T.text3 }}>({m.count} deals)</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{
                    fontSize: 14, fontWeight: 800, color: m.avg > 10 ? T.orange : T.text0,
                    fontFamily: "'Inter', sans-serif",
                  }}>{m.avg}d</span>
                  {bottleneck?.stage === m.stage && m.avg > 5 && (
                    <span style={{ fontSize: 9, padding: "2px 6px", borderRadius: T.radius.full, background: `${T.orange}20`, color: T.orange, fontWeight: 700 }}>
                      SLOW
                    </span>
                  )}
                </div>
              </div>
              <div style={{ height: 6, borderRadius: 3, background: T.bg4, overflow: "hidden" }}>
                <div style={{
                  height: "100%", borderRadius: 3,
                  background: `linear-gradient(90deg, ${m.color}, ${m.color}88)`,
                  width: `${Math.max(4, m.pct * 100)}%`,
                  transition: "width 0.5s ease",
                  boxShadow: m.avg > 10 ? `0 0 8px ${m.color}44` : "none",
                }} />
              </div>
            </div>
          ))}
        </div>

        {/* Summary row */}
        <div style={{
          display: "flex", gap: 12, marginTop: 20, paddingTop: 16,
          borderTop: `1px solid ${T.bg4}44`,
        }}>
          {[
            { label: "Avg Cycle", value: `${totalVelocity}d`, color: T.blue },
            { label: "Fastest Stage", value: stageMetrics.reduce((a, b) => (a.avg < b.avg && a.avg > 0) || b.avg === 0 ? a : b).stage, color: T.green },
            { label: "Slowest Stage", value: bottleneck?.stage || "—", color: T.orange },
          ].map(item => (
            <div key={item.label} style={{ flex: 1, textAlign: "center" }}>
              <div style={{ fontSize: 16, fontWeight: 800, color: item.color, fontFamily: "'Inter', sans-serif" }}>{item.value}</div>
              <div style={{ fontSize: 10, color: T.text3, marginTop: 2 }}>{item.label}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function PipelineTab({ deals, contacts, notes = [], emailLog = [], auditLog = [], dealComments = [], onAddDealComment, currentUserName, onDealStageChange, onEditDeal, onDeleteDeal, industryConfig }: Props) {
  const STAGES = industryConfig?.pipelineStages || DEFAULT_STAGES;
  setStageList(STAGES);

  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);
  const [activeStage, setActiveStage] = useState<string>("All");
  const [draggedDealId, setDraggedDealId] = useState<number | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"kanban" | "list">("kanban");
  const [hoveredDeal, setHoveredDeal] = useState<number | null>(null);
  const [selectedDeal, setSelectedDeal] = useState<Deal | null>(null);
  const isMobile = useMobile(640);

  // ── Stats ──
  const openDeals = useMemo(() => deals.filter(d => !["Closed Won", "Closed Lost"].includes(d.stage)), [deals]);
  const wonDeals = useMemo(() => deals.filter(d => d.stage === "Closed Won"), [deals]);
  const lostDeals = useMemo(() => deals.filter(d => d.stage === "Closed Lost"), [deals]);
  const totalPipeline = useMemo(() => openDeals.reduce((s, d) => s + d.value, 0), [openDeals]);
  const weightedPipeline = useMemo(() => openDeals.reduce((s, d) => s + d.value * (d.probability / 100), 0), [openDeals]);
  const avgProbability = useMemo(() => openDeals.length ? Math.round(openDeals.reduce((s, d) => s + d.probability, 0) / openDeals.length) : 0, [openDeals]);
  const atRiskCount = useMemo(() => openDeals.filter(d => d.health === "at-risk").length, [openDeals]);

  const ringSegments = useMemo(() => STAGES.filter(s => !["Closed Won", "Closed Lost"].includes(s)).map(s => ({
    value: deals.filter(d => d.stage === s).length,
    color: getStageColor(s),
    label: s,
  })), [deals]);

  // ── Drag handlers ──
  const handleDragStart = useCallback((e: React.DragEvent, dealId: number) => {
    setDraggedDealId(dealId);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(dealId));
    requestAnimationFrame(() => { (e.target as HTMLElement).style.opacity = "0.4"; });
  }, []);
  const handleDragEnd = useCallback((e: React.DragEvent) => {
    (e.target as HTMLElement).style.opacity = "1";
    setDraggedDealId(null);
    setDropTarget(null);
  }, []);
  const handleDragOver = useCallback((e: React.DragEvent, stage: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDropTarget(stage);
  }, []);
  const handleDragLeave = useCallback(() => setDropTarget(null), []);
  const handleDrop = useCallback((e: React.DragEvent, stage: string) => {
    e.preventDefault();
    const dealId = Number(e.dataTransfer.getData("text/plain"));
    if (dealId && !isNaN(dealId)) {
      const deal = deals.find(d => d.id === dealId);
      if (deal && deal.stage !== stage) onDealStageChange(dealId, stage);
    }
    setDraggedDealId(null);
    setDropTarget(null);
  }, [deals, onDealStageChange]);

  const filteredDeals = activeStage === "All" ? deals : deals.filter(d => d.stage === activeStage);

  // ── Styles ──
  const glass = {
    background: `linear-gradient(135deg, ${T.bg2}dd, ${T.bg3}99)`,
    backdropFilter: "blur(20px)",
    WebkitBackdropFilter: "blur(20px)",
    border: `1px solid ${T.bg4}88`,
    borderRadius: T.radius.xl,
  } as const;

  const glassSubtle = {
    background: `linear-gradient(145deg, ${T.bg2}cc, ${T.bg3}66)`,
    backdropFilter: "blur(12px)",
    WebkitBackdropFilter: "blur(12px)",
    border: `1px solid ${T.bg4}66`,
    borderRadius: T.radius.lg,
  } as const;

  // ── Stat Card ──
  const StatCard = ({ label, value, sub, color, icon }: { label: string; value: string; sub?: string; color: string; icon: string }) => (
    <div style={{ ...glassSubtle, padding: "18px 20px", flex: 1, minWidth: 140, position: "relative", overflow: "hidden" }}>
      <div style={{ position: "absolute", top: -8, right: -8, fontSize: 48, opacity: 0.04, color }}>{icon}</div>
      <div style={{ fontSize: 11, color: T.text3, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 800, color, letterSpacing: "-0.03em", lineHeight: 1, fontFamily: "'Inter', -apple-system, sans-serif" }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: T.text3, marginTop: 6 }}>{sub}</div>}
    </div>
  );

  // ── Deal Card (Apple-style) ──
  const DealCard = ({ deal, stage, color }: { deal: Deal; stage: string; color: string }) => {
    const contactObj = contacts.find(c => c.name === deal.contact);
    const isHovered = hoveredDeal === deal.id;
    const isDragging = draggedDealId === deal.id;
    const isAtRisk = deal.health === "at-risk";

    return (
      <div
        draggable={!isMobile}
        onDragStart={!isMobile ? (e) => handleDragStart(e, deal.id) : undefined}
        onDragEnd={!isMobile ? handleDragEnd : undefined}
        onMouseEnter={() => setHoveredDeal(deal.id)}
        onMouseLeave={() => setHoveredDeal(null)}
        onClick={() => setSelectedDeal(deal)}
        style={{
          ...glassSubtle,
          padding: "16px",
          cursor: "pointer",
          transition: "all 0.25s cubic-bezier(0.4, 0, 0.2, 1)",
          transform: isHovered && !isDragging ? "translateY(-2px)" : "none",
          boxShadow: isHovered && !isDragging
            ? `0 8px 32px rgba(0,0,0,0.3), 0 0 0 1px ${color}33`
            : isDragging ? `0 16px 48px rgba(0,0,0,0.4)` : "0 1px 3px rgba(0,0,0,0.2)",
          borderColor: isHovered ? `${color}44` : `${T.bg4}66`,
          opacity: isDragging ? 0.6 : 1,
        }}
      >
        {/* Top row: title + actions */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: T.text0, lineHeight: 1.3, marginBottom: 2 }}>{deal.title}</div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: T.text3 }}>
              <div style={{ width: 18, height: 18, borderRadius: "50%", background: contactObj?.avatar ? "none" : `linear-gradient(135deg,${color},${T.bg4})`, overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 8, fontWeight: 700, color: "#fff", flexShrink: 0 }}>
                {contactObj?.avatar ? <img src={contactObj.avatar} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : deal.contact?.[0] || "?"}
              </div>
              {deal.contact}
            </div>
          </div>
          <div style={{
            display: "flex", gap: 2,
            opacity: isHovered ? 1 : 0,
            transition: "opacity 0.2s",
          }}>
            <button onClick={(e) => { e.stopPropagation(); onEditDeal(deal); }} style={{
              background: T.bg4, border: "none", color: T.text2, cursor: "pointer",
              fontSize: 11, padding: "4px 8px", borderRadius: T.radius.sm,
              transition: "background 0.15s",
            }} onMouseOver={(e) => (e.currentTarget.style.background = T.bg5)}
               onMouseOut={(e) => (e.currentTarget.style.background = T.bg4)}>
              Edit
            </button>
            <button onClick={(e) => { e.stopPropagation(); shareToGlobalChat({
              title: deal.title, type: "deal", color: color,
              snapshot: { "Value": fmt(deal.value), "Stage": deal.stage, "Contact": deal.contact, "Probability": `${deal.probability}%`, "Close Date": deal.closeDate, "Days in Stage": `${deal.daysInStage}d` },
              status: deal.health === "at-risk" ? "Needs Review" : "In Progress",
            }); }} style={{
              background: `${T.purple}18`, border: "none", color: T.purple, cursor: "pointer",
              fontSize: 11, padding: "4px 8px", borderRadius: T.radius.sm,
              transition: "background 0.15s",
            }} onMouseOver={(e) => (e.currentTarget.style.background = `${T.purple}33`)}
               onMouseOut={(e) => (e.currentTarget.style.background = `${T.purple}18`)}
              title="Share to Team Chat">
              💬
            </button>
            {confirmDelete === deal.id ? (
              <button onClick={(e) => { e.stopPropagation(); onDeleteDeal(deal.id); setConfirmDelete(null); }} style={{
                background: `${T.red}22`, border: `1px solid ${T.red}44`, color: T.red,
                cursor: "pointer", fontSize: 11, padding: "4px 8px", borderRadius: T.radius.sm,
              }}>Confirm</button>
            ) : (
              <button onClick={(e) => { e.stopPropagation(); setConfirmDelete(deal.id); }} style={{
                background: T.bg4, border: "none", color: T.text3, cursor: "pointer",
                fontSize: 11, padding: "4px 8px", borderRadius: T.radius.sm,
              }}>×</button>
            )}
          </div>
        </div>

        {/* Value */}
        <div style={{
          fontSize: 22, fontWeight: 800, color: T.text0,
          letterSpacing: "-0.03em", lineHeight: 1,
          fontFamily: "'Inter', -apple-system, sans-serif",
          marginBottom: 12,
        }}>
          {fmt(deal.value)}
        </div>

        {/* Progress bar (probability) */}
        <div style={{ marginBottom: 10 }}>
          <div style={{
            height: 3, borderRadius: 2, background: T.bg4,
            overflow: "hidden",
          }}>
            <div style={{
              height: "100%", borderRadius: 2,
              background: `linear-gradient(90deg, ${color}, ${color}cc)`,
              width: `${deal.probability}%`,
              transition: "width 0.4s ease",
            }} />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
            <span style={{ fontSize: 10, color: T.text3, fontWeight: 500 }}>{deal.probability}% probability</span>
            <span style={{ fontSize: 10, color: T.text3, fontWeight: 500 }}>{deal.daysInStage}d</span>
          </div>
        </div>

        {/* Footer: health + close date */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{
            display: "flex", alignItems: "center", gap: 5,
            fontSize: 10, fontWeight: 600, letterSpacing: "0.02em",
            color: isAtRisk ? T.orange : T.green,
          }}>
            <div style={{
              width: 6, height: 6, borderRadius: "50%",
              background: isAtRisk ? T.orange : T.green,
              boxShadow: `0 0 6px ${isAtRisk ? T.orange : T.green}66`,
            }} />
            {isAtRisk ? "At Risk" : "Healthy"}
          </div>
          <span style={{ fontSize: 10, color: T.text3, fontWeight: 500 }}>
            {deal.closeDate}
          </span>
        </div>

        {/* Mobile stage badge */}
        {isMobile && (
          <div style={{ marginTop: 10 }}>
            <span style={{
              fontSize: 10, padding: "3px 10px", borderRadius: T.radius.full,
              background: `${color}15`, color, fontWeight: 600,
              border: `1px solid ${color}33`,
            }}>{stage}</span>
          </div>
        )}

        {/* Stage nav buttons */}
        {!["Closed Won", "Closed Lost"].includes(stage) && (
          <div style={{ display: "flex", gap: 6, marginTop: 12 }}>
            {STAGES.indexOf(stage) > 0 && (
              <button onClick={(e) => { e.stopPropagation(); onDealStageChange(deal.id, STAGES[STAGES.indexOf(stage) - 1]); }} style={{
                flex: 1, fontSize: 11, padding: "7px 0",
                background: T.bg4, border: "none", borderRadius: T.radius.sm,
                color: T.text2, cursor: "pointer", fontWeight: 500,
                transition: "background 0.15s",
              }}
              onMouseOver={(e) => (e.currentTarget.style.background = T.bg5)}
              onMouseOut={(e) => (e.currentTarget.style.background = T.bg4)}>
                ← Back
              </button>
            )}
            <button onClick={(e) => { e.stopPropagation(); onDealStageChange(deal.id, STAGES[STAGES.indexOf(stage) + 1]); }} style={{
              flex: 1, fontSize: 11, padding: "7px 0",
              background: `${color}18`, border: `1px solid ${color}33`,
              borderRadius: T.radius.sm, color, cursor: "pointer", fontWeight: 600,
              transition: "all 0.15s",
            }}
            onMouseOver={(e) => { e.currentTarget.style.background = `${color}28`; }}
            onMouseOut={(e) => { e.currentTarget.style.background = `${color}18`; }}>
              Advance →
            </button>
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={{ animation: "fadeIn 0.4s ease" }}>
      {/* Deal Slideout */}
      {selectedDeal && (
        <DealSlideout
          deal={selectedDeal}
          deals={deals}
          contacts={contacts}
          stages={STAGES}
          notes={notes}
          emailLog={emailLog}
          auditLog={auditLog}
          dealComments={dealComments}
          onAddDealComment={onAddDealComment}
          currentUserName={currentUserName}
          onClose={() => setSelectedDeal(null)}
          onStageChange={onDealStageChange}
          onEdit={onEditDeal}
        />
      )}

      {/* ═══ COMMAND CENTER HEADER ═══ */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
              <h1 style={{
                fontSize: 28, fontWeight: 800, color: T.text0, margin: 0,
                letterSpacing: "-0.04em", fontFamily: "'Inter', -apple-system, sans-serif",
              }}>Pipeline</h1>
              <div style={{
                fontSize: 11, padding: "3px 10px", borderRadius: T.radius.full,
                background: `${T.accent}15`, color: T.accent, fontWeight: 600,
                border: `1px solid ${T.accent}33`,
              }}>
                {openDeals.length} active
              </div>
            </div>
            <p style={{ fontSize: 13, color: T.text3, margin: 0, fontWeight: 400 }}>
              Revenue command center · Real-time deal intelligence
            </p>
          </div>

          {/* View toggle */}
          {!isMobile && (
            <div style={{
              display: "flex", gap: 2, padding: 3, borderRadius: T.radius.md,
              background: T.bg3, border: `1px solid ${T.bg4}66`,
            }}>
              {(["kanban", "list"] as const).map(mode => (
                <button key={mode} onClick={() => setViewMode(mode)} style={{
                  padding: "6px 14px", fontSize: 12, fontWeight: 600,
                  borderRadius: T.radius.sm, border: "none", cursor: "pointer",
                  background: viewMode === mode ? T.bg5 : "transparent",
                  color: viewMode === mode ? T.text0 : T.text3,
                  transition: "all 0.2s",
                  textTransform: "capitalize",
                }}>
                  {mode === "kanban" ? "Board" : "List"}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* ═══ STATS DASHBOARD ═══ */}
        <div style={{
          display: "flex", gap: 12, flexWrap: isMobile ? "wrap" : "nowrap",
          marginBottom: 4,
        }}>
          {/* Ring chart card */}
          <div style={{
            ...glass, padding: "20px 24px",
            display: "flex", alignItems: "center", gap: 20,
            minWidth: isMobile ? "100%" : 280,
          }}>
            <MiniRing segments={ringSegments} size={68} stroke={5} />
            <div>
              <div style={{ fontSize: 28, fontWeight: 800, color: T.text0, letterSpacing: "-0.03em", lineHeight: 1 }}>
                {fmt(totalPipeline)}
              </div>
              <div style={{ fontSize: 11, color: T.text3, marginTop: 4, fontWeight: 500 }}>Total pipeline value</div>
              <div style={{ fontSize: 11, color: T.accent, marginTop: 2, fontWeight: 600 }}>
                {fmt(weightedPipeline)} weighted
              </div>
            </div>
          </div>

          {/* Stat cards */}
          <StatCard label="Win Rate" value={`${wonDeals.length + lostDeals.length > 0 ? Math.round((wonDeals.length / (wonDeals.length + lostDeals.length)) * 100) : 0}%`}
            sub={`${wonDeals.length} won · ${lostDeals.length} lost`} color={T.green} icon="◎" />
          <StatCard label="Avg Probability" value={`${avgProbability}%`}
            sub={`Across ${openDeals.length} deals`} color={T.blue} icon="◈" />
          <StatCard label="At Risk" value={`${atRiskCount}`}
            sub={atRiskCount === 0 ? "All clear" : "Need attention"} color={atRiskCount > 0 ? T.orange : T.green} icon="◇" />
        </div>
      </div>

      {/* ═══ STAGE PROGRESS BAR (desktop) ═══ */}
      {!isMobile && (
        <div style={{ ...glass, padding: "14px 20px", marginBottom: 20, display: "flex", alignItems: "center", gap: 0 }}>
          {STAGES.map((stage, i) => {
            const count = deals.filter(d => d.stage === stage).length;
            const color = getStageColor(stage);
            const isLast = i === STAGES.length - 1;
            return (
              <div key={stage} style={{ display: "flex", alignItems: "center", flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1 }}>
                  <div style={{
                    width: 8, height: 8, borderRadius: "50%",
                    background: color,
                    boxShadow: count > 0 ? `0 0 8px ${color}55` : "none",
                    transition: "box-shadow 0.3s",
                  }} />
                  <span style={{ fontSize: 11, fontWeight: 600, color: count > 0 ? T.text1 : T.text3 }}>{stage}</span>
                  <span style={{
                    fontSize: 10, fontWeight: 700, color,
                    background: `${color}15`, padding: "1px 7px",
                    borderRadius: T.radius.full, minWidth: 20, textAlign: "center",
                  }}>{count}</span>
                </div>
                {!isLast && (
                  <div style={{
                    width: 24, height: 1, background: `linear-gradient(90deg, ${color}44, ${getStageColor(STAGES[i + 1])}44)`,
                    margin: "0 4px", flexShrink: 0,
                  }} />
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ═══ MOBILE: Stage pills + vertical list ═══ */}
      {isMobile ? (
        <div>
          <div style={{
            display: "flex", gap: 6, overflowX: "auto", paddingBottom: 14,
            WebkitOverflowScrolling: "touch", msOverflowStyle: "none",
          }}>
            {["All", ...STAGES].map(stage => {
              const isActive = activeStage === stage;
              const color = stage === "All" ? T.accent : (getStageColor(stage) || T.bg4);
              const count = stage === "All" ? deals.length : deals.filter(d => d.stage === stage).length;
              return (
                <button key={stage} onClick={() => setActiveStage(stage)} style={{
                  padding: "7px 16px", borderRadius: T.radius.full, fontSize: 12, fontWeight: 600,
                  whiteSpace: "nowrap", cursor: "pointer", transition: "all 0.2s",
                  background: isActive ? `${color}18` : T.bg3,
                  color: isActive ? color : T.text3,
                  border: `1px solid ${isActive ? `${color}44` : T.bg4}`,
                  boxShadow: isActive ? `0 0 12px ${color}15` : "none",
                }}>
                  {stage === "All" ? "All" : stage} <span style={{ opacity: 0.5 }}>({count})</span>
                </button>
              );
            })}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {filteredDeals.length === 0 && (
              <div className="crm-empty-state crm-panel-enter" style={{ padding: "32px 12px", ...glassSubtle }}>
                <div className="icon" style={{ fontSize: 28 }}>📊</div>
                <div className="title">No deals here</div>
                <div className="desc">Drag deals into this stage or create a new one.</div>
              </div>
            )}
            {filteredDeals.map(deal => (
              <DealCard key={deal.id} deal={deal} stage={deal.stage} color={getStageColor(deal.stage) || T.bg4} />
            ))}
          </div>
        </div>
      ) : viewMode === "list" ? (
        /* ═══ DESKTOP LIST VIEW ═══ */
        <div style={{ ...glass, overflow: "hidden" }}>
          {/* Table header */}
          <div style={{
            display: "grid", gridTemplateColumns: "2fr 1.2fr 1fr 1fr 0.8fr 0.7fr 80px",
            padding: "12px 20px", borderBottom: `1px solid ${T.bg4}66`,
            fontSize: 10, fontWeight: 700, textTransform: "uppercase",
            letterSpacing: "0.08em", color: T.text3,
          }}>
            <span>Deal</span><span>Contact</span><span>Value</span>
            <span>Stage</span><span>Probability</span><span>Health</span><span />
          </div>
          {deals.map((deal, i) => {
            const color = getStageColor(deal.stage) || T.bg4;
            const isAtRisk = deal.health === "at-risk";
            return (
              <div key={deal.id} style={{
                display: "grid", gridTemplateColumns: "2fr 1.2fr 1fr 1fr 0.8fr 0.7fr 80px",
                padding: "14px 20px", alignItems: "center",
                borderBottom: i < deals.length - 1 ? `1px solid ${T.bg4}33` : "none",
                transition: "background 0.15s",
                cursor: "pointer",
              }}
              onMouseOver={(e) => (e.currentTarget.style.background = `${T.bg4}22`)}
              onMouseOut={(e) => (e.currentTarget.style.background = "transparent")}
              onClick={() => setSelectedDeal(deal)}>
                <span style={{ fontSize: 13, fontWeight: 600, color: T.text0 }}>{deal.title}</span>
                <span style={{ fontSize: 12, color: T.text2 }}>{deal.contact}</span>
                <span style={{ fontSize: 14, fontWeight: 700, color: T.text0, fontFamily: "'Inter', -apple-system, sans-serif" }}>{fmt(deal.value)}</span>
                <span>
                  <span style={{
                    fontSize: 10, padding: "3px 10px", borderRadius: T.radius.full,
                    background: `${color}15`, color, fontWeight: 600,
                    border: `1px solid ${color}33`,
                  }}>{deal.stage}</span>
                </span>
                <span>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ flex: 1, height: 3, borderRadius: 2, background: T.bg4 }}>
                      <div style={{ height: "100%", borderRadius: 2, background: color, width: `${deal.probability}%` }} />
                    </div>
                    <span style={{ fontSize: 11, color: T.text3, fontWeight: 600, minWidth: 30 }}>{deal.probability}%</span>
                  </div>
                </span>
                <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: isAtRisk ? T.orange : T.green, fontWeight: 600 }}>
                  <div style={{ width: 6, height: 6, borderRadius: "50%", background: isAtRisk ? T.orange : T.green, boxShadow: `0 0 6px ${isAtRisk ? T.orange : T.green}44` }} />
                  {isAtRisk ? "Risk" : "Good"}
                </span>
                <span style={{ display: "flex", gap: 4, justifyContent: "flex-end" }}>
                  {!["Closed Won", "Closed Lost"].includes(deal.stage) && (
                    <button onClick={(e) => { e.stopPropagation(); onDealStageChange(deal.id, STAGES[STAGES.indexOf(deal.stage) + 1]); }} style={{
                      background: `${color}15`, border: `1px solid ${color}33`, borderRadius: T.radius.sm,
                      color, cursor: "pointer", fontSize: 10, padding: "4px 10px", fontWeight: 600,
                    }}>→</button>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      ) : (
        /* ═══ DESKTOP KANBAN (Apple command center) ═══ */
        <div style={{ display: "flex", gap: 10, overflowX: "auto", paddingBottom: 16 }}>
          {STAGES.map(stage => {
            const stageDeals = deals.filter(d => d.stage === stage);
            const stageValue = stageDeals.reduce((s, d) => s + d.value, 0);
            const color = getStageColor(stage) || T.bg4;
            const isDropping = dropTarget === stage;

            return (
              <div
                key={stage}
                onDragOver={(e) => handleDragOver(e, stage)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, stage)}
                style={{
                  minWidth: 220, flex: "1 0 220px",
                  borderRadius: T.radius.xl,
                  padding: 8,
                  transition: "all 0.25s cubic-bezier(0.4, 0, 0.2, 1)",
                  background: isDropping ? `${color}08` : "transparent",
                  boxShadow: isDropping ? `inset 0 0 0 2px ${color}33, 0 0 24px ${color}11` : "none",
                }}
              >
                {/* Column header */}
                <div style={{
                  ...glassSubtle,
                  padding: "12px 14px",
                  marginBottom: 8,
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{
                      width: 8, height: 8, borderRadius: "50%",
                      background: color,
                      boxShadow: `0 0 8px ${color}55`,
                    }} />
                    <span style={{ fontSize: 12, fontWeight: 700, color: T.text1, letterSpacing: "-0.01em" }}>{stage}</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{
                      fontSize: 10, fontWeight: 700, color,
                      background: `${color}12`, padding: "2px 8px",
                      borderRadius: T.radius.full,
                    }}>{stageDeals.length}</span>
                  </div>
                </div>

                {/* Stage value */}
                <div style={{
                  fontSize: 12, color: T.text3, marginBottom: 8, padding: "0 6px",
                  fontWeight: 600,
                  fontFamily: "'Inter', -apple-system, sans-serif",
                }}>
                  {fmt(stageValue)}
                </div>

                {/* Deal cards */}
                <div style={{ display: "flex", flexDirection: "column", gap: 8, minHeight: 60 }}>
                  {stageDeals.map(deal => (
                    <DealCard key={deal.id} deal={deal} stage={stage} color={color} />
                  ))}
                  {stageDeals.length === 0 && (
                    <div className="crm-panel-enter" style={{
                      padding: "28px 12px", textAlign: "center",
                      color: isDropping ? color : T.text3,
                      fontSize: 11, fontWeight: 500,
                      border: `1.5px dashed ${isDropping ? `${color}66` : T.bg4}`,
                      borderRadius: T.radius.lg,
                      transition: "all 0.2s",
                      background: isDropping ? `${color}06` : "transparent",
                    }}>
                      <div style={{ fontSize: 20, marginBottom: 6, opacity: 0.4 }}>{isDropping ? "⬇️" : "📊"}</div>
                      {isDropping ? "Drop here" : "No deals yet"}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ═══ PIPELINE VELOCITY ═══ */}
      <VelocityMetrics deals={deals} stages={STAGES} />
    </div>
  );
}