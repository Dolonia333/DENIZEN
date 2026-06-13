import { useState } from "react";
import { T, type Note } from "@/lib/crm-data";

interface Props {
  notes: Note[];
  onDeleteNote: (id: number) => void;
}

const typeIcons: Record<string, string> = { Call: "📞", Email: "📧", Meeting: "🤝" };
const typeColors: Record<string, string> = { Call: "#22d3a0", Email: "#4d9ef7", Meeting: "#8b5cf6" };

export function ActivityTab({ notes, onDeleteNote }: Props) {
  const [filter, setFilter] = useState("All");
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);

  const types = ["All", ...Array.from(new Set(notes.map(n => n.type)))];
  const filtered = filter === "All" ? notes : notes.filter(n => n.type === filter);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: T.text0, margin: 0, letterSpacing: "-0.02em" }}>Activity</h1>
          <p style={{ fontSize: 13, color: T.text2, marginTop: 4 }}>{notes.length} interactions logged</p>
        </div>
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {types.map(t => (
            <button key={t} onClick={() => setFilter(t)} style={{
              background: filter === t ? T.accent : T.bg3,
              color: filter === t ? "#080d18" : T.text2,
              border: `1px solid ${filter === t ? T.accent : T.bg4}`,
              borderRadius: T.radius.sm, padding: "5px 12px", fontSize: 11, cursor: "pointer", fontWeight: filter === t ? 700 : 400,
            }}>{t}</button>
          ))}
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
        {filtered.map((n, i) => (
          <div key={n.id} style={{
            display: "flex", gap: 16, padding: "16px 0",
            borderBottom: i < filtered.length - 1 ? `1px solid ${T.bg3}` : "none",
          }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
              <div style={{
                width: 36, height: 36, borderRadius: T.radius.full,
                background: `${typeColors[n.type] || T.purple}18`,
                display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, flexShrink: 0,
              }}>
                {typeIcons[n.type] || "📝"}
              </div>
              {i < filtered.length - 1 && <div style={{ flex: 1, width: 1, background: T.bg4 }} />}
            </div>
            <div style={{ flex: 1, paddingTop: 4 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6, flexWrap: "wrap", gap: 4 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: T.text0 }}>{n.contact}</span>
                  <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: T.radius.sm, background: `${typeColors[n.type] || T.purple}18`, color: typeColors[n.type] || T.purple, fontWeight: 600 }}>{n.type}</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 11, color: T.text3 }}>{n.date}</span>
                  {confirmDelete === n.id ? (
                    <button onClick={() => { onDeleteNote(n.id); setConfirmDelete(null); }} style={{ background: T.red, border: "none", borderRadius: T.radius.xs, padding: "2px 8px", color: "#fff", fontSize: 10, cursor: "pointer" }}>Delete</button>
                  ) : (
                    <button onClick={() => setConfirmDelete(n.id)} style={{ background: "none", border: "none", color: T.text3, cursor: "pointer", fontSize: 14, padding: 0 }}>✕</button>
                  )}
                </div>
              </div>
              <div style={{ fontSize: 13, color: T.text2, lineHeight: 1.5 }}>{n.text}</div>
            </div>
          </div>
        ))}
        {filtered.length === 0 && (
          <div style={{ padding: 40, textAlign: "center", color: T.text3 }}>No activity found</div>
        )}
      </div>
    </div>
  );
}
