import { useState } from "react";
import { T } from "@/lib/crm-data";
import type { Deal, Task } from "@/lib/crm-data";

interface Notification {
  id: number;
  type: "deal" | "task" | "system" | "email";
  title: string;
  message: string;
  time: string;
  read: boolean;
  icon: string;
  color: string;
}

function generateNotifications(deals: Deal[], tasks: Task[]): Notification[] {
  const notifs: Notification[] = [];
  let id = 1;

  // At-risk deals
  deals.filter(d => d.health === "at-risk").forEach(d => {
    notifs.push({ id: id++, type: "deal", title: "Deal at risk", message: `${d.title} has been in ${d.stage} for ${d.daysInStage} days`, time: "2h ago", read: false, icon: "⚠", color: T.red });
  });

  // Overdue tasks
  const today = new Date().toISOString().split("T")[0];
  tasks.filter(t => !t.done && t.due < today).forEach(t => {
    notifs.push({ id: id++, type: "task", title: "Task overdue", message: `"${t.title}" was due ${t.due}`, time: "1h ago", read: false, icon: "🔴", color: T.red });
  });

  // High priority tasks due soon
  tasks.filter(t => !t.done && t.priority === "High" && t.due >= today).forEach(t => {
    notifs.push({ id: id++, type: "task", title: "High priority task", message: `"${t.title}" due ${t.due}`, time: "3h ago", read: true, icon: "🔥", color: T.orange });
  });

  // Deal stage changes (simulated)
  deals.filter(d => d.probability >= 70 && !["Closed Won", "Closed Lost"].includes(d.stage)).forEach(d => {
    notifs.push({ id: id++, type: "deal", title: "Close-ready deal", message: `${d.title} at ${d.probability}% — consider closing`, time: "5h ago", read: true, icon: "💰", color: T.green });
  });

  // System notification
  notifs.push({ id: id++, type: "system", title: "Weekly digest ready", message: "Your sales performance report is available", time: "1d ago", read: true, icon: "📊", color: T.blue });
  notifs.push({ id: id++, type: "email", title: "Follow-up reminder", message: "Send follow-up to Marcus Rivera (3 days since last contact)", time: "4h ago", read: false, icon: "✉", color: T.purple });

  return notifs;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  deals: Deal[];
  tasks: Task[];
}

export function NotificationsPanel({ isOpen, onClose, deals, tasks }: Props) {
  const [notifications, setNotifications] = useState<Notification[]>(() => generateNotifications(deals, tasks));
  const [filter, setFilter] = useState<"all" | "unread">("all");

  if (!isOpen) return null;

  const filtered = filter === "unread" ? notifications.filter(n => !n.read) : notifications;
  const unreadCount = notifications.filter(n => !n.read).length;

  const markAllRead = () => setNotifications(prev => prev.map(n => ({ ...n, read: true })));
  const markRead = (id: number) => setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));

  return (
    <>
      <div onClick={onClose} className="animate-fade-in" style={{ position: "fixed", inset: 0, zIndex: 950, background: "rgba(0,0,0,0.4)" }} />
      <div className="animate-slide-in-right" style={{
        position: "fixed", top: 0, right: 0, bottom: 0, width: 380, maxWidth: "100vw",
        background: T.bg1, borderLeft: `1px solid ${T.bg4}`, zIndex: 951,
        display: "flex", flexDirection: "column",
        boxShadow: "-8px 0 32px rgba(0,0,0,0.5)",
      }}>
        <div style={{ padding: "18px 20px", borderBottom: `1px solid ${T.bg4}`, display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: T.text0 }}>Notifications</div>
            <div style={{ fontSize: 14, color: T.text3, marginTop: 2 }}>{unreadCount} unread</div>
          </div>
          <button aria-label="Action" onClick={markAllRead} style={{ background: "none", border: "none", color: T.accent, fontSize: 14, cursor: "pointer", fontWeight: 600 }}>Mark all read</button>
          <button aria-label="Close" onClick={onClose} style={{ background: "none", border: "none", color: T.text3, fontSize: 18, cursor: "pointer", padding: 0 }}>✕</button>
        </div>

        <div style={{ display: "flex", gap: 4, padding: "10px 20px" }}>
          {(["all", "unread"] as const).map(f => (
            <button aria-label="Action" key={f} onClick={() => setFilter(f)} style={{
              background: filter === f ? T.accent : T.bg3,
              color: filter === f ? "#080d18" : T.text2,
              border: `1px solid ${filter === f ? T.accent : T.bg4}`,
              borderRadius: T.radius.sm, padding: "4px 12px", fontSize: 14, cursor: "pointer", fontWeight: filter === f ? 700 : 400,
              textTransform: "capitalize",
            }}>{f}{f === "unread" && unreadCount > 0 ? ` (${unreadCount})` : ""}</button>
          ))}
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "8px 12px" }}>
          {filtered.length === 0 && (
            <div style={{ padding: "40px 0", textAlign: "center" }}>
              <div style={{ fontSize: 28, marginBottom: 8, opacity: 0.3 }}>🔔</div>
              <div style={{ fontSize: 14, color: T.text3 }}>All caught up!</div>
            </div>
          )}
          {filtered.map(n => (
            <div key={n.id} onClick={() => markRead(n.id)} style={{
              display: "flex", gap: 10, padding: "12px 10px",
              background: !n.read ? `${n.color}06` : "transparent",
              borderRadius: T.radius.md, marginBottom: 4, cursor: "pointer",
              borderLeft: !n.read ? `3px solid ${n.color}` : "3px solid transparent",
              transition: "all 0.15s",
            }}>
              <span style={{ fontSize: 16, flexShrink: 0 }}>{n.icon}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: !n.read ? 600 : 400, color: !n.read ? T.text0 : T.text2 }}>{n.title}</div>
                <div style={{ fontSize: 14, color: T.text3, marginTop: 2 }}>{n.message}</div>
                <div style={{ fontSize: 14, color: T.text3, marginTop: 4 }}>{n.time}</div>
              </div>
              {!n.read && <div style={{ width: 8, height: 8, borderRadius: "50%", background: n.color, flexShrink: 0, marginTop: 4 }} />}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

export function NotificationBell({ deals, tasks, onClick }: { deals: Deal[]; tasks: Task[]; onClick: () => void }) {
  const unreadCount = generateNotifications(deals, tasks).filter(n => !n.read).length;
  return (
    <button aria-label="Action" onClick={onClick} style={{
      position: "relative", background: "none", border: "none",
      color: T.text2, cursor: "pointer", fontSize: 16, padding: "4px 6px",
    }}>
      🔔
      {unreadCount > 0 && (
        <span style={{
          position: "absolute", top: 0, right: 0, width: 16, height: 16,
          borderRadius: "50%", background: T.red, color: "#fff",
          fontSize: 14, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center",
          animation: "pulse-ring 2s ease-out infinite alternate",
        }}>{unreadCount}</span>
      )}
    </button>
  );
}
