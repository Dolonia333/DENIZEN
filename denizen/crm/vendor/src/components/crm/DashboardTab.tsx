// REFACTORED: Complete dashboard redesign — KPI cards with accent bars & trends,
// pill-style action bar, semantic status badges, enhanced follow-ups/tasks/at-risk/notes panels
import { lazy, Suspense, useMemo, useState } from "react";
import { T, S, fmt, STAGE_COLORS, calcLeadScore, type Contact, type Deal, type Task, type Note, type Meeting, type Goal, type AuditEntry, type EmailLogEntry } from "@/lib/crm-data";
import { useCRMTranslation } from "@/hooks/use-crm-translation";
import { GoalsPanel } from "./GoalsPanel";
import { DashboardEmptyState } from "./shared/DashboardEmptyState";
import { MyDayPanel } from "./MyDayPanel";

const PANEL_SCROLL: React.CSSProperties = { maxHeight: 400, overflowY: "auto" };

const DashboardCharts = lazy(() =>
  import("./DashboardCharts").then((m) => ({ default: m.DashboardCharts })),
);

interface Props {
  contacts: Contact[];
  deals: Deal[];
  tasks: Task[];
  notes: Note[];
  meetings: Meeting[];
  goals?: Goal[];
  auditLog?: AuditEntry[];
  emailLog?: EmailLogEntry[];
  onNavigate: (tab: string) => void;
  onCompose?: (seed: { contactId?: number; body?: string; subject?: string }) => void;
  onAddNote?: (note: Omit<Note, "id">) => void;
  onSnoozeContact?: (contactId: number, days: number) => void;
}

export function DashboardTab({ contacts, deals, tasks, notes, meetings, goals = [], auditLog = [], emailLog = [], onNavigate, onCompose, onAddNote, onSnoozeContact }: Props) {
  const { t } = useCRMTranslation();
  const openDeals = deals.filter(d => !["Closed Won", "Closed Lost"].includes(d.stage));
  const pipelineValue = openDeals.reduce((s, d) => s + d.value, 0);
  const weightedPipeline = openDeals.reduce((s, d) => s + d.value * d.probability / 100, 0);
  const wonDeals = deals.filter(d => d.stage === "Closed Won");
  const wonValue = wonDeals.reduce((s, d) => s + d.value, 0);
  const dueTasks = tasks.filter(t => !t.done);
  const atRisk = deals.filter(d => d.health === "at-risk");

  const [draftingFor, setDraftingFor] = useState<string | null>(null);
  const [draftText, setDraftText] = useState("");
  const [hoveredFollowUp, setHoveredFollowUp] = useState<string | null>(null);
  const [expandedNote, setExpandedNote] = useState<number | null>(null);
  const [quickNoteOpen, setQuickNoteOpen] = useState(false);
  const [quickNoteText, setQuickNoteText] = useState("");
  const [taskSlideOver, setTaskSlideOver] = useState(false);

  // Smart follow-up reminders
  const followUpReminders = useMemo(() => {
    const now = new Date();
    return openDeals
      .map(deal => {
        const contact = contacts.find(c => c.name === deal.contact);
        if (!contact) return null;
        const lastDate = new Date(contact.lastContact);
        const daysSince = Math.floor((now.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24));
        if (daysSince < 7) return null;
        return { deal, contact, daysSince };
      })
      .filter(Boolean) as { deal: Deal; contact: Contact; daysSince: number }[];
  }, [openDeals, contacts]);

  const topScoredLeads = useMemo(() => {
    return contacts
      .filter((c) => c.status !== "Customer")
      .map((c) => ({ contact: c, score: calcLeadScore(c, emailLog, deals, notes, tasks) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 12);
  }, [contacts, emailLog, deals, notes, tasks]);

  const generateDraft = (contact: Contact, deal: Deal, daysSince: number) => {
    setDraftingFor(contact.name);
    setDraftText(
      `Hi ${contact.name.split(" ")[0]},\n\nI wanted to check in on our ${deal.title} discussion — it's been about ${daysSince} days since we last connected. I'd love to keep things moving and see if you have any questions about the ${deal.stage.toLowerCase()} stage.\n\nWould you have 15 minutes this week for a quick call?\n\nBest regards`
    );
  };

  // Meeting prep cards
  const [prepDraft, setPrepDraft] = useState<string | null>(null);
  const [prepDraftText, setPrepDraftText] = useState("");
  const meetingPrepCards = useMemo(() => {
    const now = new Date();
    const soon = new Date(now.getTime() + 30 * 60000);
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    return (meetings || [])
      .filter(m => {
        if (m.date !== todayStr) return false;
        const mTime = new Date(`${m.date}T${m.time}:00`);
        return mTime > now && mTime <= soon;
      })
      .map(m => {
        const contact = contacts.find(c => c.name === m.contact);
        const deal = deals.find(d => d.contact === m.contact && !["Closed Won", "Closed Lost"].includes(d.stage));
        const lastNote = notes.find(n => n.contact === m.contact);
        return { meeting: m, contact, deal, lastNote };
      });
  }, [meetings, contacts, deals, notes]);

  const generatePrepDraft = (prep: { meeting: Meeting; contact?: Contact; deal?: Deal }) => {
    const name = prep.contact?.name.split(" ")[0] || "there";
    const dealInfo = prep.deal ? `regarding ${prep.deal.title} (${prep.deal.stage}, ${fmt(prep.deal.value)})` : "";
    setPrepDraft(prep.meeting.title);
    setPrepDraftText(
      `Hi ${name},\n\nLooking forward to our ${prep.meeting.title} today${dealInfo ? " " + dealInfo : ""}.\n\nBest regards`
    );
  };

  // KPI stats with accent colors and trend indicators
  const recentWins = wonDeals.filter((d) => {
    const days = Math.floor((Date.now() - new Date(d.closeDate || "").getTime()) / 86400000);
    return days >= 0 && days <= 30;
  }).length;
  const recentContacts = contacts.filter((c) => {
    const days = Math.floor((Date.now() - new Date(c.lastContact || "").getTime()) / 86400000);
    return days <= 7;
  }).length;

  const pipelineLabel = t("pipelineValue");
  const dealsLabel = t("deals").toLowerCase();
  const contactsLabel = t("contacts");
  const customersLabel = t("customers").toLowerCase();

  const stats: { label: string; value: string; sub: string; accentColor: string; trend: string; trendDir: "up" | "down" | "neutral" }[] = [
    { label: pipelineLabel, value: fmt(pipelineValue), sub: `${openDeals.length} open ${dealsLabel}`, accentColor: "#4d9ef7", trend: openDeals.length ? `${openDeals.length} active` : "—", trendDir: "neutral" },
    { label: "Weighted Pipeline", value: fmt(weightedPipeline), sub: "probability-adjusted", accentColor: "#8b5cf6", trend: `${Math.round((weightedPipeline / Math.max(pipelineValue, 1)) * 100)}% wt`, trendDir: "neutral" },
    { label: "Closed Won", value: fmt(wonValue), sub: `${wonDeals.length} ${dealsLabel}`, accentColor: "#22d3a0", trend: recentWins ? `+${recentWins} / 30d` : "—", trendDir: recentWins ? "up" : "neutral" },
    { label: contactsLabel, value: String(contacts.length), sub: `${contacts.filter(c => c.status === "Customer").length} ${customersLabel}`, accentColor: "#14b8a6", trend: recentContacts ? `${recentContacts} touched / 7d` : "—", trendDir: recentContacts ? "up" : "neutral" },
  ];

  // Stage funnel data
  const stageData = useMemo(() => {
    const stages = ["Lead", "Qualified", "Proposal", "Negotiation", "Closed Won"];
    return stages.map(s => ({
      name: s.replace("Closed ", ""),
      value: deals.filter(d => d.stage === s).reduce((sum, d) => sum + d.value, 0),
      count: deals.filter(d => d.stage === s).length,
      fill: STAGE_COLORS[s] || T.bg4,
    }));
  }, [deals]);

  // Revenue trend
  const revenueTrend = useMemo(() => {
    const now = new Date();
    const months: { month: string; revenue: number; pipeline: number }[] = [];
    for (let i = 5; i >= 0; i -= 1) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const label = d.toLocaleString("en-US", { month: "short" });
      const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const revenue = wonDeals
        .filter((deal) => String(deal.closeDate || "").startsWith(ym))
        .reduce((s, deal) => s + (deal.value || 0), 0);
      const pipeline = deals
        .filter((deal) => !["Closed Won", "Closed Lost"].includes(deal.stage))
        .reduce((s, deal) => s + (deal.value || 0) * (deal.probability || 25) / 100, 0);
      months.push({ month: label, revenue, pipeline: Math.round(pipeline / 6) });
    }
    return months;
  }, [wonDeals, deals]);

  // Deal health pie
  const healthData = useMemo(() => {
    const good = deals.filter(d => d.health === "good" && !["Closed Won", "Closed Lost"].includes(d.stage)).length;
    const risk = deals.filter(d => d.health === "at-risk").length;
    return [
      { name: "Healthy", value: good, fill: T.green },
      { name: "At Risk", value: risk, fill: T.red },
    ].filter(d => d.value > 0);
  }, [deals]);

  const cardStyle = {
    background: `linear-gradient(145deg,${T.bg2},${T.bg3}88)`,
    border: `1px solid ${T.bg4}`, borderRadius: T.radius.lg, padding: "20px 22px",
  };

  // Quick actions — pill style
  const quickActions = [
    { id: "create-contact", icon: "👤", label: `Create ${t("contact")}`, tab: "contacts", style: "secondary" as const },
    { id: "launch-pipeline", icon: "💰", label: `Launch ${t("pipeline")}`, tab: "pipeline", style: "primary" as const },
    { id: "view-tasks", icon: "📋", label: "View Tasks", tab: "tasks", style: "ghost" as const },
    { id: "open-analytics", icon: "📊", label: "Open Analytics", tab: "analytics", style: "ghost" as const },
    { id: "schedule-meeting", icon: "📅", label: "Schedule Meeting", tab: "schedule", style: "ghost" as const },
    { id: "sales-hub", icon: "🏢", label: t("salesHub"), tab: "hub", style: "ghost" as const },
  ];

  // Today's summary
  const todayStr = new Date().toISOString().split("T")[0];
  const todayMeetings = (meetings || []).filter(m => m.date === todayStr);
  const overdueTasks = tasks.filter(t => !t.done && t.due < todayStr);

  const getUrgencyColor = (days: number) => {
    if (days > 21) return T.text3;
    if (days >= 14) return T.orange || T.text3;
    return T.text2;
  };

  const getTaskDotColor = (task: Task) => {
    if (task.done) return T.green;
    const today = todayStr;
    if (task.due < today) return T.orange || T.text3;
    if (task.due === today) return T.text3;
    return T.text3;
  };

  // Relative time helper
  const relativeTime = (dateStr: string) => {
    const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
    if (diff === 0) return "Today";
    if (diff === 1) return "Yesterday";
    if (diff < 7) return `${diff} days ago`;
    return dateStr;
  };

  return (
    <div>
      {/* Header + Status Bar */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: T.text0, letterSpacing: "-0.02em", margin: 0 }}>Dashboard</h1>
          <p style={{ fontSize: 13, color: T.text2, marginTop: 4 }}>
            Your {t("pipeline").toLowerCase()} overview at a glance
          </p>
        </div>
        {/* REFACTORED: Persistent status bar with semantic colors and linked filters */}
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
          <button onClick={() => onNavigate("schedule")} style={{
            display: "flex", alignItems: "center", gap: 6, padding: "6px 12px",
            borderRadius: T.radius.md, background: `${T.text3}11`, border: `1px solid ${T.text3}22`,
            fontSize: 11, color: T.text2, fontWeight: 600, cursor: "pointer",
          }}>
            📅 <span style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 800 }}>{todayMeetings.length}</span> Meetings
          </button>
          <button onClick={() => onNavigate("tasks")} style={{
            display: "flex", alignItems: "center", gap: 6, padding: "6px 12px",
            borderRadius: T.radius.md,
            background: overdueTasks.length > 0 ? `${T.orange || T.text3}18` : `${T.green}11`,
            border: `1px solid ${overdueTasks.length > 0 ? `${T.orange || T.text3}33` : `${T.green}22`}`,
            fontSize: 11, color: overdueTasks.length > 0 ? (T.orange || T.text3) : T.green, fontWeight: 600, cursor: "pointer",
          }}>
            📋 <span style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 800 }}>{overdueTasks.length}</span> Overdue
          </button>
          <button onClick={() => onNavigate("sales")} style={{
            display: "flex", alignItems: "center", gap: 6, padding: "6px 12px",
            borderRadius: T.radius.md,
            background: atRisk.length > 0 ? `${T.red}18` : `${T.green}11`,
            border: `1px solid ${atRisk.length > 0 ? `${T.red}33` : `${T.green}22`}`,
            fontSize: 11, color: atRisk.length > 0 ? T.red : T.green, fontWeight: 600, cursor: "pointer",
          }}>
            ⚠️ <span style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 800 }}>{atRisk.length}</span> At Risk
          </button>
        </div>
      </div>

      <MyDayPanel onNavigate={onNavigate} />

      <GoalsPanel goals={goals} deals={deals} contacts={contacts} onNavigate={onNavigate} />

      {/* REFACTORED: Pill-style Quick Actions Bar */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16, overflowX: "auto", padding: "2px 0" }}>
        {quickActions.map(a => {
          const isPrimary = a.style === "primary";
          const isSecondary = a.style === "secondary";
          return (
            <button key={a.id} type="button" onClick={() => onNavigate(a.tab)} style={{
              display: "flex", alignItems: "center", gap: 7, padding: "0 16px",
              height: 36, borderRadius: 999,
              background: isPrimary ? `linear-gradient(135deg,${T.accent},#d97706)` : "transparent",
              border: isPrimary ? "none" : isSecondary ? `1px solid ${T.accent}66` : `0.5px solid ${T.bg4}`,
              color: isPrimary ? "#080d18" : isSecondary ? T.accent : T.text2,
              fontSize: 12, fontWeight: isPrimary ? 700 : 500, cursor: "pointer",
              transition: "all 0.15s", whiteSpace: "nowrap", flexShrink: 0,
            }}
            onMouseEnter={e => {
              if (!isPrimary) {
                e.currentTarget.style.background = isSecondary ? `${T.accent}14` : `${T.bg3}`;
                e.currentTarget.style.borderColor = isSecondary ? T.accent : `${T.text3}44`;
              }
            }}
            onMouseLeave={e => {
              if (!isPrimary) {
                e.currentTarget.style.background = "transparent";
                e.currentTarget.style.borderColor = isSecondary ? `${T.accent}66` : T.bg4;
              }
            }}
            >
              <span style={{ fontSize: 14 }}>{a.icon}</span> {a.label}
            </button>
          );
        })}
      </div>

      <div className="crm-stats-grid" style={{ display: "grid", gap: 14, marginBottom: 14 }}>
        {stats.map((s, i) => (
          <div key={s.label} className="crm-card-hover" style={{
            ...cardStyle, position: "relative", overflow: "hidden",
            animationDelay: `${i * 0.05}s`, paddingTop: 23,
          }}>
            <div style={{
              position: "absolute", top: 0, left: 0, right: 0, height: 3,
              background: s.accentColor,
            }} />
            <div style={{
              fontSize: 11, color: T.text3, fontWeight: 600, textTransform: "uppercase",
              letterSpacing: "0.08em", marginBottom: 8,
            }}>{s.label}</div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <div style={{
                fontSize: 28, fontWeight: 600, color: T.text0,
                letterSpacing: "-0.02em", lineHeight: 1,
              }}>{s.value}</div>
              <span style={{
                fontSize: 11, fontWeight: 600, padding: "2px 6px", borderRadius: 4,
                background: s.trendDir === "up" ? `${T.green}18` : s.trendDir === "down" ? `${T.red}18` : `${T.text3}14`,
                color: s.trendDir === "up" ? T.green : s.trendDir === "down" ? T.red : T.text3,
              }}>
                {s.trendDir === "up" ? "↑" : s.trendDir === "down" ? "↓" : "—"} {s.trend !== "—" ? s.trend : ""}
              </span>
            </div>
            <div style={{ fontSize: 12, color: T.text3, marginTop: 6 }}>{s.sub}</div>
          </div>
        ))}
      </div>

      {/* REFACTORED: Follow-Up Reminders with urgency colors and hover micro-actions */}
      <div style={{ marginBottom: 14 }}>
        <div style={cardStyle}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 16 }}>🔔</span>
              <div style={{ fontSize: 14, fontWeight: 600, color: T.text0 }}>Follow-Up Reminders</div>
              {followUpReminders.length > 0 && (
                <span style={{ fontSize: 11, color: T.bg1, background: T.orange || T.accent, borderRadius: 10, padding: "2px 8px", fontWeight: 700 }}>
                  {followUpReminders.length}
                </span>
              )}
            </div>
            <span style={{ fontSize: 11, color: T.text3 }}>Not touched in 7+ days</span>
          </div>

          {followUpReminders.length === 0 ? (
            <DashboardEmptyState
              icon="🎉"
              title="All caught up!"
              subtitle={`No follow-ups pending. Log an interaction on an active ${t("deal").toLowerCase()} to keep your momentum going.`}
            />
          ) : (
            <div style={PANEL_SCROLL}>
              {followUpReminders.map(({ deal, contact, daysSince }) => {
                const urgencyColor = getUrgencyColor(daysSince);
                const rowKey = `${contact.id}-${deal.id}`;
                const isHovered = hoveredFollowUp === rowKey;
                return (
                  <div key={rowKey}
                    className="crm-followup-row"
                    tabIndex={0}
                    onMouseEnter={() => setHoveredFollowUp(rowKey)}
                    onMouseLeave={() => setHoveredFollowUp(null)}
                    onFocus={() => setHoveredFollowUp(rowKey)}
                    onBlur={(e) => {
                      if (!e.currentTarget.contains(e.relatedTarget as Node)) setHoveredFollowUp(null);
                    }}
                    style={{
                      display: "flex", alignItems: "center", gap: 12, padding: "10px 12px",
                      borderRadius: T.radius.md, marginBottom: 6,
                      background: `${T.bg3}88`,
                      border: `1px solid ${T.bg4}`,
                      transition: "all 0.15s",
                    }}>
                    <div style={{
                      width: 36, height: 36, borderRadius: T.radius.full,
                      background: `linear-gradient(135deg, ${T.accent}44, ${T.purple}44)`,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 14, fontWeight: 700, color: T.text0, flexShrink: 0,
                    }}>
                      {contact.name.split(" ").map(n => n[0]).join("")}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: T.text0 }}>{contact.name}</div>
                      <div style={{ fontSize: 11, color: T.text2, marginTop: 2 }}>
                        {deal.title} · {deal.stage} · {fmt(deal.value)}
                      </div>
                    </div>
                    <div style={{ textAlign: "right", flexShrink: 0, marginRight: isHovered ? 0 : 8 }}>
                      <div style={{ fontSize: 18, fontWeight: 800, color: urgencyColor, fontFamily: "'JetBrains Mono', monospace" }}>
                        {daysSince}d
                      </div>
                      <div style={{ fontSize: 9, color: urgencyColor, textTransform: "uppercase", fontWeight: 600, letterSpacing: "0.06em" }}>ago</div>
                    </div>
                    {isHovered ? (
                      <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                        {[
                          { label: "Draft Email", icon: "✉", action: () => generateDraft(contact, deal, daysSince) },
                          { label: "Log Call", icon: "📞", action: () => onAddNote?.({ contact: contact.name, text: `Call logged from dashboard follow-up (${deal.title})`, date: new Date().toISOString().slice(0, 10), type: "Call" }) },
                          { label: "Snooze", icon: "💤", action: () => onSnoozeContact?.(contact.id, 7) },
                        ].map(btn => (
                          <button key={btn.label} type="button" onClick={btn.action} title={btn.label} style={{
                            background: T.bg3, border: `1px solid ${T.bg5}`, borderRadius: T.radius.sm,
                            padding: "4px 8px", fontSize: 11, color: T.text1, cursor: "pointer",
                            whiteSpace: "nowrap", fontWeight: 600,
                          }}>
                            {btn.icon} {btn.label}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}

          {draftingFor && (
            <div style={{
              marginTop: 12, padding: 16, borderRadius: T.radius.md,
              background: T.bg1, border: `1px solid ${T.accent}33`,
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: T.accent }}>✉ Draft to {draftingFor}</div>
                <button onClick={() => setDraftingFor(null)} style={{ background: "none", border: "none", color: T.text3, cursor: "pointer", fontSize: 16 }}>×</button>
              </div>
              <textarea
                value={draftText}
                onChange={e => setDraftText(e.target.value)}
                style={{
                  width: "100%", minHeight: 120, background: T.bg2, color: T.text1,
                  border: `1px solid ${T.bg4}`, borderRadius: T.radius.md,
                  padding: 12, fontSize: 12, fontFamily: "inherit", resize: "vertical",
                }}
              />
              <div style={{ display: "flex", gap: 8, marginTop: 10, justifyContent: "flex-end" }}>
                <button onClick={() => setDraftingFor(null)} style={{
                  background: T.bg3, color: T.text2, border: `1px solid ${T.bg4}`,
                  borderRadius: T.radius.md, padding: "6px 16px", fontSize: 12, cursor: "pointer",
                }}>Cancel</button>
                <button onClick={() => {
                  const c = contacts.find((x) => x.name === draftingFor);
                  onCompose?.({ contactId: c?.id, subject: `Following up`, body: draftText });
                  setDraftingFor(null);
                }} style={{
                  background: T.accent, color: "#fff", border: "none",
                  borderRadius: T.radius.md, padding: "6px 16px", fontSize: 12, fontWeight: 600, cursor: "pointer",
                }}>Send Follow-Up Email</button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* REFACTORED: Tasks + At Risk + Recent Notes panels */}
      <div className="crm-dashboard-grid" style={{ display: "grid", gap: 14, marginBottom: 14 }}>
        {/* Tasks Due Panel */}
        <div style={{ ...cardStyle, flex: 1 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: T.text0 }}>Tasks Due ({dueTasks.length})</div>
            <button onClick={() => setTaskSlideOver(true)} style={{ fontSize: 11, color: T.accent, background: "none", border: "none", cursor: "pointer" }}>All tasks →</button>
          </div>
          {dueTasks.length === 0 ? (
            <div style={{ textAlign: "center", padding: "24px 12px", color: T.text3, fontSize: 13, lineHeight: 1.5 }}>
              🎉 All caught up! Create a new task to keep your momentum going.
            </div>
          ) : (
            <div style={PANEL_SCROLL}>
              {dueTasks.map((task) => {
                const dotColor = getTaskDotColor(task);
                return (
                  <div key={task.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: `1px solid ${T.bg3}`, position: "relative" }}
                    className="crm-task-row"
                  >
                    <div style={{ width: 8, height: 8, borderRadius: T.radius.full, background: dotColor, flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontSize: 13, color: T.text1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{task.title}</span>
                        <span style={{
                          fontSize: 10, padding: "2px 6px", borderRadius: 4,
                          background: `${dotColor}18`, color: dotColor, fontWeight: 600,
                          whiteSpace: "nowrap", flexShrink: 0,
                        }}>
                          {new Date(task.due).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                        </span>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 3 }}>
                        {task.assignee && (
                          <div style={{
                            width: 20, height: 20, borderRadius: T.radius.full,
                            background: `linear-gradient(135deg,${T.purple}44,${T.bg4})`,
                            display: "flex", alignItems: "center", justifyContent: "center",
                            fontSize: 8, fontWeight: 700, color: T.text1, flexShrink: 0,
                          }}>
                            {task.assignee.split(" ").map(n => n[0]).join("")}
                          </div>
                        )}
                        <span style={{ fontSize: 11, color: T.text2 }}>{task.assignee || task.contact}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div style={{ ...cardStyle, flex: 1 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: T.text0 }}>Top Scored {t("contacts")}</div>
            <button onClick={() => onNavigate("sales")} style={{ fontSize: 11, color: T.accent, background: "none", border: "none", cursor: "pointer" }}>Lead scoring →</button>
          </div>
          {topScoredLeads.length === 0 ? (
            <DashboardEmptyState
              icon="🎯"
              title="No leads to score yet"
              subtitle={`Add ${t("contacts").toLowerCase()} to see AI-weighted lead scores on your dashboard.`}
            />
          ) : (
            <div style={PANEL_SCROLL}>
              {topScoredLeads.map(({ contact, score }, i) => {
                const barColor = score >= 75 ? T.green : score >= 50 ? T.accent : T.text3;
                return (
                  <div key={contact.id} style={{
                    display: "flex", alignItems: "center", gap: 10, padding: "10px 0",
                    borderBottom: `1px solid ${T.bg3}`,
                  }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: T.text3, width: 22, fontFamily: "'JetBrains Mono', monospace" }}>#{i + 1}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: T.text0 }}>{contact.name}</div>
                      <div style={{ fontSize: 11, color: T.text2 }}>{contact.company}</div>
                      <div style={{ marginTop: 6, height: 5, background: T.bg4, borderRadius: 3, overflow: "hidden" }}>
                        <div style={{ height: "100%", width: `${score}%`, background: barColor, borderRadius: 3, transition: "width 0.4s ease" }} />
                      </div>
                    </div>
                    <span style={{ fontSize: 14, fontWeight: 700, color: barColor, fontFamily: "'JetBrains Mono', monospace", minWidth: 32, textAlign: "right" }}>{score}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Right column: At Risk + Recent Notes */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {/* REFACTORED: At Risk panel with risk reason tags and action dropdown */}
          {atRisk.length > 0 ? (
            <div style={{ background: `linear-gradient(145deg,${T.redDim},${T.bg2})`, border: `1px solid ${T.red}33`, borderRadius: T.radius.lg, padding: "16px 20px" }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: T.red, marginBottom: 10 }}>⚠ At Risk ({atRisk.length})</div>
              {atRisk.map(d => (
                <AtRiskDeal key={d.id} deal={d} contacts={contacts} onNavigate={onNavigate} onCompose={onCompose} onAddNote={onAddNote} />
              ))}
            </div>
          ) : (
            <div style={{ ...cardStyle, display: "flex", alignItems: "center", gap: 10, justifyContent: "center", padding: "20px" }}>
              <span style={{ fontSize: 20, color: T.green }}>✓</span>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: T.green }}>All deals healthy</div>
                <div style={{ fontSize: 11, color: T.text3 }}>No at-risk deals right now</div>
              </div>
            </div>
          )}

          {/* REFACTORED: Recent Notes with author avatar, quick-add, inline expand */}
          <div style={cardStyle}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: T.text0 }}>Recent Notes</div>
              <button onClick={() => setQuickNoteOpen(p => !p)} style={{
                background: T.bg3, border: `1px solid ${T.bg5}`, borderRadius: T.radius.sm,
                padding: "3px 8px", fontSize: 12, color: T.accent, cursor: "pointer", fontWeight: 600,
              }}>+ Note</button>
            </div>
            {quickNoteOpen && (
              <div style={{ marginBottom: 10 }}>
                <textarea
                  value={quickNoteText}
                  onChange={e => setQuickNoteText(e.target.value)}
                  placeholder="Quick note..."
                  style={{
                    width: "100%", minHeight: 60, background: T.bg3, color: T.text1,
                    border: `1px solid ${T.bg5}`, borderRadius: T.radius.md,
                    padding: 10, fontSize: 12, fontFamily: "inherit", resize: "vertical",
                  }}
                />
                <div style={{ display: "flex", gap: 6, marginTop: 6, justifyContent: "flex-end" }}>
                  <button onClick={() => { setQuickNoteOpen(false); setQuickNoteText(""); }} style={{ ...S.btnGhost, fontSize: 11, padding: "4px 10px" }}>Cancel</button>
                  <button onClick={() => {
                    if (quickNoteText.trim()) {
                      onAddNote?.({ contact: contacts[0]?.name || "", text: quickNoteText.trim(), date: new Date().toISOString().slice(0, 10), type: "Note" });
                    }
                    setQuickNoteOpen(false);
                    setQuickNoteText("");
                  }} style={{ ...S.btn, fontSize: 11, padding: "4px 10px" }}>Log Interaction</button>
                </div>
              </div>
            )}
            {notes.slice(0, 3).map(n => (
              <div key={n.id}
                onClick={() => setExpandedNote(expandedNote === n.id ? null : n.id)}
                style={{ padding: "8px 0", borderBottom: `1px solid ${T.bg3}`, cursor: "pointer" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                  {/* Author avatar */}
                  <div style={{
                    width: 20, height: 20, borderRadius: T.radius.full,
                    background: `linear-gradient(135deg,${T.accent}44,${T.bg4})`,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 8, fontWeight: 700, color: T.text1, flexShrink: 0,
                  }}>JD</div>
                  <span style={{ fontSize: 11, color: T.blue, fontWeight: 500 }}>{n.contact}</span>
                  <span style={{ fontSize: 10, color: T.text3, marginLeft: "auto" }}>{relativeTime(n.date)}</span>
                </div>
                <div style={{
                  fontSize: 12, color: T.text2,
                  overflow: expandedNote === n.id ? "visible" : "hidden",
                  textOverflow: expandedNote === n.id ? "unset" : "ellipsis",
                  whiteSpace: expandedNote === n.id ? "normal" : "nowrap",
                }}>
                  {expandedNote === n.id ? n.text : n.text.slice(0, 80) + (n.text.length > 80 ? "…" : "")}
                </div>
              </div>
            ))}
            {notes.length === 0 && (
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "16px 0", justifyContent: "center" }}>
                <span style={{ fontSize: 20, opacity: 0.4 }}>📝</span>
                <div style={{ fontSize: 12, color: T.text3 }}>No notes yet</div>
              </div>
            )}
          </div>
        </div>
      </div>

      <Suspense fallback={
        <div style={{ ...cardStyle, marginBottom: 14, color: T.text3, fontSize: 12, textAlign: "center" }}>
          Loading charts…
        </div>
      }>
        <DashboardCharts
          cardStyle={cardStyle}
          revenueTrend={revenueTrend}
          stageData={stageData}
          healthData={healthData}
          pipelineValue={pipelineValue}
          weightedPipeline={weightedPipeline}
          wonValue={wonValue}
          openDealsCount={openDeals.length}
          onNavigate={onNavigate}
        />
      </Suspense>

      {/* Meeting Prep Cards */}
      {meetingPrepCards.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div style={cardStyle}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
              <span style={{ fontSize: 16 }}>🎯</span>
              <div style={{ fontSize: 14, fontWeight: 600, color: T.text0 }}>Meeting Prep</div>
              <span style={{ fontSize: 11, color: T.bg1, background: T.purple, borderRadius: 10, padding: "2px 8px", fontWeight: 700 }}>
                Starting soon
              </span>
            </div>
            {meetingPrepCards.map(prep => (
              <div key={prep.meeting.id} style={{
                padding: "14px 16px", background: `${T.purple}10`, border: `1px solid ${T.purple}22`,
                borderRadius: T.radius.md, marginBottom: 8, borderLeft: `3px solid ${T.purple}`,
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: T.text0 }}>{prep.meeting.title}</div>
                    <div style={{ fontSize: 11, color: T.text2, marginTop: 2 }}>
                      {prep.meeting.time} · {prep.meeting.duration}min · {prep.meeting.type}
                    </div>
                  </div>
                  <span style={{ fontSize: 10, background: `${T.orange}22`, color: T.orange, padding: "2px 8px", borderRadius: T.radius.xs, fontWeight: 600 }}>
                    Starting soon
                  </span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
                  {prep.contact && (
                    <div style={{ padding: "8px 10px", background: T.bg3, borderRadius: T.radius.sm }}>
                      <div style={{ fontSize: 9, color: T.text3, textTransform: "uppercase", fontWeight: 600, marginBottom: 4 }}>Contact</div>
                      <div style={{ fontSize: 12, color: T.text1, fontWeight: 600 }}>{prep.contact.name}</div>
                      <div style={{ fontSize: 10, color: T.text3 }}>{prep.contact.company}</div>
                    </div>
                  )}
                  {prep.deal && (
                    <div style={{ padding: "8px 10px", background: T.bg3, borderRadius: T.radius.sm }}>
                      <div style={{ fontSize: 9, color: T.text3, textTransform: "uppercase", fontWeight: 600, marginBottom: 4 }}>Open Deal</div>
                      <div style={{ fontSize: 12, color: T.accent, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>{fmt(prep.deal.value)}</div>
                      <div style={{ fontSize: 10, color: T.text3 }}>{prep.deal.stage}</div>
                    </div>
                  )}
                  {prep.lastNote && (
                    <div style={{ padding: "8px 10px", background: T.bg3, borderRadius: T.radius.sm, gridColumn: prep.contact && prep.deal ? "1 / -1" : undefined }}>
                      <div style={{ fontSize: 9, color: T.text3, textTransform: "uppercase", fontWeight: 600, marginBottom: 4 }}>Last Interaction</div>
                      <div style={{ fontSize: 11, color: T.text2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{prep.lastNote.text}</div>
                    </div>
                  )}
                </div>
                <button onClick={() => generatePrepDraft(prep)} style={{
                  ...S.btnPurple, fontSize: 11, padding: "6px 14px", width: "100%",
                }}>✨ Draft Opening Message</button>
              </div>
            ))}

            {prepDraft && (
              <div style={{ marginTop: 10, padding: 14, background: T.bg1, border: `1px solid ${T.purple}33`, borderRadius: T.radius.md }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: T.purple }}>✨ Opening for {prepDraft}</div>
                  <button onClick={() => setPrepDraft(null)} style={{ background: "none", border: "none", color: T.text3, cursor: "pointer", fontSize: 16 }}>×</button>
                </div>
                <textarea value={prepDraftText} onChange={e => setPrepDraftText(e.target.value)} style={{
                  width: "100%", minHeight: 100, background: T.bg2, color: T.text1,
                  border: `1px solid ${T.bg4}`, borderRadius: T.radius.md, padding: 10, fontSize: 12, fontFamily: "inherit", resize: "vertical",
                }} />
                <div style={{ display: "flex", gap: 8, marginTop: 8, justifyContent: "flex-end" }}>
                  <button onClick={() => setPrepDraft(null)} style={{ ...S.btnGhost, fontSize: 11, padding: "5px 12px" }}>Dismiss</button>
                  <button onClick={() => { navigator.clipboard.writeText(prepDraftText); setPrepDraft(null); }} style={{ ...S.btn, fontSize: 11, padding: "5px 12px" }}>📋 Copy & Close</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Task slide-over panel */}
      {taskSlideOver && (
        <div style={{ position: "fixed", inset: 0, zIndex: 1000, display: "flex", justifyContent: "flex-end" }}
          onClick={() => setTaskSlideOver(false)}>
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", backdropFilter: "blur(2px)" }} />
          <div onClick={e => e.stopPropagation()} className="animate-slide-in-right" style={{
            width: 480, maxWidth: "100vw", background: T.bg1, borderLeft: `1px solid ${T.bg4}`,
            height: "100vh", overflowY: "auto", padding: 24, position: "relative", zIndex: 1,
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <h2 style={{ fontSize: 18, fontWeight: 700, color: T.text0, margin: 0 }}>All Tasks</h2>
              <button onClick={() => setTaskSlideOver(false)} style={{ background: "none", border: "none", color: T.text3, fontSize: 20, cursor: "pointer" }}>✕</button>
            </div>
            {tasks.filter(t => !t.done).map(t => (
              <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderBottom: `1px solid ${T.bg3}` }}>
                <div style={{ width: 8, height: 8, borderRadius: T.radius.full, background: getTaskDotColor(t), flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, color: T.text1 }}>{t.title}</div>
                  <div style={{ fontSize: 11, color: T.text3 }}>{t.contact} · Due {t.due}</div>
                </div>
                <span style={{
                  fontSize: 10, padding: "2px 6px", borderRadius: 4,
                  background: `${getTaskDotColor(t)}18`, color: getTaskDotColor(t), fontWeight: 600,
                }}>
                  {new Date(t.due).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                </span>
              </div>
            ))}
            {tasks.filter(t => !t.done).length === 0 && (
              <div style={{ textAlign: "center", padding: 40, color: T.text3, fontSize: 13 }}>No open tasks</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// REFACTORED: At Risk deal sub-component with risk reason tag and action dropdown
function AtRiskDeal({ deal, contacts, onNavigate, onCompose, onAddNote }: {
  deal: Deal;
  contacts: Contact[];
  onNavigate: (tab: string) => void;
  onCompose?: (seed: { contactId?: number; body?: string; subject?: string }) => void;
  onAddNote?: (note: Omit<Note, "id">) => void;
}) {
  const [actionOpen, setActionOpen] = useState(false);
  const riskReason = deal.daysInStage > 14 ? "No recent activity" : "Flagged at-risk";

  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: `1px solid ${T.red}15` }}>
      <div>
        <div style={{ fontSize: 13, color: T.text1 }}>{deal.title}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 3 }}>
          <span style={{ fontSize: 11, color: T.text3 }}>{deal.daysInStage}d in {deal.stage}</span>
          <span style={{
            fontSize: 9, padding: "1px 6px", borderRadius: 3,
            background: `${T.red}18`, color: T.red, fontWeight: 600,
          }}>{riskReason}</span>
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: T.accent, fontFamily: "'JetBrains Mono', monospace" }}>{fmt(deal.value)}</div>
        <div style={{ position: "relative" }}>
          <button onClick={() => setActionOpen(p => !p)} style={{
            background: T.bg3, border: `1px solid ${T.bg5}`, borderRadius: T.radius.sm,
            padding: "4px 8px", fontSize: 10, color: T.text1, cursor: "pointer", fontWeight: 600,
          }}>Take action ▾</button>
          {actionOpen && (
            <div style={{
              position: "absolute", right: 0, top: "100%", marginTop: 4,
              background: T.bg2, border: `1px solid ${T.bg5}`, borderRadius: T.radius.md,
              padding: 4, zIndex: 10, minWidth: 140, boxShadow: T.shadow.elevated,
            }}>
              {[
                { label: "Log Call", action: () => onAddNote?.({ contact: deal.contact, text: `At-risk follow-up: ${deal.title}`, date: new Date().toISOString().slice(0, 10), type: "Call" }) },
                { label: "Draft Email", action: () => { const c = contacts.find((x) => x.name === deal.contact); onCompose?.({ contactId: c?.id, subject: `Re: ${deal.title}`, body: `Hi ${deal.contact},\n\nWanted to check in on ${deal.title}.\n\n` }); } },
                { label: "Schedule Meeting", action: () => onNavigate("schedule") },
                { label: "Update Stage", action: () => onNavigate("sales") },
              ].map(({ label: action, action: fn }) => (
                <button key={action} onClick={() => { fn(); setActionOpen(false); }} style={{
                  display: "block", width: "100%", textAlign: "left",
                  background: "none", border: "none", padding: "6px 10px",
                  fontSize: 11, color: T.text1, cursor: "pointer", borderRadius: T.radius.sm,
                }}
                onMouseEnter={e => e.currentTarget.style.background = T.bg3}
                onMouseLeave={e => e.currentTarget.style.background = "none"}
                >{action}</button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
