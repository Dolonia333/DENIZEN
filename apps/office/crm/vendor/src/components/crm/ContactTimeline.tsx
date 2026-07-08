import { useMemo } from "react";
import { T, fmt, badgeStyle, type Contact, type Deal, type Note, type Task, type EmailLogEntry, type Meeting, type AuditEntry } from "@/lib/crm-data";

interface TimelineEvent {
  id: string;
  type: "email" | "note" | "deal" | "task" | "meeting" | "stage_change" | "nps";
  icon: string;
  color: string;
  title: string;
  detail?: string;
  meta?: string;
  date: string;
  timestamp: number;
}

interface Props {
  contact: Contact;
  deals: Deal[];
  notes: Note[];
  tasks: Task[];
  emailLog: EmailLogEntry[];
  meetings: Meeting[];
  auditLog: AuditEntry[];
}

export function ContactTimeline({ contact, deals, notes, tasks, emailLog, meetings, auditLog }: Props) {
  const events = useMemo(() => {
    const all: TimelineEvent[] = [];

    // Notes (calls, emails, meetings logged)
    notes.filter(n => n.contact === contact.name).forEach(n => {
      const icons: Record<string, string> = { Call: "📞", Email: "📧", Meeting: "🤝", Note: "📝" };
      all.push({
        id: `note-${n.id}`, type: "note", icon: icons[n.type] || "📝",
        color: T.blue, title: `${n.type}: ${n.text.slice(0, 80)}${n.text.length > 80 ? "…" : ""}`,
        date: n.date, timestamp: new Date(n.date).getTime(),
      });
    });

    // Emails sent
    emailLog.filter(e => e.contactId === contact.id || e.to === contact.name).forEach(e => {
      const opens = e.opens?.length || 0;
      all.push({
        id: `email-${e.id}`, type: "email", icon: "✉️", color: T.accent,
        title: `Email: ${e.subject}`,
        detail: opens > 0 ? `Opened ${opens}× · ${e.clicks} clicks` : "Not opened yet",
        meta: e.tracked ? "Tracked" : undefined,
        date: e.sentAt.split("T")[0], timestamp: new Date(e.sentAt).getTime(),
      });
    });

    // Deals
    deals.filter(d => d.contact === contact.name).forEach(d => {
      all.push({
        id: `deal-${d.id}`, type: "deal", icon: "◆", color: T.accent,
        title: `Deal: ${d.title}`,
        detail: `${fmt(d.value)} · ${d.stage} · ${d.probability}% probability`,
        date: d.closeDate, timestamp: new Date(d.closeDate).getTime(),
      });
    });

    // Tasks
    tasks.filter(t => t.contact === contact.name).forEach(t => {
      all.push({
        id: `task-${t.id}`, type: "task", icon: t.done ? "✅" : "◇", color: T.purple,
        title: t.title,
        detail: `${t.priority} priority · ${t.done ? "Completed" : "Open"}`,
        date: t.due, timestamp: new Date(t.due).getTime(),
      });
    });

    // Meetings
    meetings.filter(m => m.contact === contact.name).forEach(m => {
      all.push({
        id: `meeting-${m.id}`, type: "meeting", icon: "📅", color: T.green,
        title: m.title,
        detail: `${m.type} · ${m.duration}min · ${m.status}`,
        date: m.date, timestamp: new Date(m.date).getTime(),
      });
    });

    // Audit log entries for this contact
    auditLog.filter(a => a.entityName === contact.name).forEach(a => {
      all.push({
        id: `audit-${a.id}`, type: "stage_change", icon: "🔄", color: T.orange,
        title: `${a.action} ${a.entity}`,
        detail: a.field ? `${a.field}: ${a.from} → ${a.to}` : undefined,
        date: a.at.split("T")[0], timestamp: new Date(a.at).getTime(),
      });
    });

    return all.sort((a, b) => b.timestamp - a.timestamp);
  }, [contact, deals, notes, tasks, emailLog, meetings, auditLog]);

  // Group by date
  const grouped = useMemo(() => {
    const map = new Map<string, TimelineEvent[]>();
    events.forEach(e => {
      const key = e.date;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(e);
    });
    return Array.from(map.entries());
  }, [events]);

  if (events.length === 0) {
    return (
      <div style={{ textAlign: "center", padding: 40, color: T.text3 }}>
        <div style={{ fontSize: 32, marginBottom: 12 }}>📭</div>
        <div style={{ fontSize: 14 }}>No activity recorded yet</div>
        <div style={{ fontSize: 12, marginTop: 4, opacity: 0.6 }}>Emails, calls, notes, and deals will appear here</div>
      </div>
    );
  }

  return (
    <div style={{ position: "relative" }}>
      {/* Vertical line */}
      <div style={{ position: "absolute", left: 15, top: 0, bottom: 0, width: 2, background: T.bg4, zIndex: 0 }} />

      {grouped.map(([date, evts]) => (
        <div key={date} style={{ marginBottom: 20 }}>
          {/* Date header */}
          <div style={{
            position: "relative", zIndex: 1,
            display: "flex", alignItems: "center", gap: 10, marginBottom: 10,
          }}>
            <div style={{
              width: 32, height: 20, borderRadius: T.radius.sm,
              background: T.bg3, border: `1px solid ${T.bg4}`,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 9, fontWeight: 700, color: T.text3, letterSpacing: "0.05em",
            }}>
              {new Date(date + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}
            </div>
            <div style={{ flex: 1, height: 1, background: T.bg4 }} />
          </div>

          {/* Events */}
          {evts.map((ev) => (
            <div key={ev.id} style={{
              display: "flex", gap: 12, padding: "8px 0", marginLeft: 0,
              position: "relative", zIndex: 1,
            }}>
              <div style={{
                width: 32, height: 32, borderRadius: T.radius.full,
                background: `${ev.color}18`, border: `1px solid ${ev.color}33`,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 14, flexShrink: 0,
              }}>
                {ev.icon}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, color: T.text1, lineHeight: 1.4 }}>{ev.title}</div>
                {ev.detail && <div style={{ fontSize: 11, color: T.text3, marginTop: 2 }}>{ev.detail}</div>}
                <div style={{ display: "flex", gap: 6, marginTop: 4, alignItems: "center" }}>
                  <span style={{
                    fontSize: 9, padding: "1px 6px", borderRadius: T.radius.sm,
                    background: `${ev.color}14`, color: ev.color, fontWeight: 600,
                    textTransform: "capitalize",
                  }}>{ev.type.replace("_", " ")}</span>
                  {ev.meta && <span style={{ fontSize: 9, color: T.text3 }}>· {ev.meta}</span>}
                </div>
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
