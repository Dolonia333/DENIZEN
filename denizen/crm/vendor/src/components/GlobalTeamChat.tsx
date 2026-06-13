import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import { MessageCircle, X, Maximize2, Minimize2, Send, Search, Filter, GripHorizontal, Pin } from "lucide-react";
import { shareToGlobalChat, type SharedCard } from "@/lib/global-chat-bridge";
import { CRM_DOCK_EVENTS, dockBaseBottom, isCrmDockMounted } from "@/lib/crm-dock";

// ── Design tokens (mirrors crm-data T) ──
const T = {
  bg0:"#05080f",bg1:"#080d18",bg2:"#0d1422",bg3:"#121b2e",bg4:"#1c2640",bg5:"#1e2d4d",
  text0:"#ffffff",text1:"#e2eaf8",text2:"#7a92b8",text3:"#3d5278",
  accent:"#f0b429",purple:"#8b5cf6",blue:"#4d9ef7",green:"#22d3a0",red:"#f85b5b",orange:"#fb923c",
};

const TEAM = [
  { name: "You", color: "#f0b429" },
  { name: "Sarah Chen", color: "#8b5cf6" },
  { name: "Marcus Webb", color: "#22d3a0" },
  { name: "Emily Park", color: "#4d9ef7" },
  { name: "Alex Rivera", color: "#fb923c" },
];

const REACTIONS = ["👍", "✅", "🔥", "❤️", "👀", "💬"];

export type { SharedCard };
export { shareToGlobalChat };

// ── Navigate to a CRM tab from the chat ──
const TYPE_TO_TAB: Record<string, string> = {
  lead: "contacts", deal: "pipeline", chart: "analytics", note: "notes", task: "tasks",
};
function navigateToCRMTab(type: string) {
  const tab = TYPE_TO_TAB[type] || "dashboard";
  window.dispatchEvent(new CustomEvent("crm-navigate", { detail: tab }));
}

interface ChatMsg {
  id: number; user: string; text: string; at: string;
  reactions?: Record<string, string[]>;
  read?: boolean;
  sharedCard?: SharedCard;
  replyTo?: number;
  replies?: ChatMsg[];
  pinned?: boolean;
}

const INITIAL_MSGS: ChatMsg[] = [
  { id: 1, user: "Sarah Chen", text: "Just closed the Meridian account — $84K ARR! 🎉", at: new Date(Date.now() - 7200000).toISOString(), read: true },
  { id: 2, user: "Marcus Webb", text: "Nice! That puts us at 94% of Q2 target. Can someone pull the latest pipeline numbers?", at: new Date(Date.now() - 5400000).toISOString(), read: true },
  { id: 3, user: "Emily Park", text: "On it. Also flagging — the Nexus deal has been stuck in Qualified for 3 weeks.", at: new Date(Date.now() - 3600000).toISOString(), read: true },
  { id: 4, user: "Alex Rivera", text: "I spoke with their VP yesterday. They're comparing us against two competitors. Sending a revised proposal today.", at: new Date(Date.now() - 1800000).toISOString(), read: true },
  { id: 5, user: "Sarah Chen", text: "Let's add a case study from the Meridian win — similar industry and pain points.", at: new Date(Date.now() - 900000).toISOString(), read: true,
    sharedCard: {
      title: "Meridian Corp Deal", type: "deal", color: "#22d3a0",
      snapshot: { "Value": "$84,000 ARR", "Stage": "Closed Won", "Owner": "Sarah Chen", "Close Date": "Mar 18, 2026" },
      status: "Resolved", notes: "Won with enterprise tier + onboarding add-on",
    },
  },
  { id: 6, user: "Marcus Webb", text: "Pipeline velocity is up 18% this month. Here's the summary:", at: new Date(Date.now() - 600000).toISOString(), read: true,
    sharedCard: {
      title: "Q2 Pipeline Health", type: "chart", color: "#4d9ef7",
      snapshot: { "Open Pipeline": "$412K", "Weighted Forecast": "$287K", "Avg Days in Stage": "14.2", "Win Rate": "34%" },
      status: "In Progress",
    },
  },
];

function Avatar({ name, size = 24 }: { name: string; size?: number }) {
  const colors = ["#f0b429", "#8b5cf6", "#22d3a0", "#4d9ef7", "#fb923c", "#ec4899"];
  const idx = name.split("").reduce((s, c) => s + c.charCodeAt(0), 0) % colors.length;
  return (
    <div style={{
      width: size, height: size, borderRadius: "50%", flexShrink: 0,
      background: `linear-gradient(135deg, ${colors[idx]}, ${colors[(idx + 1) % colors.length]})`,
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: size * 0.38, fontWeight: 700, color: "#fff", letterSpacing: -0.5,
    }}>
      {name.split(" ").map(w => w[0]).join("").slice(0, 2)}
    </div>
  );
}

function timeAgo(d: string): string {
  const s = (Date.now() - new Date(d).getTime()) / 1000;
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

const LS_KEY = "global-team-chat";
function loadMessages(): ChatMsg[] {
  try { const d = localStorage.getItem(LS_KEY); return d ? JSON.parse(d) : INITIAL_MSGS; } catch { return INITIAL_MSGS; }
}
function saveMessages(msgs: ChatMsg[]) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(msgs.slice(-200))); } catch {}
}

// ── Notification helpers ──
const audioCtxRef = { current: null as AudioContext | null };

function playNotificationSound() {
  try {
    if (!audioCtxRef.current) audioCtxRef.current = new AudioContext();
    const ctx = audioCtxRef.current;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = "sine";
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.setValueAtTime(1047, ctx.currentTime + 0.08);
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.25);
  } catch {}
}

function sendDesktopNotification(title: string, body: string) {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  if (document.hasFocus()) return; // only when tab not focused
  try {
    new Notification(title, { body, icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><circle cx='16' cy='16' r='16' fill='%238b5cf6'/><text x='16' y='22' text-anchor='middle' fill='white' font-size='18'>💬</text></svg>" });
  } catch {}
}

function requestNotificationPermission() {
  if (typeof Notification !== "undefined" && Notification.permission === "default") {
    Notification.requestPermission();
  }
}

export function GlobalTeamChat() {
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [messages, setMessages] = useState<ChatMsg[]>(loadMessages);
  const [draft, setDraft] = useState("");
  const [unread, setUnread] = useState(0);
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState<string>("all");
  const [showFilters, setShowFilters] = useState(false);
  const [replyingTo, setReplyingTo] = useState<ChatMsg | null>(null);
  const [threadView, setThreadView] = useState<ChatMsg | null>(null);
  const [typingUsers, setTypingUsers] = useState<string[]>([]);
  const [showReactionPicker, setShowReactionPicker] = useState<number | null>(null);
  const [showPinned, setShowPinned] = useState(false);
  const [dockActive, setDockActive] = useState(isCrmDockMounted);
  const [dockStackHeight, setDockStackHeight] = useState(44);
  const [dockOffset, setDockOffset] = useState({ dx: 0, dy: 0 });

  useEffect(() => {
    const onActive = (e: Event) => setDockActive(Boolean((e as CustomEvent).detail?.active));
    const onDock = (e: Event) => {
      const d = (e as CustomEvent).detail || {};
      setDockStackHeight(d.stackHeight ?? 44);
      setDockOffset({ dx: d.offsetDx ?? 0, dy: d.offsetDy ?? 0 });
    };
    const onToggle = () => setOpen((o) => !o);
    window.addEventListener(CRM_DOCK_EVENTS.ACTIVE, onActive);
    window.addEventListener(CRM_DOCK_EVENTS.STATE, onDock);
    window.addEventListener(CRM_DOCK_EVENTS.CHAT_TOGGLE, onToggle);
    setDockActive(isCrmDockMounted());
    window.dispatchEvent(new Event(CRM_DOCK_EVENTS.CHAT_SYNC));
    return () => {
      window.removeEventListener(CRM_DOCK_EVENTS.ACTIVE, onActive);
      window.removeEventListener(CRM_DOCK_EVENTS.STATE, onDock);
      window.removeEventListener(CRM_DOCK_EVENTS.CHAT_TOGGLE, onToggle);
    };
  }, []);

  useEffect(() => {
    window.dispatchEvent(new CustomEvent(CRM_DOCK_EVENTS.CHAT_UNREAD, { detail: { unread } }));
  }, [unread]);

  // @mention state
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionIdx, setMentionIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const mentionCandidates = useMemo(() => {
    if (mentionQuery === null) return [];
    const q = mentionQuery.toLowerCase();
    return TEAM.filter(t => t.name !== "You" && t.name.toLowerCase().includes(q));
  }, [mentionQuery]);

  const handleDraftChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setDraft(val);
    const cursor = e.target.selectionStart || val.length;
    const before = val.slice(0, cursor);
    const atMatch = before.match(/@([a-zA-Z ]*)$/);
    if (atMatch) {
      setMentionQuery(atMatch[1]);
      setMentionIdx(0);
    } else {
      setMentionQuery(null);
    }
  }, []);

  const insertMention = useCallback((name: string) => {
    const el = inputRef.current;
    const cursor = el?.selectionStart || draft.length;
    const before = draft.slice(0, cursor);
    const after = draft.slice(cursor);
    const atPos = before.lastIndexOf("@");
    const newDraft = before.slice(0, atPos) + `@${name} ` + after;
    setDraft(newDraft);
    setMentionQuery(null);
    setMentionIdx(0);
    setTimeout(() => {
      const pos = atPos + name.length + 2;
      el?.setSelectionRange(pos, pos);
      el?.focus();
    }, 0);
  }, [draft]);

  const handleInputKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (mentionQuery !== null && mentionCandidates.length > 0) {
      if (e.key === "ArrowDown") { e.preventDefault(); setMentionIdx(i => (i + 1) % mentionCandidates.length); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setMentionIdx(i => (i - 1 + mentionCandidates.length) % mentionCandidates.length); return; }
      if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); insertMention(mentionCandidates[mentionIdx].name); return; }
      if (e.key === "Escape") { e.preventDefault(); setMentionQuery(null); return; }
    }
    if (e.key === "Enter" && !e.shiftKey && mentionQuery === null) send();
  }, [mentionQuery, mentionCandidates, mentionIdx, insertMention]);

  // Drag state
  const [pos, setPos] = useState({ x: -1, y: -1 });
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const wasOpenRef = useRef(false);
  const openRef = useRef(open);
  openRef.current = open;

  // Request notification permission on first interaction
  useEffect(() => {
    const handler = () => { requestNotificationPermission(); window.removeEventListener("click", handler); };
    window.addEventListener("click", handler);
    return () => window.removeEventListener("click", handler);
  }, []);

  // Persist messages
  useEffect(() => { saveMessages(messages); }, [messages]);

  // Listen for share events from CRM components
  useEffect(() => {
    const handler = (e: Event) => {
      const card = (e as CustomEvent<SharedCard>).detail;
      const msg: ChatMsg = {
        id: Date.now(), user: "You", text: `Shared: ${card.title}`,
        at: new Date().toISOString(), read: false, sharedCard: card,
      };
      setMessages(prev => [...prev, msg]);
      if (!openRef.current) {
        setUnread(u => u + 1);
        playNotificationSound();
      }
      setOpen(true);
      setTimeout(() => setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, read: true } : m)), 1500);
    };
    window.addEventListener("share-to-global-chat", handler);
    return () => window.removeEventListener("share-to-global-chat", handler);
  }, []);

  // Scroll to bottom
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages.length, open, threadView]);

  // Track unread when minimized
  useEffect(() => {
    if (!open && wasOpenRef.current) {
      // Chat was just closed — start counting new messages as unread
    }
    wasOpenRef.current = open;
    if (open) setUnread(0);
  }, [open]);

  // Drag handlers
  const onDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const rect = (e.currentTarget.closest("[data-chat-panel]") as HTMLElement)?.getBoundingClientRect();
    if (!rect) return;
    setDragging(true);
    dragRef.current = { startX: e.clientX, startY: e.clientY, origX: rect.left, origY: rect.top };
  }, []);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      if (!dragRef.current) return;
      const dx = e.clientX - dragRef.current.startX;
      const dy = e.clientY - dragRef.current.startY;
      setPos({ x: dragRef.current.origX + dx, y: dragRef.current.origY + dy });
    };
    const onUp = () => { setDragging(false); dragRef.current = null; };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, [dragging]);

  const send = useCallback((text?: string, card?: SharedCard) => {
    const t = text || draft.trim();
    if (!t && !card) return;
    const msg: ChatMsg = {
      id: Date.now(), user: "You", text: t, at: new Date().toISOString(), read: false,
      sharedCard: card, replyTo: replyingTo?.id,
    };
    if (threadView) {
      setMessages(prev => prev.map(m => m.id === threadView.id ? { ...m, replies: [...(m.replies || []), msg] } : m));
      setThreadView(prev => prev ? { ...prev, replies: [...(prev.replies || []), msg] } : prev);
    } else {
      setMessages(prev => [...prev, msg]);
    }
    setDraft("");
    setReplyingTo(null);
    // Read receipt
    setTimeout(() => {
      setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, read: true } : m));
    }, 1500);
    // Simulated reply
    if (!threadView) {
      const others = TEAM.filter(t => t.name !== "You");
      const responder = others[Math.floor(Math.random() * others.length)];
      setTimeout(() => setTypingUsers([responder.name]), 2500);
      setTimeout(() => {
        setTypingUsers([]);
        const autoReplies = [
          "Noted, thanks! 👍", "Good call — let me look into it", "Agree, let's action this",
          "Will update the pipeline", "Following up on this now", "Syncing with the team on it 🙌",
        ];
        const reply: ChatMsg = {
          id: Date.now() + 1, user: responder.name,
          text: autoReplies[Math.floor(Math.random() * autoReplies.length)],
          at: new Date().toISOString(), read: true,
        };
        setMessages(prev => [...prev, reply]);
        if (!openRef.current) {
          setUnread(u => u + 1);
          playNotificationSound();
          sendDesktopNotification(responder.name, reply.text);
        }
      }, 4500);
    }
  }, [draft, replyingTo, threadView, open]);

  const toggleReaction = useCallback((msgId: number, emoji: string) => {
    setMessages(prev => prev.map(m => {
      if (m.id !== msgId) return m;
      const r = { ...(m.reactions || {}) };
      const u = r[emoji] || [];
      r[emoji] = u.includes("You") ? u.filter(x => x !== "You") : [...u, "You"];
      if (r[emoji].length === 0) delete r[emoji];
      return { ...m, reactions: r };
    }));
    setShowReactionPicker(null);
  }, []);

  const toggleCardReaction = useCallback((msgId: number, emoji: string) => {
    setMessages(prev => prev.map(m => {
      if (m.id !== msgId || !m.sharedCard) return m;
      const r: Record<string, string[]> = {};
      if (m.sharedCard.notes) {} // keep TS happy
      const existing = (m as any)._cardReactions || {};
      Object.assign(r, existing);
      const u = r[emoji] || [];
      r[emoji] = u.includes("You") ? u.filter(x => x !== "You") : [...u, "You"];
      if (r[emoji].length === 0) delete r[emoji];
      return { ...m, _cardReactions: r } as any;
    }));
  }, []);

  const togglePin = useCallback((msgId: number) => {
    setMessages(prev => prev.map(m => m.id === msgId ? { ...m, pinned: !m.pinned } : m));
  }, []);

  const pinnedMessages = useMemo(() => messages.filter(m => m.pinned), [messages]);

  // Filter messages
  const displayMessages = useMemo(() => {
    let msgs = threadView ? [threadView, ...(threadView.replies || [])] : messages.filter(m => !m.replyTo);
    if (filterType !== "all") {
      if (filterType === "messages") msgs = msgs.filter(m => !m.sharedCard);
      else msgs = msgs.filter(m => m.sharedCard?.type === filterType);
    }
    if (search) {
      const q = search.toLowerCase();
      msgs = msgs.filter(m =>
        m.text.toLowerCase().includes(q) ||
        m.user.toLowerCase().includes(q) ||
        m.sharedCard?.title.toLowerCase().includes(q) ||
        JSON.stringify(m.sharedCard?.snapshot || {}).toLowerCase().includes(q)
      );
    }
    return msgs;
  }, [messages, threadView, filterType, search]);

  // Panel position/size
  const isDefault = pos.x === -1;
  const panelW = expanded ? 520 : 380;
  const panelH = expanded ? "calc(100vh - 100px)" : "calc(100vh - 100px)";

  const dockPanelBottom = dockBaseBottom(isMobile) + dockStackHeight + 12 + dockOffset.dy;
  const defaultPanelBottom = dockActive ? dockPanelBottom : (isMobile ? 142 : 86);
  const defaultPanelRight = dockActive ? (isMobile ? 16 : 20) + dockOffset.dx : 24;

  const panelStyle: React.CSSProperties = isDefault
    ? { position: "fixed", bottom: defaultPanelBottom, right: defaultPanelRight, width: panelW, height: panelH, maxHeight: expanded ? 700 : 580 }
    : { position: "fixed", left: pos.x, top: pos.y, width: panelW, height: panelH, maxHeight: expanded ? 700 : 580 };

  const renderMsg = (msg: ChatMsg) => {
    const isMe = msg.user === "You";
    const replyCount = !threadView ? (msg.replies?.length || 0) : 0;
    const cardReactions = (msg as any)._cardReactions as Record<string, string[]> | undefined;

    return (
      <div key={msg.id} style={{ display: "flex", gap: 8, flexDirection: isMe ? "row-reverse" : "row", alignItems: "flex-end" }}>
        {!isMe && <Avatar name={msg.user} size={26} />}
        <div style={{ maxWidth: "72%", minWidth: 0 }}>
          {!isMe && (
            <span style={{ fontSize: 10, fontWeight: 600, color: T.text3, marginBottom: 2, display: "block", paddingLeft: 6 }}>{msg.user}</span>
          )}

          {/* Reply context */}
          {msg.replyTo && !threadView && (() => {
            const parent = messages.find(m => m.id === msg.replyTo);
            return parent ? (
              <div style={{ fontSize: 9, color: T.text3, padding: "2px 8px", marginBottom: 2, borderLeft: `2px solid ${T.purple}55` }}>
                ↩ {parent.user}: {parent.text.slice(0, 50)}{parent.text.length > 50 ? "…" : ""}
              </div>
            ) : null;
          })()}

          {/* Shared card */}
          {msg.sharedCard && (
            <div style={{
              padding: "10px 12px", marginBottom: 4,
              borderRadius: isMe ? "14px 14px 4px 14px" : "14px 14px 14px 4px",
              background: `${msg.sharedCard.color}12`, border: `1px solid ${msg.sharedCard.color}28`,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                <div style={{ width: 4, height: 16, borderRadius: 2, background: msg.sharedCard.color }} />
                <span style={{ fontSize: 12, fontWeight: 700, color: T.text0 }}>{msg.sharedCard.title}</span>
                <span style={{ fontSize: 9, padding: "2px 7px", borderRadius: 999, background: `${msg.sharedCard.color}20`, color: msg.sharedCard.color, fontWeight: 600 }}>
                  {msg.sharedCard.type}
                </span>
              </div>
              {/* Snapshot key-value pairs */}
              <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "2px 10px", fontSize: 10 }}>
                {Object.entries(msg.sharedCard.snapshot).map(([k, v]) => (
                  <div key={k} style={{ display: "contents" }}><span style={{ color: T.text3, fontWeight: 600 }}>{k}</span><span style={{ color: T.text1, fontVariantNumeric: "tabular-nums" }}>{v}</span></div>
                ))}
              </div>
              {msg.sharedCard.notes && (
                <div style={{ marginTop: 6, fontSize: 10, color: T.text2, fontStyle: "italic", padding: "4px 8px", background: "rgba(255,255,255,0.03)", borderRadius: 6 }}>
                  📝 {msg.sharedCard.notes}
                </div>
              )}
              {msg.sharedCard.status && (
                <div style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{
                    fontSize: 9, fontWeight: 700, padding: "2px 8px", borderRadius: 999,
                    background: msg.sharedCard.status === "Resolved" ? `${T.green}20` : msg.sharedCard.status === "In Progress" ? `${T.blue}20` : `${T.orange}20`,
                    color: msg.sharedCard.status === "Resolved" ? T.green : msg.sharedCard.status === "In Progress" ? T.blue : T.orange,
                  }}>{msg.sharedCard.status}</span>
                </div>
              )}
              {/* Go to source button */}
              <button
                onClick={() => navigateToCRMTab(msg.sharedCard!.type)}
                style={{
                  marginTop: 8, width: "100%", padding: "6px 0", borderRadius: 8,
                  background: `${msg.sharedCard.color}14`, border: `1px solid ${msg.sharedCard.color}28`,
                  color: msg.sharedCard.color, fontSize: 10, fontWeight: 700, cursor: "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
                  transition: "background 0.15s",
                }}
                onMouseEnter={e => e.currentTarget.style.background = `${msg.sharedCard!.color}28`}
                onMouseLeave={e => e.currentTarget.style.background = `${msg.sharedCard!.color}14`}
              >
                →  Go to {msg.sharedCard.type === "lead" ? "Contacts" : msg.sharedCard.type === "deal" ? "Pipeline" : msg.sharedCard.type === "chart" ? "Analytics" : msg.sharedCard.type === "note" ? "Notes" : "Tasks"}
              </button>
              {/* Card reactions */}
              <div style={{ display: "flex", gap: 3, marginTop: 6, flexWrap: "wrap", alignItems: "center" }}>
                {cardReactions && Object.entries(cardReactions).map(([em, users]) => (
                  <button key={em} onClick={() => toggleCardReaction(msg.id, em)} style={{
                    padding: "1px 6px", borderRadius: 999, fontSize: 10, cursor: "pointer",
                    background: users.includes("You") ? `${msg.sharedCard!.color}22` : "rgba(255,255,255,0.05)",
                    border: `1px solid ${users.includes("You") ? `${msg.sharedCard!.color}44` : "transparent"}`,
                    color: T.text1, transition: "all 0.12s",
                  }}>{em} {users.length}</button>
                ))}
                {REACTIONS.slice(0, 4).map(em => (
                  <button key={em} onClick={() => toggleCardReaction(msg.id, em)}
                    style={{ padding: "1px 4px", fontSize: 11, cursor: "pointer", background: "transparent", border: "none", color: T.text3, opacity: 0.4, transition: "opacity 0.12s" }}
                    onMouseEnter={e => e.currentTarget.style.opacity = "0.9"}
                    onMouseLeave={e => e.currentTarget.style.opacity = "0.4"}
                  >{em}</button>
                ))}
              </div>
            </div>
          )}

          {msg.pinned && (
            <div style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 9, color: T.accent, fontWeight: 600, marginBottom: 2, paddingLeft: 6 }}>
              <Pin size={8} /> Pinned
            </div>
          )}

          {/* Message bubble */}
          <div style={{
            padding: "9px 14px",
            borderRadius: isMe ? "18px 18px 4px 18px" : "18px 18px 18px 4px",
            background: isMe ? `linear-gradient(135deg, ${T.accent}, #d97706)` : "rgba(255,255,255,0.06)",
            color: isMe ? "#080d18" : T.text1,
            fontSize: 13, lineHeight: 1.5, fontWeight: isMe ? 500 : 400,
          }}>{msg.text.split(/(@[A-Za-z ]+)/g).map((part, pi) =>
            part.startsWith("@") && TEAM.some(t => part === `@${t.name}`)
              ? <span key={pi} style={{ color: T.accent, fontWeight: 700 }}>{part}</span>
              : part
          )}</div>

          {/* Reactions + reply */}
          <div style={{ display: "flex", gap: 3, marginTop: 3, flexWrap: "wrap", justifyContent: isMe ? "flex-end" : "flex-start", alignItems: "center" }}>
            {msg.reactions && Object.entries(msg.reactions).map(([em, users]) => (
              <button key={em} onClick={() => toggleReaction(msg.id, em)} style={{
                padding: "1px 6px", borderRadius: 999, fontSize: 10, cursor: "pointer",
                background: users.includes("You") ? `${T.accent}22` : "rgba(255,255,255,0.05)",
                border: `1px solid ${users.includes("You") ? `${T.accent}44` : "transparent"}`,
                color: T.text1, transition: "all 0.12s",
              }}>{em} {users.length}</button>
            ))}
            <div style={{ position: "relative" }}>
              <button onClick={() => setShowReactionPicker(showReactionPicker === msg.id ? null : msg.id)}
                style={{ padding: "1px 5px", borderRadius: 999, fontSize: 10, cursor: "pointer", background: "transparent", border: "none", color: T.text3, opacity: 0.4 }}
                onMouseEnter={e => e.currentTarget.style.opacity = "0.9"}
                onMouseLeave={e => e.currentTarget.style.opacity = "0.4"}>+</button>
              {showReactionPicker === msg.id && (
                <div style={{
                  position: "absolute", bottom: "100%", left: 0, marginBottom: 4, zIndex: 50,
                  display: "flex", gap: 2, padding: "4px 6px",
                  background: T.bg2, border: `1px solid ${T.bg4}`, borderRadius: 10,
                  boxShadow: "0 4px 16px rgba(0,0,0,0.5)",
                }}>
                  {REACTIONS.map(em => (
                    <button key={em} onClick={() => toggleReaction(msg.id, em)}
                      style={{ padding: "3px 5px", fontSize: 15, cursor: "pointer", background: "transparent", border: "none", borderRadius: 6, transition: "background 0.1s" }}
                      onMouseEnter={e => e.currentTarget.style.background = "rgba(255,255,255,0.1)"}
                      onMouseLeave={e => e.currentTarget.style.background = "transparent"}>{em}</button>
                  ))}
                </div>
              )}
            </div>
            {!threadView && (
              <button onClick={() => setReplyingTo(msg)}
                style={{ padding: "1px 6px", borderRadius: 999, fontSize: 9, cursor: "pointer", background: "transparent", border: "none", color: T.text3, opacity: 0.4, fontWeight: 600, transition: "opacity 0.12s" }}
                onMouseEnter={e => e.currentTarget.style.opacity = "0.9"}
                onMouseLeave={e => e.currentTarget.style.opacity = "0.4"}>↩ Reply</button>
            )}
            <button onClick={() => togglePin(msg.id)}
              style={{ padding: "1px 6px", borderRadius: 999, fontSize: 9, cursor: "pointer", background: msg.pinned ? `${T.accent}15` : "transparent", border: "none", color: msg.pinned ? T.accent : T.text3, opacity: msg.pinned ? 0.9 : 0.4, fontWeight: 600, transition: "all 0.12s" }}
              onMouseEnter={e => e.currentTarget.style.opacity = "0.9"}
              onMouseLeave={e => { if (!msg.pinned) e.currentTarget.style.opacity = "0.4"; }}
            ><Pin size={9} style={{ display: "inline", verticalAlign: "middle", marginRight: 2 }} />{msg.pinned ? "Unpin" : "Pin"}</button>
          </div>

          {/* Timestamp + read receipt */}
          <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 2, justifyContent: isMe ? "flex-end" : "flex-start" }}>
            <span style={{ fontSize: 9, color: T.text3, opacity: 0.5 }}>{timeAgo(msg.at)}</span>
            {isMe && <span style={{ fontSize: 10, color: msg.read ? T.green : T.text3, opacity: msg.read ? 0.8 : 0.4, letterSpacing: -2 }}>✓✓</span>}
          </div>

          {/* Thread count */}
          {replyCount > 0 && (
            <button onClick={() => setThreadView(msg)} style={{
              display: "flex", alignItems: "center", gap: 4, marginTop: 4, padding: "4px 10px",
              borderRadius: 999, fontSize: 10, fontWeight: 600, cursor: "pointer",
              background: `${T.purple}11`, border: `1px solid ${T.purple}22`, color: T.purple, transition: "background 0.12s",
            }}
              onMouseEnter={e => e.currentTarget.style.background = `${T.purple}22`}
              onMouseLeave={e => e.currentTarget.style.background = `${T.purple}11`}
            >💬 {replyCount} {replyCount === 1 ? "reply" : "replies"}</button>
          )}
        </div>
      </div>
    );
  };

  return (
    <>
      {/* ═══ FLOATING BUTTON (hidden when unified dock is active) ═══ */}
      {!dockActive && (
      <button onClick={() => setOpen(o => !o)} style={{
        position: "fixed", bottom: isMobile ? 80 : 24, right: 24, zIndex: 9990,
        width: 54, height: 54, borderRadius: "50%",
        background: open ? T.bg3 : `linear-gradient(135deg, ${T.purple}, #6d28d9)`,
        border: `1px solid ${open ? T.bg5 : `${T.purple}66`}`,
        color: "#fff", cursor: "pointer",
        display: "flex", alignItems: "center", justifyContent: "center",
        boxShadow: open ? "0 2px 12px rgba(0,0,0,0.3)" : `0 4px 24px ${T.purple}40`,
        transition: "all 0.25s cubic-bezier(0.16,1,0.3,1)",
        transform: open ? "scale(0.92)" : "scale(1)",
      }}
        onMouseEnter={e => { if (!open) e.currentTarget.style.transform = "scale(1.08)"; }}
        onMouseLeave={e => { e.currentTarget.style.transform = open ? "scale(0.92)" : "scale(1)"; }}
      >
        {open ? <X size={20} /> : <MessageCircle size={22} />}
        {!open && unread > 0 && (
          <div style={{
            position: "absolute", top: -3, right: -3, minWidth: 20, height: 20, borderRadius: 999,
            background: T.red, color: "#fff", fontSize: 10, fontWeight: 700,
            display: "flex", alignItems: "center", justifyContent: "center", padding: "0 5px",
            border: "2px solid #080d18", animation: "pulse 2s infinite",
          }}>{unread > 99 ? "99+" : unread}</div>
        )}
      </button>
      )}

      {/* ═══ CHAT PANEL ═══ */}
      {open && (
        <div data-chat-panel style={{
          ...panelStyle, zIndex: 9980,
          display: "flex", flexDirection: "column",
          background: "#0b1120",
          border: `1px solid ${T.bg5}`, borderRadius: 18,
          boxShadow: "0 16px 64px rgba(0,0,0,0.8), 0 0 0 1px rgba(255,255,255,0.06)",
          overflow: "hidden",
          transition: dragging ? "none" : "width 0.25s, height 0.25s",
        }}>
          {/* ── HEADER ── */}
          <div
            onMouseDown={onDragStart}
            style={{
              padding: "12px 16px", borderBottom: `1px solid ${T.bg4}`,
              display: "flex", alignItems: "center", gap: 10,
              background: "rgba(255,255,255,0.02)",
              cursor: dragging ? "grabbing" : "grab", userSelect: "none",
            }}>
            <GripHorizontal size={14} color={T.text3} style={{ opacity: 0.4, flexShrink: 0 }} />
            <div style={{ display: "flex", marginRight: 2 }}>
              {TEAM.slice(1, 4).map((u, i) => (
                <div key={u.name} style={{ marginLeft: i > 0 ? -8 : 0, position: "relative", zIndex: 3 - i }}>
                  <Avatar name={u.name} size={26} />
                  <div style={{ position: "absolute", bottom: 0, right: 0, width: 7, height: 7, borderRadius: "50%", background: T.green, border: "2px solid #0c101c" }} />
                </div>
              ))}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: T.text0, lineHeight: 1.2 }}>CRM Scratch Chat</div>
              <div style={{ fontSize: 10, color: T.text3 }}>Local only · use Denizen for real team chat</div>
            </div>
            <button onClick={() => setShowPinned(p => !p)} style={{
              width: 28, height: 28, borderRadius: 8, background: showPinned ? `${T.accent}15` : "transparent",
              border: "none", color: showPinned ? T.accent : T.text3, cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.12s",
              position: "relative",
            }}>
              <Pin size={14} />
              {pinnedMessages.length > 0 && (
                <div style={{ position: "absolute", top: 1, right: 1, width: 12, height: 12, borderRadius: "50%", background: T.accent, color: "#080d18", fontSize: 7, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  {pinnedMessages.length}
                </div>
              )}
            </button>
            <button onClick={() => setShowFilters(f => !f)} style={{
              width: 28, height: 28, borderRadius: 8, background: showFilters ? `${T.accent}15` : "transparent",
              border: "none", color: showFilters ? T.accent : T.text3, cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.12s",
            }}><Filter size={14} /></button>
            <button onClick={() => { setExpanded(e => !e); setPos({ x: -1, y: -1 }); }} style={{
              width: 28, height: 28, borderRadius: 8, background: "transparent",
              border: "none", color: T.text3, cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.12s",
            }}>{expanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}</button>
            <button onClick={() => setOpen(false)} style={{
              width: 28, height: 28, borderRadius: 8, background: "transparent",
              border: "none", color: T.text3, cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.12s",
            }}
              onMouseEnter={e => e.currentTarget.style.background = "rgba(255,255,255,0.08)"}
              onMouseLeave={e => e.currentTarget.style.background = "transparent"}
            ><X size={14} /></button>
          </div>

          <div style={{
            padding: "10px 14px",
            borderBottom: `1px solid ${T.bg4}`,
            background: `${T.accent}10`,
            fontSize: 11,
            color: T.text2,
            lineHeight: 1.45,
          }}>
            CRM scratch pad — not synced to Denizen. For live NPC + teammate chat, open{" "}
            <a href="/?phone=1" style={{ color: T.accent, fontWeight: 600, textDecoration: "none" }}>Denizen Phone → Chat</a>.
          </div>

          {/* ── FILTER BAR ── */}
          {showFilters && (
            <div style={{ padding: "8px 14px", borderBottom: `1px solid ${T.bg4}`, background: "rgba(255,255,255,0.01)" }}>
              <div style={{ position: "relative", marginBottom: 6 }}>
                <Search size={13} color={T.text3} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)" }} />
                <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search messages…"
                  style={{
                    width: "100%", background: T.bg3, border: `1px solid ${T.bg4}`, borderRadius: 8,
                    color: T.text1, padding: "7px 10px 7px 30px", fontSize: 11, outline: "none", boxSizing: "border-box",
                  }} />
              </div>
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                {["all", "messages", "lead", "deal", "chart", "note", "task"].map(f => (
                  <button key={f} onClick={() => setFilterType(f)} style={{
                    padding: "3px 9px", borderRadius: 999, fontSize: 9, fontWeight: 600, cursor: "pointer",
                    background: filterType === f ? `${T.accent}18` : T.bg3,
                    color: filterType === f ? T.accent : T.text3,
                    border: `1px solid ${filterType === f ? `${T.accent}44` : T.bg4}`,
                    transition: "all 0.12s",
                  }}>{f === "all" ? "All" : f.charAt(0).toUpperCase() + f.slice(1)}</button>
                ))}
              </div>
            </div>
          )}

          {/* ── PINNED PANEL ── */}
          {showPinned && (
            <div style={{ maxHeight: 200, overflowY: "auto", borderBottom: `1px solid ${T.bg4}`, background: `${T.accent}04` }}>
              <div style={{ padding: "8px 14px 4px", display: "flex", alignItems: "center", gap: 6 }}>
                <Pin size={11} color={T.accent} />
                <span style={{ fontSize: 11, fontWeight: 700, color: T.accent }}>Pinned Messages</span>
                <span style={{ fontSize: 9, color: T.text3 }}>({pinnedMessages.length})</span>
              </div>
              {pinnedMessages.length === 0 ? (
                <div style={{ padding: "12px 14px 14px", fontSize: 11, color: T.text3, textAlign: "center" }}>No pinned messages yet</div>
              ) : pinnedMessages.map(pm => (
                <div key={pm.id} style={{ padding: "6px 14px", display: "flex", gap: 8, alignItems: "flex-start", transition: "background 0.1s", cursor: "default" }}
                  onMouseEnter={e => e.currentTarget.style.background = "rgba(255,255,255,0.03)"}
                  onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                  <Avatar name={pm.user} size={20} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ fontSize: 10, fontWeight: 600, color: T.text1 }}>{pm.user}</span>
                      <span style={{ fontSize: 9, color: T.text3 }}>{timeAgo(pm.at)}</span>
                    </div>
                    <div style={{ fontSize: 11, color: T.text2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {pm.sharedCard ? `📎 ${pm.sharedCard.title}` : pm.text}
                    </div>
                  </div>
                  <button onClick={() => togglePin(pm.id)} style={{ background: "none", border: "none", color: T.text3, cursor: "pointer", fontSize: 10, padding: "2px 4px", opacity: 0.5, flexShrink: 0 }}
                    onMouseEnter={e => e.currentTarget.style.opacity = "1"}
                    onMouseLeave={e => e.currentTarget.style.opacity = "0.5"}
                    title="Unpin"><X size={10} /></button>
                </div>
              ))}
            </div>
          )}

          {/* ── THREAD HEADER ── */}
          {threadView && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 14px", background: `${T.purple}08`, borderBottom: `1px solid ${T.bg4}` }}>
              <button onClick={() => setThreadView(null)} style={{ background: "none", border: "none", color: T.text2, cursor: "pointer", fontSize: 14, padding: "2px 6px" }}>←</button>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: T.text0 }}>Thread</div>
                <div style={{ fontSize: 10, color: T.text3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{threadView.text}</div>
              </div>
              <span style={{ fontSize: 9, color: T.purple, fontWeight: 600, flexShrink: 0 }}>{(threadView.replies?.length || 0)} replies</span>
            </div>
          )}

          {/* ── MESSAGES ── */}
          <div style={{ flex: 1, overflowY: "auto", padding: "14px 14px 8px", display: "flex", flexDirection: "column", gap: 14 }}>
            {displayMessages.length === 0 && (
              <div style={{ textAlign: "center", padding: 40, color: T.text3, fontSize: 12 }}>
                {search || filterType !== "all" ? "No matching messages" : "No messages yet — start the conversation!"}
              </div>
            )}
            {displayMessages.map(renderMsg)}

            {/* Typing */}
            {typingUsers.length > 0 && !threadView && (
              <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
                <Avatar name={typingUsers[0]} size={26} />
                <div>
                  <span style={{ fontSize: 10, fontWeight: 600, color: T.text3, display: "block", paddingLeft: 6, marginBottom: 2 }}>{typingUsers[0]}</span>
                  <div style={{
                    padding: "10px 16px", borderRadius: "18px 18px 18px 4px",
                    background: "rgba(255,255,255,0.06)", display: "flex", gap: 5, alignItems: "center",
                  }}>
                    {[0, 0.2, 0.4].map((d, i) => (
                      <span key={i} style={{ width: 6, height: 6, borderRadius: "50%", background: T.text3, animation: "gcTyping 1.4s infinite", animationDelay: `${d}s` }} />
                    ))}
                  </div>
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          {/* ── REPLY BAR ── */}
          {replyingTo && (
            <div style={{
              padding: "6px 14px", borderTop: `1px solid ${T.bg4}`, background: `${T.purple}06`,
              display: "flex", alignItems: "center", gap: 8,
            }}>
              <div style={{ width: 3, height: 20, borderRadius: 2, background: T.purple, flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 10, fontWeight: 600, color: T.purple }}>↩ Replying to {replyingTo.user}</div>
                <div style={{ fontSize: 10, color: T.text3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{replyingTo.text}</div>
              </div>
              <button onClick={() => setReplyingTo(null)} style={{ background: "none", border: "none", color: T.text3, cursor: "pointer", fontSize: 12, padding: "2px 4px" }}>✕</button>
            </div>
          )}

          {/* ── INPUT ── */}
          <div style={{
            padding: "10px 14px", borderTop: `1px solid ${T.bg4}`,
            display: "flex", gap: 8, alignItems: "center",
            background: "rgba(255,255,255,0.02)", position: "relative",
          }}>
            {/* @mention dropdown */}
            {mentionQuery !== null && mentionCandidates.length > 0 && (
              <div style={{
                position: "absolute", bottom: "100%", left: 14, right: 60, marginBottom: 4,
                background: T.bg2, border: `1px solid ${T.bg4}`, borderRadius: 12,
                boxShadow: "0 8px 32px rgba(0,0,0,0.5)", overflow: "hidden", zIndex: 50,
              }}>
                <div style={{ padding: "6px 10px", fontSize: 9, color: T.text3, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", borderBottom: `1px solid ${T.bg4}` }}>
                  Mention a teammate
                </div>
                {mentionCandidates.map((t, i) => (
                  <div key={t.name}
                    onMouseDown={e => { e.preventDefault(); insertMention(t.name); }}
                    onMouseEnter={() => setMentionIdx(i)}
                    style={{
                      display: "flex", alignItems: "center", gap: 10, padding: "8px 12px",
                      cursor: "pointer", transition: "background 0.1s",
                      background: i === mentionIdx ? `${T.accent}12` : "transparent",
                    }}>
                    <Avatar name={t.name} size={24} />
                    <span style={{ fontSize: 12, fontWeight: 600, color: i === mentionIdx ? T.text0 : T.text1 }}>{t.name}</span>
                    <div style={{ width: 6, height: 6, borderRadius: "50%", background: T.green, marginLeft: "auto", flexShrink: 0 }} />
                  </div>
                ))}
              </div>
            )}
            <input ref={inputRef} value={draft} onChange={handleDraftChange}
              onKeyDown={handleInputKeyDown}
              placeholder={replyingTo ? "Reply…" : threadView ? "Reply in thread…" : "Message your team… (type @ to mention)"}
              style={{
                flex: 1, background: "rgba(255,255,255,0.06)", border: "none",
                borderRadius: 22, color: T.text1, padding: "10px 16px", fontSize: 13, outline: "none",
              }} />
            <button onClick={() => send()} style={{
              width: 34, height: 34, borderRadius: "50%",
              background: draft.trim() ? `linear-gradient(135deg, ${T.accent}, #d97706)` : "rgba(255,255,255,0.06)",
              border: "none", color: draft.trim() ? "#080d18" : T.text3,
              fontSize: 15, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
              transition: "all 0.2s",
            }}><Send size={16} /></button>
          </div>
        </div>
      )}

      <style>{`
        @keyframes gcTyping {
          0%, 60%, 100% { transform: translateY(0); opacity: 0.35; }
          30% { transform: translateY(-4px); opacity: 1; }
        }
        @keyframes pulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.1); }
        }
      `}</style>
    </>
  );
}
