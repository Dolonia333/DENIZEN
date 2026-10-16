import { useState, useMemo } from "react";
import { T, S, fmt, type Task, type Subtask } from "@/lib/crm-data";
import { shareToGlobalChat } from "@/components/GlobalTeamChat";

interface Props {
  tasks: Task[];
  teamMembers?: string[];
  currentUserName?: string;
  onToggleTask: (id: number) => void;
  onDeleteTask: (id: number) => void;
  onUpdateTask?: (task: Task) => void;
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

function Avatar({ name, size = 24 }: { name: string; size?: number }) {
  const colors = ["#6366f1", "#f0b429", "#22d3a0", "#8b5cf6", "#4d9ef7", "#fb923c"];
  const idx = name.split("").reduce((s, c) => s + c.charCodeAt(0), 0) % colors.length;
  return (
    <div style={{
      width: size, height: size, borderRadius: T.radius.full, flexShrink: 0,
      background: `linear-gradient(135deg,${colors[idx]},${T.bg4})`,
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: size * 0.4, fontWeight: 700, color: "#fff",
    }}>
      {name.split(" ").map(w => w[0]).join("").slice(0, 2)}
    </div>
  );
}

function SubtaskProgress({ subtasks }: { subtasks?: Subtask[] }) {
  if (!subtasks || subtasks.length === 0) return null;
  const done = subtasks.filter(s => s.done).length;
  const pct = (done / subtasks.length) * 100;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6 }}>
      <div style={{ flex: 1, height: 3, borderRadius: 2, background: T.bg4, overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: pct === 100 ? T.green : T.accent, borderRadius: 2, transition: "width 0.3s" }} />
      </div>
      <span style={{ fontSize: 14, color: T.text3, fontFamily: "'JetBrains Mono', monospace" }}>{done}/{subtasks.length}</span>
    </div>
  );
}

function TaskDetailPanel({ task, onClose, onUpdate, teamMembers = [], currentUserName = "You" }: {
  task: Task; onClose: () => void; onUpdate: (t: Task) => void;
  teamMembers?: string[]; currentUserName?: string;
}) {
  const [editDesc, setEditDesc] = useState(false);
  const [desc, setDesc] = useState(task.description || "");
  const [newComment, setNewComment] = useState("");
  const [newSubtask, setNewSubtask] = useState("");

  const urgency = getUrgency(task.due);
  const pm = PRIORITY_META[task.priority] || PRIORITY_META.Medium;
  const col = COLUMNS.find(c => c.key === (task.status || "todo"));

  const toggleSubtask = (stId: number) => {
    const updated = { ...task, subtasks: (task.subtasks || []).map(s => s.id === stId ? { ...s, done: !s.done } : s) };
    onUpdate(updated);
  };

  const addSubtask = () => {
    if (!newSubtask.trim()) return;
    const st: Subtask = { id: Date.now(), title: newSubtask.trim(), done: false };
    onUpdate({ ...task, subtasks: [...(task.subtasks || []), st] });
    setNewSubtask("");
  };

  const addComment = () => {
    if (!newComment.trim()) return;
    const c = { id: Date.now(), user: currentUserName, text: newComment.trim(), at: new Date().toISOString() };
    onUpdate({ ...task, comments: [...(task.comments || []), c] });
    setNewComment("");
  };

  const changeStatus = (status: Task["status"]) => {
    const hist = [...(task.statusHistory || []), { status: status!, at: new Date().toISOString() }];
    onUpdate({ ...task, status, done: status === "done", statusHistory: hist });
  };

  return (
    <div style={{
      position: "fixed", top: 0, right: 0, bottom: 0, width: 460, maxWidth: "100vw",
      background: T.bg1, borderLeft: `1px solid ${T.bg4}`, zIndex: 900,
      display: "flex", flexDirection: "column", boxShadow: "-8px 0 40px rgba(0,0,0,0.5)",
    }}>
      {/* Header */}
      <div style={{ padding: "16px 20px", borderBottom: `1px solid ${T.bg4}`, display: "flex", alignItems: "center", gap: 12 }}>
        <button aria-label="Close" onClick={onClose} style={{ background: T.bg3, border: `1px solid ${T.bg4}`, borderRadius: T.radius.sm, padding: "6px 10px", color: T.text2, cursor: "pointer", fontSize: 14 }}>← Back</button>
        <div style={{ flex: 1 }} />
        <button aria-label="Action" onClick={() => shareToGlobalChat({
          title: task.title, type: "task", color: pm.color,
          snapshot: { "Priority": task.priority, "Status": col?.label || "To Do", "Assignee": task.assignee || "Unassigned", "Due": task.due || "No date", "Contact": task.contact || "—" },
          status: task.done ? "Resolved" : "In Progress",
        })} style={{ background: `${T.purple}15`, border: `1px solid ${T.purple}33`, borderRadius: T.radius.sm, padding: "6px 10px", color: T.purple, cursor: "pointer", fontSize: 14, fontWeight: 600 }}>💬 Share</button>
        <span style={{ ...pm, fontSize: 14, padding: "3px 8px", borderRadius: T.radius.sm, background: pm.bg, color: pm.color, fontWeight: 700 }}>{pm.label}</span>
        {task.isClientFacing && <span style={{ fontSize: 14, padding: "3px 8px", borderRadius: T.radius.sm, background: `${T.accent}18`, color: T.accent, fontWeight: 600 }}>Client</span>}
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: 20 }}>
        {/* Title */}
        <h2 style={{ fontSize: 18, fontWeight: 700, color: T.text0, margin: "0 0 4px", lineHeight: 1.3 }}>{task.title}</h2>

        {/* Meta row */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 12, marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 14, color: T.text3 }}>Assignee</span>
            <select
              value={task.assignee || ""}
              onChange={(e) => onUpdate({ ...task, assignee: e.target.value || undefined })}
              style={{ ...S.input, width: "auto", minWidth: 140, fontSize: 14, padding: "6px 10px" }}
            >
              <option value="">Unassigned</option>
              {teamMembers.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          {task.due && (
            <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <div style={{ width: 8, height: 8, borderRadius: T.radius.full, background: urgencyColor[urgency] }} />
              <span style={{ fontSize: 14, color: T.text2 }}>Due {task.due}</span>
            </div>
          )}
          {task.projectTag && (
            <span style={{ fontSize: 14, padding: "2px 8px", borderRadius: T.radius.sm, background: `${task.projectColor || T.bg4}18`, color: task.projectColor || T.text2, fontWeight: 600 }}>{task.projectTag}</span>
          )}
        </div>

        {/* Status buttons */}
        <div style={{ display: "flex", gap: 4, marginBottom: 20 }}>
          {COLUMNS.map(c => (
            <button aria-label="Action" key={c.key} onClick={() => changeStatus(c.key)} style={{
              flex: 1, padding: "6px 0", borderRadius: T.radius.sm, fontSize: 14, fontWeight: 600, cursor: "pointer",
              background: task.status === c.key ? `${c.color}22` : T.bg3,
              color: task.status === c.key ? c.color : T.text3,
              border: `1px solid ${task.status === c.key ? `${c.color}66` : T.bg4}`,
            }}>{c.label}</button>
          ))}
        </div>

        {/* Description */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 14, color: T.text3, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 6 }}>Description</div>
          {editDesc ? (
            <div>
              <textarea value={desc} onChange={e = aria-label="textarea"> setDesc(e.target.value)} style={{ ...S.input as React.CSSProperties, minHeight: 80, resize: "vertical" }} />
              <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                <button aria-label="Action" onClick={() => { onUpdate({ ...task, description: desc }); setEditDesc(false); }} style={{ ...S.btn as React.CSSProperties, padding: "5px 12px", fontSize: 14 }}>Save</button>
                <button aria-label="Action" onClick={() => setEditDesc(false)} style={{ ...S.btnGhost as React.CSSProperties, padding: "5px 12px", fontSize: 14 }}>Cancel</button>
              </div>
            </div>
          ) : (
            <div onClick={() => setEditDesc(true)} style={{ fontSize: 14, color: task.description ? T.text1 : T.text3, cursor: "pointer", padding: "8px 10px", background: T.bg3, borderRadius: T.radius.sm, border: `1px solid ${T.bg4}`, minHeight: 40 }}>
              {task.description || "Click to add description…"}
            </div>
          )}
        </div>

        {/* Subtasks */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 14, color: T.text3, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 8 }}>
            Subtasks {task.subtasks && task.subtasks.length > 0 && `(${task.subtasks.filter(s => s.done).length}/${task.subtasks.length})`}
          </div>
          {(task.subtasks || []).map(st => (
            <div key={st.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0" }}>
              <button aria-label="Action" onClick={() => toggleSubtask(st.id)} style={{
                width: 18, height: 18, borderRadius: T.radius.xs, flexShrink: 0,
                border: `2px solid ${st.done ? T.green : T.bg5}`, background: st.done ? T.green : "transparent",
                cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 14,
              }}>{st.done && "✓"}</button>
              <span style={{ fontSize: 14, color: st.done ? T.text3 : T.text1, textDecoration: st.done ? "line-through" : "none" }}>{st.title}</span>
            </div>
          ))}
          <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
            <input value={newSubtask} onChange={e = aria-label="input"> setNewSubtask(e.target.value)} placeholder="Add subtask…"
              onKeyDown={e => e.key === "Enter" && addSubtask()}
              style={{ ...S.input as React.CSSProperties, flex: 1, padding: "6px 10px", fontSize: 14 }} />
            <button aria-label="add" onClick={addSubtask} style={{ ...S.btn as React.CSSProperties, padding: "6px 10px", fontSize: 14 }}>Add</button>
          </div>
        </div>

        {/* Status Timeline */}
        {task.statusHistory && task.statusHistory.length > 0 && (
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 14, color: T.text3, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 8 }}>Status History</div>
            {task.statusHistory.map((h, i) => {
              const c = COLUMNS.find(x => x.key === h.status);
              return (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0" }}>
                  <div style={{ width: 8, height: 8, borderRadius: T.radius.full, background: c?.color || T.text3, flexShrink: 0 }} />
                  <span style={{ fontSize: 14, color: c?.color || T.text2, fontWeight: 600 }}>{c?.label || h.status}</span>
                  <span style={{ fontSize: 14, color: T.text3, marginLeft: "auto" }}>{new Date(h.at).toLocaleDateString()}</span>
                </div>
              );
            })}
          </div>
        )}

        {/* Comments */}
        <div>
          <div style={{ fontSize: 14, color: T.text3, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 8 }}>Comments</div>
          {(task.comments || []).map(c => (
            <div key={c.id} style={{ padding: "8px 10px", background: T.bg3, borderRadius: T.radius.sm, marginBottom: 6 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                <Avatar name={c.user} size={18} />
                <span style={{ fontSize: 14, fontWeight: 600, color: T.text1 }}>{c.user}</span>
                <span style={{ fontSize: 14, color: T.text3, marginLeft: "auto" }}>{new Date(c.at).toLocaleDateString()}</span>
              </div>
              <p style={{ fontSize: 14, color: T.text2, margin: 0 }}>{c.text}</p>
            </div>
          ))}
          <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
            <input value={newComment} onChange={e = aria-label="input"> setNewComment(e.target.value)} placeholder="Add a comment…"
              onKeyDown={e => e.key === "Enter" && addComment()}
              style={{ ...S.input as React.CSSProperties, flex: 1, padding: "6px 10px", fontSize: 14 }} />
            <button aria-label="add" onClick={addComment} style={{ ...S.btn as React.CSSProperties, padding: "6px 10px", fontSize: 14 }}>Post</button>
          </div>
        </div>

        {/* Created info */}
        <div style={{ marginTop: 20, padding: "10px 0", borderTop: `1px solid ${T.bg4}`, display: "flex", gap: 12, fontSize: 14, color: T.text3 }}>
          {task.createdBy && <span>Created by {task.createdBy}</span>}
          {task.createdAt && <span>on {task.createdAt}</span>}
        </div>
      </div>
    </div>
  );
}

function TaskCard({ task, onSelect, onDragStart }: { task: Task; onSelect: () => void; onDragStart: (e: React.DragEvent) => void }) {
  const pm = PRIORITY_META[task.priority] || PRIORITY_META.Medium;
  const urgency = getUrgency(task.due);

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onClick={onSelect}
      style={{
        background: `linear-gradient(145deg,${T.bg2},${T.bg3}88)`,
        border: `1px solid ${T.bg4}`, borderRadius: T.radius.md,
        padding: "12px 14px", cursor: "grab",
        transition: "transform 0.15s, box-shadow 0.15s",
      }}
      onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-1px)"; e.currentTarget.style.boxShadow = T.shadow.card; }}
      onMouseLeave={e => { e.currentTarget.style.transform = ""; e.currentTarget.style.boxShadow = ""; }}
    >
      {/* Top meta */}
      <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 6 }}>
        <span style={{ fontSize: 14, padding: "2px 6px", borderRadius: T.radius.xs, background: pm.bg, color: pm.color, fontWeight: 700 }}>{pm.label}</span>
        {task.isClientFacing && <span style={{ fontSize: 14, padding: "2px 6px", borderRadius: T.radius.xs, background: `${T.accent}18`, color: T.accent, fontWeight: 600 }}>Client</span>}
        {task.projectTag && (
          <span style={{ fontSize: 14, padding: "2px 6px", borderRadius: T.radius.xs, background: `${task.projectColor || T.bg4}18`, color: task.projectColor || T.text2, fontWeight: 600, marginLeft: "auto" }}>{task.projectTag}</span>
        )}
      </div>

      {/* Title */}
      <div style={{ fontSize: 14, fontWeight: 600, color: T.text0, lineHeight: 1.3, marginBottom: 6 }}>{task.title}</div>

      {/* Subtask progress */}
      <SubtaskProgress subtasks={task.subtasks} />

      {/* Bottom row */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          {task.due && (
            <>
              <div style={{ width: 7, height: 7, borderRadius: T.radius.full, background: urgencyColor[urgency] }} />
              <span style={{ fontSize: 14, color: T.text3 }}>{task.due}</span>
            </>
          )}
        </div>
        {task.assignee && <Avatar name={task.assignee} size={20} />}
      </div>
    </div>
  );
}

export function TasksTab({ tasks, teamMembers = [], currentUserName = "You", onToggleTask, onDeleteTask, onUpdateTask }: Props) {
  const [view, setView] = useState<"kanban" | "list">("kanban");
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [dragTask, setDragTask] = useState<Task | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  // Filters
  const [filterPriority, setFilterPriority] = useState("All");
  const [filterAssignee, setFilterAssignee] = useState("All");
  const [filterTag, setFilterTag] = useState("All");
  const [filterType, setFilterType] = useState<"All" | "Client" | "Internal">("All");

  const assignees = ["All", ...Array.from(new Set([
    ...teamMembers,
    ...tasks.map(t => t.assignee).filter(Boolean) as string[],
  ]))];
  const tags = ["All", ...Array.from(new Set(tasks.map(t => t.projectTag).filter(Boolean) as string[]))];
  const priorities = ["All", "Critical", "High", "Medium", "Low"];

  const filtered = useMemo(() => {
    let list = tasks;
    if (filterPriority !== "All") list = list.filter(t => t.priority === filterPriority);
    if (filterAssignee !== "All") list = list.filter(t => t.assignee === filterAssignee);
    if (filterTag !== "All") list = list.filter(t => t.projectTag === filterTag);
    if (filterType === "Client") list = list.filter(t => t.isClientFacing);
    if (filterType === "Internal") list = list.filter(t => !t.isClientFacing);
    return list;
  }, [tasks, filterPriority, filterAssignee, filterTag, filterType]);

  const getStatus = (t: Task): string => t.status || (t.done ? "done" : "todo");
  const colTasks = (key: string) => filtered.filter(t => getStatus(t) === key);

  const handleDrop = (status: string) => {
    if (!dragTask || !onUpdateTask) return;
    const hist = [...(dragTask.statusHistory || []), { status, at: new Date().toISOString() }];
    onUpdateTask({ ...dragTask, status: status as Task["status"], done: status === "done", statusHistory: hist });
    setDragTask(null);
    setDropTarget(null);
  };

  const handleUpdateTask = (t: Task) => {
    if (onUpdateTask) onUpdateTask(t);
    setSelectedTask(t);
  };

  // Stats
  const totalTasks = tasks.length;
  const doneTasks = tasks.filter(t => getStatus(t) === "done").length;
  const overdueTasks = tasks.filter(t => !t.done && getUrgency(t.due) === "overdue").length;

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: T.text0, margin: 0, letterSpacing: "-0.02em" }}>Tasks</h1>
          <p style={{ fontSize: 14, color: T.text2, marginTop: 4 }}>
            {totalTasks} total · {doneTasks} done · {overdueTasks > 0 && <span style={{ color: "#ef4444" }}>{overdueTasks} overdue</span>}
          </p>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {(["kanban", "list"] as const).map(v => (
            <button aria-label="Action" key={v} onClick={() => setView(v)} style={{
              padding: "6px 14px", borderRadius: T.radius.sm, fontSize: 14, fontWeight: 600, cursor: "pointer",
              background: view === v ? `${T.accent}22` : T.bg3, color: view === v ? T.accent : T.text3,
              border: `1px solid ${view === v ? `${T.accent}66` : T.bg4}`,
            }}>{v === "kanban" ? "◆ Board" : "☰ List"}</button>
          ))}
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
        {[
          { label: "Priority", value: filterPriority, options: priorities, set: setFilterPriority },
          { label: "Assignee", value: filterAssignee, options: assignees, set: setFilterAssignee },
          { label: "Project", value: filterTag, options: tags, set: setFilterTag },
        ].map(f => (
          <select key={f.label} value={f.value} onChange={e => f.set(e.target.value)} style={{
            background: T.bg3, border: `1px solid ${T.bg4}`, borderRadius: T.radius.sm,
            color: f.value !== "All" ? T.accent : T.text2, padding: "5px 10px", fontSize: 14, outline: "none", cursor: "pointer",
          }}>
            {f.options.map(o => <option key={o} value={o}>{o === "All" ? `${f.label}: All` : o}</option>)}
          </select>
        ))}
        <select value={filterType} onChange={e => setFilterType(e.target.value as any)} style={{
          background: T.bg3, border: `1px solid ${T.bg4}`, borderRadius: T.radius.sm,
          color: filterType !== "All" ? T.accent : T.text2, padding: "5px 10px", fontSize: 14, outline: "none", cursor: "pointer",
        }}>
          <option value="All">Type: All</option>
          <option value="Client">Client-Facing</option>
          <option value="Internal">Internal</option>
        </select>
      </div>

      {/* KANBAN VIEW */}
      {view === "kanban" && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, minHeight: 400 }}>
          {COLUMNS.map(col => {
            const items = colTasks(col.key);
            const totalInCol = filtered.length > 0 ? items.length : 0;
            const isOver = dropTarget === col.key;
            return (
              <div key={col.key}
                onDragOver={e => { e.preventDefault(); setDropTarget(col.key); }}
                onDragLeave={() => setDropTarget(null)}
                onDrop={() => handleDrop(col.key)}
                style={{
                  background: isOver ? `${col.color}08` : T.bg1,
                  border: `1px solid ${isOver ? `${col.color}44` : T.bg4}`,
                  borderRadius: T.radius.lg, padding: 10, transition: "all 0.15s",
                  display: "flex", flexDirection: "column",
                }}
              >
                {/* Column header */}
                <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 6px 10px", borderBottom: `2px solid ${col.color}22` }}>
                  <span style={{ fontSize: 14, color: col.color }}>{col.icon}</span>
                  <span style={{ fontSize: 14, fontWeight: 700, color: T.text0, flex: 1 }}>{col.label}</span>
                  <span style={{
                    fontSize: 14, fontWeight: 700, padding: "2px 7px", borderRadius: T.radius.full,
                    background: `${col.color}18`, color: col.color,
                    fontFamily: "'JetBrains Mono', monospace",
                  }}>{items.length}</span>
                </div>

                {/* Column progress */}
                <div style={{ height: 2, background: T.bg4, borderRadius: 1, margin: "8px 0", overflow: "hidden" }}>
                  <div style={{ width: filtered.length > 0 ? `${(totalInCol / filtered.length) * 100}%` : "0%", height: "100%", background: col.color, borderRadius: 1, transition: "width 0.3s" }} />
                </div>

                {/* Cards */}
                <div style={{ display: "flex", flexDirection: "column", gap: 8, flex: 1, minHeight: 50 }}>
                  {items.map(t => (
                    <TaskCard key={t.id} task={t} onSelect={() => setSelectedTask(t)}
                      onDragStart={() => setDragTask(t)} />
                  ))}
                  {items.length === 0 && (
                    <div className="crm-empty-state crm-panel-enter" style={{ padding: "24px 12px" }}>
                      <div className="icon" style={{ fontSize: 24 }}>📝</div>
                      <div className="desc">No tasks — drag or create one here</div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* LIST VIEW */}
      {view === "list" && (
        <div style={{ background: T.bg2, border: `1px solid ${T.bg4}`, borderRadius: T.radius.lg, overflow: "hidden" }}>
          <div style={{ display: "grid", gridTemplateColumns: "2.5fr 0.8fr 0.8fr 0.8fr 0.8fr 0.6fr", padding: "10px 20px", borderBottom: `1px solid ${T.bg4}`, gap: 12 }}>
            {["Task", "Status", "Priority", "Assignee", "Due", "Subtasks"].map(h => (
              <div key={h} style={{ fontSize: 14, color: T.text3, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em" }}>{h}</div>
            ))}
          </div>
          {filtered.map(t => {
            const pm = PRIORITY_META[t.priority] || PRIORITY_META.Medium;
            const urgency = getUrgency(t.due);
            const col = COLUMNS.find(c => c.key === getStatus(t));
            const stDone = (t.subtasks || []).filter(s => s.done).length;
            const stTotal = (t.subtasks || []).length;
            return (
              <div key={t.id} onClick={() => setSelectedTask(t)} style={{
                display: "grid", gridTemplateColumns: "2.5fr 0.8fr 0.8fr 0.8fr 0.8fr 0.6fr",
                padding: "12px 20px", borderBottom: `1px solid ${T.bg3}`, gap: 12, alignItems: "center",
                cursor: "pointer", transition: "background 0.1s",
              }}
                onMouseEnter={e => (e.currentTarget.style.background = T.bg3)}
                onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                  {t.projectTag && <div style={{ width: 3, height: 24, borderRadius: 2, background: t.projectColor || T.bg4, flexShrink: 0 }} />}
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: T.text0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {t.title}
                      {t.isClientFacing && <span style={{ fontSize: 14, marginLeft: 6, padding: "1px 5px", borderRadius: T.radius.xs, background: `${T.accent}18`, color: T.accent, fontWeight: 600, verticalAlign: "middle" }}>Client</span>}
                    </div>
                    {t.contact && <div style={{ fontSize: 14, color: T.text3 }}>{t.contact}</div>}
                  </div>
                </div>
                <div><span style={{ fontSize: 14, padding: "3px 8px", borderRadius: T.radius.sm, background: `${col?.color || T.bg4}18`, color: col?.color || T.text2, fontWeight: 600 }}>{col?.label || "To Do"}</span></div>
                <div><span style={{ fontSize: 14, padding: "3px 8px", borderRadius: T.radius.sm, background: pm.bg, color: pm.color, fontWeight: 700 }}>{pm.label}</span></div>
                <div>{t.assignee ? <div style={{ display: "flex", alignItems: "center", gap: 5 }}><Avatar name={t.assignee} size={20} /><span style={{ fontSize: 14, color: T.text2 }}>{t.assignee.split(" ")[0]}</span></div> : <span style={{ fontSize: 14, color: T.text3 }}>—</span>}</div>
                <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  <div style={{ width: 7, height: 7, borderRadius: T.radius.full, background: urgencyColor[urgency] }} />
                  <span style={{ fontSize: 14, color: T.text2 }}>{t.due || "—"}</span>
                </div>
                <div>{stTotal > 0 ? <span style={{ fontSize: 14, color: stDone === stTotal ? T.green : T.text3, fontFamily: "'JetBrains Mono', monospace" }}>{stDone}/{stTotal}</span> : <span style={{ fontSize: 14, color: T.text3 }}>—</span>}</div>
              </div>
            );
          })}
          {filtered.length === 0 && (
            <div style={{ padding: 40, textAlign: "center", color: T.text3 }}>No tasks match filters</div>
          )}
        </div>
      )}

      {/* Detail Panel */}
      {selectedTask && (
        <>
          <div onClick={() => setSelectedTask(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 899, backdropFilter: "blur(2px)" }} />
          <TaskDetailPanel
            task={selectedTask}
            onClose={() => setSelectedTask(null)}
            onUpdate={handleUpdateTask}
            teamMembers={teamMembers}
            currentUserName={currentUserName}
          />
        </>
      )}
    </div>
  );
}
