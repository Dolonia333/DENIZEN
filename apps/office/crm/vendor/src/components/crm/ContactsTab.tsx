import { useState, useMemo } from "react";
import { T, badgeStyle, type Contact } from "@/lib/crm-data";
import { EmptyState, TableSkeleton } from "./EmptyState";
import { type ContactGroup, GroupFilterChips, GroupAssignDropdown, CreateGroupModal, DeleteGroupConfirm } from "./ContactGroups";
import { shareToGlobalChat } from "@/components/GlobalTeamChat";

interface Props {
  contacts: Contact[];
  onSelectContact: (c: Contact) => void;
  onEditContact: (c: Contact) => void;
  onDeleteContact: (id: number) => void;
  onExport?: () => void;
  onImport?: () => void;
  groups: ContactGroup[];
  contactGroupMap: Record<number, number[]>;
  onCreateGroup: (g: ContactGroup) => void;
  onEditGroup: (g: ContactGroup) => void;
  onDeleteGroup: (id: number) => void;
  onToggleContactGroup: (contactId: number, groupId: number) => void;
}

export function ContactsTab({ contacts, onSelectContact, onEditContact, onDeleteContact, onExport, onImport, groups, contactGroupMap, onCreateGroup, onEditGroup, onDeleteGroup, onToggleContactGroup }: Props) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);
  const [activeGroupId, setActiveGroupId] = useState<number | null>(null);
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [editingGroup, setEditingGroup] = useState<ContactGroup | null>(null);
  const [deletingGroup, setDeletingGroup] = useState<ContactGroup | null>(null);

  const statuses = ["All", ...Array.from(new Set(contacts.map(c => c.status)))];

  const filtered = useMemo(() => {
    let list = contacts;
    if (statusFilter !== "All") list = list.filter(c => c.status === statusFilter);
    if (activeGroupId !== null) list = list.filter(c => (contactGroupMap[c.id] || []).includes(activeGroupId));
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(c => c.name.toLowerCase().includes(q) || c.company.toLowerCase().includes(q) || c.email.toLowerCase().includes(q));
    }
    return list.sort((a, b) => b.score - a.score);
  }, [contacts, search, statusFilter, activeGroupId, contactGroupMap]);

  const scoreColor = (s: number) => s >= 80 ? T.green : s >= 50 ? T.accent : "#6366f1";

  const contactGroups = (contactId: number) => {
    const gIds = contactGroupMap[contactId] || [];
    return groups.filter(g => gIds.includes(g.id));
  };

  const ActionButtons = ({ c }: { c: Contact }) => (
    <div style={{ display: "flex", gap: 4 }} onClick={e => e.stopPropagation()}>
      <GroupAssignDropdown groups={groups} assignedGroupIds={contactGroupMap[c.id] || []} onToggle={(gId) => onToggleContactGroup(c.id, gId)} />
      <button onClick={() => shareToGlobalChat({
        title: c.name, type: "lead", color: c.score >= 80 ? T.green : c.score >= 50 ? T.accent : "#6366f1",
        snapshot: { "Company": c.company, "Email": c.email, "Status": c.status, "Score": `${c.score}`, "Lead Source": c.leadSource || "—", "Last Contact": c.lastContact },
        status: c.status === "Customer" ? "Resolved" : "Needs Review",
      })} style={{ background: `${T.purple}18`, border: "none", borderRadius: T.radius.xs, padding: "4px 8px", color: T.purple, fontSize: 11, cursor: "pointer" }} title="Share to Team Chat">💬</button>
      <button onClick={() => onEditContact(c)} style={{ background: T.bg4, border: "none", borderRadius: T.radius.xs, padding: "4px 8px", color: T.text2, fontSize: 11, cursor: "pointer" }}>✎</button>
      {confirmDelete === c.id ? (
        <button onClick={() => { onDeleteContact(c.id); setConfirmDelete(null); }} style={{ background: T.red, border: "none", borderRadius: T.radius.xs, padding: "4px 8px", color: "#fff", fontSize: 11, cursor: "pointer" }}>Confirm</button>
      ) : (
        <button onClick={() => setConfirmDelete(c.id)} style={{ background: T.bg4, border: "none", borderRadius: T.radius.xs, padding: "4px 8px", color: T.red, fontSize: 11, cursor: "pointer" }}>✕</button>
      )}
    </div>
  );

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: T.text0, margin: 0, letterSpacing: "-0.02em" }}>Contacts</h1>
          <p style={{ fontSize: 13, color: T.text2, marginTop: 4 }}>{contacts.length} total · {contacts.filter(c => c.status === "Customer").length} customers</p>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button onClick={() => setShowCreateGroup(true)} style={{ background: T.bg3, border: `1px solid ${T.bg4}`, borderRadius: T.radius.sm, padding: "6px 12px", color: T.accent, fontSize: 11, cursor: "pointer", fontWeight: 600 }}>+ Create Group</button>
          {onImport && <button onClick={onImport} style={{ background: T.bg3, border: `1px solid ${T.bg4}`, borderRadius: T.radius.sm, padding: "6px 12px", color: T.text2, fontSize: 11, cursor: "pointer" }}>⬆ Import CSV</button>}
          {onExport && <button onClick={onExport} style={{ background: T.bg3, border: `1px solid ${T.bg4}`, borderRadius: T.radius.sm, padding: "6px 12px", color: T.text2, fontSize: 11, cursor: "pointer" }}>⬇ Export CSV</button>}
        </div>
      </div>

      {/* Group filter chips */}
      {groups.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <GroupFilterChips groups={groups} activeGroupId={activeGroupId} onSelect={setActiveGroupId}
            onEdit={(g) => setEditingGroup(g)} onDelete={(g) => setDeletingGroup(g)} />
        </div>
      )}

      <div className="crm-contacts-filters" style={{ display: "flex", gap: 10, marginBottom: 16, alignItems: "center", flexWrap: "wrap" }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search contacts…"
          style={{ background: T.bg3, border: `1px solid ${T.bg4}`, borderRadius: T.radius.md, color: T.text1, padding: "8px 12px", fontSize: 13, outline: "none", flex: "1 1 200px", minWidth: 0 }} />
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {statuses.map(s => (
            <button key={s} onClick={() => setStatusFilter(s)} style={{
              background: statusFilter === s ? T.accent : T.bg3,
              color: statusFilter === s ? "#080d18" : T.text2,
              border: `1px solid ${statusFilter === s ? T.accent : T.bg4}`,
              borderRadius: T.radius.sm, padding: "5px 12px", fontSize: 12, cursor: "pointer", fontWeight: statusFilter === s ? 700 : 400,
            }}>{s}</button>
          ))}
        </div>
      </div>

      {/* Desktop table */}
      <div className="crm-contacts-table" style={{ background: T.bg2, border: `1px solid ${T.bg4}`, borderRadius: T.radius.lg, overflow: "hidden" }}>
        <div className="crm-contacts-header" style={{ display: "grid", gridTemplateColumns: "2fr 1.2fr 0.8fr 0.6fr 1fr 0.8fr 0.6fr", padding: "10px 20px", borderBottom: `1px solid ${T.bg4}`, gap: 12 }}>
          {["Contact", "Company", "Status", "Score", "Groups", "Last Contact", "Actions"].map(h => (
            <div key={h} style={{ fontSize: 10, color: T.text3, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em" }}>{h}</div>
          ))}
        </div>
        {filtered.map(c => (
          <div key={c.id} onClick={() => onSelectContact(c)} className="crm-contact-row"
            style={{ display: "grid", gridTemplateColumns: "2fr 1.2fr 0.8fr 0.6fr 1fr 0.8fr 0.6fr", padding: "14px 20px", borderBottom: `1px solid ${T.bg3}`, cursor: "pointer", gap: 12, alignItems: "center", transition: "background 0.1s" }}
            onMouseEnter={e => (e.currentTarget.style.background = T.bg3)}
            onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ width: 32, height: 32, borderRadius: T.radius.md, background: c.avatar ? "none" : `linear-gradient(135deg,${scoreColor(c.score)},${T.bg4})`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, color: "#fff", flexShrink: 0, overflow: "hidden" }}>{c.avatar ? <img src={c.avatar} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : c.name[0]}</div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: T.text0 }}>{c.name}</div>
                <div style={{ fontSize: 11, color: T.text3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.email}</div>
              </div>
            </div>
            <div style={{ fontSize: 13, color: T.text2 }}>{c.company}</div>
            <div><span style={badgeStyle(T.text1, T.bg4)}>{c.status}</span></div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div style={{ width: 28, height: 28, borderRadius: T.radius.full, border: `2px solid ${scoreColor(c.score)}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: scoreColor(c.score), fontFamily: "'JetBrains Mono', monospace" }}>{c.score}</span>
              </div>
            </div>
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              {contactGroups(c.id).map(g => (
                <span key={g.id} style={{ fontSize: 10, padding: "1px 6px", borderRadius: T.radius.xs, background: `${g.color}18`, color: g.color, fontWeight: 600 }}>{g.name}</span>
              ))}
            </div>
            <div style={{ fontSize: 12, color: T.text3 }}>{c.lastContact}</div>
            <ActionButtons c={c} />
          </div>
        ))}
        {filtered.length === 0 && contacts.length > 0 && (
          <EmptyState icon="🔍" title="No matches found" description="Try adjusting your search or filters to find what you're looking for." />
        )}
        {contacts.length === 0 && (
          <EmptyState icon="👥" title="No contacts yet" description="Import a CSV or add your first contact to get started with your CRM." />
        )}
      </div>

      {/* Mobile card list */}
      <div className="crm-contacts-cards" style={{ display: "none", flexDirection: "column", gap: 8 }}>
        {filtered.map(c => (
          <div key={c.id} onClick={() => onSelectContact(c)} style={{
            background: `linear-gradient(145deg,${T.bg2},${T.bg3}88)`, border: `1px solid ${T.bg4}`,
            borderRadius: T.radius.md, padding: "14px 16px", cursor: "pointer",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
              <div style={{ width: 36, height: 36, borderRadius: T.radius.md, background: c.avatar ? "none" : `linear-gradient(135deg,${scoreColor(c.score)},${T.bg4})`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 700, color: "#fff", flexShrink: 0, overflow: "hidden" }}>{c.avatar ? <img src={c.avatar} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : c.name[0]}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: T.text0 }}>{c.name}</div>
                <div style={{ fontSize: 12, color: T.text3 }}>{c.company || c.email}</div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <div style={{ width: 28, height: 28, borderRadius: T.radius.full, border: `2px solid ${scoreColor(c.score)}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: scoreColor(c.score), fontFamily: "'JetBrains Mono', monospace" }}>{c.score}</span>
                </div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 6 }}>
              {contactGroups(c.id).map(g => (
                <span key={g.id} style={{ fontSize: 10, padding: "1px 6px", borderRadius: T.radius.xs, background: `${g.color}18`, color: g.color, fontWeight: 600 }}>{g.name}</span>
              ))}
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={badgeStyle(T.text1, T.bg4)}>{c.status}</span>
              <ActionButtons c={c} />
            </div>
          </div>
        ))}
        {filtered.length === 0 && contacts.length > 0 && (
          <EmptyState icon="🔍" title="No matches found" description="Try adjusting your search or filters." />
        )}
        {contacts.length === 0 && (
          <EmptyState icon="👥" title="No contacts yet" description="Import a CSV or add your first contact." />
        )}
      </div>

      {/* Modals */}
      {(showCreateGroup || editingGroup) && (
        <CreateGroupModal
          editGroup={editingGroup}
          onClose={() => { setShowCreateGroup(false); setEditingGroup(null); }}
          onSave={(g) => { editingGroup ? onEditGroup(g) : onCreateGroup(g); setShowCreateGroup(false); setEditingGroup(null); }}
        />
      )}
      {deletingGroup && (
        <DeleteGroupConfirm
          group={deletingGroup}
          onClose={() => setDeletingGroup(null)}
          onConfirm={() => { onDeleteGroup(deletingGroup.id); if (activeGroupId === deletingGroup.id) setActiveGroupId(null); setDeletingGroup(null); }}
        />
      )}
    </div>
  );
}
