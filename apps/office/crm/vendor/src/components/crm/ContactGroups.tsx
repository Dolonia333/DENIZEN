import { useState } from "react";
import { T, S } from "@/lib/crm-data";

export interface ContactGroup {
  id: number;
  name: string;
  color: string;
  description: string;
}

const PRESET_COLORS = ["#f0b429", "#6366f1", "#22d3a0", "#f85b5b", "#4d9ef7", "#8b5cf6", "#fb923c", "#ec4899"];

interface CreateGroupModalProps {
  onClose: () => void;
  onSave: (group: ContactGroup) => void;
  editGroup?: ContactGroup | null;
}

export function CreateGroupModal({ onClose, onSave, editGroup }: CreateGroupModalProps) {
  const [name, setName] = useState(editGroup?.name || "");
  const [color, setColor] = useState(editGroup?.color || PRESET_COLORS[0]);
  const [description, setDescription] = useState(editGroup?.description || "");

  const handleSave = () => {
    if (!name.trim()) return;
    onSave({ id: editGroup?.id || Date.now(), name: name.trim(), color, description: description.trim() });
  };

  return (
    <div onClick={onClose} style={S.modalBg as React.CSSProperties}>
      <div onClick={e => e.stopPropagation()} className="animate-scale-in" style={S.modalBox as React.CSSProperties}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: T.text0, margin: "0 0 20px" }}>
          {editGroup ? "Edit Group" : "Create Group"}
        </h2>
        <div style={{ marginBottom: 12 }}>
          <label style={S.label as React.CSSProperties}>Group Name *</label>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. VIP Clients" style={S.input as React.CSSProperties} />
        </div>
        <div style={{ marginBottom: 12 }}>
          <label style={S.label as React.CSSProperties}>Color</label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {PRESET_COLORS.map(c => (
              <button key={c} onClick={() => setColor(c)} style={{
                width: 28, height: 28, borderRadius: T.radius.sm, background: c, border: color === c ? "2px solid #fff" : "2px solid transparent",
                cursor: "pointer", transition: "border 0.1s",
              }} />
            ))}
          </div>
        </div>
        <div style={{ marginBottom: 12 }}>
          <label style={S.label as React.CSSProperties}>Description (optional)</label>
          <input value={description} onChange={e => setDescription(e.target.value)} placeholder="What this group is for…" style={S.input as React.CSSProperties} />
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          <button onClick={handleSave} style={S.btn as React.CSSProperties}>{editGroup ? "Save Changes" : "Create Group"}</button>
          <button onClick={onClose} style={S.btnGhost as React.CSSProperties}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

interface DeleteConfirmProps {
  group: ContactGroup;
  onClose: () => void;
  onConfirm: () => void;
}

export function DeleteGroupConfirm({ group, onClose, onConfirm }: DeleteConfirmProps) {
  return (
    <div onClick={onClose} style={S.modalBg as React.CSSProperties}>
      <div onClick={e => e.stopPropagation()} className="animate-scale-in" style={{ ...S.modalBox as React.CSSProperties, width: 400 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: T.text0, margin: "0 0 12px" }}>Delete Group</h2>
        <p style={{ fontSize: 13, color: T.text2, marginBottom: 20 }}>
          Are you sure you want to delete "<strong style={{ color: T.text0 }}>{group.name}</strong>"? Contacts in this group will remain — they'll just lose this group label.
        </p>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={onConfirm} style={{ ...S.btn as React.CSSProperties, background: T.red }}>Delete Group</button>
          <button onClick={onClose} style={S.btnGhost as React.CSSProperties}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

interface GroupAssignDropdownProps {
  groups: ContactGroup[];
  assignedGroupIds: number[];
  onToggle: (groupId: number) => void;
}

export function GroupAssignDropdown({ groups, assignedGroupIds, onToggle }: GroupAssignDropdownProps) {
  const [open, setOpen] = useState(false);

  if (groups.length === 0) return null;

  return (
    <div style={{ position: "relative" }} onClick={e => e.stopPropagation()}>
      <button onClick={() => setOpen(p => !p)} style={{
        background: T.bg4, border: "none", borderRadius: T.radius.xs, padding: "4px 8px",
        color: T.text2, fontSize: 11, cursor: "pointer", display: "flex", alignItems: "center", gap: 4,
      }}>
        🏷 {assignedGroupIds.length > 0 ? assignedGroupIds.length : ""}
      </button>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 99 }} />
          <div style={{
            position: "absolute", top: "100%", right: 0, marginTop: 4, zIndex: 100,
            background: T.bg2, border: `1px solid ${T.bg4}`, borderRadius: T.radius.md,
            padding: 6, minWidth: 180, boxShadow: T.shadow.elevated,
          }}>
            {groups.map(g => {
              const assigned = assignedGroupIds.includes(g.id);
              return (
                <button key={g.id} onClick={() => onToggle(g.id)} style={{
                  display: "flex", alignItems: "center", gap: 8, width: "100%",
                  background: assigned ? `${g.color}18` : "transparent",
                  border: "none", borderRadius: T.radius.sm, padding: "6px 8px",
                  cursor: "pointer", color: T.text1, fontSize: 12, textAlign: "left",
                }}>
                  <div style={{ width: 10, height: 10, borderRadius: 2, background: g.color, flexShrink: 0 }} />
                  <span style={{ flex: 1 }}>{g.name}</span>
                  {assigned && <span style={{ color: T.green, fontSize: 12 }}>✓</span>}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

interface GroupFilterChipsProps {
  groups: ContactGroup[];
  activeGroupId: number | null;
  onSelect: (id: number | null) => void;
  onEdit: (g: ContactGroup) => void;
  onDelete: (g: ContactGroup) => void;
}

export function GroupFilterChips({ groups, activeGroupId, onSelect, onEdit, onDelete }: GroupFilterChipsProps) {
  const [contextMenu, setContextMenu] = useState<{ group: ContactGroup; x: number; y: number } | null>(null);

  return (
    <>
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
        {groups.map(g => (
          <button
            key={g.id}
            onClick={() => onSelect(activeGroupId === g.id ? null : g.id)}
            onContextMenu={e => { e.preventDefault(); setContextMenu({ group: g, x: e.clientX, y: e.clientY }); }}
            style={{
              display: "flex", alignItems: "center", gap: 5,
              background: activeGroupId === g.id ? `${g.color}22` : T.bg3,
              color: activeGroupId === g.id ? g.color : T.text2,
              border: `1px solid ${activeGroupId === g.id ? `${g.color}66` : T.bg4}`,
              borderRadius: T.radius.sm, padding: "5px 10px", fontSize: 12, cursor: "pointer",
              fontWeight: activeGroupId === g.id ? 600 : 400,
            }}
          >
            <div style={{ width: 8, height: 8, borderRadius: 2, background: g.color }} />
            {g.name}
          </button>
        ))}
      </div>
      {contextMenu && (
        <>
          <div onClick={() => setContextMenu(null)} style={{ position: "fixed", inset: 0, zIndex: 999 }} />
          <div style={{
            position: "fixed", left: contextMenu.x, top: contextMenu.y, zIndex: 1000,
            background: T.bg2, border: `1px solid ${T.bg4}`, borderRadius: T.radius.md,
            padding: 4, minWidth: 120, boxShadow: T.shadow.elevated,
          }}>
            <button onClick={() => { onEdit(contextMenu.group); setContextMenu(null); }} style={{
              display: "block", width: "100%", background: "none", border: "none", color: T.text1,
              padding: "6px 10px", fontSize: 12, cursor: "pointer", textAlign: "left", borderRadius: T.radius.sm,
            }}>✎ Edit Group</button>
            <button onClick={() => { onDelete(contextMenu.group); setContextMenu(null); }} style={{
              display: "block", width: "100%", background: "none", border: "none", color: T.red,
              padding: "6px 10px", fontSize: 12, cursor: "pointer", textAlign: "left", borderRadius: T.radius.sm,
            }}>✕ Delete Group</button>
          </div>
        </>
      )}
    </>
  );
}
