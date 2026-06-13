import { useState, useRef, useCallback, useMemo, useEffect } from "react";
import { T, S } from "@/lib/crm-data";
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";

// ── Types ──
interface BoardCard {
  id: number;
  type: "text" | "checklist" | "image" | "link" | "divider" | "chart";
  x: number; y: number; w: number; h: number;
  title: string;
  content?: string;
  checkItems?: { id: number; text: string; done: boolean }[];
  imageUrl?: string;
  linkUrl?: string; linkTitle?: string;
  color?: string;
  lastEditedBy?: string; lastEditedAt?: string;
  comments?: CardComment[];
  chartType?: "bar" | "line" | "pie";
  chartData?: { label: string; value: number; color: string }[];
  chartBackup?: { label: string; value: number; color: string }[] | null;
  pinned?: boolean;
}
interface CardComment { id: number; user: string; text: string; at: string; resolved?: boolean; }
export interface Board { id: number; name: string; color: string; cards: BoardCard[]; }
interface ChatMessage {
  id: number; user: string; text: string; at: string;
  reactions?: Record<string, string[]>; read?: boolean;
  sharedCard?: { title: string; type: string; color: string; content?: string; chartSummary?: string; checkSummary?: string; };
  replyTo?: number; replies?: ChatMessage[];
}
interface ActivityItem { id: number; user: string; action: string; target: string; at: string; color: string; }
interface DirectNote { id: number; to: string; from: string; text: string; at: string; board: string; }
interface FloatingPanel { type: "chat" | "activity"; x: number; y: number; w: number; h: number; }

const BOARD_COLORS = ["#f0b429", "#8b5cf6", "#22d3a0", "#4d9ef7", "#ef4444", "#fb923c", "#ec4899"];
const CARD_COLORS = ["#f0b429", "#8b5cf6", "#22d3a0", "#4d9ef7", "#ef4444", "#fb923c", "#ec4899", "#6b7280"];
const CHART_COLORS = ["#f0b429","#4d9ef7","#22d3a0","#f85b5b","#8b5cf6","#fb923c","#ec4899","#06b6d4"];
const REACTION_EMOJIS = ["👍", "✅", "🔥", "💬", "❤️", "👀"];
const RESIZE_DIRS = ["t","r","b","l","tr","tl","br","bl"];
const SNAP_GRID = 12;
const DRAG_THRESHOLD = 4;

function snap(n: number) {
  return Math.max(0, Math.round(n / SNAP_GRID) * SNAP_GRID);
}

function isInteractiveTarget(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return !!el.closest(".resize-handle, .card-share-handle, textarea, input, button, a, select, label");
}

type TeamMember = { name: string; role: string; color: string; status: string };

const DEFAULT_CHART_DATA = [
  { label: "Q1", value: 42, color: "#f0b429" },
  { label: "Q2", value: 68, color: "#8b5cf6" },
  { label: "Q3", value: 55, color: "#22d3a0" },
  { label: "Q4", value: 80, color: "#4d9ef7" },
];

// ── Helpers ──
function Avatar({ name, size = 24 }: { name: string; size?: number }) {
  const colors = ["#6366f1", "#f0b429", "#22d3a0", "#8b5cf6", "#4d9ef7", "#fb923c"];
  const idx = name.split("").reduce((s, c) => s + c.charCodeAt(0), 0) % colors.length;
  return (
    <div style={{
      width: size, height: size, borderRadius: "50%", flexShrink: 0,
      background: `linear-gradient(135deg,${colors[idx]},${colors[(idx+1)%colors.length]})`,
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: size * 0.38, fontWeight: 700, color: "#fff", letterSpacing: "-0.02em",
    }}>
      {name.split(" ").map(w => w[0]).join("").slice(0, 2)}
    </div>
  );
}

function timeAgo(dateStr: string): string {
  const diff = (Date.now() - new Date(dateStr).getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function resizeHandleStyle(dir: string): React.CSSProperties {
  const base: React.CSSProperties = { position: "absolute", zIndex: 30, opacity: 0, transition: "opacity 0.15s" };
  const s = 8;
  if (dir === "r") return { ...base, right: -3, top: s, bottom: s, width: 6, cursor: "ew-resize" };
  if (dir === "l") return { ...base, left: -3, top: s, bottom: s, width: 6, cursor: "ew-resize" };
  if (dir === "b") return { ...base, bottom: -3, left: s, right: s, height: 6, cursor: "ns-resize" };
  if (dir === "t") return { ...base, top: -3, left: s, right: s, height: 6, cursor: "ns-resize" };
  if (dir === "tr") return { ...base, top: -4, right: -4, width: 10, height: 10, cursor: "nesw-resize", borderRadius: "50%" };
  if (dir === "tl") return { ...base, top: -4, left: -4, width: 10, height: 10, cursor: "nwse-resize", borderRadius: "50%" };
  if (dir === "br") return { ...base, bottom: -4, right: -4, width: 10, height: 10, cursor: "nwse-resize", borderRadius: "50%" };
  if (dir === "bl") return { ...base, bottom: -4, left: -4, width: 10, height: 10, cursor: "nesw-resize", borderRadius: "50%" };
  return base;
}

const panel = (accent?: string): React.CSSProperties => ({
  background: T.bg1,
  border: `1px solid ${accent ? `${accent}33` : T.bg3}`,
  borderRadius: 14,
});

const smallBtn: React.CSSProperties = {
  background: T.bg3, border: `1px solid ${T.bg4}`, borderRadius: 6,
  color: T.text2, fontSize: 10, padding: "2px 7px", cursor: "pointer",
  transition: "all 0.1s", whiteSpace: "nowrap",
};

// ── Default boards ──
const defaultBoards: Board[] = [
  {
    id: 1, name: "Q2 Campaign", color: "#8b5cf6",
    cards: [
      { id: 1, type: "text", x: 40, y: 20, w: 260, h: 160, title: "Campaign Brief", content: "Launch multi-channel campaign targeting enterprise segment. Focus on ROI messaging and case studies.", color: "#f0b429", lastEditedBy: "John Doe", lastEditedAt: new Date().toISOString(), comments: [], pinned: true },
      { id: 2, type: "checklist", x: 340, y: 20, w: 260, h: 200, title: "Launch Checklist", checkItems: [{ id: 1, text: "Finalize creative assets", done: true }, { id: 2, text: "Set up tracking pixels", done: true }, { id: 3, text: "Schedule email sequences", done: false }, { id: 4, text: "Brief sales team", done: false }], color: "#22d3a0", lastEditedBy: "Sarah Chen", lastEditedAt: new Date().toISOString(), comments: [] },
      { id: 3, type: "divider", x: 40, y: 240, w: 560, h: 40, title: "CONTENT ASSETS", color: "#4d9ef7", comments: [] },
      { id: 4, type: "text", x: 40, y: 290, w: 260, h: 120, title: "Hero Copy Draft", content: "Transform your pipeline with AI-powered insights. See 3x conversion rates in 30 days.", color: "#8b5cf6", lastEditedBy: "Marcus Webb", lastEditedAt: new Date().toISOString(), comments: [{ id: 1, user: "Emily Park", text: "Love this direction! Can we add a customer quote?", at: new Date(Date.now() - 7200000).toISOString() }] },
      { id: 5, type: "link", x: 340, y: 290, w: 260, h: 120, title: "Competitor Analysis", linkUrl: "https://example.com/analysis", linkTitle: "Q2 Market Report 2026", color: "#fb923c", lastEditedBy: "Emily Park", lastEditedAt: new Date().toISOString(), comments: [] },
      { id: 6, type: "chart", x: 640, y: 20, w: 320, h: 260, title: "Campaign Performance", chartType: "bar", chartData: [{ label: "Leads", value: 124, color: "#f0b429" }, { label: "MQLs", value: 68, color: "#8b5cf6" }, { label: "SQLs", value: 32, color: "#22d3a0" }, { label: "Won", value: 12, color: "#4d9ef7" }], chartBackup: null, color: "#f0b429", lastEditedBy: "John Doe", lastEditedAt: new Date().toISOString(), comments: [] },
    ],
  },
  {
    id: 2, name: "Client: Acme Corp", color: "#22d3a0",
    cards: [
      { id: 10, type: "text", x: 40, y: 20, w: 280, h: 140, title: "Account Overview", content: "Enterprise client, $450K ARR. Primary contact: Jane Smith. Contract renewal in Q3.", color: "#22d3a0", lastEditedBy: "John Doe", lastEditedAt: new Date().toISOString(), comments: [] },
      { id: 11, type: "checklist", x: 360, y: 20, w: 260, h: 180, title: "Deliverables", checkItems: [{ id: 1, text: "Brand audit report", done: true }, { id: 2, text: "Social media strategy", done: false }, { id: 3, text: "Q3 content calendar", done: false }], color: "#4d9ef7", lastEditedBy: "Sarah Chen", lastEditedAt: new Date().toISOString(), comments: [] },
      { id: 12, type: "chart", x: 40, y: 220, w: 340, h: 260, title: "Revenue Trend", chartType: "line", chartData: [{ label: "Jan", value: 38, color: "#22d3a0" }, { label: "Feb", value: 42, color: "#22d3a0" }, { label: "Mar", value: 55, color: "#22d3a0" }, { label: "Apr", value: 48, color: "#22d3a0" }, { label: "May", value: 65, color: "#22d3a0" }], chartBackup: null, color: "#22d3a0", lastEditedBy: "John Doe", lastEditedAt: new Date().toISOString(), comments: [] },
    ],
  },
];

// ── Pop-out Card Window (draggable + editable) ──
function PopoutCardWindow({ card, onClose, onUpdateCard, newCardComment, setNewCardComment, addCardComment }: {
  card: BoardCard;
  onClose: () => void;
  onUpdateCard: (updates: Partial<BoardCard>) => void;
  newCardComment: string;
  setNewCardComment: (v: string) => void;
  addCardComment: () => void;
}) {
  const [pos, setPos] = useState({ x: window.innerWidth / 2 - 280, y: window.innerHeight / 2 - 250 });
  const dragRef = useRef<{ startX: number; startY: number; startPX: number; startPY: number } | null>(null);
  const rafId = useRef(0);
  const [editTitle, setEditTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(card.title);
  const [editContent, setEditContent] = useState(false);
  const [contentDraft, setContentDraft] = useState(card.content || "");
  const [editCheckIdx, setEditCheckIdx] = useState<number | null>(null);
  const [checkDraft, setCheckDraft] = useState("");
  const [newCheckItem, setNewCheckItem] = useState("");

  useEffect(() => { setTitleDraft(card.title); setContentDraft(card.content || ""); }, [card.id]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragRef.current) return;
      const { startX, startY, startPX, startPY } = dragRef.current;
      const nx = Math.max(0, Math.min(window.innerWidth - 200, startPX + e.clientX - startX));
      const ny = Math.max(0, Math.min(window.innerHeight - 100, startPY + e.clientY - startY));
      cancelAnimationFrame(rafId.current);
      rafId.current = requestAnimationFrame(() => setPos({ x: nx, y: ny }));
    };
    const onUp = () => { dragRef.current = null; };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, []);

  const saveTitle = () => { if (titleDraft.trim()) onUpdateCard({ title: titleDraft.trim(), lastEditedBy: "You", lastEditedAt: new Date().toISOString() }); setEditTitle(false); };
  const saveContent = () => { onUpdateCard({ content: contentDraft, lastEditedBy: "You", lastEditedAt: new Date().toISOString() }); setEditContent(false); };
  const toggleCheck = (id: number) => {
    const items = (card.checkItems || []).map(i => i.id === id ? { ...i, done: !i.done } : i);
    onUpdateCard({ checkItems: items, lastEditedBy: "You", lastEditedAt: new Date().toISOString() });
  };
  const saveCheckEdit = (id: number) => {
    if (checkDraft.trim()) {
      onUpdateCard({ checkItems: (card.checkItems || []).map(i => i.id === id ? { ...i, text: checkDraft.trim() } : i), lastEditedBy: "You", lastEditedAt: new Date().toISOString() });
    }
    setEditCheckIdx(null);
  };
  const deleteCheckItem = (id: number) => {
    onUpdateCard({ checkItems: (card.checkItems || []).filter(i => i.id !== id), lastEditedBy: "You", lastEditedAt: new Date().toISOString() });
  };
  const addNewCheckItem = () => {
    if (!newCheckItem.trim()) return;
    const maxId = Math.max(0, ...(card.checkItems || []).map(i => i.id));
    onUpdateCard({ checkItems: [...(card.checkItems || []), { id: maxId + 1, text: newCheckItem.trim(), done: false }], lastEditedBy: "You", lastEditedAt: new Date().toISOString() });
    setNewCheckItem("");
  };

  const accent = card.color || T.accent;

  return (
    <div style={{
      position: "fixed", left: pos.x, top: pos.y,
      width: 560, maxWidth: "95vw", maxHeight: "80vh",
      background: T.bg1, border: `1px solid ${accent}33`,
      borderRadius: 18, zIndex: 900,
      display: "flex", flexDirection: "column",
      boxShadow: `0 24px 80px rgba(0,0,0,0.55), 0 0 0 1px ${T.bg3}, 0 0 100px ${accent}08`,
      animation: "popIn 0.2s ease-out",
    }}>
      <style>{`@keyframes popIn { from { opacity: 0; transform: scale(0.95); } to { opacity: 1; transform: scale(1); } }`}</style>
      {/* Draggable header */}
      <div
        onMouseDown={e => { e.preventDefault(); dragRef.current = { startX: e.clientX, startY: e.clientY, startPX: pos.x, startPY: pos.y }; }}
        style={{ padding: "14px 20px", borderBottom: `1px solid ${T.bg3}`, display: "flex", alignItems: "center", gap: 10, flexShrink: 0, cursor: "grab", userSelect: "none" }}
      >
        <div style={{ width: 10, height: 10, borderRadius: "50%", background: accent }} />
        <span style={{ fontSize: 10, color: T.text3, textTransform: "uppercase", fontWeight: 600, letterSpacing: "0.08em" }}>{card.type}</span>
        <span style={{ fontSize: 9, color: T.text3, marginLeft: 4 }}>⠿ drag to move</span>
        <div style={{ flex: 1 }} />
        <button onClick={onClose} style={{ background: T.bg2, border: `1px solid ${T.bg3}`, borderRadius: 8, padding: "5px 14px", color: T.text2, cursor: "pointer", fontSize: 12, fontWeight: 600, transition: "all 0.15s" }}
          onMouseEnter={e => { e.currentTarget.style.background = T.bg3; }} onMouseLeave={e => { e.currentTarget.style.background = T.bg2; }}>✕</button>
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: 24 }}>
        {/* Editable title */}
        {editTitle ? (
          <div style={{ marginBottom: 16 }}>
            <input value={titleDraft} onChange={e => setTitleDraft(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") saveTitle(); if (e.key === "Escape") { setEditTitle(false); setTitleDraft(card.title); } }}
              autoFocus
              style={{ width: "100%", fontSize: 20, fontWeight: 800, color: T.text0, background: T.bg2, border: `1px solid ${accent}44`, borderRadius: 10, padding: "8px 12px", outline: "none", letterSpacing: "-0.02em" }} />
            <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
              <button onClick={saveTitle} style={{ ...smallBtn, background: `${accent}15`, color: accent, border: `1px solid ${accent}44` }}>Save</button>
              <button onClick={() => { setEditTitle(false); setTitleDraft(card.title); }} style={smallBtn}>Cancel</button>
            </div>
          </div>
        ) : (
          <h2 onClick={() => setEditTitle(true)} style={{ fontSize: 20, fontWeight: 800, color: T.text0, margin: "0 0 16px", letterSpacing: "-0.02em", cursor: "pointer", borderRadius: 8, padding: "4px 6px", marginLeft: -6, transition: "background 0.15s" }}
            onMouseEnter={e => e.currentTarget.style.background = T.bg2} onMouseLeave={e => e.currentTarget.style.background = "transparent"}
            title="Click to edit title">{card.title} <span style={{ fontSize: 11, color: T.text3, fontWeight: 400 }}>✎</span></h2>
        )}

        {/* Editable content for text cards */}
        {card.type === "text" && (
          editContent ? (
            <div style={{ marginBottom: 20 }}>
              <textarea value={contentDraft} onChange={e => setContentDraft(e.target.value)}
                autoFocus rows={5}
                style={{ width: "100%", fontSize: 13, color: T.text1, background: T.bg2, border: `1px solid ${accent}44`, borderRadius: 10, padding: "12px 14px", outline: "none", lineHeight: 1.6, resize: "vertical", fontFamily: "inherit" }} />
              <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                <button onClick={saveContent} style={{ ...smallBtn, background: `${accent}15`, color: accent, border: `1px solid ${accent}44` }}>Save</button>
                <button onClick={() => { setEditContent(false); setContentDraft(card.content || ""); }} style={smallBtn}>Cancel</button>
              </div>
            </div>
          ) : (
            <div onClick={() => setEditContent(true)}
              style={{ fontSize: 13, color: T.text2, lineHeight: 1.6, marginBottom: 20, padding: "12px 14px", background: T.bg2, borderRadius: 10, border: `1px solid ${T.bg3}`, whiteSpace: "pre-wrap", cursor: "pointer", transition: "border-color 0.15s" }}
              onMouseEnter={e => e.currentTarget.style.borderColor = `${accent}44`} onMouseLeave={e => e.currentTarget.style.borderColor = T.bg3}
              title="Click to edit content">
              {card.content || <span style={{ color: T.text3, fontStyle: "italic" }}>Click to add content…</span>}
              <span style={{ fontSize: 10, color: T.text3, float: "right" }}>✎</span>
            </div>
          )
        )}

        {/* Editable checklist */}
        {card.checkItems && (
          <div style={{ marginBottom: 20 }}>
            {card.checkItems.map(item => (
              <div key={item.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0" }}>
                <div onClick={() => toggleCheck(item.id)} style={{ width: 16, height: 16, borderRadius: 4, border: `2px solid ${item.done ? T.green : T.bg4}`, background: item.done ? T.green : "transparent", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 10, flexShrink: 0, cursor: "pointer" }}>{item.done && "✓"}</div>
                {editCheckIdx === item.id ? (
                  <div style={{ flex: 1, display: "flex", gap: 4 }}>
                    <input value={checkDraft} onChange={e => setCheckDraft(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter") saveCheckEdit(item.id); if (e.key === "Escape") setEditCheckIdx(null); }}
                      autoFocus style={{ flex: 1, fontSize: 12, color: T.text1, background: T.bg2, border: `1px solid ${T.bg4}`, borderRadius: 6, padding: "4px 8px", outline: "none" }} />
                    <button onClick={() => saveCheckEdit(item.id)} style={{ ...smallBtn, fontSize: 9 }}>✓</button>
                  </div>
                ) : (
                  <span onClick={() => { setEditCheckIdx(item.id); setCheckDraft(item.text); }}
                    style={{ flex: 1, fontSize: 12, color: item.done ? T.text3 : T.text1, textDecoration: item.done ? "line-through" : "none", cursor: "pointer", borderRadius: 4, padding: "2px 4px", transition: "background 0.15s" }}
                    onMouseEnter={e => e.currentTarget.style.background = T.bg2} onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                    title="Click to edit">{item.text}</span>
                )}
                <button onClick={() => deleteCheckItem(item.id)} style={{ background: "none", border: "none", color: T.text3, cursor: "pointer", fontSize: 11, opacity: 0.4, transition: "opacity 0.15s", padding: "0 4px" }}
                  onMouseEnter={e => e.currentTarget.style.opacity = "1"} onMouseLeave={e => e.currentTarget.style.opacity = "0.4"}>✕</button>
              </div>
            ))}
            <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
              <input value={newCheckItem} onChange={e => setNewCheckItem(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") addNewCheckItem(); }}
                placeholder="Add item…" style={{ flex: 1, fontSize: 11, color: T.text1, background: T.bg2, border: `1px solid ${T.bg4}`, borderRadius: 6, padding: "6px 10px", outline: "none" }} />
              <button onClick={addNewCheckItem} style={{ ...smallBtn, background: `${accent}15`, color: accent, border: `1px solid ${accent}44` }}>+ Add</button>
            </div>
          </div>
        )}

        {card.linkUrl && (
          <div style={{ marginBottom: 20, padding: "10px 14px", background: T.bg2, borderRadius: 10, border: `1px solid ${T.bg3}` }}>
            <a href={card.linkUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: "#4d9ef7", textDecoration: "none" }}>
              🔗 {card.linkTitle || card.linkUrl}
            </a>
          </div>
        )}
        {card.lastEditedBy && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 20, fontSize: 11, color: T.text3 }}>
            <Avatar name={card.lastEditedBy} size={18} />
            Last edited by {card.lastEditedBy}
            {card.lastEditedAt && <span> · {timeAgo(card.lastEditedAt)}</span>}
          </div>
        )}
        <div>
          <div style={{ fontSize: 10, color: T.text3, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 10 }}>
            Comments ({card.comments?.length || 0})
          </div>
          {(card.comments || []).filter(c => !c.resolved).map(c => (
            <div key={c.id} style={{ padding: "10px 12px", background: T.bg2, border: `1px solid ${T.bg3}`, borderRadius: 10, marginBottom: 6 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                <Avatar name={c.user} size={18} />
                <span style={{ fontSize: 11, fontWeight: 600, color: T.text1 }}>{c.user}</span>
                <span style={{ fontSize: 9, color: T.text3, marginLeft: "auto" }}>{timeAgo(c.at)}</span>
              </div>
              <p style={{ fontSize: 12, color: T.text2, margin: 0 }}>{c.text}</p>
            </div>
          ))}
          <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
            <input value={newCardComment} onChange={e => setNewCardComment(e.target.value)}
              onKeyDown={e => e.key === "Enter" && addCardComment()}
              placeholder="Add a comment…" style={{ ...(S.input as React.CSSProperties), flex: 1, padding: "8px 12px", fontSize: 12 }} />
            <button onClick={addCardComment}
              style={{ background: `${T.accent}15`, border: `1px solid ${T.accent}44`, borderRadius: 8, padding: "8px 12px", fontSize: 11, fontWeight: 700, cursor: "pointer", color: T.accent }}>Post</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main Component ──
export interface NotesTabProps {
  boards?: Board[];
  onBoardsChange?: (boards: Board[]) => void;
  currentUserName?: string;
  teamMembers?: string[];
}

export function NotesTab({ boards: externalBoards, onBoardsChange, currentUserName = "You", teamMembers = [] }: NotesTabProps = {}) {
  const me = currentUserName;
  const team: TeamMember[] = useMemo(() => {
    const palette = ["#f0b429", "#8b5cf6", "#22d3a0", "#4d9ef7", "#fb923c", "#ec4899"];
    const names = teamMembers.length ? teamMembers : [me];
    return names.map((name, i) => ({
      name,
      role: name === me ? "You" : "Team member",
      color: palette[i % palette.length],
      status: "online",
    }));
  }, [teamMembers, me]);
  const [boards, setBoardsState] = useState<Board[]>(
    externalBoards !== undefined ? externalBoards : defaultBoards,
  );

  useEffect(() => {
    if (externalBoards !== undefined) setBoardsState(externalBoards);
  }, [externalBoards]);

  const setBoards = useCallback((value: Board[] | ((prev: Board[]) => Board[])) => {
    setBoardsState((prev) => {
      const next = typeof value === "function" ? value(prev) : value;
      onBoardsChange?.(next);
      return next;
    });
  }, [onBoardsChange]);
  const [activeBoardId, setActiveBoardId] = useState<number | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [newMsg, setNewMsg] = useState("");
  const [chatDragOver, setChatDragOver] = useState(false);
  const [typingUsers, setTypingUsers] = useState<string[]>([]);
  const [replyingTo, setReplyingTo] = useState<ChatMessage | null>(null);
  const [showNewBoard, setShowNewBoard] = useState(false);
  const [newBoardName, setNewBoardName] = useState("");
  const [newBoardColor, setNewBoardColor] = useState(BOARD_COLORS[0]);
  const dragCardRef = useRef<{ id: number; startX: number; startY: number; origX: number; origY: number; el: HTMLElement } | null>(null);
  const [draggingCardId, setDraggingCardId] = useState<number | null>(null);
  const [selectedCard, setSelectedCard] = useState<BoardCard | null>(null);
  const [newCardComment, setNewCardComment] = useState("");
  const [editingCard, setEditingCard] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [hoveredCard, setHoveredCard] = useState<number | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const activity = useMemo<ActivityItem[]>(() => {
    const items: ActivityItem[] = [];
    boards.forEach((b) => {
      b.cards.forEach((c) => {
        if (!c.lastEditedBy || !c.lastEditedAt) return;
        items.push({
          id: c.id,
          user: c.lastEditedBy,
          action: "edited",
          target: c.title,
          at: c.lastEditedAt,
          color: c.color || T.accent,
        });
      });
    });
    return items.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 40);
  }, [boards]);
  const [viewMode, setViewMode] = useState<"canvas" | "grid">("canvas");

  // Floating panels (chat/activity as adjustable windows)
  const [floatingPanels, setFloatingPanels] = useState<FloatingPanel[]>([]);
  const panelDragRef = useRef<{ type: "chat" | "activity"; startX: number; startY: number; startPX: number; startPY: number } | null>(null);
  const panelResizeRef = useRef<{ type: "chat" | "activity"; startX: number; startY: number; startW: number; startH: number; edge: string } | null>(null);

  // Direct notes for team members
  const [directNoteTarget, setDirectNoteTarget] = useState<TeamMember | null>(null);
  const [directNoteText, setDirectNoteText] = useState("");
  const [directNotes, setDirectNotes] = useState<DirectNote[]>([]);
  const [showNotesForMember, setShowNotesForMember] = useState<string | null>(null);

  // Chart editing
  const [editingChartId, setEditingChartId] = useState<number | null>(null);
  const [editingCell, setEditingCell] = useState<{ cardId: number; idx: number; field: "label" | "value" } | null>(null);
  const [cellDraft, setCellDraft] = useState("");
  const [colorPicker, setColorPicker] = useState<{ cardId: number; idx: number } | null>(null);
  const [editingChartTitle, setEditingChartTitle] = useState<number | null>(null);
  const [chartTitleDraft, setChartTitleDraft] = useState("");

  const resizeRef = useRef<{
    cardId: number; startX: number; startY: number;
    startW: number; startH: number; startPX: number; startPY: number;
    dir: string; minW: number; minH: number; el: HTMLElement;
  } | null>(null);
  const [resizingCardId, setResizingCardId] = useState<number | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const didDragRef = useRef(false);
  const rafRef = useRef<number>(0);

  const board = boards.find(b => b.id === activeBoardId) || boards[0] || null;

  useEffect(() => {
    if (!boards.length) {
      setActiveBoardId(null);
      return;
    }
    if (activeBoardId == null || !boards.some((b) => b.id === activeBoardId)) {
      setActiveBoardId(boards[0].id);
    }
  }, [boards, activeBoardId]);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [chatMessages.length]);

  // ── Toggle floating panel ──
  const togglePanel = (type: "chat" | "activity") => {
    setFloatingPanels(prev => {
      const exists = prev.find(p => p.type === type);
      if (exists) return prev.filter(p => p.type !== type);
      const offset = prev.length * 30;
      return [...prev, { type, x: window.innerWidth - 420 - offset, y: 100 + offset, w: 380, h: 500 }];
    });
  };

  const updatePanel = (type: "chat" | "activity", updates: Partial<FloatingPanel>) => {
    setFloatingPanels(prev => prev.map(p => p.type === type ? { ...p, ...updates } : p));
  };

  // ── Panel drag/resize with RAF for smoothness ──
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (panelDragRef.current) {
        const { type, startX, startY, startPX, startPY } = panelDragRef.current;
        const nx = Math.max(0, Math.min(window.innerWidth - 200, startPX + e.clientX - startX));
        const ny = Math.max(0, Math.min(window.innerHeight - 100, startPY + e.clientY - startY));
        cancelAnimationFrame(rafRef.current);
        rafRef.current = requestAnimationFrame(() => updatePanel(type, { x: nx, y: ny }));
      }
      if (panelResizeRef.current) {
        const { type, startX, startY, startW, startH, edge } = panelResizeRef.current;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        const updates: Partial<FloatingPanel> = {};
        if (edge.includes("r")) updates.w = Math.max(300, Math.min(700, startW + dx));
        if (edge.includes("b")) updates.h = Math.max(300, Math.min(800, startH + dy));
        if (edge.includes("l")) {
          const nw = Math.max(300, Math.min(700, startW - dx));
          updates.w = nw;
        }
        cancelAnimationFrame(rafRef.current);
        rafRef.current = requestAnimationFrame(() => updatePanel(type, updates));
      }
    };
    const onUp = () => { panelDragRef.current = null; panelResizeRef.current = null; };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, []);

  // ── Card resize: pointer + live DOM updates (no React re-render per frame) ──
  const handleResizeStart = useCallback((cardId: number, dir: string, e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const card = board?.cards.find(c => c.id === cardId);
    const el = (e.currentTarget as HTMLElement).closest(".notes-card") as HTMLElement | null;
    if (!card || !el) return;
    didDragRef.current = true;
    const minW = card.type === "divider" ? 100 : 160;
    const minH = card.type === "divider" ? 30 : 80;
    resizeRef.current = {
      cardId, startX: e.clientX, startY: e.clientY,
      startW: card.w, startH: card.h, startPX: card.x, startPY: card.y,
      dir, minW, minH, el,
    };
    setResizingCardId(cardId);
    el.style.transition = "none";
    el.style.willChange = "width, height, left, top";
    try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  }, [board]);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!resizeRef.current) return;
      const { cardId, startX, startY, startW, startH, startPX, startPY, dir, minW, minH, el } = resizeRef.current;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      let x = startPX, y = startPY, w = startW, h = startH;
      if (dir.includes("r")) w = Math.max(minW, Math.min(900, startW + dx));
      if (dir.includes("l")) { w = Math.max(minW, Math.min(900, startW - dx)); x = startPX + (startW - w); }
      if (dir.includes("b")) h = Math.max(minH, Math.min(720, startH + dy));
      if (dir.includes("t")) { h = Math.max(minH, Math.min(720, startH - dy)); y = startPY + (startH - h); }
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
      el.style.width = `${w}px`;
      el.style.height = `${h}px`;
      void cardId;
    };
    const onUp = () => {
      if (!resizeRef.current) return;
      const { cardId, el } = resizeRef.current;
      const x = snap(parseFloat(el.style.left) || 0);
      const y = snap(parseFloat(el.style.top) || 0);
      const w = snap(parseFloat(el.style.width) || 160);
      const h = snap(parseFloat(el.style.height) || 80);
      el.style.willChange = "";
      el.style.transition = "";
      setBoards(prev => prev.map(b => b.id === activeBoardId ? {
        ...b, cards: b.cards.map(c => c.id === cardId ? { ...c, x, y, w, h, lastEditedBy: me, lastEditedAt: new Date().toISOString() } : c),
      } : b));
      resizeRef.current = null;
      setResizingCardId(null);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [activeBoardId, me, setBoards]);

  // ── Card drag: pointer + transform (commit on release) ──
  const handleCardPointerDown = useCallback((cardId: number, e: React.PointerEvent) => {
    if (viewMode !== "canvas" || e.button !== 0) return;
    if (isInteractiveTarget(e.target)) return;
    const card = boards.find(b => b.id === activeBoardId)?.cards.find(c => c.id === cardId);
    const el = e.currentTarget as HTMLElement;
    if (!card) return;
    didDragRef.current = false;
    dragCardRef.current = {
      id: cardId,
      startX: e.clientX,
      startY: e.clientY,
      origX: card.x,
      origY: card.y,
      el,
    };
    setDraggingCardId(cardId);
    el.style.transition = "none";
    el.style.willChange = "transform";
    try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  }, [boards, activeBoardId, viewMode]);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!dragCardRef.current) return;
      const { startX, startY, origX, origY, el } = dragCardRef.current;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (Math.abs(dx) + Math.abs(dy) > DRAG_THRESHOLD) didDragRef.current = true;
      el.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
      void origX;
      void origY;
    };
    const onUp = (e: PointerEvent) => {
      if (!dragCardRef.current) return;
      const { id, startX, startY, origX, origY, el } = dragCardRef.current;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      const x = snap(origX + dx);
      const y = snap(origY + dy);
      el.style.transform = "";
      el.style.willChange = "";
      el.style.transition = "";
      if (didDragRef.current) {
        setBoards(prev => prev.map(b => b.id === activeBoardId ? {
          ...b, cards: b.cards.map(c => c.id === id ? { ...c, x, y, lastEditedBy: me, lastEditedAt: new Date().toISOString() } : c),
        } : b));
      }
      dragCardRef.current = null;
      setDraggingCardId(null);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [activeBoardId, me, setBoards]);

  // ── CRUD ──
  const addCard = (type: BoardCard["type"]) => {
    const id = Date.now();
    const defaults: Partial<BoardCard> = {
      text: { w: 260, h: 190, title: "New Note", content: "" },
      checklist: { w: 260, h: 200, title: "Checklist", checkItems: [{ id: 1, text: "Item 1", done: false }] },
      image: { w: 260, h: 220, title: "Image", imageUrl: "" },
      link: { w: 260, h: 150, title: "Link", linkUrl: "", linkTitle: "" },
      divider: { w: 400, h: 36, title: "SECTION", color: T.accent },
      chart: { w: 320, h: 280, title: "New Chart", chartType: "bar" as const, chartData: [...DEFAULT_CHART_DATA.map(d => ({ ...d }))], chartBackup: null },
    }[type] || {};
    const card: BoardCard = {
      id, type, x: 60 + Math.random() * 100, y: 60 + Math.random() * 80,
      ...defaults as any,
      color: CARD_COLORS[Math.floor(Math.random() * CARD_COLORS.length)],
      lastEditedBy: me, lastEditedAt: new Date().toISOString(), comments: [],
    };
    setBoards(prev => prev.map(b => b.id === activeBoardId ? { ...b, cards: [...b.cards, card] } : b));
    setEditingCard(id);
  };

  const updateCard = (cardId: number, updates: Partial<BoardCard>) => {
    setBoards(prev => prev.map(b => b.id === activeBoardId ? {
      ...b, cards: b.cards.map(c => c.id === cardId ? { ...c, ...updates, lastEditedBy: me, lastEditedAt: new Date().toISOString() } : c)
    } : b));
    if (selectedCard?.id === cardId) setSelectedCard(prev => prev ? { ...prev, ...updates } : prev);
  };

  const deleteCard = (cardId: number) => {
    setBoards(prev => prev.map(b => b.id === activeBoardId ? { ...b, cards: b.cards.filter(c => c.id !== cardId) } : b));
    if (selectedCard?.id === cardId) setSelectedCard(null);
  };

  const addBoard = () => {
    if (!newBoardName.trim()) return;
    const b: Board = { id: Date.now(), name: newBoardName.trim(), color: newBoardColor, cards: [] };
    setBoards(prev => [...prev, b]);
    setActiveBoardId(b.id);
    setShowNewBoard(false); setNewBoardName("");
  };

  const deleteBoard = (id: number) => {
    if (boards.length <= 1) return;
    setBoards(prev => prev.filter(b => b.id !== id));
    if (activeBoardId === id) setActiveBoardId(boards.find(b => b.id !== id)!.id);
  };

  // ── Chart editing ──
  const startEditChart = (cardId: number) => {
    const card = board.cards.find(c => c.id === cardId);
    if (!card || !card.chartData) return;
    updateCard(cardId, { chartBackup: card.chartBackup || [...card.chartData.map(d => ({ ...d }))] });
    setEditingChartId(cardId);
  };
  const saveChart = (cardId: number) => { updateCard(cardId, { chartBackup: null }); setEditingChartId(null); };
  const resetChart = (cardId: number) => {
    const card = board.cards.find(c => c.id === cardId);
    if (card?.chartBackup) updateCard(cardId, { chartData: card.chartBackup, chartBackup: null });
    setEditingChartId(null);
  };
  const toggleChartType = (cardId: number) => {
    const card = board.cards.find(c => c.id === cardId);
    if (!card) return;
    const order: ("bar" | "line" | "pie")[] = ["bar", "line", "pie"];
    updateCard(cardId, { chartType: order[(order.indexOf(card.chartType || "bar") + 1) % 3] });
  };
  const addChartPoint = (cardId: number) => {
    const card = board.cards.find(c => c.id === cardId);
    if (!card?.chartData) return;
    updateCard(cardId, { chartData: [...card.chartData, { label: "New", value: 0, color: CHART_COLORS[card.chartData.length % CHART_COLORS.length] }] });
  };
  const removeChartPoint = (cardId: number, idx: number) => {
    const card = board.cards.find(c => c.id === cardId);
    if (!card?.chartData) return;
    updateCard(cardId, { chartData: card.chartData.filter((_, i) => i !== idx) });
  };
  const updateChartPoint = (cardId: number, idx: number, updates: Partial<{ label: string; value: number; color: string }>) => {
    const card = board.cards.find(c => c.id === cardId);
    if (!card?.chartData) return;
    updateCard(cardId, { chartData: card.chartData.map((d, i) => i === idx ? { ...d, ...updates } : d) });
  };

  // ── Chat ──
  const sendMessage = (text?: string, sharedCard?: ChatMessage["sharedCard"]) => {
    const msgText = text || newMsg.trim();
    if (!msgText && !sharedCard) return;
    const msg: ChatMessage = {
      id: Date.now(), user: me, text: msgText, at: new Date().toISOString(), read: false,
      sharedCard, replyTo: replyingTo?.id || undefined,
    };
    setChatMessages(prev => [...prev, msg]);
    setNewMsg(""); setReplyingTo(null);
    setTimeout(() => setChatMessages(prev => prev.map(m => m.id === msg.id ? { ...m, read: true } : m)), 2000);
  };

  const toggleReaction = (msgId: number, emoji: string) => {
    setChatMessages(prev => prev.map(m => {
      if (m.id !== msgId) return m;
      const reactions = { ...(m.reactions || {}) };
      const users = reactions[emoji] || [];
      reactions[emoji] = users.includes(me) ? users.filter(u => u !== me) : [...users, me];
      if (reactions[emoji].length === 0) delete reactions[emoji];
      return { ...m, reactions };
    }));
  };

  const handleCardDragStart = useCallback((card: BoardCard, e: React.DragEvent) => {
    e.dataTransfer.setData("application/card-id", String(card.id));
    e.dataTransfer.effectAllowed = "copy";
  }, []);

  const handleChatDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setChatDragOver(false);
    const cardId = Number(e.dataTransfer.getData("application/card-id"));
    const card = board.cards.find(c => c.id === cardId);
    if (!card) return;
    sendMessage(`Shared: ${card.title}`, {
      title: card.title, type: card.type, color: card.color || T.accent,
      content: card.content?.slice(0, 120),
      chartSummary: card.chartData?.map(d => `${d.label}: ${d.value}`).join(", "),
      checkSummary: card.checkItems ? `${card.checkItems.filter(i => i.done).length}/${card.checkItems.length} done` : undefined,
    });
  }, [board]);

  const addCardComment = (cardId: number) => {
    if (!newCardComment.trim()) return;
    const comment: CardComment = { id: Date.now(), user: me, text: newCardComment.trim(), at: new Date().toISOString() };
    updateCard(cardId, { comments: [...(selectedCard?.comments || []), comment] });
    setNewCardComment("");
  };

  // ── Direct notes ──
  const sendDirectNote = () => {
    if (!directNoteText.trim() || !directNoteTarget) return;
    const note: DirectNote = {
      id: Date.now(),
      to: directNoteTarget.name,
      from: me,
      text: directNoteText.trim(),
      at: new Date().toISOString(),
      board: board.name,
    };
    setDirectNotes(prev => [note, ...prev]);
    setDirectNoteText("");
    setDirectNoteTarget(null);
  };

  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const q = searchQuery.toLowerCase();
    const results: { board: Board; card: BoardCard }[] = [];
    boards.forEach(b => b.cards.forEach(c => {
      if (c.title.toLowerCase().includes(q) || c.content?.toLowerCase().includes(q)) results.push({ board: b, card: c });
    }));
    return results;
  }, [searchQuery, boards]);

  const getCardCursor = (_cardId: number) => null;

  // ── Board stats ──
  const boardStats = useMemo(() => {
    const cards = board?.cards || [];
    const totalChecks = cards.flatMap(c => c.checkItems || []);
    const doneChecks = totalChecks.filter(i => i.done);
    return {
      cards: cards.length,
      notes: cards.filter(c => c.type === "text").length,
      checklists: cards.filter(c => c.type === "checklist").length,
      charts: cards.filter(c => c.type === "chart").length,
      checkProgress: totalChecks.length > 0 ? Math.round((doneChecks.length / totalChecks.length) * 100) : 0,
      totalChecks: totalChecks.length,
      doneChecks: doneChecks.length,
    };
  }, [board]);

  // ── Render chart inside card ──
  const renderEditableChart = (card: BoardCard) => {
    const data = card.chartData || DEFAULT_CHART_DATA;
    const isEditing = editingChartId === card.id;
    const chartH = card.h - (isEditing ? 200 : 100);
    return (
      <div onMouseDown={e => e.stopPropagation()} style={{ marginTop: 4, display: "flex", flexDirection: "column", height: card.h - 60 }}>
        <div style={{ display: "flex", gap: 3, marginBottom: 6, flexWrap: "wrap", alignItems: "center" }}>
          <button onClick={e => { e.stopPropagation(); toggleChartType(card.id); }} style={smallBtn}>⇄ {card.chartType}</button>
          {!isEditing ? (
            <button onClick={e => { e.stopPropagation(); startEditChart(card.id); }} style={smallBtn}>✏️ Edit</button>
          ) : (
            <>
              <button onClick={e => { e.stopPropagation(); saveChart(card.id); }} style={{ ...smallBtn, background: `${T.green}22`, color: T.green }}>✓ Save</button>
              <button onClick={e => { e.stopPropagation(); resetChart(card.id); }} style={{ ...smallBtn, background: `${T.red}22`, color: T.red }}>↺ Reset</button>
            </>
          )}
        </div>
        <div style={{ flex: 1, minHeight: 0 }}>
          <ResponsiveContainer width="100%" height={Math.max(80, chartH)}>
            {card.chartType === "bar" ? (
              <BarChart data={data}>
                <CartesianGrid strokeDasharray="3 3" stroke={T.bg4} />
                <XAxis dataKey="label" tick={{ fill: T.text3, fontSize: 10 }} axisLine={{ stroke: T.bg4 }} />
                <YAxis tick={{ fill: T.text3, fontSize: 10 }} axisLine={{ stroke: T.bg4 }} width={30} />
                <Tooltip contentStyle={{ background: T.bg2, border: `1px solid ${T.bg4}`, borderRadius: 8, color: T.text1, fontSize: 11 }} />
                <Bar dataKey="value" radius={[4, 4, 0, 0]}>{data.map((d, i) => <Cell key={i} fill={d.color} />)}</Bar>
              </BarChart>
            ) : card.chartType === "line" ? (
              <LineChart data={data}>
                <CartesianGrid strokeDasharray="3 3" stroke={T.bg4} />
                <XAxis dataKey="label" tick={{ fill: T.text3, fontSize: 10 }} axisLine={{ stroke: T.bg4 }} />
                <YAxis tick={{ fill: T.text3, fontSize: 10 }} axisLine={{ stroke: T.bg4 }} width={30} />
                <Tooltip contentStyle={{ background: T.bg2, border: `1px solid ${T.bg4}`, borderRadius: 8, color: T.text1, fontSize: 11 }} />
                <Line type="monotone" dataKey="value" stroke={data[0]?.color || CHART_COLORS[0]} strokeWidth={2} dot={{ fill: data[0]?.color || CHART_COLORS[0], r: 3 }} />
              </LineChart>
            ) : (
              <PieChart>
                <Pie data={data} dataKey="value" nameKey="label" cx="50%" cy="50%" innerRadius="30%" outerRadius="65%" paddingAngle={2} strokeWidth={0}>
                  {data.map((d, i) => <Cell key={i} fill={d.color} />)}
                </Pie>
                <Tooltip contentStyle={{ background: T.bg2, border: `1px solid ${T.bg4}`, borderRadius: 8, color: T.text1, fontSize: 11 }} />
              </PieChart>
            )}
          </ResponsiveContainer>
        </div>
        {isEditing && (
          <div style={{ marginTop: 4, maxHeight: 130, overflowY: "auto", borderTop: `1px solid ${T.bg4}`, paddingTop: 6 }}>
            {data.map((dp, idx) => (
              <div key={idx} style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 3, fontSize: 10 }}>
                <div style={{ position: "relative" }}>
                  <div onClick={e => { e.stopPropagation(); setColorPicker(colorPicker?.cardId === card.id && colorPicker.idx === idx ? null : { cardId: card.id, idx }); }}
                    style={{ width: 14, height: 14, borderRadius: 3, background: dp.color, cursor: "pointer", border: `1px solid ${T.bg5}` }} />
                  {colorPicker?.cardId === card.id && colorPicker.idx === idx && (
                    <div style={{ position: "absolute", top: 18, left: 0, zIndex: 50, background: T.bg2, border: `1px solid ${T.bg4}`, borderRadius: 8, padding: 5, display: "flex", gap: 3, flexWrap: "wrap", width: 110 }}>
                      {CHART_COLORS.map(c => (
                        <div key={c} onClick={e => { e.stopPropagation(); updateChartPoint(card.id, idx, { color: c }); setColorPicker(null); }}
                          style={{ width: 18, height: 18, borderRadius: 3, background: c, cursor: "pointer", border: dp.color === c ? "2px solid #fff" : `1px solid ${T.bg5}` }} />
                      ))}
                    </div>
                  )}
                </div>
                {editingCell?.cardId === card.id && editingCell.idx === idx && editingCell.field === "label" ? (
                  <input autoFocus value={cellDraft} onChange={e => setCellDraft(e.target.value)}
                    onBlur={() => { updateChartPoint(card.id, idx, { label: cellDraft || dp.label }); setEditingCell(null); }}
                    onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                    onClick={e => e.stopPropagation()}
                    style={{ background: T.bg4, border: `1px solid ${T.bg5}`, borderRadius: 3, color: T.text1, fontSize: 10, padding: "1px 4px", width: 50 }} />
                ) : (
                  <span onClick={e => { e.stopPropagation(); setEditingCell({ cardId: card.id, idx, field: "label" }); setCellDraft(dp.label); }}
                    style={{ color: T.text2, cursor: "pointer", minWidth: 40 }}>{dp.label}</span>
                )}
                {editingCell?.cardId === card.id && editingCell.idx === idx && editingCell.field === "value" ? (
                  <input autoFocus type="number" value={cellDraft} onChange={e => setCellDraft(e.target.value)}
                    onBlur={() => { updateChartPoint(card.id, idx, { value: Number(cellDraft) || 0 }); setEditingCell(null); }}
                    onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                    onClick={e => e.stopPropagation()}
                    style={{ background: T.bg4, border: `1px solid ${T.bg5}`, borderRadius: 3, color: T.text1, fontSize: 10, padding: "1px 4px", width: 55 }} />
                ) : (
                  <span onClick={e => { e.stopPropagation(); setEditingCell({ cardId: card.id, idx, field: "value" }); setCellDraft(String(dp.value)); }}
                    style={{ color: T.accent, cursor: "pointer", fontVariantNumeric: "tabular-nums" }}>{dp.value.toLocaleString()}</span>
                )}
                <button onClick={e => { e.stopPropagation(); removeChartPoint(card.id, idx); }}
                  style={{ ...smallBtn, padding: "1px 4px", color: T.red, fontSize: 9 }}>−</button>
              </div>
            ))}
            <button onClick={e => { e.stopPropagation(); addChartPoint(card.id); }}
              style={{ ...smallBtn, marginTop: 3, color: T.green, fontSize: 9 }}>+ Add point</button>
          </div>
        )}
      </div>
    );
  };

  // ── Render a card ──
  const renderCard = (card: BoardCard) => {
    const cursorUser = getCardCursor(card.id);
    const isHovered = hoveredCard === card.id;
    const isActiveDrag = draggingCardId === card.id || resizingCardId === card.id;

    return (
      <div key={card.id} className={`notes-card${isActiveDrag ? " notes-card--dragging" : ""}`}
        onPointerDown={e => viewMode === "canvas" && handleCardPointerDown(card.id, e)}
        onClick={e => { e.stopPropagation(); if (!didDragRef.current) setSelectedCard(card); }}
        onMouseEnter={() => setHoveredCard(card.id)}
        onMouseLeave={() => setHoveredCard(null)}
        style={{
          ...(viewMode === "canvas" ? {
            position: "absolute" as const, left: card.x, top: card.y,
            width: card.w, height: card.type === "divider" ? card.h : card.h,
          } : {
            position: "relative" as const, width: "100%",
          }),
          ...(card.type === "divider" ? {
            background: "transparent", border: "none", borderRadius: 0,
            borderBottom: `2px dashed ${card.color || T.bg4}66`,
            padding: "0 12px", display: "flex", alignItems: "center", cursor: "grab",
          } : {
            background: T.bg2, border: `1px solid ${T.bg3}`, borderRadius: 12,
            cursor: viewMode === "canvas" ? (isActiveDrag ? "grabbing" : "grab") : "default",
            transition: isActiveDrag ? "none" : "box-shadow 0.15s, border-color 0.15s",
            padding: 14,
            boxSizing: "border-box",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            touchAction: viewMode === "canvas" ? "none" : "auto",
            ...(viewMode === "grid" ? { minHeight: 160 } : {}),
          }),
          zIndex: isActiveDrag ? 50 : (card.pinned ? 20 : 10),
          userSelect: isActiveDrag ? "none" : "auto",
          ...(isHovered && card.type !== "divider" && !isActiveDrag ? {
            boxShadow: `0 8px 32px rgba(0,0,0,0.35)`,
            borderColor: `${card.color || T.bg5}55`,
          } : {}),
          ...(isActiveDrag && card.type !== "divider" ? {
            boxShadow: `0 16px 48px rgba(0,0,0,0.45), 0 0 0 1px ${card.color || T.accent}44`,
          } : {}),
        }}>
        {cursorUser && isHovered && (
          <div style={{
            position: "absolute", top: -28, left: 8, zIndex: 60,
            display: "flex", alignItems: "center", gap: 5,
            padding: "3px 8px", borderRadius: 999,
            background: cursorUser.color, color: "#fff",
            fontSize: 9, fontWeight: 700, whiteSpace: "nowrap",
            boxShadow: "0 2px 8px rgba(0,0,0,0.4)",
          }}>
            <div style={{ width: 5, height: 5, borderRadius: "50%", background: "#fff", opacity: 0.8 }} />
            {cursorUser.name} · {cursorUser.action}
          </div>
        )}
        {cursorUser && (
          <div style={{ position: "absolute", inset: -2, borderRadius: 14, border: `2px solid ${cursorUser.color}44`, pointerEvents: "none" }} />
        )}

        {card.type === "divider" ? (
          <span style={{ fontSize: 10, fontWeight: 700, color: card.color || T.text3, letterSpacing: "0.15em", textTransform: "uppercase" }}>{card.title}</span>
        ) : (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8, flexShrink: 0 }}>
              <div
                className="card-share-handle"
                draggable
                onDragStart={e => { e.stopPropagation(); handleCardDragStart(card, e); }}
                onPointerDown={e => e.stopPropagation()}
                title="Drag to team chat to share"
                style={{
                  width: 18, height: 18, borderRadius: 4, flexShrink: 0,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 10, color: T.text3, cursor: "grab",
                  background: T.bg3, border: `1px solid ${T.bg4}`,
                  opacity: isHovered ? 0.9 : 0.35, transition: "opacity 0.15s",
                }}
              >↗</div>
              <div style={{ width: 4, height: 16, borderRadius: 2, background: card.color || T.accent, flexShrink: 0 }} />
              {editingCard === card.id || editingChartTitle === card.id ? (
                <input autoFocus
                  value={editingChartTitle === card.id ? chartTitleDraft : card.title}
                  onChange={e => editingChartTitle === card.id ? setChartTitleDraft(e.target.value) : updateCard(card.id, { title: e.target.value })}
                  onBlur={() => {
                    if (editingChartTitle === card.id) { updateCard(card.id, { title: chartTitleDraft || card.title }); setEditingChartTitle(null); }
                    else setEditingCard(null);
                  }}
                  onKeyDown={e => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                  onClick={e => e.stopPropagation()} onMouseDown={e => e.stopPropagation()}
                  style={{ background: "transparent", border: "none", outline: "none", color: T.text0, fontSize: 13, fontWeight: 700, flex: 1, padding: 0 }}
                />
              ) : (
                <span onDoubleClick={e => {
                  e.stopPropagation();
                  if (card.type === "chart") { setEditingChartTitle(card.id); setChartTitleDraft(card.title); }
                  else setEditingCard(card.id);
                }}
                  style={{ fontSize: 13, fontWeight: 700, color: T.text0, flex: 1, cursor: "text" }}>{card.title}</span>
              )}
              {(card.comments?.length || 0) > 0 && (
                <span style={{ fontSize: 10, color: card.color || T.accent, fontWeight: 700 }}>💬 {card.comments!.length}</span>
              )}
              <button onClick={e => { e.stopPropagation(); deleteCard(card.id); }}
                style={{ background: "none", border: "none", color: T.text3, fontSize: 12, cursor: "pointer", opacity: isHovered ? 0.6 : 0, transition: "opacity 0.15s", padding: "0 2px" }}
                onMouseDown={e => e.stopPropagation()}>✕</button>
            </div>

            <div style={{ flex: 1, minHeight: 0, overflow: "auto", display: "flex", flexDirection: "column" }}>
            {card.type === "text" && (
              <div onMouseDown={e => e.stopPropagation()} style={{ flex: 1, minHeight: 48, display: "flex" }}>
                <textarea value={card.content || ""} onChange={e => updateCard(card.id, { content: e.target.value })}
                  placeholder="Type your note…" onClick={e => e.stopPropagation()}
                  style={{
                    width: "100%", flex: 1, background: "transparent", border: "none", outline: "none",
                    color: T.text2, fontSize: 12, lineHeight: 1.6, resize: "none", minHeight: 48,
                    fontFamily: "inherit",
                  }} />
              </div>
            )}

            {card.type === "checklist" && (
              <div onMouseDown={e => e.stopPropagation()}>
                {(card.checkItems || []).map(item => (
                  <div key={item.id} style={{ display: "flex", alignItems: "center", gap: 6, padding: "3px 0" }}>
                    <button onClick={e => { e.stopPropagation(); updateCard(card.id, { checkItems: card.checkItems!.map(i => i.id === item.id ? { ...i, done: !i.done } : i) }); }}
                      style={{ width: 16, height: 16, borderRadius: 4, border: `2px solid ${item.done ? T.green : T.bg4}`, background: item.done ? T.green : "transparent", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 10, flexShrink: 0 }}>
                      {item.done && "✓"}
                    </button>
                    <span style={{ fontSize: 12, color: item.done ? T.text3 : T.text1, textDecoration: item.done ? "line-through" : "none", flex: 1 }}>{item.text}</span>
                  </div>
                ))}
                <button onClick={e => { e.stopPropagation(); updateCard(card.id, { checkItems: [...(card.checkItems || []), { id: Date.now(), text: "New item", done: false }] }); }}
                  style={{ ...smallBtn, marginTop: 6, fontSize: 10 }}>+ Add item</button>
              </div>
            )}

            {card.type === "link" && (
              <div onMouseDown={e => e.stopPropagation()}>
                {card.linkUrl ? (
                  <a href={card.linkUrl} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}
                    style={{ fontSize: 11, color: "#4d9ef7", textDecoration: "none", display: "block" }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: T.text1, marginBottom: 2 }}>{card.linkTitle || card.linkUrl}</div>
                    <span style={{ fontSize: 10, color: T.text3 }}>🔗 {card.linkUrl}</span>
                  </a>
                ) : (
                  <input type="text" placeholder="Paste URL…" onChange={e => updateCard(card.id, { linkUrl: e.target.value, linkTitle: e.target.value })}
                    onClick={e => e.stopPropagation()} style={{ ...S.input as React.CSSProperties, fontSize: 11, padding: "6px 10px" }} />
                )}
              </div>
            )}

            {card.type === "chart" && renderEditableChart(card)}
            </div>

            {card.lastEditedBy && (
              <div style={{
                marginTop: 8, paddingTop: 8, flexShrink: 0,
                borderTop: `1px solid ${T.bg3}`,
                fontSize: 10, color: T.text3,
                display: "flex", alignItems: "center", gap: 6, minHeight: 22,
              }}>
                <Avatar name={card.lastEditedBy} size={16} />
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", lineHeight: 1.3 }}>
                  {card.lastEditedBy} · {card.lastEditedAt ? timeAgo(card.lastEditedAt) : ""}
                </span>
              </div>
            )}
          </>
        )}

        {viewMode === "canvas" && card.type !== "divider" && RESIZE_DIRS.map(dir => (
          <div key={dir} className="resize-handle"
            onPointerDown={e => handleResizeStart(card.id, dir, e)}
            style={resizeHandleStyle(dir)} />
        ))}
        {viewMode === "canvas" && card.type === "divider" && ["l", "r"].map(dir => (
          <div key={dir} className="resize-handle"
            onPointerDown={e => handleResizeStart(card.id, dir, e)}
            style={resizeHandleStyle(dir)} />
        ))}
      </div>
    );
  };

  // ── Render floating panel content ──
  const renderFloatingPanel = (fp: FloatingPanel) => {
    const isChat = fp.type === "chat";
    const accentColor = isChat ? T.purple || "#8b5cf6" : T.accent;

    return (
      <div key={fp.type} style={{
        position: "fixed", left: fp.x, top: fp.y, width: fp.w, height: fp.h,
        zIndex: 800, display: "flex", flexDirection: "column",
        background: T.bg1, border: `1px solid ${accentColor}33`,
        borderRadius: 16, boxShadow: `0 20px 60px rgba(0,0,0,0.5), 0 0 0 1px ${T.bg3}`,
        overflow: "hidden", isolation: "isolate",
      }}>
        {/* Drag handle / header */}
        <div
          onMouseDown={e => {
            e.preventDefault();
            panelDragRef.current = { type: fp.type, startX: e.clientX, startY: e.clientY, startPX: fp.x, startPY: fp.y };
          }}
          style={{
            padding: "10px 14px", display: "flex", alignItems: "center", gap: 8,
            cursor: "grab", borderBottom: `1px solid ${T.bg3}`, flexShrink: 0,
            background: `${accentColor}08`, userSelect: "none",
          }}>
          <div style={{ width: 20, display: "flex", flexDirection: "column", gap: 2, opacity: 0.3 }}>
            <div style={{ height: 2, borderRadius: 1, background: T.text3 }} />
            <div style={{ height: 2, borderRadius: 1, background: T.text3 }} />
          </div>
          <span style={{ fontSize: 14 }}>{isChat ? "💬" : "⚡"}</span>
          <span style={{ fontSize: 13, fontWeight: 700, color: T.text0, flex: 1 }}>
            {isChat ? "Team Chat" : "Activity Feed"}
          </span>
          {isChat && (
            <div style={{ display: "flex", marginRight: 4 }}>
              {team.slice(0, 3).map((u, i) => (
                <div key={u.name} style={{ marginLeft: i > 0 ? -6 : 0 }}>
                  <Avatar name={u.name} size={20} />
                </div>
              ))}
            </div>
          )}
          <button onClick={() => togglePanel(fp.type)} style={{ background: T.bg3, border: `1px solid ${T.bg4}`, borderRadius: 6, padding: "3px 8px", color: T.text2, cursor: "pointer", fontSize: 11, fontWeight: 600 }}>✕</button>
        </div>

        {/* Content */}
        {!isChat ? (
          <div style={{ flex: 1, overflowY: "auto", padding: 14 }}>
            {activity.map(a => (
              <div key={a.id} style={{ display: "flex", gap: 10, marginBottom: 14 }}>
                <div style={{ position: "relative", flexShrink: 0 }}>
                  <Avatar name={a.user} size={28} />
                  <div style={{ position: "absolute", left: 13, top: 32, width: 1, height: 14, background: T.bg3 }} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, color: T.text1, lineHeight: 1.4 }}>
                    <span style={{ fontWeight: 700 }}>{a.user}</span>{" "}
                    <span style={{ color: T.text3 }}>{a.action}</span>{" "}
                    <span style={{ color: a.color, fontWeight: 600 }}>{a.target}</span>
                  </div>
                  <div style={{ fontSize: 10, color: T.text3, marginTop: 2 }}>{timeAgo(a.at)}</div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <>
            {chatDragOver && (
              <div style={{ position: "absolute", inset: 0, zIndex: 60, background: `${T.accent}11`, display: "flex", alignItems: "center", justifyContent: "center", backdropFilter: "blur(4px)", borderRadius: 16 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: T.accent, textAlign: "center" }}>
                  <div style={{ fontSize: 32, marginBottom: 8 }}>📌</div>
                  Drop card to share
                </div>
              </div>
            )}
            <div
              onDragOver={e => { e.preventDefault(); setChatDragOver(true); }}
              onDragLeave={() => setChatDragOver(false)}
              onDrop={handleChatDrop}
              style={{ flex: 1, overflowY: "auto", padding: "12px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
              {chatMessages.map(msg => {
                const isMe = msg.user === me;
                return (
                  <div key={msg.id} style={{ display: "flex", gap: 8, flexDirection: isMe ? "row-reverse" : "row", alignItems: "flex-end" }}>
                    {!isMe && <Avatar name={msg.user} size={22} />}
                    <div style={{ maxWidth: "75%", minWidth: 0 }}>
                      {!isMe && (
                        <span style={{ fontSize: 10, fontWeight: 600, color: T.text3, marginBottom: 2, display: "block", paddingLeft: 4 }}>{msg.user}</span>
                      )}
                      {msg.sharedCard && (
                        <div style={{
                          padding: "8px 10px", marginBottom: 4,
                          borderRadius: isMe ? "12px 12px 4px 12px" : "12px 12px 12px 4px",
                          background: `${msg.sharedCard.color}12`, border: `1px solid ${msg.sharedCard.color}33`,
                        }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
                            <div style={{ width: 3, height: 12, borderRadius: 2, background: msg.sharedCard.color }} />
                            <span style={{ fontSize: 11, fontWeight: 700, color: T.text0 }}>{msg.sharedCard.title}</span>
                            <span style={{ fontSize: 8, padding: "1px 5px", borderRadius: 999, background: `${msg.sharedCard.color}22`, color: msg.sharedCard.color, fontWeight: 600 }}>{msg.sharedCard.type}</span>
                          </div>
                          {msg.sharedCard.content && <div style={{ fontSize: 10, color: T.text2, lineHeight: 1.4 }}>{msg.sharedCard.content}</div>}
                          {msg.sharedCard.checkSummary && <div style={{ fontSize: 10, color: T.text3, marginTop: 2 }}>☑ {msg.sharedCard.checkSummary}</div>}
                        </div>
                      )}
                      <div style={{
                        padding: "8px 12px",
                        borderRadius: isMe ? "14px 14px 4px 14px" : "14px 14px 14px 4px",
                        background: isMe ? `linear-gradient(135deg, ${T.accent}, #d97706)` : T.bg2,
                        color: isMe ? "#080d18" : T.text1,
                        fontSize: 12, lineHeight: 1.45, fontWeight: isMe ? 500 : 400,
                      }}>{msg.text}</div>
                      <div style={{ display: "flex", gap: 3, marginTop: 2, flexWrap: "wrap", justifyContent: isMe ? "flex-end" : "flex-start", alignItems: "center" }}>
                        {msg.reactions && Object.entries(msg.reactions).map(([emoji, users]) => (
                          <button key={emoji} onClick={() => toggleReaction(msg.id, emoji)} style={{
                            padding: "1px 5px", borderRadius: 999, fontSize: 10, cursor: "pointer",
                            background: users.includes(me) ? `${T.accent}22` : T.bg3,
                            border: `1px solid ${users.includes(me) ? `${T.accent}44` : "transparent"}`, color: T.text1,
                          }}>{emoji} {users.length}</button>
                        ))}
                        {REACTION_EMOJIS.slice(0, 3).map(em => (
                          <button key={em} onClick={() => toggleReaction(msg.id, em)}
                            style={{ padding: "1px 3px", fontSize: 10, cursor: "pointer", background: "transparent", border: "none", color: T.text3, opacity: 0.4 }}
                            onMouseEnter={e => e.currentTarget.style.opacity = "1"}
                            onMouseLeave={e => e.currentTarget.style.opacity = "0.4"}>{em}</button>
                        ))}
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 3, marginTop: 1, justifyContent: isMe ? "flex-end" : "flex-start" }}>
                        <span style={{ fontSize: 9, color: T.text3, opacity: 0.5 }}>{timeAgo(msg.at)}</span>
                        {isMe && <span style={{ fontSize: 10, color: msg.read ? "#22d3a0" : T.text3, opacity: msg.read ? 0.9 : 0.4, letterSpacing: -2 }}>✓✓</span>}
                      </div>
                    </div>
                  </div>
                );
              })}
              {typingUsers.length > 0 && (
                <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
                  <Avatar name={typingUsers[0]} size={22} />
                  <div>
                    <span style={{ fontSize: 10, fontWeight: 600, color: T.text3, display: "block", paddingLeft: 4 }}>{typingUsers[0]}</span>
                    <div style={{ padding: "8px 14px", borderRadius: "14px 14px 14px 4px", background: T.bg2, display: "flex", gap: 4, alignItems: "center" }}>
                      <span className="typing-dot" style={{ width: 5, height: 5, borderRadius: "50%", background: T.text3, animation: "typingBounce 1.4s infinite" }} />
                      <span className="typing-dot" style={{ width: 5, height: 5, borderRadius: "50%", background: T.text3, animation: "typingBounce 1.4s infinite", animationDelay: "0.2s" }} />
                      <span className="typing-dot" style={{ width: 5, height: 5, borderRadius: "50%", background: T.text3, animation: "typingBounce 1.4s infinite", animationDelay: "0.4s" }} />
                    </div>
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            {replyingTo && (
              <div style={{ padding: "6px 14px", borderTop: `1px solid ${T.bg3}`, background: `${T.purple}08`, display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ width: 3, height: 18, borderRadius: 2, background: T.purple || "#8b5cf6", flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 10, fontWeight: 600, color: T.purple || "#8b5cf6" }}>↩ Replying to {replyingTo.user}</div>
                  <div style={{ fontSize: 10, color: T.text3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{replyingTo.text}</div>
                </div>
                <button onClick={() => setReplyingTo(null)} style={{ background: "none", border: "none", color: T.text3, cursor: "pointer", fontSize: 12 }}>✕</button>
              </div>
            )}

            <div style={{ padding: "10px 14px", borderTop: `1px solid ${T.bg3}`, display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
              <input value={newMsg} onChange={e => setNewMsg(e.target.value)}
                onKeyDown={e => e.key === "Enter" && sendMessage()}
                placeholder="Message…"
                style={{ flex: 1, background: T.bg2, border: `1px solid ${T.bg3}`, borderRadius: 20, color: T.text1, padding: "8px 14px", fontSize: 12, outline: "none" }} />
              <button onClick={() => sendMessage()} style={{
                width: 32, height: 32, borderRadius: "50%",
                background: newMsg.trim() ? `linear-gradient(135deg, ${T.accent}, #d97706)` : T.bg2,
                border: "none", color: newMsg.trim() ? "#080d18" : T.text3,
                fontSize: 14, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                transition: "all 0.2s", fontWeight: 700,
              }}>↑</button>
            </div>
          </>
        )}

        {/* Resize edges */}
        {["r", "b", "br"].map(edge => (
          <div key={edge}
            onMouseDown={e => {
              e.preventDefault(); e.stopPropagation();
              panelResizeRef.current = { type: fp.type, startX: e.clientX, startY: e.clientY, startW: fp.w, startH: fp.h, edge };
            }}
            style={{
              position: "absolute",
              ...(edge === "r" ? { right: -3, top: 20, bottom: 20, width: 6, cursor: "ew-resize" } : {}),
              ...(edge === "b" ? { bottom: -3, left: 20, right: 20, height: 6, cursor: "ns-resize" } : {}),
              ...(edge === "br" ? { bottom: -4, right: -4, width: 14, height: 14, cursor: "nwse-resize", borderRadius: "50%" } : {}),
              zIndex: 10,
            }}
          />
        ))}
      </div>
    );
  };

  const sidebarW = sidebarCollapsed ? 52 : 240;
  const chatPanel = floatingPanels.find(p => p.type === "chat");
  const activityPanel = floatingPanels.find(p => p.type === "activity");

  if (boards.length === 0 || !board) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "calc(100vh - 120px)", padding: 32, textAlign: "center" }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>📋</div>
        <h2 style={{ fontSize: 20, fontWeight: 700, color: T.text0, margin: "0 0 8px" }}>No boards yet</h2>
        <p style={{ fontSize: 13, color: T.text2, maxWidth: 360, lineHeight: 1.5, marginBottom: 20 }}>
          Create your first workspace board for notes, charts, and team collaboration. Demo boards are not loaded automatically.
        </p>
        <button type="button" onClick={() => setShowNewBoard(true)} style={{ ...S.btn as React.CSSProperties }}>Create first board</button>
        {showNewBoard && (
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }} onClick={() => setShowNewBoard(false)}>
            <div style={{ background: T.bg2, border: `1px solid ${T.bg4}`, borderRadius: T.radius.lg, padding: 24, width: 360 }} onClick={(e) => e.stopPropagation()}>
              <div style={{ fontSize: 15, fontWeight: 700, color: T.text0, marginBottom: 12 }}>New board</div>
              <input value={newBoardName} onChange={(e) => setNewBoardName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addBoard()} placeholder="Board name…" style={{ ...S.input as React.CSSProperties, width: "100%", marginBottom: 12 }} />
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button type="button" onClick={() => setShowNewBoard(false)} style={S.btnGhost as React.CSSProperties}>Cancel</button>
                <button type="button" onClick={addBoard} style={S.btn as React.CSSProperties}>Create</button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", height: "calc(100vh - 56px)", gap: 0, overflow: "hidden" }}>

      {/* ═══════════════════ LEFT SIDEBAR ═══════════════════ */}
      <div style={{
        width: sidebarW, minWidth: sidebarW, flexShrink: 0,
        background: T.bg1, borderRight: `1px solid ${T.bg3}`,
        display: "flex", flexDirection: "column", transition: "width 0.2s",
        overflow: "hidden",
      }}>
        {/* Workspace header */}
        <div style={{ padding: sidebarCollapsed ? "16px 8px" : "20px 16px 16px", borderBottom: `1px solid ${T.bg3}` }}>
          {sidebarCollapsed ? (
            <button onClick={() => setSidebarCollapsed(false)} style={{ background: "none", border: "none", color: T.text2, cursor: "pointer", fontSize: 16, width: "100%", display: "flex", justifyContent: "center" }}>☰</button>
          ) : (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 800, color: T.text0, letterSpacing: "-0.03em" }}>📋 Workspace</div>
                <div style={{ fontSize: 10, color: T.text3, marginTop: 2 }}>{boards.length} boards · {board.cards.length} cards</div>
              </div>
              <button onClick={() => setSidebarCollapsed(true)} style={{ background: "none", border: "none", color: T.text3, cursor: "pointer", fontSize: 14 }}>◀</button>
            </div>
          )}
        </div>

        {!sidebarCollapsed && (
          <>
            {/* Boards list */}
            <div style={{ padding: "12px 12px 8px" }}>
              <div style={{ fontSize: 9, fontWeight: 700, color: T.text3, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 8, paddingLeft: 4 }}>Boards</div>
              {boards.map(b => (
                <button key={b.id} onClick={() => setActiveBoardId(b.id)} style={{
                  width: "100%", display: "flex", alignItems: "center", gap: 8, padding: "8px 10px",
                  borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer",
                  background: activeBoardId === b.id ? `${b.color}15` : "transparent",
                  color: activeBoardId === b.id ? T.text0 : T.text2,
                  border: activeBoardId === b.id ? `1px solid ${b.color}33` : "1px solid transparent",
                  transition: "all 0.15s", marginBottom: 2, textAlign: "left",
                }}>
                  <div style={{ width: 8, height: 8, borderRadius: "50%", background: b.color, flexShrink: 0 }} />
                  <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b.name}</span>
                  <span style={{ fontSize: 9, color: T.text3 }}>{b.cards.length}</span>
                </button>
              ))}
              <button onClick={() => setShowNewBoard(true)} style={{
                width: "100%", display: "flex", alignItems: "center", gap: 8, padding: "8px 10px",
                borderRadius: 8, fontSize: 12, fontWeight: 500, cursor: "pointer",
                background: "transparent", color: T.text3,
                border: `1px dashed ${T.bg4}`, transition: "all 0.15s", marginTop: 4,
              }}>
                <span style={{ fontSize: 14 }}>+</span> New Board
              </button>
            </div>

            {/* Board stats */}
            <div style={{ padding: "8px 12px", borderTop: `1px solid ${T.bg3}` }}>
              <div style={{ fontSize: 9, fontWeight: 700, color: T.text3, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 8, paddingLeft: 4 }}>Progress</div>
              <div style={{ background: T.bg2, borderRadius: 10, padding: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: T.text2, marginBottom: 6 }}>
                  <span>Tasks</span>
                  <span style={{ color: T.text0, fontWeight: 700 }}>{boardStats.doneChecks}/{boardStats.totalChecks}</span>
                </div>
                <div style={{ height: 6, borderRadius: 3, background: T.bg4, overflow: "hidden" }}>
                  <div style={{ height: "100%", borderRadius: 3, background: `linear-gradient(90deg, ${board.color}, ${board.color}cc)`, width: `${boardStats.checkProgress}%`, transition: "width 0.3s" }} />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginTop: 10 }}>
                  {[
                    { label: "Notes", value: boardStats.notes, icon: "📝" },
                    { label: "Lists", value: boardStats.checklists, icon: "☑" },
                    { label: "Charts", value: boardStats.charts, icon: "📊" },
                    { label: "Total", value: boardStats.cards, icon: "📌" },
                  ].map(s => (
                    <div key={s.label} style={{ background: T.bg3, borderRadius: 8, padding: "6px 8px", textAlign: "center" }}>
                      <div style={{ fontSize: 11 }}>{s.icon}</div>
                      <div style={{ fontSize: 14, fontWeight: 800, color: T.text0 }}>{s.value}</div>
                      <div style={{ fontSize: 8, color: T.text3, fontWeight: 600 }}>{s.label}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Team presence — clickable for direct notes */}
            <div style={{ padding: "8px 12px", borderTop: `1px solid ${T.bg3}`, marginTop: "auto" }}>
              <div style={{ fontSize: 9, fontWeight: 700, color: T.text3, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 8, paddingLeft: 4 }}>Team</div>
              {team.map(u => {
                const memberNotes = directNotes.filter(n => n.to === u.name || n.from === u.name);
                const isExpanded = showNotesForMember === u.name;
                return (
                  <div key={u.name}>
                    <div
                      onClick={() => {
                        if (u.name === me) return;
                        setShowNotesForMember(isExpanded ? null : u.name);
                      }}
                      style={{
                        display: "flex", alignItems: "center", gap: 8, padding: "6px 6px",
                        borderRadius: 8, cursor: u.name === me ? "default" : "pointer",
                        transition: "background 0.15s",
                        background: isExpanded ? `${u.color}12` : "transparent",
                        border: isExpanded ? `1px solid ${u.color}33` : "1px solid transparent",
                      }}>
                      <div style={{ position: "relative" }}>
                        <Avatar name={u.name} size={24} />
                        <div style={{
                          position: "absolute", bottom: -1, right: -1, width: 8, height: 8, borderRadius: "50%",
                          background: u.status === "online" ? "#22d3a0" : "#f0b429",
                          border: `2px solid ${T.bg1}`,
                        }} />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 11, fontWeight: 600, color: T.text1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {u.name} {u.name === me && <span style={{ fontSize: 9, color: T.text3 }}>(you)</span>}
                        </div>
                        <div style={{ fontSize: 9, color: T.text3 }}>{u.role}</div>
                      </div>
                      {u.name !== me && (
                        <div style={{ display: "flex", gap: 3, alignItems: "center" }}>
                          {memberNotes.length > 0 && (
                            <span style={{ fontSize: 9, background: `${u.color}22`, color: u.color, borderRadius: 999, padding: "1px 5px", fontWeight: 700 }}>{memberNotes.length}</span>
                          )}
                          <button
                            onClick={e => { e.stopPropagation(); setDirectNoteTarget(u); }}
                            title={`Leave note for ${u.name}`}
                            style={{ background: "none", border: "none", cursor: "pointer", fontSize: 12, padding: "0 2px", opacity: 0.5, transition: "opacity 0.15s" }}
                            onMouseEnter={e => e.currentTarget.style.opacity = "1"}
                            onMouseLeave={e => e.currentTarget.style.opacity = "0.5"}
                          >✉️</button>
                        </div>
                      )}
                    </div>

                    {/* Expanded notes list for this member */}
                    {isExpanded && (
                      <div style={{ padding: "6px 6px 8px 38px" }}>
                        {memberNotes.length === 0 ? (
                          <div style={{ fontSize: 10, color: T.text3, padding: "4px 0" }}>No notes yet</div>
                        ) : (
                          memberNotes.slice(0, 5).map(n => (
                            <div key={n.id} style={{ padding: "6px 8px", background: T.bg2, borderRadius: 8, marginBottom: 4, border: `1px solid ${T.bg3}` }}>
                              <div style={{ fontSize: 10, color: T.text2, lineHeight: 1.4 }}>{n.text}</div>
                              <div style={{ fontSize: 9, color: T.text3, marginTop: 3, display: "flex", gap: 6 }}>
                                <span>{n.from === me ? "You" : n.from} → {n.to === me ? "You" : n.to}</span>
                                <span>· {timeAgo(n.at)}</span>
                              </div>
                            </div>
                          ))
                        )}
                        <button
                          onClick={e => { e.stopPropagation(); setDirectNoteTarget(u); }}
                          style={{ ...smallBtn, marginTop: 4, fontSize: 10, width: "100%", textAlign: "center", display: "block", padding: "4px 8px" }}
                        >+ Leave a note</button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* ═══════════════════ MAIN CANVAS ═══════════════════ */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, overflow: "hidden" }}>

        {/* Top toolbar */}
        <div style={{
          display: "flex", alignItems: "center", gap: 10, padding: "10px 16px",
          borderBottom: `1px solid ${T.bg3}`, background: T.bg1, flexShrink: 0,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1 }}>
            <div style={{ width: 10, height: 10, borderRadius: "50%", background: board.color }} />
            <span style={{ fontSize: 16, fontWeight: 800, color: T.text0, letterSpacing: "-0.02em" }}>{board.name}</span>
            {boards.length > 1 && (
              <button onClick={() => deleteBoard(board.id)} style={{ background: "none", border: "none", color: T.text3, cursor: "pointer", fontSize: 10, opacity: 0.5 }}>Delete</button>
            )}
          </div>

          <div style={{ display: "flex", gap: 4 }}>
            {([
              { type: "text" as const, icon: "📝", label: "Note" },
              { type: "checklist" as const, icon: "☑", label: "List" },
              { type: "chart" as const, icon: "📊", label: "Chart" },
              { type: "link" as const, icon: "🔗", label: "Link" },
              { type: "divider" as const, icon: "—", label: "Divider" },
            ]).map(t => (
              <button key={t.type} onClick={() => addCard(t.type)} style={{
                padding: "5px 10px", borderRadius: 8, fontSize: 11, fontWeight: 600,
                cursor: "pointer", background: T.bg2,
                border: `1px solid ${T.bg3}`, color: T.text2, transition: "all 0.15s",
              }}
                onMouseEnter={e => { e.currentTarget.style.background = `${board.color}15`; e.currentTarget.style.color = board.color; e.currentTarget.style.borderColor = `${board.color}44`; }}
                onMouseLeave={e => { e.currentTarget.style.background = T.bg2; e.currentTarget.style.color = T.text2; e.currentTarget.style.borderColor = T.bg3; }}
              >{t.icon} {t.label}</button>
            ))}
          </div>

          <div style={{ display: "flex", background: T.bg2, borderRadius: 8, border: `1px solid ${T.bg3}`, overflow: "hidden" }}>
            {(["canvas", "grid"] as const).map(v => (
              <button key={v} onClick={() => setViewMode(v)} style={{
                padding: "5px 10px", fontSize: 11, fontWeight: 600, cursor: "pointer",
                background: viewMode === v ? `${board.color}18` : "transparent",
                color: viewMode === v ? board.color : T.text3, border: "none",
              }}>{v === "canvas" ? "🔲 Canvas" : "▦ Grid"}</button>
            ))}
          </div>

          <div style={{ position: "relative" }}>
            <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search…"
              style={{ background: T.bg2, border: `1px solid ${T.bg3}`, borderRadius: 8, color: T.text1, padding: "6px 12px", fontSize: 11, outline: "none", width: 140 }} />
            {searchResults.length > 0 && searchQuery && (
              <div style={{ position: "absolute", top: "100%", right: 0, marginTop: 4, width: 280, ...panel(), padding: 8, zIndex: 100, maxHeight: 240, overflowY: "auto", background: T.bg1, boxShadow: "0 8px 32px rgba(0,0,0,0.4)" }}>
                {searchResults.map(r => (
                  <div key={r.card.id} onClick={() => { setActiveBoardId(r.board.id); setSearchQuery(""); }}
                    style={{ padding: "8px 10px", borderRadius: 8, cursor: "pointer", marginBottom: 2, transition: "background 0.1s" }}
                    onMouseEnter={e => e.currentTarget.style.background = T.bg2}
                    onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: T.text0 }}>{r.card.title}</div>
                    <div style={{ fontSize: 9, color: r.board.color, fontWeight: 500 }}>in {r.board.name}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Floating panel toggles */}
          <div style={{ display: "flex", gap: 4 }}>
            <button onClick={() => togglePanel("activity")} style={{
              padding: "5px 10px", borderRadius: 8, fontSize: 11, fontWeight: 600, cursor: "pointer",
              background: activityPanel ? `${T.accent}15` : T.bg2,
              color: activityPanel ? T.accent : T.text3,
              border: `1px solid ${activityPanel ? `${T.accent}44` : T.bg3}`,
            }}>⚡ Activity</button>
            <button onClick={() => togglePanel("chat")} style={{
              padding: "5px 10px", borderRadius: 8, fontSize: 11, fontWeight: 600, cursor: "pointer",
              background: chatPanel ? `${T.purple || "#8b5cf6"}15` : T.bg2,
              color: chatPanel ? (T.purple || "#8b5cf6") : T.text3,
              border: `1px solid ${chatPanel ? `${T.purple || "#8b5cf6"}44` : T.bg3}`,
            }}>
              💬 Chat
              {chatMessages.length > 0 && <span style={{ marginLeft: 4, fontSize: 9, background: T.purple || "#8b5cf6", color: "#fff", borderRadius: 999, padding: "1px 5px", fontWeight: 700 }}>{chatMessages.length}</span>}
            </button>
          </div>
        </div>

        {/* Canvas area - now full width since panels float */}
        <div ref={canvasRef}
          style={{
            flex: 1, position: "relative", overflow: "auto",
            background: T.bg0,
            backgroundImage: viewMode === "canvas" ? `radial-gradient(circle, ${T.bg3}44 1px, transparent 1px)` : undefined,
            backgroundSize: "24px 24px",
            cursor: draggingCardId != null || resizingCardId != null ? "grabbing" : "default",
            ...(viewMode === "grid" ? { padding: 16, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12, alignContent: "start" } : { minHeight: 800 }),
          }}>
          {board.cards.map(card => renderCard(card))}

          {board.cards.length === 0 && (
            <div style={{ position: viewMode === "canvas" ? "absolute" : "relative", inset: viewMode === "canvas" ? 0 : undefined, display: "flex", alignItems: "center", justifyContent: "center", gridColumn: "1/-1", minHeight: 400 }}>
              <div style={{ textAlign: "center", padding: 40 }}>
                <div style={{ fontSize: 48, marginBottom: 12, opacity: 0.2 }}>📌</div>
                <div style={{ fontSize: 16, color: T.text3, fontWeight: 600, marginBottom: 4 }}>Empty board</div>
                <div style={{ fontSize: 12, color: T.text3, opacity: 0.6 }}>Use the toolbar above to add notes, checklists, charts, and more</div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ═══ FLOATING PANELS (Chat / Activity as windows) ═══ */}
      {floatingPanels.map(fp => renderFloatingPanel(fp))}

      {/* ═══ CARD DETAIL POP-OUT WINDOW ═══ */}
      {selectedCard && selectedCard.type !== "divider" && (
        <>
          <div onClick={() => setSelectedCard(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 899, backdropFilter: "blur(6px)" }} />
          <PopoutCardWindow
            card={selectedCard}
            onClose={() => setSelectedCard(null)}
            onUpdateCard={(updates) => { updateCard(selectedCard.id, updates); setSelectedCard(prev => prev ? { ...prev, ...updates } : prev); }}
            newCardComment={newCardComment}
            setNewCardComment={setNewCardComment}
            addCardComment={() => addCardComment(selectedCard.id)}
          />
        </>
      )}

      {/* ═══ DIRECT NOTE MODAL ═══ */}
      {directNoteTarget && (
        <div onClick={() => { setDirectNoteTarget(null); setDirectNoteText(""); }} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 950, display: "flex", alignItems: "center", justifyContent: "center", backdropFilter: "blur(8px)" }}>
          <div onClick={e => e.stopPropagation()} style={{
            background: T.bg1, border: `1px solid ${directNoteTarget.color}33`,
            borderRadius: 16, padding: 24, width: 420, maxWidth: "95vw",
            boxShadow: `0 20px 60px rgba(0,0,0,0.5), 0 0 80px ${directNoteTarget.color}11`,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
              <Avatar name={directNoteTarget.name} size={40} />
              <div>
                <div style={{ fontSize: 16, fontWeight: 800, color: T.text0, letterSpacing: "-0.02em" }}>
                  Note for {directNoteTarget.name}
                </div>
                <div style={{ fontSize: 11, color: T.text3, marginTop: 2 }}>{directNoteTarget.role} · {directNoteTarget.status}</div>
              </div>
            </div>

            {/* Existing notes for this person */}
            {directNotes.filter(n => n.to === directNoteTarget.name).length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: T.text3, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 8 }}>Previous Notes</div>
                <div style={{ maxHeight: 160, overflowY: "auto" }}>
                  {directNotes.filter(n => n.to === directNoteTarget.name).map(n => (
                    <div key={n.id} style={{ padding: "8px 10px", background: T.bg2, borderRadius: 8, marginBottom: 4, border: `1px solid ${T.bg3}` }}>
                      <div style={{ fontSize: 11, color: T.text2, lineHeight: 1.4 }}>{n.text}</div>
                      <div style={{ fontSize: 9, color: T.text3, marginTop: 3 }}>
                        {n.from === me ? "You" : n.from} · {timeAgo(n.at)} · {n.board}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 10, fontWeight: 700, color: T.text3, textTransform: "uppercase", letterSpacing: "0.1em", display: "block", marginBottom: 6 }}>Your Note</label>
              <textarea
                autoFocus
                value={directNoteText}
                onChange={e => setDirectNoteText(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && e.metaKey) sendDirectNote(); }}
                placeholder={`Leave a note for ${directNoteTarget.name}…`}
                style={{
                  width: "100%", minHeight: 100, background: T.bg2, border: `1px solid ${T.bg3}`,
                  borderRadius: 10, color: T.text1, padding: "10px 14px", fontSize: 13,
                  lineHeight: 1.6, resize: "vertical", outline: "none", fontFamily: "inherit",
                }}
              />
              <div style={{ fontSize: 9, color: T.text3, marginTop: 4, opacity: 0.6 }}>⌘+Enter to send</div>
            </div>

            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={sendDirectNote} disabled={!directNoteText.trim()} style={{
                flex: 1, padding: "10px 16px", borderRadius: 10,
                background: directNoteText.trim() ? `linear-gradient(135deg, ${directNoteTarget.color}, ${directNoteTarget.color}cc)` : T.bg3,
                border: "none", color: directNoteText.trim() ? "#fff" : T.text3,
                fontSize: 13, fontWeight: 700, cursor: directNoteText.trim() ? "pointer" : "not-allowed",
                transition: "all 0.2s",
              }}>Send Note</button>
              <button onClick={() => { setDirectNoteTarget(null); setDirectNoteText(""); }} style={{
                padding: "10px 16px", borderRadius: 10, background: T.bg2,
                border: `1px solid ${T.bg3}`, color: T.text2, fontSize: 13,
                fontWeight: 600, cursor: "pointer",
              }}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ NEW BOARD MODAL ═══ */}
      {showNewBoard && (
        <div onClick={() => setShowNewBoard(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 950, display: "flex", alignItems: "center", justifyContent: "center", backdropFilter: "blur(8px)" }}>
          <div onClick={e => e.stopPropagation()} style={{ background: T.bg1, border: `1px solid ${newBoardColor}33`, borderRadius: 16, padding: 24, width: 380, maxWidth: "95vw", boxShadow: "0 20px 60px rgba(0,0,0,0.5)" }}>
            <h2 style={{ fontSize: 18, fontWeight: 800, color: T.text0, margin: "0 0 18px", letterSpacing: "-0.02em" }}>New Board</h2>
            <div style={{ marginBottom: 14 }}>
              <label style={S.label as React.CSSProperties}>Name</label>
              <input value={newBoardName} onChange={e => setNewBoardName(e.target.value)} onKeyDown={e => e.key === "Enter" && addBoard()}
                style={S.input as React.CSSProperties} autoFocus placeholder="Board name…" />
            </div>
            <div style={{ marginBottom: 18 }}>
              <label style={S.label as React.CSSProperties}>Color</label>
              <div style={{ display: "flex", gap: 8 }}>
                {BOARD_COLORS.map(c => (
                  <button key={c} onClick={() => setNewBoardColor(c)} style={{
                    width: 28, height: 28, borderRadius: "50%", background: c, cursor: "pointer",
                    border: newBoardColor === c ? "3px solid #fff" : "2px solid transparent", transition: "all 0.15s",
                  }} />
                ))}
              </div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={addBoard} style={S.btn as React.CSSProperties}>Create Board</button>
              <button onClick={() => setShowNewBoard(false)} style={S.btnGhost as React.CSSProperties}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .notes-card:hover .resize-handle { opacity: 1 !important; background: ${T.accent}44; }
        .notes-card:hover .resize-handle:hover { background: ${T.accent}88; }
        .notes-card--dragging { opacity: 0.96; }
        .notes-card--dragging .resize-handle { opacity: 1 !important; }
        @keyframes typingBounce {
          0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }
          30% { transform: translateY(-4px); opacity: 1; }
        }
      `}</style>
    </div>
  );
}
