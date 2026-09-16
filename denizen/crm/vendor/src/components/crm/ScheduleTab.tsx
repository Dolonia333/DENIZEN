import { useState, useMemo } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import { T, S, MEETING_TEMPLATES, type Task, type Meeting, type Deal, type Contact, type Subtask } from "@/lib/crm-data";

interface Props {
  tasks: Task[];
  deals: Deal[];
  meetings: Meeting[];
  contacts: Contact[];
  availability: {
    timezone: string; workdays: number[]; startHour: number; endHour: number;
    bufferTime: number; meetingTypes: { id: number; name: string; duration: number; description: string; color: string }[];
  };
  onToggleTask: (id: number) => void;
  onDeleteTask: (id: number) => void;
  onUpdateTask?: (task: Task) => void;
  onAddMeeting: (meeting: Meeting) => void;
  onUpdateMeeting: (meeting: Meeting) => void;
}

const COLUMNS = [
  { key: "todo" as const, label: "To Do", color: "#6366f1", icon: "○" },
  { key: "in-progress" as const, label: "In Progress", color: "#f0b429", icon: "◐" },
  { key: "in-review" as const, label: "In Review", color: "#8b5cf6", icon: "◑" },
  { key: "done" as const, label: "Done", color: "#22d3a0", icon: "●" },
];

const PRIORITY_META: Record<string, { label: string; color: string; bg: string }> = {
  Critical: { label: "Critical", color: "#ef4444", bg: "#ef444418" },
  High: { label: "High", color: "#fb923c", bg: "#fb923c18" },
  Medium: { label: "Medium", color: "#4d9ef7", bg: "#4d9ef718" },
  Low: { label: "Low", color: "#6b7280", bg: "#6b728018" },
};

function getUrgency(due: string): "overdue" | "due-soon" | "on-track" {
  if (!due) return "on-track";
  const now = new Date(); const d = new Date(due);
  const diff = (d.getTime() - now.getTime()) / 86400000;
  if (diff < 0) return "overdue";
  if (diff <= 3) return "due-soon";
  return "on-track";
}
const urgencyColor = { overdue: "#ef4444", "due-soon": "#fbbf24", "on-track": "#22d3a0" };

const MEETING_TYPE_COLORS: Record<string, string> = {
  discovery: "#4d9ef7", demo: "#f0b429", proposal: "#8b5cf6", "check-in": "#22d3a0", other: "#fb923c",
};

// ── Apple-style Ring Chart ──
function MiniRing({ segments, size = 64, stroke = 5 }: { segments: { value: number; color: string; label: string }[]; size?: number; stroke?: number }) {
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const total = segments.reduce((s, seg) => s + seg.value, 0) || 1;
  let offset = 0;
  return (
    <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={T.bg4} strokeWidth={stroke} opacity={0.3} />
      {segments.map((seg, i) => {
        const len = (seg.value / total) * circ;
        const gap = segments.length > 1 ? 2 : 0;
        const el = (
          <circle key={i} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={seg.color} strokeWidth={stroke}
            strokeDasharray={`${Math.max(0, len - gap)} ${circ}`} strokeDashoffset={-offset} strokeLinecap="round"
            style={{ transition: "stroke-dasharray 0.6s ease, stroke-dashoffset 0.6s ease" }} />
        );
        offset += len;
        return el;
      })}
    </svg>
  );
}

function Avatar({ name, size = 24 }: { name: string; size?: number }) {
  const colors = ["#6366f1", "#f0b429", "#22d3a0", "#8b5cf6", "#4d9ef7", "#fb923c"];
  const idx = name.split("").reduce((s, c) => s + c.charCodeAt(0), 0) % colors.length;
  return (
    <div style={{
      width: size, height: size, borderRadius: "50%", flexShrink: 0,
      background: `linear-gradient(135deg,${colors[idx]},${T.bg4})`,
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: size * 0.4, fontWeight: 700, color: "#fff",
    }}>
      {name.split(" ").map(w => w[0]).join("").slice(0, 2)}
    </div>
  );
}

// ── Glassmorphism card style ──
const glassCard = (accent?: string): React.CSSProperties => ({
  background: `linear-gradient(145deg, rgba(15,20,35,0.85), rgba(10,14,25,0.75))`,
  backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)",
  border: `1px solid ${accent ? `${accent}33` : T.bg4}`,
  borderRadius: T.radius.lg,
  boxShadow: `0 4px 24px rgba(0,0,0,0.3)${accent ? `, inset 0 1px 0 ${accent}11` : ""}`,
});

// ── Task Detail Slideout ──
function TaskDetailPanel({ task, onClose, onUpdate }: { task: Task; onClose: () => void; onUpdate: (t: Task) => void }) {
  const [editDesc, setEditDesc] = useState(false);
  const [desc, setDesc] = useState(task.description || "");
  const [newComment, setNewComment] = useState("");
  const [newSubtask, setNewSubtask] = useState("");
  const pm = PRIORITY_META[task.priority] || PRIORITY_META.Medium;
  const urgency = getUrgency(task.due);

  const toggleSubtask = (stId: number) => {
    onUpdate({ ...task, subtasks: (task.subtasks || []).map(s => s.id === stId ? { ...s, done: !s.done } : s) });
  };
  const addSubtask = () => {
    if (!newSubtask.trim()) return;
    onUpdate({ ...task, subtasks: [...(task.subtasks || []), { id: Date.now(), title: newSubtask.trim(), done: false }] });
    setNewSubtask("");
  };
  const addComment = () => {
    if (!newComment.trim()) return;
    onUpdate({ ...task, comments: [...(task.comments || []), { id: Date.now(), user: "John Doe", text: newComment.trim(), at: new Date().toISOString() }] });
    setNewComment("");
  };
  const changeStatus = (status: Task["status"]) => {
    const hist = [...(task.statusHistory || []), { status: status!, at: new Date().toISOString() }];
    onUpdate({ ...task, status, done: status === "done", statusHistory: hist });
  };

  return (
    <div style={{
      position: "fixed", top: 0, right: 0, bottom: 0, width: 480, maxWidth: "100vw",
      ...glassCard(), borderRadius: 0, borderLeft: `1px solid ${T.bg4}`, zIndex: 900,
      display: "flex", flexDirection: "column", boxShadow: "-12px 0 60px rgba(0,0,0,0.6)",
    }}>
      <div style={{ padding: "18px 22px", borderBottom: `1px solid ${T.bg4}`, display: "flex", alignItems: "center", gap: 12 }}>
        <button onClick={onClose} style={{ ...glassCard() as any, padding: "7px 14px", color: T.text2, cursor: "pointer", fontSize: 12, fontWeight: 600 }}>← Back</button>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 10, padding: "4px 10px", borderRadius: T.radius.full, background: pm.bg, color: pm.color, fontWeight: 700, letterSpacing: "0.02em" }}>{pm.label}</span>
        {task.isClientFacing && <span style={{ fontSize: 10, padding: "4px 10px", borderRadius: T.radius.full, background: `${T.accent}18`, color: T.accent, fontWeight: 600 }}>Client</span>}
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: 22 }}>
        <h2 style={{ fontSize: 20, fontWeight: 800, color: T.text0, margin: "0 0 6px", letterSpacing: "-0.02em" }}>{task.title}</h2>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 12, marginBottom: 18 }}>
          {task.assignee && <div style={{ display: "flex", alignItems: "center", gap: 6 }}><Avatar name={task.assignee} size={22} /><span style={{ fontSize: 12, color: T.text2 }}>{task.assignee}</span></div>}
          {task.due && <div style={{ display: "flex", alignItems: "center", gap: 5 }}><div style={{ width: 8, height: 8, borderRadius: "50%", background: urgencyColor[urgency] }} /><span style={{ fontSize: 12, color: T.text2 }}>Due {task.due}</span></div>}
        </div>
        {/* Status buttons */}
        <div style={{ display: "flex", gap: 4, marginBottom: 22 }}>
          {COLUMNS.map(c => (
            <button key={c.key} onClick={() => changeStatus(c.key)} style={{
              flex: 1, padding: "7px 0", borderRadius: T.radius.sm, fontSize: 11, fontWeight: 600, cursor: "pointer",
              background: task.status === c.key ? `${c.color}22` : "rgba(255,255,255,0.03)",
              color: task.status === c.key ? c.color : T.text3,
              border: `1px solid ${task.status === c.key ? `${c.color}66` : T.bg4}`,
              transition: "all 0.15s",
            }}>{c.label}</button>
          ))}
        </div>
        {/* Description */}
        <div style={{ marginBottom: 22 }}>
          <div style={{ fontSize: 10, color: T.text3, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 8 }}>Description</div>
          {editDesc ? (
            <div>
              <textarea value={desc} onChange={e => setDesc(e.target.value)} style={{ ...S.input as React.CSSProperties, minHeight: 80, resize: "vertical" }} />
              <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                <button onClick={() => { onUpdate({ ...task, description: desc }); setEditDesc(false); }} style={{ ...S.btn as React.CSSProperties, padding: "5px 12px", fontSize: 11 }}>Save</button>
                <button onClick={() => setEditDesc(false)} style={{ ...S.btnGhost as React.CSSProperties, padding: "5px 12px", fontSize: 11 }}>Cancel</button>
              </div>
            </div>
          ) : (
            <div onClick={() => setEditDesc(true)} style={{ fontSize: 13, color: task.description ? T.text1 : T.text3, cursor: "pointer", padding: "10px 12px", ...glassCard() as any, minHeight: 40 }}>
              {task.description || "Click to add description…"}
            </div>
          )}
        </div>
        {/* Subtasks */}
        <div style={{ marginBottom: 22 }}>
          <div style={{ fontSize: 10, color: T.text3, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 8 }}>
            Subtasks {task.subtasks && task.subtasks.length > 0 && `(${task.subtasks.filter(s => s.done).length}/${task.subtasks.length})`}
          </div>
          {(task.subtasks || []).map(st => (
            <div key={st.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 0" }}>
              <button onClick={() => toggleSubtask(st.id)} style={{
                width: 18, height: 18, borderRadius: T.radius.xs, flexShrink: 0,
                border: `2px solid ${st.done ? T.green : T.bg5}`, background: st.done ? T.green : "transparent",
                cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 10,
              }}>{st.done && "✓"}</button>
              <span style={{ fontSize: 13, color: st.done ? T.text3 : T.text1, textDecoration: st.done ? "line-through" : "none" }}>{st.title}</span>
            </div>
          ))}
          <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
            <input value={newSubtask} onChange={e => setNewSubtask(e.target.value)} placeholder="Add subtask…" onKeyDown={e => e.key === "Enter" && addSubtask()} style={{ ...S.input as React.CSSProperties, flex: 1, padding: "6px 10px", fontSize: 12 }} />
            <button onClick={addSubtask} style={{ ...S.btn as React.CSSProperties, padding: "6px 10px", fontSize: 11 }}>Add</button>
          </div>
        </div>
        {/* Comments */}
        <div>
          <div style={{ fontSize: 10, color: T.text3, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 8 }}>Comments</div>
          {(task.comments || []).map(c => (
            <div key={c.id} style={{ padding: "10px 12px", ...glassCard() as any, marginBottom: 6 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                <Avatar name={c.user} size={18} />
                <span style={{ fontSize: 11, fontWeight: 600, color: T.text1 }}>{c.user}</span>
                <span style={{ fontSize: 10, color: T.text3, marginLeft: "auto" }}>{new Date(c.at).toLocaleDateString()}</span>
              </div>
              <p style={{ fontSize: 12, color: T.text2, margin: 0 }}>{c.text}</p>
            </div>
          ))}
          <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
            <input value={newComment} onChange={e => setNewComment(e.target.value)} placeholder="Add a comment…" onKeyDown={e => e.key === "Enter" && addComment()} style={{ ...S.input as React.CSSProperties, flex: 1, padding: "6px 10px", fontSize: 12 }} />
            <button onClick={addComment} style={{ ...S.btn as React.CSSProperties, padding: "6px 10px", fontSize: 11 }}>Post</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── New Meeting Modal ──
function NewMeetingModal({ date, contacts, onSave, onClose }: {
  date: string; contacts: Contact[];
  onSave: (m: Meeting) => void; onClose: () => void;
}) {
  const [title, setTitle] = useState("");
  const [type, setType] = useState("discovery");
  const [time, setTime] = useState("10:00");
  const [duration, setDuration] = useState(30);
  const [contact, setContact] = useState("");
  const [notes, setNotes] = useState("");

  const save = () => {
    if (!title || !date || !time) return;
    onSave({
      id: Date.now(), title, type, date, time, duration, contact,
      attendees: contact ? [contact] : [], status: "confirmed", notes, meetingUrl: "",
    });
    onClose();
  };

  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 10050,
      display: "flex", alignItems: "flex-end", justifyContent: "center",
      backdropFilter: "blur(8px)", padding: 0,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        ...glassCard(T.accent), padding: "18px 16px calc(18px + env(safe-area-inset-bottom, 0px))",
        width: "100%", maxWidth: 520, maxHeight: "min(92dvh, 920px)", overflowY: "auto",
        borderRadius: "16px 16px 0 0", boxSizing: "border-box",
      }}>
        <h2 style={{ fontSize: 18, fontWeight: 800, color: T.text0, margin: "0 0 12px", letterSpacing: "-0.02em" }}>
          New Meeting — {new Date(date + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}
        </h2>
        {/* Templates */}
        <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
          {MEETING_TEMPLATES.map(tpl => (
            <button key={tpl.name} type="button" onClick={() => { setTitle(tpl.name); setType(tpl.type); setDuration(tpl.duration); }}
              style={{
                fontSize: 11, padding: "8px 12px", borderRadius: T.radius.sm, cursor: "pointer",
                background: title === tpl.name ? `${T.accent}22` : "rgba(255,255,255,0.04)",
                border: `1px solid ${title === tpl.name ? `${T.accent}66` : T.bg4}`,
                color: title === tpl.name ? T.accent : T.text3, fontWeight: 600, whiteSpace: "nowrap",
              }}>
              {tpl.name}
            </button>
          ))}
        </div>
        <div style={{ marginBottom: 12 }}><label style={S.label as React.CSSProperties}>Title *</label><input value={title} onChange={e => setTitle(e.target.value)} style={{ ...(S.input as React.CSSProperties), width: "100%", boxSizing: "border-box" }} /></div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 12, marginBottom: 12 }}>
          <div><label style={S.label as React.CSSProperties}>Time</label><input type="time" value={time} onChange={e => setTime(e.target.value)} style={{ ...(S.input as React.CSSProperties), width: "100%", boxSizing: "border-box" }} /></div>
          <div><label style={S.label as React.CSSProperties}>Duration</label>
            <select value={duration} onChange={e => setDuration(Number(e.target.value))} style={{ ...(S.input as React.CSSProperties), width: "100%", boxSizing: "border-box" }}>
              {[15, 30, 45, 60, 90].map(d => <option key={d} value={d}>{d} min</option>)}
            </select>
          </div>
        </div>
        <div style={{ marginBottom: 12 }}><label style={S.label as React.CSSProperties}>Contact</label>
          <select value={contact} onChange={e => setContact(e.target.value)} style={{ ...(S.input as React.CSSProperties), width: "100%", boxSizing: "border-box" }}>
            <option value="">Select…</option>
            {contacts.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
          </select>
        </div>
        <div style={{ marginBottom: 12 }}><label style={S.label as React.CSSProperties}>Notes</label>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} style={{ ...S.input as React.CSSProperties, minHeight: 60, resize: "vertical", width: "100%", boxSizing: "border-box" }} />
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button onClick={save} style={{ ...(S.btn as React.CSSProperties), flex: "1 1 100%" }}>Create Meeting</button>
          <button onClick={onClose} style={{ ...(S.btnGhost as React.CSSProperties), flex: "1 1 auto" }}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

type CalView = "month" | "week" | "day";
type MainView = "schedule" | "kanban" | "agenda";

export function ScheduleTab({ tasks, deals, meetings, contacts, availability, onToggleTask, onDeleteTask, onUpdateTask, onAddMeeting, onUpdateMeeting }: Props) {
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  const [mainView, setMainView] = useState<MainView>("schedule");
  const [calView, setCalView] = useState<CalView>("month");
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [selectedDate, setSelectedDate] = useState<string | null>(todayStr);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [mobilePanel, setMobilePanel] = useState<"calendar" | "tasks">("calendar");
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [quickAddDate, setQuickAddDate] = useState(todayStr);
  const [quickTitle, setQuickTitle] = useState("");
  const [quickPriority, setQuickPriority] = useState("Medium");
  const [quickAssignee, setQuickAssignee] = useState("");
  const [showNewMeeting, setShowNewMeeting] = useState(false);
  const [meetingDate, setMeetingDate] = useState(todayStr);
  const [dayViewDate, setDayViewDate] = useState(todayStr);

  // Kanban drag
  const [dragTask, setDragTask] = useState<Task | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  const isMobile = useIsMobile();

  const getStatus = (t: Task): string => t.status || (t.done ? "done" : "todo");

  // ── Stats ──
  const totalTasks = tasks.length;
  const doneTasks = tasks.filter(t => getStatus(t) === "done").length;
  const tasksDueToday = useMemo(() => tasks.filter(t => t.due === todayStr && !t.done), [tasks, todayStr]);
  const overdueTasks = useMemo(() => tasks.filter(t => !t.done && t.due && new Date(t.due) < today && t.due !== todayStr), [tasks, todayStr]);
  const upcomingTasks = useMemo(() => {
    const next7 = new Date(today); next7.setDate(next7.getDate() + 7);
    return tasks.filter(t => !t.done && t.due && new Date(t.due) > today && new Date(t.due) <= next7);
  }, [tasks, today]);
  const meetingsToday = useMemo(() => meetings.filter(m => m.date === todayStr), [meetings, todayStr]);
  const inProgressTasks = tasks.filter(t => getStatus(t) === "in-progress").length;
  const completionPct = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;

  // Calendar helpers
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDow = new Date(year, month, 1).getDay();
  const monthName = new Date(year, month).toLocaleString("default", { month: "long" });
  const prev = () => { setSelectedDate(null); if (month === 0) { setMonth(11); setYear(y => y - 1); } else setMonth(m => m - 1); };
  const next = () => { setSelectedDate(null); if (month === 11) { setMonth(0); setYear(y => y + 1); } else setMonth(m => m + 1); };

  // Events map
  const eventsMap = useMemo(() => {
    const map: Record<string, { label: string; type: string; color: string; taskId?: number; meetingId?: number }[]> = {};
    const add = (date: string, ev: (typeof map)[string][0]) => { if (!date) return; if (!map[date]) map[date] = []; map[date].push(ev); };
    tasks.forEach(t => {
      if (!t.done && t.due) {
        const isOverdue = new Date(t.due) < today;
        const pm = PRIORITY_META[t.priority] || PRIORITY_META.Medium;
        add(t.due, { label: t.title, type: isOverdue ? "overdue" : "task", color: pm.color, taskId: t.id });
      }
    });
    deals.filter(d => !["Closed Won", "Closed Lost"].includes(d.stage)).forEach(d => {
      add(d.closeDate, { label: `Close: ${d.title}`, type: "deal", color: T.accent });
    });
    meetings.forEach(m => {
      add(m.date, { label: `${m.time} ${m.title}`, type: "meeting", color: MEETING_TYPE_COLORS[m.type] || "#8b5cf6", meetingId: m.id });
    });
    return map;
  }, [tasks, deals, meetings, today]);

  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  const tasksForDate = useMemo(() => {
    if (!selectedDate) return tasks.filter(t => !t.done);
    return tasks.filter(t => t.due === selectedDate);
  }, [tasks, selectedDate]);

  const meetingsForDate = useMemo(() => {
    if (!selectedDate) return meetingsToday;
    return meetings.filter(m => m.date === selectedDate).sort((a, b) => a.time.localeCompare(b.time));
  }, [meetings, selectedDate, meetingsToday]);

  // Week helpers
  const toDateStr = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const getWeekStart = (dateStr: string) => { const d = new Date(dateStr + "T12:00:00"); d.setDate(d.getDate() - d.getDay()); return d; };
  const weekDates = useMemo(() => {
    const start = getWeekStart(dayViewDate);
    return Array.from({ length: 7 }, (_, i) => { const d = new Date(start); d.setDate(d.getDate() + i); return toDateStr(d); });
  }, [dayViewDate]);
  const prevWeek = () => { const d = new Date(dayViewDate + "T12:00:00"); d.setDate(d.getDate() - 7); setDayViewDate(toDateStr(d)); };
  const nextWeek = () => { const d = new Date(dayViewDate + "T12:00:00"); d.setDate(d.getDate() + 7); setDayViewDate(toDateStr(d)); };
  const prevDay = () => { const d = new Date(dayViewDate + "T12:00:00"); d.setDate(d.getDate() - 1); setDayViewDate(toDateStr(d)); };
  const nextDay = () => { const d = new Date(dayViewDate + "T12:00:00"); d.setDate(d.getDate() + 1); setDayViewDate(toDateStr(d)); };

  // Kanban
  const colTasks = (key: string) => tasks.filter(t => getStatus(t) === key);
  const handleDrop = (status: string) => {
    if (!dragTask || !onUpdateTask) return;
    const hist = [...(dragTask.statusHistory || []), { status, at: new Date().toISOString() }];
    onUpdateTask({ ...dragTask, status: status as Task["status"], done: status === "done", statusHistory: hist });
    setDragTask(null); setDropTarget(null);
  };

  // Agenda items
  const agendaItems = useMemo(() => {
    const items: { date: string; label: string; type: string; color: string; time?: string; task?: Task; meeting?: Meeting }[] = [];
    const allDates = new Set<string>();
    tasks.forEach(t => { if (t.due && !t.done) allDates.add(t.due); });
    meetings.forEach(m => allDates.add(m.date));
    const sorted = Array.from(allDates).sort();
    sorted.forEach(date => {
      meetings.filter(m => m.date === date).sort((a, b) => a.time.localeCompare(b.time)).forEach(m => {
        items.push({ date, label: m.title, type: "meeting", color: MEETING_TYPE_COLORS[m.type] || "#8b5cf6", time: m.time, meeting: m });
      });
      tasks.filter(t => t.due === date && !t.done).forEach(t => {
        const pm = PRIORITY_META[t.priority] || PRIORITY_META.Medium;
        items.push({ date, label: t.title, type: "task", color: pm.color, task: t });
      });
    });
    return items;
  }, [tasks, meetings]);

  const handleQuickAdd = () => {
    if (!quickTitle.trim() || !onUpdateTask) return;
    onUpdateTask({
      id: Date.now(), title: quickTitle.trim(), contact: "", due: quickAddDate,
      priority: quickPriority, done: false, status: "todo",
      assignee: quickAssignee || undefined, createdBy: "John Doe",
      createdAt: todayStr, statusHistory: [{ status: "todo", at: new Date().toISOString() }],
    });
    setQuickTitle(""); setShowQuickAdd(false);
  };

  const handleTaskUpdate = (t: Task) => { if (onUpdateTask) onUpdateTask(t); setSelectedTask(t); };

  const openQuickAdd = (date: string) => { setQuickAddDate(date); setQuickTitle(""); setQuickPriority("Medium"); setQuickAssignee(""); setShowQuickAdd(true); };
  const openNewMeeting = (date: string) => { setMeetingDate(date); setShowNewMeeting(true); };

  // ── Ring data ──
  const taskRingSegments = COLUMNS.map(c => ({ value: colTasks(c.key).length, color: c.color, label: c.label }));
  const priorityRingSegments = Object.entries(PRIORITY_META).map(([k, v]) => ({
    value: tasks.filter(t => t.priority === k && !t.done).length, color: v.color, label: k,
  })).filter(s => s.value > 0);

  // ── Nav arrow btn ──
  const navBtn = (onClick: () => void, label: string) => (
    <button onClick={onClick} style={{
      ...glassCard() as any, padding: "5px 12px", color: T.text2, cursor: "pointer", fontSize: 14,
      fontWeight: 500, transition: "all 0.15s", lineHeight: 1,
    }}
      onMouseEnter={e => { e.currentTarget.style.color = T.accent; e.currentTarget.style.borderColor = `${T.accent}44`; }}
      onMouseLeave={e => { e.currentTarget.style.color = T.text2; e.currentTarget.style.borderColor = T.bg4; }}
    >{label}</button>
  );

  return (
    <div>
      {/* ═══════════ COMMAND CENTER HEADER ═══════════ */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
        <div style={{ minWidth: 0, flex: isMobile ? "1 1 100%" : undefined }}>
          <h1 style={{ fontSize: isMobile ? 22 : 26, fontWeight: 800, color: T.text0, margin: 0, letterSpacing: "-0.03em" }}>
            Schedule {isMobile ? null : <span style={{ fontSize: 14, fontWeight: 500, color: T.text3, marginLeft: 6 }}>Command Center</span>}
          </h1>
          <p style={{ fontSize: 12, color: T.text3, marginTop: 4 }}>
            {today.toLocaleDateString("en-US", { weekday: isMobile ? "short" : "long", month: "long", day: "numeric", year: "numeric" })}
          </p>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", width: isMobile ? "100%" : undefined }}>
          {(["schedule", "kanban", "agenda"] as MainView[]).map(v => (
            <button key={v} onClick={() => setMainView(v)} style={{
              ...glassCard(mainView === v ? T.accent : undefined) as any,
              padding: isMobile ? "8px 10px" : "7px 16px", fontSize: isMobile ? 11 : 12, fontWeight: 600, cursor: "pointer",
              color: mainView === v ? T.accent : T.text3, transition: "all 0.15s",
              flex: isMobile ? "1 1 calc(33.33% - 6px)" : undefined, textAlign: "center", minWidth: 0,
            }}>
              {isMobile
                ? (v === "schedule" ? "Schedule" : v === "kanban" ? "Kanban" : "Agenda")
                : (v === "schedule" ? "📅 Schedule" : v === "kanban" ? "◆ Kanban" : "📋 Agenda")}
            </button>
          ))}
        </div>
      </div>

      {/* ═══════════ STATS DASHBOARD ═══════════ */}
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(5, 1fr)", gap: 12, marginBottom: 20 }}>
        {/* Completion Ring */}
        <div style={{ ...glassCard(T.accent), padding: 16, display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ position: "relative" }}>
            <MiniRing segments={taskRingSegments} size={56} stroke={5} />
            <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 800, color: T.text0, fontFamily: "'JetBrains Mono', monospace" }}>{completionPct}%</div>
          </div>
          <div>
            <div style={{ fontSize: 10, color: T.text3, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" }}>Completion</div>
            <div style={{ fontSize: 18, fontWeight: 800, color: T.text0, fontFamily: "'JetBrains Mono', monospace" }}>{doneTasks}/{totalTasks}</div>
          </div>
        </div>

        {/* Due Today */}
        <div onClick={() => setSelectedDate(todayStr)} style={{ ...glassCard(T.accent), padding: 16, cursor: "pointer" }}>
          <div style={{ fontSize: 10, color: T.text3, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>Due Today</div>
          <div style={{ fontSize: 28, fontWeight: 900, color: T.accent, fontFamily: "'JetBrains Mono', monospace", lineHeight: 1 }}>{tasksDueToday.length}</div>
          <div style={{ fontSize: 10, color: T.text3, marginTop: 4 }}>{inProgressTasks} in progress</div>
        </div>

        {/* Overdue */}
        <div style={{ ...glassCard(overdueTasks.length > 0 ? "#ef4444" : undefined), padding: 16 }}>
          <div style={{ fontSize: 10, color: T.text3, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>Overdue</div>
          <div style={{ fontSize: 28, fontWeight: 900, color: overdueTasks.length > 0 ? "#ef4444" : T.text0, fontFamily: "'JetBrains Mono', monospace", lineHeight: 1 }}>{overdueTasks.length}</div>
          <div style={{ fontSize: 10, color: T.text3, marginTop: 4 }}>
            {overdueTasks.length > 0 ? "Needs attention" : "All clear"}
          </div>
        </div>

        {/* Upcoming */}
        <div style={{ ...glassCard(), padding: 16 }}>
          <div style={{ fontSize: 10, color: T.text3, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>Next 7 Days</div>
          <div style={{ fontSize: 28, fontWeight: 900, color: T.blue, fontFamily: "'JetBrains Mono', monospace", lineHeight: 1 }}>{upcomingTasks.length}</div>
          <div style={{ fontSize: 10, color: T.text3, marginTop: 4 }}>tasks upcoming</div>
        </div>

        {/* Meetings */}
        <div style={{ ...glassCard("#8b5cf6"), padding: 16 }}>
          <div style={{ fontSize: 10, color: T.text3, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>Meetings Today</div>
          <div style={{ fontSize: 28, fontWeight: 900, color: "#8b5cf6", fontFamily: "'JetBrains Mono', monospace", lineHeight: 1 }}>{meetingsToday.length}</div>
          <div style={{ fontSize: 10, color: T.text3, marginTop: 4 }}>{meetings.length} total scheduled</div>
        </div>
      </div>

      {/* ═══════════ SCHEDULE VIEW ═══════════ */}
      {mainView === "schedule" && (
        <>
          {/* Mobile toggle */}
          {isMobile && (
            <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
              {(["calendar", "tasks"] as const).map(p => (
                <button key={p} onClick={() => setMobilePanel(p)} style={{
                  flex: 1, padding: "9px 0", fontSize: 12, fontWeight: 600, cursor: "pointer",
                  ...glassCard(mobilePanel === p ? T.accent : undefined) as any,
                  color: mobilePanel === p ? T.accent : T.text3,
                }}>{p === "calendar" ? "📅 Calendar" : "☑ Tasks"}</button>
              ))}
            </div>
          )}

          <div style={{ display: isMobile ? "block" : "grid", gridTemplateColumns: "1fr 380px", gap: 16 }}>
            {/* ── LEFT: Calendar ── */}
            {(!isMobile || mobilePanel === "calendar") && (
              <div style={{ ...glassCard(), overflow: "hidden" }}>
                <div style={{
                  padding: isMobile ? "12px 12px" : "14px 18px",
                  borderBottom: `1px solid ${T.bg4}`,
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  flexWrap: "wrap",
                }}>
                  <div style={{ display: "flex", gap: 3, flex: isMobile ? "1 1 100%" : undefined }}>
                    {(["month", "week", "day"] as CalView[]).map(v => (
                      <button key={v} onClick={() => setCalView(v)} style={{
                        padding: isMobile ? "8px 0" : "5px 12px",
                        borderRadius: T.radius.full, fontSize: 11, fontWeight: 600, cursor: "pointer",
                        background: calView === v ? `${T.accent}22` : "rgba(255,255,255,0.03)",
                        color: calView === v ? T.accent : T.text3,
                        border: `1px solid ${calView === v ? `${T.accent}55` : "transparent"}`,
                        transition: "all 0.15s",
                        flex: isMobile ? 1 : undefined,
                        textAlign: "center",
                      }}>{v.charAt(0).toUpperCase() + v.slice(1)}</button>
                    ))}
                  </div>
                  {!isMobile && <div style={{ flex: 1 }} />}
                  <div style={{ display: "flex", alignItems: "center", gap: 6, flex: isMobile ? "1 1 100%" : undefined, justifyContent: "center" }}>
                    {calView === "month" && (
                      <>{navBtn(prev, "‹")}<span style={{ fontSize: isMobile ? 13 : 14, fontWeight: 700, color: T.text0, minWidth: isMobile ? 0 : 130, textAlign: "center", flex: isMobile ? 1 : undefined }}>{isMobile ? `${monthName.slice(0, 3)} ${year}` : `${monthName} ${year}`}</span>{navBtn(next, "›")}</>
                    )}
                    {calView === "week" && (
                      <>{navBtn(prevWeek, "‹")}<span style={{ fontSize: isMobile ? 11 : 12, fontWeight: 600, color: T.text0, textAlign: "center", flex: 1 }}>{new Date(weekDates[0] + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })} — {new Date(weekDates[6] + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>{navBtn(nextWeek, "›")}</>
                    )}
                    {calView === "day" && (
                      <>{navBtn(prevDay, "‹")}<span style={{ fontSize: isMobile ? 11 : 12, fontWeight: 600, color: T.text0, textAlign: "center", flex: 1 }}>{new Date(dayViewDate + "T12:00:00").toLocaleDateString("en-US", { weekday: isMobile ? "short" : "long", month: "short", day: "numeric", year: isMobile ? undefined : "numeric" })}</span>{navBtn(nextDay, "›")}</>
                    )}
                  </div>
                </div>

                {/* MONTH */}
                {calView === "month" && (
                  <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed", border: `1px solid ${T.gridLine}`, borderRadius: T.radius.md, overflow: "hidden" }}>
                    <thead>
                      <tr>
                        {(["S", "M", "T", "W", "T", "F", "S"] as const).map((d, i) => (
                          <th key={`${d}-${i}`} style={{
                            textAlign: "center", fontSize: 10, color: i === 0 || i === 6 ? T.text3 : T.text2,
                            fontWeight: 600, padding: isMobile ? "6px 0" : "10px 0",
                            letterSpacing: isMobile ? "0.04em" : "0.12em",
                            fontFamily: "'JetBrains Mono', monospace",
                            borderBottom: `1px solid ${T.gridLineStrong}`,
                            borderRight: i < 6 ? `1px solid ${T.gridLine}` : "none",
                            background: T.bg3,
                          }}>{isMobile ? d : ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"][i]}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {Array.from({ length: Math.ceil(cells.length / 7) }, (_, rowIdx) => (
                        <tr key={rowIdx}>
                          {cells.slice(rowIdx * 7, rowIdx * 7 + 7).map((day, colIdx) => {
                            const isLastRow = rowIdx === Math.ceil(cells.length / 7) - 1;
                            const cellStyle: React.CSSProperties = {
                              height: isMobile ? 52 : 88, padding: isMobile ? "4px 2px" : "6px 8px", verticalAlign: "top",
                              borderRight: colIdx < 6 ? `1px solid ${T.gridLine}` : "none",
                              borderBottom: !isLastRow ? `1px solid ${T.gridLine}` : "none",
                            };
                            if (day === null) return <td key={`e-${colIdx}`} style={{ ...cellStyle, background: "rgba(255,255,255,0.01)" }} />;
                            const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
                            const events = eventsMap[dateStr] || [];
                            const isToday = dateStr === todayStr;
                            const isSelected = dateStr === selectedDate;
                            const isWeekend = colIdx === 0 || colIdx === 6;
                            const taskCount = events.filter(e => e.type === "task" || e.type === "overdue").length;
                            const meetingCount = events.filter(e => e.type === "meeting").length;
                            return (
                              <td key={dateStr}
                                onClick={() => { setSelectedDate(dateStr); if (isMobile) setMobilePanel("tasks"); }}
                                onDoubleClick={() => openQuickAdd(dateStr)}
                                style={{
                                  ...cellStyle, cursor: "pointer", position: "relative",
                                  background: isSelected
                                    ? `linear-gradient(180deg, ${T.accent}14, ${T.accent}08)`
                                    : isToday ? `${T.accent}08` : isWeekend ? "rgba(255,255,255,0.015)" : "transparent",
                                  transition: "background 0.15s ease",
                                }}
                                onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = "rgba(255,255,255,0.04)"; }}
                                onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = isToday ? `${T.accent}08` : isWeekend ? "rgba(255,255,255,0.015)" : "transparent"; }}
                              >
                                {isSelected && <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: `linear-gradient(90deg, ${T.accent}, ${T.accent}66)` }} />}
                                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: isMobile ? 2 : 6 }}>
                                  <span style={{
                                    fontSize: isMobile ? 12 : 13, fontWeight: isToday ? 800 : 500,
                                    color: isToday ? "#080d18" : isWeekend ? T.text3 : T.text1,
                                    fontFamily: "'JetBrains Mono', monospace",
                                    ...(isToday ? {
                                      background: `linear-gradient(135deg, ${T.accent}, #d97706)`,
                                      width: isMobile ? 22 : 26, height: isMobile ? 22 : 26, borderRadius: "50%",
                                      display: "inline-flex", alignItems: "center", justifyContent: "center",
                                      lineHeight: 1,
                                    } : {}),
                                  }}>{day}</span>
                                  <div style={{ display: "flex", gap: 3 }}>
                                    {meetingCount > 0 && <div style={{ width: 5, height: 5, borderRadius: "50%", background: "#8b5cf6" }} />}
                                    {taskCount > 0 && <div style={{ width: 5, height: 5, borderRadius: "50%", background: events.some(e => e.type === "overdue") ? "#ef4444" : T.accent }} />}
                                  </div>
                                </div>
                                {!isMobile && (
                                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                                  {events.slice(0, 2).map((ev, i) => (
                                    <div key={i} style={{
                                      fontSize: 9, lineHeight: 1.3, padding: "2px 5px", borderRadius: 4,
                                      background: `${ev.color}14`, color: ev.color, fontWeight: 500,
                                      whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                                      borderLeft: `2px solid ${ev.color}66`,
                                    }}>{ev.label}</div>
                                  ))}
                                  {events.length > 2 && (
                                    <span style={{ fontSize: 9, color: T.text3, fontWeight: 500, paddingLeft: 5, fontFamily: "'JetBrains Mono', monospace" }}>
                                      +{events.length - 2} more
                                    </span>
                                  )}
                                </div>
                                )}
                                {isMobile && events.length > 0 && (
                                  <div style={{ fontSize: 8, color: T.text3, textAlign: "center", fontFamily: "'JetBrains Mono', monospace", lineHeight: 1 }}>
                                    {events.length}
                                  </div>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}

                {/* WEEK */}
                {calView === "week" && (
                  <div style={{ padding: isMobile ? 10 : 14, border: `1px solid ${T.gridLine}`, borderRadius: T.radius.md }}>
                    {isMobile ? (
                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        {weekDates.map((dateStr) => {
                          const d = new Date(dateStr + "T12:00:00");
                          const events = eventsMap[dateStr] || [];
                          const isToday = dateStr === todayStr;
                          const isSelected = dateStr === selectedDate;
                          return (
                            <button
                              key={dateStr}
                              type="button"
                              onClick={() => { setSelectedDate(dateStr); setMobilePanel("tasks"); }}
                              style={{
                                display: "flex", alignItems: "center", gap: 12, width: "100%",
                                padding: "12px 12px", textAlign: "left", cursor: "pointer",
                                borderRadius: T.radius.md,
                                border: `1px solid ${isSelected ? `${T.accent}66` : isToday ? `${T.accent}44` : T.gridLine}`,
                                background: isSelected ? `${T.accent}14` : isToday ? `${T.accent}08` : "rgba(255,255,255,0.02)",
                              }}
                            >
                              <div style={{ width: 44, flexShrink: 0, textAlign: "center" }}>
                                <div style={{ fontSize: 9, color: T.text3, textTransform: "uppercase", fontWeight: 700, letterSpacing: "0.1em", fontFamily: "'JetBrains Mono', monospace" }}>
                                  {d.toLocaleDateString("en-US", { weekday: "short" })}
                                </div>
                                <div style={{ fontSize: 18, fontWeight: isToday ? 900 : 700, color: isToday ? T.accent : T.text0, fontFamily: "'JetBrains Mono', monospace" }}>
                                  {d.getDate()}
                                </div>
                              </div>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                {events.length === 0 ? (
                                  <div style={{ fontSize: 11, color: T.text3 }}>No meetings</div>
                                ) : (
                                  <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                                    {events.slice(0, 2).map((ev, i) => (
                                      <div key={i} style={{
                                        fontSize: 11, color: ev.color, fontWeight: 500,
                                        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                                      }}>{ev.label}</div>
                                    ))}
                                    {events.length > 2 && (
                                      <div style={{ fontSize: 10, color: T.text3 }}>+{events.length - 2} more</div>
                                    )}
                                  </div>
                                )}
                              </div>
                              <span style={{ fontSize: 11, color: T.accent, fontWeight: 600, flexShrink: 0 }}>Open →</span>
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 0 }}>
                      {weekDates.map((dateStr, colIdx) => {
                        const d = new Date(dateStr + "T12:00:00");
                        const events = eventsMap[dateStr] || [];
                        const isToday = dateStr === todayStr;
                        const isSelected = dateStr === selectedDate;
                        return (
                          <div key={dateStr}
                            onClick={() => { setSelectedDate(dateStr); if (isMobile) setMobilePanel("tasks"); }}
                            onDoubleClick={() => openQuickAdd(dateStr)}
                            style={{
                              minHeight: 160, padding: 10, cursor: "pointer",
                              background: isSelected
                                ? `linear-gradient(180deg, ${T.accent}14, ${T.accent}06)`
                                : isToday ? `${T.accent}08` : "rgba(255,255,255,0.02)",
                              borderRight: colIdx < 6 ? `1px solid ${T.gridLine}` : "none",
                              borderLeft: colIdx === 0 ? "none" : undefined,
                              transition: "all 0.15s ease",
                              position: "relative",
                            }}
                            onMouseEnter={e => { if (!isSelected) { e.currentTarget.style.background = "rgba(255,255,255,0.04)"; } }}
                            onMouseLeave={e => { if (!isSelected) { e.currentTarget.style.background = isToday ? `${T.accent}08` : "rgba(255,255,255,0.02)"; } }}
                          >
                            {isSelected && <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, borderRadius: `${T.radius.md} ${T.radius.md} 0 0`, background: `linear-gradient(90deg, ${T.accent}, transparent)` }} />}
                            <div style={{ textAlign: "center", marginBottom: 8, paddingBottom: 8, borderBottom: `1px solid ${T.gridLine}` }}>
                              <div style={{ fontSize: 9, color: T.text3, textTransform: "uppercase", fontWeight: 700, letterSpacing: "0.15em", fontFamily: "'JetBrains Mono', monospace" }}>{d.toLocaleDateString("en-US", { weekday: "short" })}</div>
                              <div style={{
                                fontSize: 22, fontWeight: isToday ? 900 : 700,
                                color: isToday ? T.accent : T.text0,
                                fontFamily: "'JetBrains Mono', monospace", lineHeight: 1.4,
                              }}>{d.getDate()}</div>
                            </div>
                            <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                              {events.slice(0, 4).map((ev, i) => (
                                <div key={i} style={{
                                  fontSize: 9, padding: "3px 6px", borderRadius: 4,
                                  background: `${ev.color}14`, color: ev.color, fontWeight: 500,
                                  borderLeft: `2px solid ${ev.color}66`,
                                  whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                                }}>{ev.label}</div>
                              ))}
                              {events.length > 4 && <span style={{ fontSize: 9, color: T.text3, paddingLeft: 6, fontFamily: "'JetBrains Mono', monospace" }}>+{events.length - 4}</span>}
                              {events.length === 0 && <div style={{ fontSize: 9, color: T.text3, textAlign: "center", opacity: 0.3, marginTop: 8 }}>—</div>}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    )}
                  </div>
                )}

                {/* DAY */}
                {calView === "day" && (
                  <div style={{ padding: 18, maxHeight: 520, overflowY: "auto" }}>
                    {(() => {
                      const dayTasks = tasks.filter(t => t.due === dayViewDate);
                      const dayMeetings = meetings.filter(m => m.date === dayViewDate).sort((a, b) => a.time.localeCompare(b.time));
                      const isToday = dayViewDate === todayStr;
                      return (
                        <div>
                          {/* Day header */}
                          <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 20, paddingBottom: 14, borderBottom: `1px solid ${T.bg4}`, flexWrap: "wrap" }}>
                            <div style={{
                              width: 52, height: 52, borderRadius: T.radius.md,
                              background: isToday ? `linear-gradient(135deg, ${T.accent}, #d97706)` : T.bg3,
                              display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column",
                            }}>
                              <span style={{ fontSize: 9, fontWeight: 700, color: isToday ? "#080d18" : T.text3, textTransform: "uppercase", lineHeight: 1, fontFamily: "'JetBrains Mono', monospace" }}>
                                {new Date(dayViewDate + "T12:00:00").toLocaleDateString("en-US", { month: "short" })}
                              </span>
                              <span style={{ fontSize: 20, fontWeight: 900, color: isToday ? "#080d18" : T.text0, lineHeight: 1, fontFamily: "'JetBrains Mono', monospace" }}>
                                {new Date(dayViewDate + "T12:00:00").getDate()}
                              </span>
                            </div>
                            <div style={{ flex: "1 1 auto", minWidth: 0 }}>
                              <div style={{ fontSize: 15, fontWeight: 700, color: T.text0 }}>
                                {new Date(dayViewDate + "T12:00:00").toLocaleDateString("en-US", { weekday: "long" })}
                              </div>
                              <div style={{ fontSize: 11, color: T.text3 }}>
                                {dayMeetings.length} meeting{dayMeetings.length !== 1 ? "s" : ""} · {dayTasks.length} task{dayTasks.length !== 1 ? "s" : ""}
                              </div>
                            </div>
                            <div style={{ display: "flex", gap: 6, flex: isMobile ? "1 1 100%" : undefined }}>
                              <button onClick={() => openQuickAdd(dayViewDate)} style={{ ...glassCard() as any, padding: "8px 14px", fontSize: 11, fontWeight: 600, color: T.accent, cursor: "pointer", flex: isMobile ? 1 : undefined }}>+ Task</button>
                              <button onClick={() => openNewMeeting(dayViewDate)} style={{ ...glassCard() as any, padding: "8px 14px", fontSize: 11, fontWeight: 600, color: "#8b5cf6", cursor: "pointer", flex: isMobile ? 1 : undefined }}>+ Meeting</button>
                            </div>
                          </div>

                          {dayMeetings.length > 0 && (
                            <div style={{ marginBottom: 20 }}>
                              <div style={{ fontSize: 10, color: T.text3, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 10, fontFamily: "'JetBrains Mono', monospace" }}>Meetings</div>
                              {dayMeetings.map(m => (
                                <div key={m.id} style={{
                                  display: "flex", alignItems: "center", gap: 14, padding: "12px 16px", marginBottom: 6,
                                  borderRadius: T.radius.md, background: "rgba(139,92,246,0.04)",
                                  border: `1px solid rgba(139,92,246,0.12)`, transition: "all 0.15s",
                                }}
                                  onMouseEnter={e => { e.currentTarget.style.background = "rgba(139,92,246,0.08)"; }}
                                  onMouseLeave={e => { e.currentTarget.style.background = "rgba(139,92,246,0.04)"; }}
                                >
                                  <div style={{ width: 3, height: 32, borderRadius: 2, background: MEETING_TYPE_COLORS[m.type] || "#8b5cf6", flexShrink: 0 }} />
                                  <span style={{ fontSize: 13, fontWeight: 700, color: "#8b5cf6", fontFamily: "'JetBrains Mono', monospace", width: 52, flexShrink: 0 }}>{m.time}</span>
                                  <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontSize: 13, fontWeight: 600, color: T.text0 }}>{m.title}</div>
                                    {m.contact && <div style={{ fontSize: 10, color: T.text3, marginTop: 1 }}>with {m.contact}</div>}
                                  </div>
                                  <span style={{ fontSize: 10, color: T.text3, fontFamily: "'JetBrains Mono', monospace" }}>{m.duration}m</span>
                                </div>
                              ))}
                            </div>
                          )}
                          {dayTasks.length > 0 && (
                            <div>
                              <div style={{ fontSize: 10, color: T.text3, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 10, fontFamily: "'JetBrains Mono', monospace" }}>Tasks</div>
                              {dayTasks.map(t => {
                                const pm = PRIORITY_META[t.priority] || PRIORITY_META.Medium;
                                return (
                                  <div key={t.id} onClick={() => setSelectedTask(t)} style={{
                                    display: "flex", alignItems: "center", gap: 12, padding: "12px 16px",
                                    marginBottom: 6, cursor: "pointer", borderRadius: T.radius.md,
                                    background: "rgba(255,255,255,0.02)", border: `1px solid ${T.bg4}`,
                                    borderLeft: `3px solid ${pm.color}`, transition: "all 0.15s",
                                  }}
                                    onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,255,255,0.05)"; }}
                                    onMouseLeave={e => { e.currentTarget.style.background = "rgba(255,255,255,0.02)"; }}
                                  >
                                    <span style={{ fontSize: 13, color: t.done ? T.text3 : T.text0, flex: 1, fontWeight: 500, textDecoration: t.done ? "line-through" : "none" }}>{t.title}</span>
                                    <span style={{ fontSize: 9, padding: "3px 10px", borderRadius: T.radius.full, background: pm.bg, color: pm.color, fontWeight: 700 }}>{pm.label}</span>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                          {dayMeetings.length === 0 && dayTasks.length === 0 && (
                            <div style={{ padding: 60, textAlign: "center" }}>
                              <div style={{ fontSize: 36, marginBottom: 12, opacity: 0.3 }}>📭</div>
                              <div style={{ fontSize: 14, color: T.text3, fontWeight: 500, marginBottom: 6 }}>Nothing scheduled</div>
                              <div style={{ fontSize: 11, color: T.text3, opacity: 0.6 }}>Double-click a date to add a task</div>
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                )}
              </div>
            )}

            {/* ── RIGHT: Tasks + Meetings Panel ── */}
            {(!isMobile || mobilePanel === "tasks") && (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {/* Selected date context */}
                <div style={{ ...glassCard(T.accent), padding: "14px 18px", display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{
                    width: 40, height: 40, borderRadius: T.radius.md,
                    background: `linear-gradient(135deg, ${T.accent}, #d97706)`,
                    display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column",
                  }}>
                    <span style={{ fontSize: 9, fontWeight: 700, color: "#080d18", textTransform: "uppercase", lineHeight: 1 }}>
                      {selectedDate ? new Date(selectedDate + "T12:00:00").toLocaleDateString("en-US", { month: "short" }) : "ALL"}
                    </span>
                    <span style={{ fontSize: 16, fontWeight: 900, color: "#080d18", lineHeight: 1 }}>
                      {selectedDate ? new Date(selectedDate + "T12:00:00").getDate() : "—"}
                    </span>
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: T.text0 }}>
                      {selectedDate
                        ? new Date(selectedDate + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })
                        : "All Open Tasks"
                      }
                    </div>
                    <div style={{ fontSize: 11, color: T.text3 }}>
                      {tasksForDate.length} task{tasksForDate.length !== 1 ? "s" : ""} · {meetingsForDate.length} meeting{meetingsForDate.length !== 1 ? "s" : ""}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 4 }}>
                    <button onClick={() => openQuickAdd(selectedDate || todayStr)} title="Add Task" style={{
                      ...glassCard() as any, width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 16, color: T.accent, cursor: "pointer",
                    }}>+</button>
                    <button onClick={() => openNewMeeting(selectedDate || todayStr)} title="Add Meeting" style={{
                      ...glassCard() as any, width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 14, color: "#8b5cf6", cursor: "pointer",
                    }}>📅</button>
                  </div>
                  {selectedDate && (
                    <button onClick={() => setSelectedDate(null)} style={{ ...glassCard() as any, padding: "4px 10px", fontSize: 10, color: T.text3, cursor: "pointer" }}>✕</button>
                  )}
                </div>

                {/* Meetings section */}
                {meetingsForDate.length > 0 && (
                  <div style={{ ...glassCard("#8b5cf6"), padding: 14 }}>
                    <div style={{ fontSize: 10, color: T.text3, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 10 }}>
                      Meetings ({meetingsForDate.length})
                    </div>
                    {meetingsForDate.map(m => (
                      <div key={m.id} style={{
                        display: "flex", alignItems: "center", gap: 10, padding: "8px 10px",
                        borderRadius: T.radius.sm, marginBottom: 4,
                        background: "rgba(139,92,246,0.06)", borderLeft: `3px solid ${MEETING_TYPE_COLORS[m.type] || "#8b5cf6"}`,
                      }}>
                        <span style={{ fontSize: 12, fontWeight: 700, color: "#8b5cf6", fontFamily: "'JetBrains Mono', monospace", width: 48 }}>{m.time}</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 12, fontWeight: 600, color: T.text0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.title}</div>
                          {m.contact && <div style={{ fontSize: 10, color: T.text3 }}>{m.contact}</div>}
                        </div>
                        <span style={{ fontSize: 9, color: T.text3 }}>{m.duration}m</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Tasks section */}
                <div style={{ ...glassCard(), padding: 14, flex: 1, maxHeight: isMobile ? undefined : 400, overflowY: "auto" }}>
                  <div style={{ fontSize: 10, color: T.text3, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 10 }}>
                    Tasks ({tasksForDate.length})
                  </div>
                  {tasksForDate.length === 0 && (
                    <div style={{ padding: 24, textAlign: "center", color: T.text3, fontSize: 12 }}>
                      {selectedDate ? "No tasks for this date" : "No open tasks"}
                    </div>
                  )}
                  {tasksForDate.map(t => {
                    const pm = PRIORITY_META[t.priority] || PRIORITY_META.Medium;
                    const urgency = getUrgency(t.due);
                    const col = COLUMNS.find(c => c.key === getStatus(t));
                    const stDone = (t.subtasks || []).filter(s => s.done).length;
                    const stTotal = (t.subtasks || []).length;
                    return (
                      <div key={t.id} onClick={() => setSelectedTask(t)} style={{
                        padding: "10px 12px", borderRadius: T.radius.sm, marginBottom: 4,
                        background: "rgba(255,255,255,0.02)", border: `1px solid ${T.bg4}`,
                        borderLeft: `3px solid ${pm.color}`, cursor: "pointer", transition: "all 0.15s",
                      }}
                        onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,255,255,0.05)"; e.currentTarget.style.borderColor = `${pm.color}44`; }}
                        onMouseLeave={e => { e.currentTarget.style.background = "rgba(255,255,255,0.02)"; e.currentTarget.style.borderColor = T.bg4; }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                          <span style={{ fontSize: 12, fontWeight: 600, color: t.done ? T.text3 : T.text0, flex: 1, textDecoration: t.done ? "line-through" : "none" }}>{t.title}</span>
                          <span style={{ fontSize: 8, padding: "2px 6px", borderRadius: T.radius.full, background: pm.bg, color: pm.color, fontWeight: 700 }}>{pm.label}</span>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 10, color: T.text3 }}>
                          {col && <span style={{ color: col.color }}>{col.icon} {col.label}</span>}
                          {t.due && <span style={{ display: "flex", alignItems: "center", gap: 3 }}><div style={{ width: 5, height: 5, borderRadius: "50%", background: urgencyColor[urgency] }} />{t.due}</span>}
                          {t.assignee && <span>→ {t.assignee.split(" ")[0]}</span>}
                          {stTotal > 0 && <span style={{ color: stDone === stTotal ? T.green : T.text3, fontFamily: "'JetBrains Mono', monospace" }}>{stDone}/{stTotal}</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Priority Ring mini-widget */}
                {priorityRingSegments.length > 0 && (
                  <div style={{ ...glassCard(), padding: 14, display: "flex", alignItems: "center", gap: 14 }}>
                    <MiniRing segments={priorityRingSegments} size={48} stroke={4} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 10, color: T.text3, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>By Priority</div>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        {priorityRingSegments.map(s => (
                          <span key={s.label} style={{ fontSize: 10, color: s.color, fontWeight: 600 }}>
                            {s.label}: {s.value}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      )}

      {/* ═══════════ KANBAN VIEW ═══════════ */}
      {mainView === "kanban" && (
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(4, 1fr)", gap: 12, minHeight: 400 }}>
          {COLUMNS.map(col => {
            const items = colTasks(col.key);
            const isOver = dropTarget === col.key;
            return (
              <div key={col.key}
                onDragOver={e => { e.preventDefault(); setDropTarget(col.key); }}
                onDragLeave={() => setDropTarget(null)}
                onDrop={() => handleDrop(col.key)}
                style={{
                  ...glassCard(isOver ? col.color : undefined),
                  padding: 12, transition: "all 0.15s", display: "flex", flexDirection: "column",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 6px 12px", borderBottom: `2px solid ${col.color}22` }}>
                  <span style={{ fontSize: 14, color: col.color }}>{col.icon}</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: T.text0, flex: 1 }}>{col.label}</span>
                  <span style={{ fontSize: 10, fontWeight: 800, padding: "2px 8px", borderRadius: T.radius.full, background: `${col.color}18`, color: col.color, fontFamily: "'JetBrains Mono', monospace" }}>{items.length}</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8, flex: 1, paddingTop: 8 }}>
                  {items.map(t => {
                    const pm = PRIORITY_META[t.priority] || PRIORITY_META.Medium;
                    const urgency = getUrgency(t.due);
                    return (
                      <div key={t.id} draggable
                        onDragStart={() => setDragTask(t)}
                        onClick={() => setSelectedTask(t)}
                        style={{
                          ...glassCard() as any, padding: "11px 13px", cursor: "grab", transition: "transform 0.15s, box-shadow 0.15s",
                        }}
                        onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = "0 8px 30px rgba(0,0,0,0.4)"; }}
                        onMouseLeave={e => { e.currentTarget.style.transform = ""; e.currentTarget.style.boxShadow = ""; }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 5 }}>
                          <span style={{ fontSize: 8, padding: "2px 6px", borderRadius: T.radius.full, background: pm.bg, color: pm.color, fontWeight: 700 }}>{pm.label}</span>
                          {t.projectTag && <span style={{ fontSize: 8, padding: "2px 6px", borderRadius: T.radius.full, background: `${t.projectColor || T.bg4}18`, color: t.projectColor || T.text2, fontWeight: 600, marginLeft: "auto" }}>{t.projectTag}</span>}
                        </div>
                        <div style={{ fontSize: 12, fontWeight: 600, color: T.text0, lineHeight: 1.3, marginBottom: 6 }}>{t.title}</div>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                            {t.due && <><div style={{ width: 6, height: 6, borderRadius: "50%", background: urgencyColor[urgency] }} /><span style={{ fontSize: 9, color: T.text3 }}>{t.due}</span></>}
                          </div>
                          {t.assignee && <Avatar name={t.assignee} size={20} />}
                        </div>
                      </div>
                    );
                  })}
                  {items.length === 0 && <div style={{ padding: 20, textAlign: "center", color: T.text3, fontSize: 11, opacity: 0.4 }}>No tasks</div>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ═══════════ AGENDA VIEW ═══════════ */}
      {mainView === "agenda" && (
        <div style={{ ...glassCard(), padding: 18, maxHeight: 600, overflowY: "auto" }}>
          {agendaItems.length === 0 && <div style={{ padding: 40, textAlign: "center", color: T.text3 }}>No upcoming items</div>}
          {(() => {
            let lastDate = "";
            return agendaItems.map((item, idx) => {
              const showDate = item.date !== lastDate;
              lastDate = item.date;
              const d = new Date(item.date + "T12:00:00");
              const isToday = item.date === todayStr;
              const isPast = new Date(item.date) < today && !isToday;
              return (
                <div key={idx}>
                  {showDate && (
                    <div style={{
                      padding: "10px 0 6px", marginTop: idx > 0 ? 8 : 0,
                      borderBottom: `1px solid ${T.bg4}`, display: "flex", alignItems: "center", gap: 8,
                    }}>
                      <span style={{
                        fontSize: 12, fontWeight: 700, color: isToday ? T.accent : isPast ? T.text3 : T.text0,
                      }}>
                        {isToday ? "Today" : d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
                      </span>
                      {isToday && <span style={{ fontSize: 9, padding: "2px 8px", borderRadius: T.radius.full, background: `${T.accent}22`, color: T.accent, fontWeight: 700 }}>NOW</span>}
                    </div>
                  )}
                  <div
                    onClick={() => { if (item.task) setSelectedTask(item.task); }}
                    style={{
                      display: "flex", alignItems: "center", gap: 12, padding: "8px 12px",
                      borderRadius: T.radius.sm, cursor: item.task ? "pointer" : "default",
                      transition: "background 0.1s",
                    }}
                    onMouseEnter={e => { if (item.task) e.currentTarget.style.background = "rgba(255,255,255,0.03)"; }}
                    onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
                  >
                    <div style={{ width: 4, height: 24, borderRadius: 2, background: item.color, flexShrink: 0 }} />
                    {item.time && <span style={{ fontSize: 11, fontWeight: 600, color: item.color, fontFamily: "'JetBrains Mono', monospace", width: 48 }}>{item.time}</span>}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: T.text0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{item.label}</div>
                    </div>
                    <span style={{ fontSize: 9, padding: "2px 8px", borderRadius: T.radius.full, background: `${item.color}15`, color: item.color, fontWeight: 600, textTransform: "uppercase" }}>{item.type}</span>
                  </div>
                </div>
              );
            });
          })()}
        </div>
      )}

      {/* ═══════════ MODALS ═══════════ */}
      {/* Quick Add Task */}
      {showQuickAdd && (
        <div onClick={() => setShowQuickAdd(false)} style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 10050,
          display: "flex", alignItems: "flex-end", justifyContent: "center", backdropFilter: "blur(8px)", padding: 0,
        }}>
          <div onClick={e => e.stopPropagation()} style={{
            ...glassCard(T.accent),
            padding: "18px 16px calc(18px + env(safe-area-inset-bottom, 0px))",
            width: "100%", maxWidth: 520, maxHeight: "min(92dvh, 920px)", overflowY: "auto",
            borderRadius: "16px 16px 0 0", boxSizing: "border-box",
          }}>
            <h2 style={{ fontSize: 18, fontWeight: 800, color: T.text0, margin: "0 0 14px", letterSpacing: "-0.02em" }}>
              Quick Add Task — {new Date(quickAddDate + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}
            </h2>
            <div style={{ marginBottom: 12 }}>
              <label style={S.label as React.CSSProperties}>Title *</label>
              <input value={quickTitle} onChange={e => setQuickTitle(e.target.value)} onKeyDown={e => e.key === "Enter" && handleQuickAdd()} style={{ ...(S.input as React.CSSProperties), width: "100%", boxSizing: "border-box" }} autoFocus placeholder="Task title…" />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 12, marginBottom: 12 }}>
              <div><label style={S.label as React.CSSProperties}>Priority</label>
                <select value={quickPriority} onChange={e => setQuickPriority(e.target.value)} style={{ ...(S.input as React.CSSProperties), width: "100%", boxSizing: "border-box" }}>
                  {["Critical", "High", "Medium", "Low"].map(p => <option key={p}>{p}</option>)}
                </select>
              </div>
              <div><label style={S.label as React.CSSProperties}>Assignee</label>
                <input value={quickAssignee} onChange={e => setQuickAssignee(e.target.value)} style={{ ...(S.input as React.CSSProperties), width: "100%", boxSizing: "border-box" }} placeholder="Name…" />
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button onClick={handleQuickAdd} style={{ ...(S.btn as React.CSSProperties), flex: "1 1 100%" }}>Create Task</button>
              <button onClick={() => setShowQuickAdd(false)} style={{ ...(S.btnGhost as React.CSSProperties), flex: "1 1 auto" }}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* New Meeting */}
      {showNewMeeting && (
        <NewMeetingModal date={meetingDate} contacts={contacts} onSave={onAddMeeting} onClose={() => setShowNewMeeting(false)} />
      )}

      {/* Task Detail */}
      {selectedTask && (
        <>
          <div onClick={() => setSelectedTask(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 899, backdropFilter: "blur(4px)" }} />
          <TaskDetailPanel task={selectedTask} onClose={() => setSelectedTask(null)} onUpdate={handleTaskUpdate} />
        </>
      )}
    </div>
  );
}
