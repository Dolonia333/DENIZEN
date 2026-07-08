import { useMemo } from "react";
import { T, fmt, type Contact, type Deal, type Task, type SupportTicket } from "@/lib/crm-data";
import { filterMyDeals, filterMyTasks, filterMyTickets } from "@/lib/crm-adoption";

interface Props {
  userName: string;
  deals: Deal[];
  tasks: Task[];
  tickets: SupportTicket[];
  onNavigate: (tab: string) => void;
}

export function MyWorkPanel({ userName, deals, tasks, tickets, onNavigate }: Props) {
  const myDeals = useMemo(() => filterMyDeals(deals, userName).filter((d) => !/closed won|closed lost/i.test(d.stage)).slice(0, 5), [deals, userName]);
  const myTasks = useMemo(() => filterMyTasks(tasks, userName).slice(0, 5), [tasks, userName]);
  const myTickets = useMemo(() => filterMyTickets(tickets, userName).slice(0, 3), [tickets, userName]);

  const card = { background: T.bg2, border: `1px solid ${T.bg3}`, borderRadius: 12, padding: 14 };

  return (
    <div style={{ ...card, marginBottom: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: T.text0 }}>My work — {userName}</h2>
        <button type="button" onClick={() => onNavigate("team")} style={{ background: "none", border: "none", color: T.accent, fontSize: 11, cursor: "pointer" }}>Team view</button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 12 }}>
        <div>
          <div style={{ fontSize: 10, color: T.text3, fontWeight: 700, textTransform: "uppercase", marginBottom: 6 }}>My deals ({myDeals.length})</div>
          {myDeals.length === 0 && <div style={{ fontSize: 11, color: T.text3 }}>No owned deals</div>}
          {myDeals.map((d) => (
            <div key={d.id} style={{ fontSize: 12, color: T.text2, padding: "3px 0" }}>{d.title} · {fmt(d.value)}</div>
          ))}
          <button type="button" onClick={() => onNavigate("sales")} style={{ background: "none", border: "none", color: T.accent, fontSize: 10, cursor: "pointer", marginTop: 4 }}>Pipeline →</button>
        </div>
        <div>
          <div style={{ fontSize: 10, color: T.text3, fontWeight: 700, textTransform: "uppercase", marginBottom: 6 }}>My tasks ({myTasks.length})</div>
          {myTasks.map((t) => (
            <div key={t.id} style={{ fontSize: 12, color: t.due && t.due < new Date().toISOString().slice(0, 10) ? T.red : T.text2, padding: "3px 0" }}>{t.title}</div>
          ))}
          <button type="button" onClick={() => onNavigate("schedule")} style={{ background: "none", border: "none", color: T.accent, fontSize: 10, cursor: "pointer", marginTop: 4 }}>Schedule →</button>
        </div>
        <div>
          <div style={{ fontSize: 10, color: T.text3, fontWeight: 700, textTransform: "uppercase", marginBottom: 6 }}>My tickets ({myTickets.length})</div>
          {myTickets.map((t) => (
            <div key={t.id} style={{ fontSize: 12, color: T.text2, padding: "3px 0" }}>{t.subject}</div>
          ))}
          <button type="button" onClick={() => onNavigate("support")} style={{ background: "none", border: "none", color: T.accent, fontSize: 10, cursor: "pointer", marginTop: 4 }}>Support →</button>
        </div>
      </div>
    </div>
  );
}
