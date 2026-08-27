// Role-aware dashboard renderer. Given the active role + industry, it lays out a
// tailored set of KPI cards and widgets computed from the live workspace data.
// New role layouts live in lib/crm-roles.ts; new widgets get a case in renderWidget().
import { useMemo } from "react";
import {
  T, fmt, STAGE_COLORS, calcLeadScore,
  type Contact, type Deal, type Task, type Note, type Meeting, type Goal,
  type AuditEntry, type EmailLogEntry, type Sequence, type SequenceEnrollment,
  type Submission, type Company,
} from "@/lib/crm-data";
import { useCRMTranslation } from "@/hooks/use-crm-translation";
import { getRoleLayout, type KpiId, type WidgetId } from "@/lib/crm-roles";
import {
  isOpenPipelineDeal,
  isAtRiskWorkingDeal,
  isOpenTask,
  isOverdueTask,
} from "@/lib/crm-working-set";

interface RoleDashboardProps {
  roleId: string;
  contacts: Contact[];
  deals: Deal[];
  tasks: Task[];
  notes: Note[];
  meetings: Meeting[];
  goals?: Goal[];
  auditLog?: AuditEntry[];
  emailLog?: EmailLogEntry[];
  sequences?: Sequence[];
  sequenceEnrollments?: SequenceEnrollment[];
  submissions?: Submission[];
  companies?: Company[];
  onNavigate: (tab: string) => void;
}

const WON = "Closed Won";
const LOST = "Closed Lost";
const isClosed = (d: Deal) => d.stage === WON || d.stage === LOST;
const todayStr = () => new Date().toISOString().slice(0, 10);
const daysSince = (iso?: string) =>
  iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86400000) : 9999;

// ── shared layout primitives ────────────────────────────────────────────────
function Panel({ title, action, onAction, children, accent }: {
  title: string; action?: string; onAction?: () => void; children: React.ReactNode; accent?: string;
}) {
  return (
    <div style={{
      background: `linear-gradient(145deg,${T.bg2},${T.bg3}88)`,
      border: `1px solid ${T.bg4}`, borderRadius: T.radius.lg, padding: "18px 20px",
      display: "flex", flexDirection: "column", minHeight: 0,
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: T.text1, display: "flex", alignItems: "center", gap: 8 }}>
          {accent && <span style={{ width: 8, height: 8, borderRadius: 2, background: accent, display: "inline-block" }} />}
          {title}
        </h3>
        {action && (
          <button onClick={onAction} style={{
            background: "none", border: "none", color: T.text2, fontSize: 12, fontWeight: 600,
            cursor: "pointer", padding: 0,
          }}>{action} →</button>
        )}
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>{children}</div>
    </div>
  );
}

function BarRow({ label, value, max, color, right }: {
  label: string; value: number; max: number; color: string; right?: string;
}) {
  const pct = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0;
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4, fontSize: 12.5 }}>
        <span style={{ color: T.text1, fontWeight: 500 }}>{label}</span>
        <span style={{ color: T.text2, fontWeight: 600 }}>{right ?? value}</span>
      </div>
      <div style={{ height: 7, background: T.bg4, borderRadius: 4, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${pct}%`, background: color, borderRadius: 4 }} />
      </div>
    </div>
  );
}

function EmptyHint({ text }: { text: string }) {
  return <div style={{ color: T.text3, fontSize: 12.5, padding: "16px 4px", textAlign: "center" }}>{text}</div>;
}

const PALETTE = ["#6366f1", "#f0b429", "#3b82f6", "#8b5cf6", "#22d3a0", "#fb923c", "#f85b5b", "#4d9ef7"];

// ── component ───────────────────────────────────────────────────────────────
export function RoleDashboard(props: RoleDashboardProps) {
  const {
    roleId, contacts, deals, tasks, meetings, goals = [], auditLog = [],
    emailLog = [], notes, sequences = [], sequenceEnrollments = [],
    submissions = [], companies = [], onNavigate,
  } = props;
  const { t, industryConfig } = useCRMTranslation();
  // Resolve every label through t() so missing/custom industry terms fall back
  // to sensible English defaults instead of rendering "undefined".
  const term = {
    deals: t("deals"), deal: t("deal"), contacts: t("contacts"), customers: t("customers"),
    tasks: t("tasks"), task: t("task"), pipeline: t("pipeline"),
    pipelineValue: t("pipelineValue"), accounts: t("accounts"),
  };
  const layout = useMemo(() => getRoleLayout(roleId, industryConfig.id), [roleId, industryConfig.id]);

  const m = useMemo(() => {
    const open = deals.filter((d) => isOpenPipelineDeal(d));
    const won = deals.filter((d) => d.stage === WON);
    const lost = deals.filter((d) => d.stage === LOST || /disqual/i.test(String(d.status || "")) || /lost/i.test(d.stage));
    const pipelineValue = open.reduce((s, d) => s + (d.value || 0), 0);
    const weighted = open.reduce((s, d) => s + (d.value || 0) * (d.probability || 0) / 100, 0);
    const wonValue = won.reduce((s, d) => s + (d.value || 0), 0);
    const customers = contacts.filter((c) => /customer|active client/i.test(c.status || ""));
    const openTasks = tasks.filter((t) => isOpenTask(t));
    const overdue = openTasks.filter((t) => isOverdueTask(t, todayStr()));
    const today = todayStr();
    const meetingsToday = meetings.filter((mt) => mt.date === today);
    const atRisk = open.filter((d) => isAtRiskWorkingDeal(d, today));
    const leads = contacts.filter((c) => !/customer|active client|capture team|partner/i.test(c.status || ""));
    const newLeads = leads.filter((c) => daysSince(c.lastContact) <= 14);
    const qualified = contacts.filter((c) => calcLeadScore(c, emailLog, deals, notes, tasks) >= 70);
    const sentEmails = emailLog.length;
    const openedEmails = emailLog.filter((e) => (e.opens?.length || 0) > 0).length;
    const activeSeq = sequences.filter((s) => s.active);
    const activeEnroll = sequenceEnrollments.filter((e) => e.status === "active");
    const renewals = open.filter((d) => d.closeDate && daysSince(d.closeDate) < 0 && -daysSince(d.closeDate) <= 30);
    return {
      open, won, lost, pipelineValue, weighted, wonValue, customers, openTasks, overdue,
      meetingsToday, atRisk, leads, newLeads, qualified, sentEmails, openedEmails,
      activeSeq, activeEnroll, renewals,
      winRate: won.length + lost.length > 0 ? Math.round((won.length / (won.length + lost.length)) * 100) : 0,
      avgDeal: won.length ? wonValue / won.length : 0,
      convRate: contacts.length ? Math.round((customers.length / contacts.length) * 100) : 0,
      respRate: sentEmails ? Math.round((openedEmails / sentEmails) * 100) : 0,
    };
  }, [deals, contacts, tasks, meetings, emailLog, notes, sequences, sequenceEnrollments]);

  // ── KPI cards ──────────────────────────────────────────────────────────────
  function kpi(id: KpiId): { label: string; value: string; sub: string; accent: string } {
    switch (id) {
      case "pipeline-value": return { label: term.pipelineValue, value: fmt(m.pipelineValue), sub: `${m.open.length} open ${term.deals.toLowerCase()}`, accent: T.accent };
      case "weighted-pipeline": return { label: "Weighted Pipeline", value: fmt(Math.round(m.weighted)), sub: "probability-adjusted", accent: T.purple };
      case "won-value": return { label: `${term.deals} Won`, value: fmt(m.wonValue), sub: `${m.won.length} closed`, accent: T.green };
      case "open-deals": return { label: `Open ${term.deals}`, value: String(m.open.length), sub: fmt(m.pipelineValue), accent: T.accent };
      case "contacts": return { label: term.contacts, value: String(contacts.length), sub: `${m.customers.length} ${term.customers.toLowerCase()}`, accent: T.blue };
      case "customers": return { label: term.customers, value: String(m.customers.length), sub: `of ${contacts.length} ${term.contacts.toLowerCase()}`, accent: T.green };
      case "tasks-due": return { label: term.tasks + " Due", value: String(m.openTasks.length), sub: m.overdue.length ? `${m.overdue.length} overdue` : "on track", accent: m.overdue.length ? T.red : T.blue };
      case "overdue-tasks": return { label: "Overdue", value: String(m.overdue.length), sub: `${m.openTasks.length} open`, accent: T.red };
      case "new-leads": return { label: "New Leads", value: String(m.newLeads.length), sub: "last 14 days", accent: T.blue };
      case "meetings-today": return { label: "Meetings Today", value: String(m.meetingsToday.length), sub: "scheduled", accent: T.purple };
      case "at-risk-count": return { label: "At-Risk", value: String(m.atRisk.length), sub: `${term.deals.toLowerCase()} need attention`, accent: T.red };
      case "win-rate": return { label: "Win Rate", value: `${m.winRate}%`, sub: `${m.won.length}W · ${m.lost.length}L`, accent: T.green };
      case "avg-deal": return { label: `Avg ${term.deal}`, value: fmt(Math.round(m.avgDeal)), sub: "won deals", accent: T.accent };
      case "active-sequences": return { label: "Active Sequences", value: String(m.activeSeq.length), sub: `${m.activeEnroll.length} enrolled`, accent: T.blue };
      case "renewals-due": return { label: "Closing ≤30d", value: String(m.renewals.length), sub: "upcoming", accent: T.orange };
      case "response-rate": return { label: "Email Open Rate", value: `${m.respRate}%`, sub: `${m.sentEmails} sent`, accent: T.purple };
      case "qualified-leads": return { label: "Qualified (MQL)", value: String(m.qualified.length), sub: "score ≥ 70", accent: T.accent };
      case "conversion-rate": return { label: "Conversion", value: `${m.convRate}%`, sub: "contact → customer", accent: T.green };
      case "total-revenue": return { label: "Revenue (Won)", value: fmt(m.wonValue), sub: `${m.won.length} ${term.deals.toLowerCase()}`, accent: T.green };
      case "quota-attainment": return { label: "Attainment", value: fmt(m.wonValue), sub: "vs target", accent: T.accent };
      default: return { label: id, value: "—", sub: "", accent: T.text3 };
    }
  }

  // ── widgets ──────────────────────────────────────────────────────────────
  function renderWidget(id: WidgetId): React.ReactNode {
    switch (id) {
      case "pipeline-by-stage": {
        const stages = industryConfig.pipelineStages?.length ? industryConfig.pipelineStages : Object.keys(STAGE_COLORS);
        const byStage = stages.map((st, i) => ({
          st, color: STAGE_COLORS[st] || PALETTE[i % PALETTE.length],
          val: deals.filter((d) => d.stage === st && d.stage !== LOST).reduce((s, d) => s + (d.value || 0), 0),
          count: deals.filter((d) => d.stage === st).length,
        })).filter((r) => !/lost/i.test(r.st));
        const max = Math.max(1, ...byStage.map((r) => r.val));
        return (
          <Panel title={term.pipeline} action="View" onAction={() => onNavigate("sales")} accent={T.accent}>
            {byStage.some((r) => r.count) ? byStage.map((r) => (
              <BarRow key={r.st} label={`${r.st} · ${r.count}`} value={r.val} max={max} color={r.color} right={fmt(r.val)} />
            )) : <EmptyHint text={`No ${term.deals.toLowerCase()} yet`} />}
          </Panel>
        );
      }
      case "forecast": {
        const buckets = [
          { label: "Commit (>70%)", color: T.green, deals: m.open.filter((d) => (d.probability || 0) >= 70) },
          { label: "Best Case (40-70%)", color: T.blue, deals: m.open.filter((d) => (d.probability || 0) >= 40 && (d.probability || 0) < 70) },
          { label: "Pipeline (<40%)", color: T.accent, deals: m.open.filter((d) => (d.probability || 0) < 40) },
        ];
        const max = Math.max(1, ...buckets.map((b) => b.deals.reduce((s, d) => s + (d.value || 0), 0)));
        return (
          <Panel title="Forecast" accent={T.green}>
            {buckets.map((b) => {
              const v = b.deals.reduce((s, d) => s + (d.value || 0), 0);
              return <BarRow key={b.label} label={`${b.label} · ${b.deals.length}`} value={v} max={max} color={b.color} right={fmt(v)} />;
            })}
          </Panel>
        );
      }
      case "leaderboard": {
        const byOwner = new Map<string, { won: number; open: number }>();
        deals.forEach((d) => {
          const owner = d.ownerId || "Unassigned";
          const cur = byOwner.get(owner) || { won: 0, open: 0 };
          if (d.stage === WON) cur.won += d.value || 0;
          else if (isOpenPipelineDeal(d)) cur.open += d.value || 0;
          byOwner.set(owner, cur);
        });
        const rows = [...byOwner.entries()].sort((a, b) => b[1].won - a[1].won).slice(0, 6);
        const max = Math.max(1, ...rows.map((r) => r[1].won + r[1].open));
        return (
          <Panel title="Leaderboard" accent={T.purple}>
            {rows.length && (rows.length > 1 || rows[0][0] !== "Unassigned") ? rows.map(([owner, v], i) => (
              <BarRow key={owner} label={`${i + 1}. ${owner}`} value={v.won + v.open} max={max} color={PALETTE[i % PALETTE.length]} right={fmt(v.won)} />
            )) : <EmptyHint text="Assign deal owners to rank reps" />}
          </Panel>
        );
      }
      case "revenue-trend": {
        const months: { key: string; label: string; val: number }[] = [];
        for (let i = 5; i >= 0; i -= 1) {
          const d = new Date(); d.setMonth(d.getMonth() - i);
          months.push({ key: d.toISOString().slice(0, 7), label: d.toLocaleString("en", { month: "short" }), val: 0 });
        }
        m.won.forEach((d) => {
          const k = (d.closeDate || "").slice(0, 7);
          const hit = months.find((mo) => mo.key === k);
          if (hit) hit.val += d.value || 0;
        });
        const max = Math.max(1, ...months.map((mo) => mo.val));
        return (
          <Panel title="Revenue Trend" action="Analytics" onAction={() => onNavigate("analytics")} accent={T.green}>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 8, height: 120, paddingTop: 8 }}>
              {months.map((mo) => (
                <div key={mo.key} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
                  <div style={{ fontSize: 10, color: T.text2 }}>{mo.val ? `$${Math.round(mo.val / 1000)}k` : ""}</div>
                  <div style={{ width: "100%", height: `${Math.max(2, (mo.val / max) * 90)}px`, background: `linear-gradient(180deg,${T.green},${T.green}55)`, borderRadius: "4px 4px 0 0" }} />
                  <div style={{ fontSize: 11, color: T.text3 }}>{mo.label}</div>
                </div>
              ))}
            </div>
          </Panel>
        );
      }
      case "tasks-due": {
        const rows = [...m.openTasks].sort((a, b) => (a.due || "").localeCompare(b.due || "")).slice(0, 6);
        return (
          <Panel title={`${term.tasks} Due`} action="All" onAction={() => onNavigate("schedule")} accent={T.blue}>
            {rows.length ? rows.map((t) => {
              const od = t.due && t.due < todayStr();
              return (
                <div key={t.id} style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", borderBottom: `1px solid ${T.bg3}`, fontSize: 12.5 }}>
                  <span style={{ color: T.text1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "70%" }}>{t.title}</span>
                  <span style={{ color: od ? T.red : T.text2, fontWeight: 600 }}>{t.due || "—"}</span>
                </div>
              );
            }) : <EmptyHint text="All caught up 🎉" />}
          </Panel>
        );
      }
      case "follow-ups": {
        const rows = m.open
          .map((d) => ({ d, c: contacts.find((c) => c.name === d.contact) }))
          .filter((r) => r.c && daysSince(r.c!.lastContact) >= 7)
          .sort((a, b) => daysSince(b.c!.lastContact) - daysSince(a.c!.lastContact))
          .slice(0, 6);
        return (
          <Panel title="Follow-Up Reminders" accent={T.orange}>
            {rows.length ? rows.map((r) => (
              <div key={r.d.id} style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", borderBottom: `1px solid ${T.bg3}`, fontSize: 12.5 }}>
                <span style={{ color: T.text1 }}>{r.c!.name}</span>
                <span style={{ color: T.orange, fontWeight: 600 }}>{daysSince(r.c!.lastContact)}d ago</span>
              </div>
            )) : <EmptyHint text="No follow-ups pending" />}
          </Panel>
        );
      }
      case "top-leads": {
        const rows = contacts
          .filter((c) => !/customer/i.test(c.status || ""))
          .map((c) => ({ c, score: calcLeadScore(c, emailLog, deals, notes, tasks) }))
          .sort((a, b) => b.score - a.score).slice(0, 6);
        return (
          <Panel title="Top Scored Leads" action="Contacts" onAction={() => onNavigate("contacts")} accent={T.accent}>
            {rows.length ? rows.map((r) => (
              <div key={r.c.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: `1px solid ${T.bg3}`, fontSize: 12.5 }}>
                <span style={{ color: T.text1 }}>{r.c.name}<span style={{ color: T.text3, marginLeft: 6 }}>{r.c.company}</span></span>
                <span style={{ color: r.score >= 70 ? T.green : T.accent, fontWeight: 700 }}>{r.score}</span>
              </div>
            )) : <EmptyHint text="Add contacts to see lead scores" />}
          </Panel>
        );
      }
      case "at-risk-deals": {
        return (
          <Panel title={`At-Risk ${term.deals}`} accent={T.red}>
            {m.atRisk.length ? m.atRisk.slice(0, 6).map((d) => (
              <div key={d.id} style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", borderBottom: `1px solid ${T.bg3}`, fontSize: 12.5 }}>
                <span style={{ color: T.text1 }}>{d.title}</span>
                <span style={{ color: T.red, fontWeight: 600 }}>{fmt(d.value)}</span>
              </div>
            )) : <EmptyHint text="✓ All deals healthy" />}
          </Panel>
        );
      }
      case "recent-activity": {
        return (
          <Panel title="Recent Activity" accent={T.blue}>
            {auditLog.length ? auditLog.slice(0, 8).map((a) => (
              <div key={a.id} style={{ padding: "6px 0", borderBottom: `1px solid ${T.bg3}`, fontSize: 12 }}>
                <span style={{ color: T.text2 }}>{a.user} </span>
                <span style={{ color: T.text1 }}>{a.action} {a.entity} </span>
                <span style={{ color: T.text3 }}>{a.entityName}</span>
              </div>
            )) : <EmptyHint text="Activity will appear here" />}
          </Panel>
        );
      }
      case "funnel": {
        const stages = [
          { label: term.contacts, n: contacts.length, color: T.blue },
          { label: "Engaged", n: contacts.filter((c) => c.interactions > 0).length, color: T.accent },
          { label: "Qualified", n: m.qualified.length, color: T.purple },
          { label: term.customers, n: m.customers.length, color: T.green },
        ];
        const max = Math.max(1, ...stages.map((s) => s.n));
        return (
          <Panel title="Conversion Funnel" accent={T.purple}>
            {stages.map((s, i) => (
              <BarRow key={s.label} label={s.label} value={s.n} max={max} color={s.color}
                right={`${s.n}${i > 0 && stages[0].n ? ` · ${Math.round((s.n / stages[0].n) * 100)}%` : ""}`} />
            ))}
          </Panel>
        );
      }
      case "active-sequences": {
        return (
          <Panel title="Active Sequences" action="Sequences" onAction={() => onNavigate("sequences")} accent={T.blue}>
            {m.activeSeq.length ? m.activeSeq.slice(0, 6).map((s) => {
              const enrolled = sequenceEnrollments.filter((e) => e.sequenceId === s.id && e.status === "active").length;
              return (
                <div key={s.id} style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", borderBottom: `1px solid ${T.bg3}`, fontSize: 12.5 }}>
                  <span style={{ color: T.text1 }}>{s.name}</span>
                  <span style={{ color: T.blue, fontWeight: 600 }}>{enrolled} active</span>
                </div>
              );
            }) : <EmptyHint text="No active sequences" />}
          </Panel>
        );
      }
      case "meetings-today": {
        return (
          <Panel title="Today's Meetings" action="Schedule" onAction={() => onNavigate("schedule")} accent={T.purple}>
            {m.meetingsToday.length ? m.meetingsToday.slice(0, 6).map((mt) => (
              <div key={mt.id} style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", borderBottom: `1px solid ${T.bg3}`, fontSize: 12.5 }}>
                <span style={{ color: T.text1 }}>{mt.title}<span style={{ color: T.text3, marginLeft: 6 }}>{mt.contact}</span></span>
                <span style={{ color: T.purple, fontWeight: 600 }}>{mt.time}</span>
              </div>
            )) : <EmptyHint text="No meetings today" />}
          </Panel>
        );
      }
      case "lead-sources": {
        const bySource = new Map<string, number>();
        contacts.forEach((c) => {
          const src = c.leadSource || "Unknown";
          bySource.set(src, (bySource.get(src) || 0) + 1);
        });
        const rows = [...bySource.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
        const max = Math.max(1, ...rows.map((r) => r[1]));
        return (
          <Panel title="Lead Sources" accent={T.orange}>
            {rows.length ? rows.map(([src, n], i) => (
              <BarRow key={src} label={src} value={n} max={max} color={PALETTE[i % PALETTE.length]} />
            )) : <EmptyHint text="No lead source data" />}
          </Panel>
        );
      }
      case "new-leads-list": {
        const rows = [...m.newLeads].sort((a, b) => daysSince(a.lastContact) - daysSince(b.lastContact)).slice(0, 7);
        return (
          <Panel title="New Leads" action="Contacts" onAction={() => onNavigate("contacts")} accent={T.blue}>
            {rows.length ? rows.map((c) => (
              <div key={c.id} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: `1px solid ${T.bg3}`, fontSize: 12.5 }}>
                <span style={{ color: T.text1 }}>{c.name}<span style={{ color: T.text3, marginLeft: 6 }}>{c.company}</span></span>
                <span style={{ color: T.text2 }}>{c.status}</span>
              </div>
            )) : <EmptyHint text="No new leads in 14 days" />}
          </Panel>
        );
      }
      case "accounts-health": {
        const src = companies.length
          ? companies.map((c) => ({ name: c.name, health: c.health, sub: fmt(c.arr || c.mrr * 12 || 0) }))
          : m.customers.map((c) => ({ name: c.name, health: deals.find((d) => d.contact === c.name)?.health || "good", sub: c.company }));
        return (
          <Panel title={`${term.accounts} Health`} action="Companies" onAction={() => onNavigate("companies")} accent={T.green}>
            {src.length ? src.slice(0, 7).map((a, i) => {
              const risk = /risk|churn/i.test(a.health);
              return (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: `1px solid ${T.bg3}`, fontSize: 12.5 }}>
                  <span style={{ color: T.text1, display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ width: 7, height: 7, borderRadius: 999, background: risk ? T.red : T.green }} />{a.name}
                  </span>
                  <span style={{ color: T.text3 }}>{a.sub}</span>
                </div>
              );
            }) : <EmptyHint text={`No ${term.accounts.toLowerCase()} yet`} />}
          </Panel>
        );
      }
      case "renewals": {
        return (
          <Panel title="Closing Soon (≤30d)" accent={T.orange}>
            {m.renewals.length ? m.renewals.slice(0, 6).map((d) => (
              <div key={d.id} style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", borderBottom: `1px solid ${T.bg3}`, fontSize: 12.5 }}>
                <span style={{ color: T.text1 }}>{d.title}</span>
                <span style={{ color: T.orange, fontWeight: 600 }}>{d.closeDate}</span>
              </div>
            )) : <EmptyHint text="Nothing closing in 30 days" />}
          </Panel>
        );
      }
      case "goals": {
        return (
          <Panel title="Goals" accent={T.accent}>
            {goals.length ? goals.slice(0, 5).map((g) => {
              const pct = g.target ? Math.min(100, Math.round((g.current / g.target) * 100)) : 0;
              return <BarRow key={g.id} label={g.label} value={g.current} max={g.target || 1} color={g.color || T.accent} right={`${pct}%`} />;
            }) : <EmptyHint text="Set goals in Analytics" />}
          </Panel>
        );
      }
      case "industry-spotlight":
        return renderIndustrySpotlight();
      default:
        return null;
    }
  }

  // Industry-tailored spotlight panel — reshapes the dashboard per vertical.
  // Every industry gets one: named verticals below get a custom title + metric,
  // and any other (incl. custom) falls back to a config-driven spotlight.
  function renderIndustrySpotlight(): React.ReactNode {
    const id = industryConfig.id;
    const stages = industryConfig.pipelineStages || [];
    const groupByStage = () => {
      const live = stages.filter((st) => !/lost|cancel/i.test(st));
      const max = Math.max(1, ...live.map((st) => deals.filter((d) => d.stage === st).length));
      return live.map((st, i) => (
        <BarRow key={st} label={st} value={deals.filter((d) => d.stage === st).length} max={max} color={PALETTE[i % PALETTE.length]} />
      ));
    };
    const today = todayStr();
    const upcoming = meetings.filter((mt) => mt.date >= today).length;
    const todayCount = meetings.filter((mt) => mt.date === today).length;

    // Per-industry flavor: spotlight title + the noun used for scheduled events.
    const FLAVOR: Record<string, { title: string; eventNoun?: string; eventIcon?: string; metric?: () => React.ReactNode }> = {
      "real-estate": { title: "Listings by Status", eventNoun: "showing", eventIcon: "📅" },
      legal: { title: "Cases by Phase", eventNoun: "hearing/meeting", eventIcon: "⚖️" },
      healthcare: { title: "Patient Pipeline", eventNoun: "appointment", eventIcon: "📅" },
      dental: { title: "Treatment Pipeline", eventNoun: "appointment", eventIcon: "🦷" },
      veterinary: { title: "Care Pipeline", eventNoun: "appointment", eventIcon: "🐾" },
      recruitment: { title: "Candidates by Stage", eventNoun: "interview", eventIcon: "🗓" },
      media: { title: "Bookings by Stage", eventNoun: "shoot/session", eventIcon: "🎬" },
      education: { title: "Admissions Pipeline", eventNoun: "tour/interview", eventIcon: "🎓" },
      consulting: { title: "Projects by Phase", eventNoun: "meeting", eventIcon: "📊" },
      "financial-services": { title: "Portfolios by Stage", metric: () => <>💰 {fmt(m.pipelineValue)} assets in pipeline</> },
      nonprofit: { title: "Donations & Grants", metric: () => <>🎁 {fmt(m.wonValue)} raised</> },
      manufacturing: { title: "Orders by Stage", eventNoun: "site visit", eventIcon: "🏭" },
      retail: { title: "Sales Pipeline" },
      insurance: { title: "Policies by Status", eventNoun: "review", eventIcon: "🛡️" },
      automotive: { title: "Sales by Stage", eventNoun: "test drive", eventIcon: "🚗" },
      construction: { title: "Bids & Projects", eventNoun: "site visit", eventIcon: "🏗️" },
      hospitality: { title: "Reservations by Status", eventNoun: "event/tour", eventIcon: "🏨" },
      fitness: { title: "Memberships by Stage", eventNoun: "tour/class", eventIcon: "💪" },
      travel: { title: "Trips by Status", eventNoun: "consultation", eventIcon: "✈️" },
      "home-services": { title: "Jobs by Stage", eventNoun: "service visit", eventIcon: "🔧" },
      accounting: { title: "Engagements by Stage", eventNoun: "meeting", eventIcon: "📒" },
      beauty: { title: "Appointments by Status", eventNoun: "appointment", eventIcon: "💅" },
      events: { title: "Events by Stage", eventNoun: "planning meeting", eventIcon: "🎉" },
      logistics: { title: "Freight by Stage", eventNoun: "review", eventIcon: "🚚" },
      agency: { title: "New Business Pipeline", eventNoun: "pitch/kickoff", eventIcon: "📈" },
      solar: { title: "Installs by Stage", eventNoun: "site survey", eventIcon: "☀️" },
      saas: { title: "Subscriptions by Stage", metric: () => <>☁️ {fmt(m.pipelineValue)} ARR in pipeline</> },
      iaas: { title: "Workloads by Stage", eventNoun: "architecture review", eventIcon: "🖥️" },
      govcon: { title: "Opportunities by Phase", eventNoun: "capture meeting", eventIcon: "🏛️" },
      cybersecurity: { title: "Engagements by Phase", eventNoun: "assessment", eventIcon: "🔐" },
      msp: { title: "MSAs by Stage", metric: () => <>🛠️ {fmt(m.pipelineValue)} MRR pipeline</> },
      telecom: { title: "Circuits by Status", eventNoun: "install", eventIcon: "📡" },
      "energy-utilities": { title: "Contracts by Stage", eventNoun: "site assessment", eventIcon: "⚡" },
      ecommerce: { title: "Accounts by Stage", eventNoun: "launch", eventIcon: "🛒" },
      "aerospace-defense": { title: "Programs by Phase", eventNoun: "program review", eventIcon: "🛩️" },
      "pharma-life-sciences": { title: "Programs by Phase", eventNoun: "scientific review", eventIcon: "🧬" },
      "property-management": { title: "Leases by Status", eventNoun: "tour", eventIcon: "🏢" },
      franchise: { title: "Franchise Pipeline", eventNoun: "discovery day", eventIcon: "🍔" },
      staffing: { title: "Placements by Stage", eventNoun: "interview", eventIcon: "👥" },
    };

    const flavor = FLAVOR[id];
    const icon = industryConfig.icon || "📊";
    const title = flavor?.title || `${term.pipeline} by ${industryConfig.terminology?.stage || "Stage"}`;
    const metricLine: React.ReactNode = flavor?.metric
      ? flavor.metric()
      : flavor?.eventNoun
        ? <>{flavor.eventIcon || "📅"} {upcoming} {flavor.eventNoun}{upcoming === 1 ? "" : "s"} upcoming{todayCount ? ` · ${todayCount} today` : ""}</>
        : null;

    return (
      <Panel title={`${icon} ${title}`} action="View" onAction={() => onNavigate("sales")} accent={T.accent}>
        {deals.length ? (
          <>
            {groupByStage()}
            {metricLine && <div style={{ marginTop: 10, fontSize: 12, color: T.text2 }}>{metricLine}</div>}
          </>
        ) : <EmptyHint text={`No ${term.deals.toLowerCase()} yet`} />}
      </Panel>
    );
  }

  return (
    <div>
      {/* KPI row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 14, marginBottom: 16 }}>
        {layout.kpis.map((id) => {
          const k = kpi(id);
          return (
            <div key={id} style={{
              background: `linear-gradient(145deg,${T.bg2},${T.bg3}88)`, border: `1px solid ${T.bg4}`,
              borderRadius: T.radius.lg, padding: "16px 18px", position: "relative", overflow: "hidden",
            }}>
              <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: k.accent }} />
              <div style={{ fontSize: 10.5, color: T.text2, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em" }}>{k.label}</div>
              <div style={{ fontSize: 26, fontWeight: 800, color: T.text0, margin: "6px 0 2px" }}>{k.value}</div>
              <div style={{ fontSize: 11.5, color: T.text3 }}>{k.sub}</div>
            </div>
          );
        })}
      </div>

      {/* Widget grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))", gap: 14, alignItems: "start" }}>
        {layout.widgets.map((id) => (
          <div key={id}>{renderWidget(id)}</div>
        ))}
      </div>
    </div>
  );
}
