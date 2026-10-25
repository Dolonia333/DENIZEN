import { useState, useEffect, useRef, useMemo } from "react";
import { T, fmt, type Contact, type Deal, type Note, type Task, type Company, NAV_ITEMS } from "@/lib/crm-data";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  contacts: Contact[];
  deals: Deal[];
  notes?: Note[];
  tasks?: Task[];
  companies?: Company[];
  onNavigate: (id: string) => void;
  onSelectContact?: (c: Contact) => void;
}

export function CommandPalette({ isOpen, onClose, contacts, deals, notes = [], tasks = [], companies = [], onNavigate, onSelectContact }: Props) {
  const [q, setQ] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const [sel, setSel] = useState(0);

  useEffect(() => {
    if (isOpen) setTimeout(() => inputRef.current?.focus(), 60);
    else { setQ(""); setSel(0); }
  }, [isOpen]);

  const results = useMemo(() => {
    if (!q.trim()) return { pages: NAV_ITEMS.slice(0, 8), contacts: [] as Contact[], deals: [] as Deal[], notes: [] as Note[], tasks: [] as Task[], companies: [] as Company[] };
    const lq = q.toLowerCase();
    return {
      pages: NAV_ITEMS.filter(p => p.label.toLowerCase().includes(lq)),
      contacts: contacts.filter(c => c.name.toLowerCase().includes(lq) || c.company.toLowerCase().includes(lq) || c.email.toLowerCase().includes(lq)).slice(0, 5),
      deals: deals.filter(d => d.title.toLowerCase().includes(lq) || d.contact.toLowerCase().includes(lq)).slice(0, 4),
      notes: notes.filter(n => n.text.toLowerCase().includes(lq) || n.contact.toLowerCase().includes(lq)).slice(0, 3),
      tasks: tasks.filter(t => t.title.toLowerCase().includes(lq) || t.contact.toLowerCase().includes(lq)).slice(0, 4),
      companies: companies.filter(c => c.name.toLowerCase().includes(lq) || c.domain.toLowerCase().includes(lq)).slice(0, 4),
    };
  }, [q, contacts, deals, notes, tasks, companies]);

  const flat = [
    ...results.contacts.map(c => ({ ...c, _type: "contact" as const })),
    ...results.deals.map(d => ({ ...d, _type: "deal" as const })),
    ...results.tasks.map(t => ({ ...t, _type: "task" as const })),
    ...results.companies.map(c => ({ ...c, _type: "company" as const })),
    ...results.notes.map(n => ({ ...n, _type: "note" as const })),
    ...results.pages.map(p => ({ ...p, _type: "page" as const })),
  ];

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setSel(p => Math.min(p + 1, flat.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSel(p => Math.max(p - 1, 0)); }
    else if (e.key === "Enter" && flat[sel]) {
      const it = flat[sel];
      if (it._type === "page") onNavigate((it as typeof results.pages[0]).id);
      else if (it._type === "contact") {
        if (onSelectContact) onSelectContact(it as Contact);
        else onNavigate("contacts");
      }
      else if (it._type === "deal") onNavigate("sales");
      else if (it._type === "task") onNavigate("schedule");
      else if (it._type === "company") onNavigate("companies");
      else if (it._type === "note") onNavigate("notes");
      onClose();
    }
    else if (e.key === "Escape") onClose();
  };

  if (!isOpen) return null;

  let idx = -1;
  const section = (title: string, children: React.ReactNode) => (
    <>
      <div style={{ fontSize: 14, color: T.text3, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", padding: "8px 18px 4px" }}>{title}</div>
      {children}
    </>
  );

  const row = (label: string, sub: string, icon: string, i: number, onClick: () => void) => (
    <div key={`${icon}-${i}`} onClick={onClick} onMouseEnter={() => setSel(i)}
      style={{
        padding: "10px 18px", cursor: "pointer",
        background: sel === i ? `${T.accent}12` : "transparent",
        display: "flex", alignItems: "center", gap: 10,
      }}>
      <span style={{ fontSize: 14 }}>{icon}</span>
      <div>
        <div style={{ fontSize: 14, color: T.text0, fontWeight: 600 }}>{label}</div>
        <div style={{ fontSize: 14, color: T.text3 }}>{sub}</div>
      </div>
    </div>
  );

  return (
    <div onClick={onClose} className="animate-fade-in" style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "flex-start", justifyContent: "center", zIndex: 1100, backdropFilter: "blur(8px)", paddingTop: "15vh" }}>
      <div onClick={e => e.stopPropagation()} className="animate-scale-in" style={{ background: T.bg2, border: `1px solid ${T.bg4}`, borderRadius: T.radius.xl, width: 600, maxWidth: "94vw", overflow: "hidden", boxShadow: "0 20px 60px rgba(0,0,0,0.6)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 18px", borderBottom: `1px solid ${T.bg4}` }}>
          <span style={{ color: T.text3, fontSize: 16 }}>🔍</span>
          <input ref={inputRef} value={q} onChange={e = aria-label="input"> { setQ(e.target.value); setSel(0); }} placeholder="Search contacts, deals, tasks, companies…" style={{ flex: 1, background: "none", border: "none", color: T.text0, fontSize: 15, outline: "none" }} onKeyDown={handleKey} />
          <span style={{ fontSize: 14, color: T.text3, background: T.bg3, padding: "2px 6px", borderRadius: 4 }}>esc</span>
        </div>
        <div style={{ maxHeight: 440, overflowY: "auto", padding: "8px 0" }}>
          {results.contacts.length > 0 && section("Contacts", results.contacts.map(c => { idx++; const i = idx; return row(c.name, c.company, "◉", i, () => { if (onSelectContact) onSelectContact(c); else onNavigate("contacts"); onClose(); }); }))}
          {results.deals.length > 0 && section("Deals", results.deals.map(d => { idx++; const i = idx; return row(d.title, `${d.contact} · ${fmt(d.value)}`, "◆", i, () => { onNavigate("sales"); onClose(); }); }))}
          {results.tasks.length > 0 && section("Tasks", results.tasks.map(t => { idx++; const i = idx; return row(t.title, t.due || "no due date", "◇", i, () => { onNavigate("schedule"); onClose(); }); }))}
          {results.companies.length > 0 && section("Companies", results.companies.map(c => { idx++; const i = idx; return row(c.name, c.industry || c.domain, "🏢", i, () => { onNavigate("companies"); onClose(); }); }))}
          {results.notes.length > 0 && section("Notes", results.notes.map(n => { idx++; const i = idx; return row(n.contact, n.text.slice(0, 60), "📌", i, () => { onNavigate("notes"); onClose(); }); }))}
          {results.pages.length > 0 && section("Pages", results.pages.map(p => { idx++; const i = idx; return row(p.label, "Navigate", p.icon, i, () => { onNavigate(p.id); onClose(); }); }))}
          {flat.length === 0 && q.trim() && <div style={{ padding: 24, textAlign: "center", color: T.text3, fontSize: 14 }}>No results for "{q}"</div>}
        </div>
      </div>
    </div>
  );
}
