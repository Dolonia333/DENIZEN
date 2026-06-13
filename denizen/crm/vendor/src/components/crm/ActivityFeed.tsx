import { useState, useEffect, useRef, useCallback } from "react";
import { T, fmt, type Contact, type Deal, type Note, type Task, type AuditEntry } from "@/lib/crm-data";
import { CRM_DOCK_EVENTS, dockBaseBottom } from "@/lib/crm-dock";

export interface ActivityEvent {
  id: number;
  type: "deal_move" | "deal_created" | "deal_won" | "deal_lost" | "contact_created" | "note_added" | "task_completed" | "task_created";
  title: string;
  description: string;
  icon: string;
  color: string;
  timestamp: number;
  entityName?: string;
}

const EVENT_META: Record<ActivityEvent["type"], { icon: string; color: string; verb: string }> = {
  deal_move: { icon: "◆", color: "#f0b429", verb: "moved" },
  deal_created: { icon: "💰", color: "#4d9ef7", verb: "created" },
  deal_won: { icon: "🎉", color: "#22d3a0", verb: "won" },
  deal_lost: { icon: "❌", color: "#f85b5b", verb: "lost" },
  contact_created: { icon: "👤", color: "#8b5cf6", verb: "added" },
  note_added: { icon: "📝", color: "#fb923c", verb: "logged" },
  task_completed: { icon: "✅", color: "#22d3a0", verb: "completed" },
  task_created: { icon: "📋", color: "#4d9ef7", verb: "created" },
};

interface Props {
  contacts: Contact[];
  deals: Deal[];
  notes: Note[];
  tasks: Task[];
  auditLog?: AuditEntry[];
  /** When set, the fixed launcher is hidden (use CrmFloatingDock). */
  launcher?: "fixed" | "none";
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  onUnreadChange?: (count: number) => void;
}

function auditEntryToEvent(entry: AuditEntry, idx: number): ActivityEvent | null {
  const ts = new Date(entry.at).getTime();
  if (Number.isNaN(ts)) return null;
  const action = String(entry.action || "").toLowerCase();
  const entity = String(entry.entity || "").toLowerCase();
  let type: ActivityEvent["type"] = "note_added";
  if (entity === "deal" && action === "created") type = "deal_created";
  else if (entity === "deal" && /won|closed won/.test(action + (entry.to || ""))) type = "deal_won";
  else if (entity === "deal" && /lost|closed lost/.test(action + (entry.to || ""))) type = "deal_lost";
  else if (entity === "deal" && entry.field === "stage") type = "deal_move";
  else if (entity === "contact" && action === "created") type = "contact_created";
  else if (entity === "task" && action === "created") type = "task_created";
  else if (entity === "task" && /complete|done/.test(action)) type = "task_completed";
  else if (entity === "note") type = "note_added";

  const meta = EVENT_META[type];
  const detail = entry.field && entry.to
    ? `${entry.field}: ${entry.from || "—"} → ${entry.to}`
    : entry.entityName;
  return {
    id: entry.id || ts - idx,
    type,
    title: `${entry.user} ${meta.verb} ${entry.entityName}`,
    description: detail,
    icon: meta.icon,
    color: meta.color,
    timestamp: ts,
    entityName: entry.entityName,
  };
}

function timeAgo(ts: number): string {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60) return "Just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export function ActivityFeed({
  contacts,
  deals,
  notes,
  tasks,
  auditLog = [],
  launcher = "fixed",
  isOpen: isOpenProp,
  onOpenChange,
  onUnreadChange,
}: Props) {
  const [isOpenInternal, setIsOpenInternal] = useState(false);
  const isOpen = isOpenProp ?? isOpenInternal;
  const setIsOpen = onOpenChange ?? setIsOpenInternal;
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [unread, setUnread] = useState(0);
  const [panelBottom, setPanelBottom] = useState(140);
  const [panelRight, setPanelRight] = useState(24);
  const prevDealsRef = useRef<Deal[]>(deals);
  const prevContactsRef = useRef<Contact[]>(contacts);
  const prevNotesRef = useRef<Note[]>(notes);
  const prevTasksRef = useRef<Task[]>(tasks);
  const initializedRef = useRef(false);

  // Seed from persisted audit log (no fabricated timestamps)
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;
    const seed = auditLog
      .map((entry, idx) => auditEntryToEvent(entry, idx))
      .filter((e): e is ActivityEvent => !!e)
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 30);
    setEvents(seed);
  }, [auditLog]);

  // Detect new changes
  const addEvent = useCallback((event: Omit<ActivityEvent, "id" | "timestamp">) => {
    const newEvent = { ...event, id: Date.now() + Math.random(), timestamp: Date.now() };
    setEvents(prev => [newEvent, ...prev].slice(0, 50));
    if (!isOpen) setUnread(p => p + 1);
  }, [isOpen]);

  useEffect(() => {
    if (!initializedRef.current) return;
    const prevDeals = prevDealsRef.current;

    // New deals
    deals.forEach(d => {
      if (!prevDeals.find(p => p.id === d.id)) {
        addEvent({ type: "deal_created", title: `New deal: ${d.title}`, description: `${fmt(d.value)} · ${d.contact}`, icon: "💰", color: "#4d9ef7", entityName: d.title });
      }
    });

    // Stage changes
    deals.forEach(d => {
      const prev = prevDeals.find(p => p.id === d.id);
      if (prev && prev.stage !== d.stage) {
        if (d.stage === "Closed Won") {
          addEvent({ type: "deal_won", title: `Deal won! ${d.title}`, description: `${fmt(d.value)} closed`, icon: "🎉", color: "#22d3a0", entityName: d.title });
        } else if (d.stage === "Closed Lost") {
          addEvent({ type: "deal_lost", title: `Deal lost: ${d.title}`, description: `${fmt(d.value)}`, icon: "❌", color: "#f85b5b", entityName: d.title });
        } else {
          addEvent({ type: "deal_move", title: `${d.title} → ${d.stage}`, description: `Moved from ${prev.stage}`, icon: "◆", color: "#f0b429", entityName: d.title });
        }
      }
    });

    prevDealsRef.current = deals;
  }, [deals, addEvent]);

  useEffect(() => {
    if (!initializedRef.current) return;
    const prevContacts = prevContactsRef.current;
    contacts.forEach(c => {
      if (!prevContacts.find(p => p.id === c.id)) {
        addEvent({ type: "contact_created", title: `New contact: ${c.name}`, description: `${c.company} · ${c.status}`, icon: "👤", color: "#8b5cf6", entityName: c.name });
      }
    });
    prevContactsRef.current = contacts;
  }, [contacts, addEvent]);

  useEffect(() => {
    if (!initializedRef.current) return;
    const prevNotes = prevNotesRef.current;
    notes.forEach(n => {
      if (!prevNotes.find(p => p.id === n.id)) {
        addEvent({ type: "note_added", title: `Note on ${n.contact}`, description: n.text.slice(0, 50), icon: "📝", color: "#fb923c", entityName: n.contact });
      }
    });
    prevNotesRef.current = notes;
  }, [notes, addEvent]);

  useEffect(() => {
    if (!initializedRef.current) return;
    const prevTasks = prevTasksRef.current;
    tasks.forEach(t => {
      const prev = prevTasks.find(p => p.id === t.id);
      if (!prev) {
        addEvent({ type: "task_created", title: `New task`, description: t.title, icon: "📋", color: "#4d9ef7", entityName: t.title });
      } else if (t.done && !prev.done) {
        addEvent({ type: "task_completed", title: `Task completed`, description: t.title, icon: "✅", color: "#22d3a0", entityName: t.title });
      }
    });
    prevTasksRef.current = tasks;
  }, [tasks, addEvent]);

  useEffect(() => {
    onUnreadChange?.(unread);
  }, [unread, onUnreadChange]);

  useEffect(() => {
    if (isOpen) setUnread(0);
  }, [isOpen]);

  useEffect(() => {
    const onDock = (e: Event) => {
      const { stackHeight, isMobile, offsetDx = 0, offsetDy = 0 } = (e as CustomEvent).detail || {};
      const base = dockBaseBottom(Boolean(isMobile));
      const right = (isMobile ? 16 : 20) + Number(offsetDx || 0);
      setPanelBottom(base + (stackHeight || 44) + 12 + Number(offsetDy || 0));
      setPanelRight(right);
    };
    window.addEventListener(CRM_DOCK_EVENTS.STATE, onDock);
    return () => window.removeEventListener(CRM_DOCK_EVENTS.STATE, onDock);
  }, []);

  const handleToggle = () => {
    const next = !isOpen;
    setIsOpen(next);
    if (next) setUnread(0);
  };

  return (
    <>
      {launcher === "fixed" && (
        <button onClick={handleToggle} style={{
          position: "fixed", bottom: 90, right: 76, zIndex: 800,
          width: 42, height: 42, borderRadius: "50%",
          background: isOpen ? T.bg3 : `linear-gradient(135deg, ${T.purple}, #6366f1)`,
          color: isOpen ? T.text0 : "#fff",
          border: `1px solid ${T.bg5}`, fontSize: 18, cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center",
          boxShadow: "0 4px 20px rgba(0,0,0,0.6)", transition: "all 0.15s",
        }}>
          ⚡
          {unread > 0 && (
            <span style={{
              position: "absolute", top: -4, right: -4,
              width: 18, height: 18, borderRadius: "50%",
              background: T.red, color: "#fff", fontSize: 9, fontWeight: 800,
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>{unread > 9 ? "9+" : unread}</span>
          )}
        </button>
      )}

      {/* Feed Panel */}
      {isOpen && (
        <div style={{
          position: "fixed", bottom: panelBottom, right: panelRight, zIndex: 801,
          width: 360, maxHeight: 480,
          background: T.bg1, border: `1px solid ${T.bg4}`,
          borderRadius: T.radius.xl, boxShadow: "0 8px 40px rgba(0,0,0,0.6)",
          display: "flex", flexDirection: "column", overflow: "hidden",
        }}>
          {/* Header */}
          <div style={{
            padding: "14px 18px", borderBottom: `1px solid ${T.bg4}`,
            display: "flex", justifyContent: "space-between", alignItems: "center",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 14 }}>⚡</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: T.text0 }}>Activity Feed</span>
              <span style={{
                fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: T.radius.full,
                background: `${T.purple}22`, color: T.purple,
              }}>LIVE</span>
            </div>
            <button onClick={() => setIsOpen(false)} style={{
              background: "none", border: "none", color: T.text3, cursor: "pointer", fontSize: 16,
            }}>✕</button>
          </div>

          {/* Events List */}
          <div style={{ flex: 1, overflowY: "auto", padding: "8px 0" }}>
            {events.length === 0 ? (
              <div style={{ textAlign: "center", padding: 40, color: T.text3, fontSize: 12 }}>
                No activity yet — changes will appear here in real time
              </div>
            ) : (
              events.map((event, idx) => (
                <div key={event.id} style={{
                  display: "flex", gap: 12, padding: "10px 18px",
                  borderBottom: idx < events.length - 1 ? `1px solid ${T.bg3}` : "none",
                  transition: "background 0.1s",
                }}
                onMouseEnter={e => e.currentTarget.style.background = `${T.bg3}66`}
                onMouseLeave={e => e.currentTarget.style.background = ""}
                >
                  <div style={{
                    width: 28, height: 28, borderRadius: T.radius.full, flexShrink: 0,
                    background: `${event.color}18`, color: event.color,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 12,
                  }}>{event.icon}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: T.text0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {event.title}
                    </div>
                    <div style={{ fontSize: 11, color: T.text3, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {event.description}
                    </div>
                  </div>
                  <div style={{ fontSize: 9, color: T.text3, whiteSpace: "nowrap", flexShrink: 0, marginTop: 2 }}>
                    {timeAgo(event.timestamp)}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </>
  );
}
