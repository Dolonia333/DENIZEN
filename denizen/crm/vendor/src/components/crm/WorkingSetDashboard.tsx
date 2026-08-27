import { useMemo } from "react";
import { T, fmt, type Contact, type Deal, type Task, type Company } from "@/lib/crm-data";
import { buildWorkingSet } from "@/lib/crm-working-set";

interface Props {
  contacts: Contact[];
  deals: Deal[];
  tasks: Task[];
  companies?: Company[];
  onNavigate: (tab: string) => void;
}

function Kpi({
  label, value, sub, accent, onClick,
}: {
  label: string; value: string; sub: string; accent: string; onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        textAlign: "left",
        background: `linear-gradient(145deg,${T.bg2},${T.bg3}88)`,
        border: `1px solid ${T.bg4}`,
        borderRadius: T.radius.lg,
        padding: "16px 18px",
        cursor: onClick ? "pointer" : "default",
        position: "relative",
        overflow: "hidden",
      }}
    >
      <div style={{
        position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: accent,
      }} />
      <div style={{
        fontSize: 10, fontWeight: 700, color: T.text3, textTransform: "uppercase",
        letterSpacing: "0.08em", marginBottom: 6,
      }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: T.text0, letterSpacing: "-0.02em" }}>{value}</div>
      <div style={{ fontSize: 12, color: T.text2, marginTop: 4 }}>{sub}</div>
    </button>
  );
}

function Section({
  title, action, onAction, children,
}: {
  title: string; action?: string; onAction?: () => void; children: React.ReactNode;
}) {
  return (
    <div style={{
      background: `linear-gradient(145deg,${T.bg2},${T.bg3}88)`,
      border: `1px solid ${T.bg4}`,
      borderRadius: T.radius.lg,
      padding: "18px 20px",
      minHeight: 0,
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: T.text1 }}>{title}</h3>
        {action && onAction ? (
          <button
            type="button"
            onClick={onAction}
            style={{ background: "none", border: "none", color: T.accent, fontSize: 12, fontWeight: 600, cursor: "pointer", padding: 0 }}
          >
            {action} →
          </button>
        ) : null}
      </div>
      {children}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div style={{ color: T.text3, fontSize: 12.5, padding: "12px 0", textAlign: "center" }}>{text}</div>;
}

/**
 * Personal working-set board — only live deals / contacts / tasks.
 * Watchlist RFPs and seed leftovers stay out of pipeline $.
 */
export function WorkingSetDashboard({ contacts, deals, tasks, companies = [], onNavigate }: Props) {
  const ws = useMemo(
    () => buildWorkingSet({ deals, contacts, tasks, companies }),
    [deals, contacts, tasks, companies],
  );

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ marginBottom: 16 }}>
        <div style={{
          fontSize: 11, fontWeight: 700, color: T.accent, textTransform: "uppercase",
          letterSpacing: "0.08em", marginBottom: 6,
        }}>
          My board
        </div>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: T.text0 }}>
          Working set
        </h2>
        <p style={{ margin: "6px 0 0", fontSize: 13, color: T.text2, maxWidth: 560, lineHeight: 1.45 }}>
          Who, what, next step, by when. Pipeline $ only moves on a real bid or invoice — watchlist stays parked.
        </p>
      </div>

      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
        gap: 12,
        marginBottom: 16,
      }}>
        <Kpi
          label="Open deals"
          value={String(ws.pipelineDeals.length)}
          sub={`${fmt(ws.pipelineValue)} pipeline`}
          accent={T.accent}
          onClick={() => onNavigate("pipeline")}
        />
        <Kpi
          label="Pipeline $"
          value={fmt(ws.pipelineValue)}
          sub={ws.pipelineValue === 0 ? "no invented numbers" : "live pursuits"}
          accent={ws.pipelineValue === 0 ? T.green : T.accent}
          onClick={() => onNavigate("pipeline")}
        />
        <Kpi
          label="Contacts"
          value={String(ws.contacts.length)}
          sub={`${ws.companies.length} companies`}
          accent={T.blue}
          onClick={() => onNavigate("contacts")}
        />
        <Kpi
          label="Open tasks"
          value={String(ws.openTasks.length)}
          sub={ws.overdueTasks.length ? `${ws.overdueTasks.length} overdue` : "none overdue"}
          accent={ws.overdueTasks.length ? T.red : T.blue}
          onClick={() => onNavigate("tasks")}
        />
        <Kpi
          label="Watchlist"
          value={String(ws.watchlistDeals.length)}
          sub="RFPs parked"
          accent={T.purple}
          onClick={() => onNavigate("pipeline")}
        />
        <Kpi
          label="At risk"
          value={String(ws.atRiskDeals.length)}
          sub="next date missed"
          accent={ws.atRiskDeals.length ? T.red : T.green}
          onClick={() => onNavigate("pipeline")}
        />
      </div>

      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
        gap: 14,
      }}>
        <Section title={`Live deals (${ws.pipelineDeals.length})`} action="Pipeline" onAction={() => onNavigate("pipeline")}>
          {ws.pipelineDeals.length === 0 ? (
            <Empty text="No open pursuits — add one or promote from watchlist" />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {ws.pipelineDeals.map((d) => {
                const next = String(d.closeDate || "").slice(0, 10);
                const missed = Boolean(next && next < today);
                return (
                  <div
                    key={d.id}
                    style={{
                      padding: "10px 12px",
                      borderRadius: T.radius.md,
                      border: `1px solid ${missed ? `${T.red}55` : T.bg4}`,
                      background: T.bg3,
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: T.text0 }}>{d.title}</div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: T.accent, whiteSpace: "nowrap" }}>{fmt(d.value)}</div>
                    </div>
                    <div style={{ fontSize: 11, color: T.text2, marginTop: 4 }}>
                      {d.stage || "—"}
                      {d.contact ? ` · ${d.contact}` : " · no contact"}
                      {d.company ? ` · ${d.company}` : ""}
                    </div>
                    {next ? (
                      <div style={{ fontSize: 11, marginTop: 4, color: missed ? T.red : T.text3 }}>
                        Next {next}{missed ? " · missed" : ""}
                      </div>
                    ) : (
                      <div style={{ fontSize: 11, marginTop: 4, color: T.orange }}>No next date — add a task or close it</div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Section>

        <Section title={`Next actions (${ws.openTasks.length})`} action="Tasks" onAction={() => onNavigate("tasks")}>
          {ws.openTasks.length === 0 ? (
            <Empty text="Every open deal needs one verb task this week" />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {ws.openTasks.slice(0, 8).map((t) => {
                const due = String(t.due || "").slice(0, 10);
                const overdue = Boolean(due && due < today);
                return (
                  <div
                    key={t.id}
                    style={{
                      padding: "10px 12px",
                      borderRadius: T.radius.md,
                      border: `1px solid ${overdue ? `${T.red}55` : T.bg4}`,
                      background: T.bg3,
                    }}
                  >
                    <div style={{ fontSize: 13, fontWeight: 600, color: overdue ? T.red : T.text0 }}>{t.title}</div>
                    <div style={{ fontSize: 11, color: T.text3, marginTop: 4 }}>
                      {due ? `Due ${due}` : "No due date"}
                      {t.contact ? ` · ${t.contact}` : ""}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Section>

        <Section title={`People (${ws.contacts.length})`} action="Contacts" onAction={() => onNavigate("contacts")}>
          {ws.contacts.length === 0 ? (
            <Empty text="No contacts in the working set" />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {ws.contacts.map((c) => (
                <div
                  key={c.id}
                  style={{
                    padding: "10px 12px",
                    borderRadius: T.radius.md,
                    border: `1px solid ${T.bg4}`,
                    background: T.bg3,
                  }}
                >
                  <div style={{ fontSize: 13, fontWeight: 700, color: T.text0 }}>{c.name}</div>
                  <div style={{ fontSize: 11, color: T.text2, marginTop: 3 }}>
                    {c.status || "—"}
                    {c.company ? ` · ${c.company}` : ""}
                  </div>
                  {c.email ? (
                    <div style={{ fontSize: 11, color: T.text3, marginTop: 3 }}>{c.email}</div>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </Section>

        <Section title={`Watchlist (${ws.watchlistDeals.length})`} action="Pipeline" onAction={() => onNavigate("pipeline")}>
          {ws.watchlistDeals.length === 0 ? (
            <Empty text="No parked RFPs" />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <p style={{ margin: "0 0 8px", fontSize: 12, color: T.text2, lineHeight: 1.4 }}>
                Research only — promote after go/no-go. Not counted in pipeline $.
              </p>
              {ws.watchlistDeals.slice(0, 6).map((d) => (
                <div key={d.id} style={{ fontSize: 12, color: T.text2, padding: "4px 0", borderBottom: `1px solid ${T.bg4}` }}>
                  {d.title}
                </div>
              ))}
              {ws.watchlistDeals.length > 6 ? (
                <div style={{ fontSize: 11, color: T.text3, marginTop: 6 }}>
                  +{ws.watchlistDeals.length - 6} more parked
                </div>
              ) : null}
              {ws.expiredDeals.length > 0 ? (
                <div style={{ fontSize: 11, color: T.text3, marginTop: 10 }}>
                  {ws.expiredDeals.length} expired historical row{ws.expiredDeals.length === 1 ? "" : "s"} (not pipeline)
                </div>
              ) : null}
            </div>
          )}
        </Section>
      </div>
    </div>
  );
}
