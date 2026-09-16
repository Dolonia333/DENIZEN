import { useEffect, useMemo, useState } from "react";
import {
  T, S, DEFAULT_TEAM_POLICY,
  type Deal, type Contact, type Task, type TeamPolicy, type UsageLogEntry,
} from "@/lib/crm-data";
import { computeAdoptionMetrics, inactiveUsers } from "@/lib/crm-adoption";
import { fetchCrmTeamActivity, type CrmTeamActivityItem } from "@/lib/crm-api";

interface Props {
  deals: Deal[];
  contacts: Contact[];
  tasks: Task[];
  teamMembers: string[];
  teamPolicy: TeamPolicy;
  usageLog: UsageLogEntry[];
  currentUserName: string;
  crmScope?: "own" | "org" | null;
  canManageTeam?: boolean;
  onUpdateDeals: (deals: Deal[]) => void;
  onUpdateTasks: (tasks: Task[]) => void;
  onUpdatePolicy: (policy: TeamPolicy) => void;
}

function nextId(list: { id: number }[]) {
  return list.length ? Math.max(...list.map((r) => r.id)) + 1 : Date.now();
}

function formatWhen(iso: string | null | undefined) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  } catch {
    return "";
  }
}

export function TeamTab({
  deals, contacts, tasks, teamMembers, teamPolicy, usageLog,
  currentUserName, crmScope, canManageTeam = true,
  onUpdateDeals, onUpdateTasks, onUpdatePolicy,
}: Props) {
  const [assignOwner, setAssignOwner] = useState("");
  const [selectedDealIds, setSelectedDealIds] = useState<number[]>([]);
  const [bulkTaskTitle, setBulkTaskTitle] = useState("");
  const [bulkTaskAssignee, setBulkTaskAssignee] = useState("");
  const [feed, setFeed] = useState<CrmTeamActivityItem[]>([]);
  const [feedLoading, setFeedLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setFeedLoading(true);
    void fetchCrmTeamActivity(50).then((result) => {
      if (cancelled) return;
      setFeed(result.feed || []);
      setFeedLoading(false);
    });
    const timer = setInterval(() => {
      void fetchCrmTeamActivity(50).then((result) => {
        if (!cancelled) setFeed(result.feed || []);
      });
    }, 30_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const unownedDeals = useMemo(
    () => deals.filter((d) => !/closed won|closed lost/i.test(d.stage) && !d.ownerId?.trim()),
    [deals],
  );

  const adoption = useMemo(
    () => computeAdoptionMetrics(usageLog, teamMembers, 7),
    [usageLog, teamMembers],
  );

  const inactive = useMemo(
    () => inactiveUsers(usageLog, teamMembers, teamPolicy.nudgeInactiveDays),
    [usageLog, teamMembers, teamPolicy.nudgeInactiveDays],
  );

  const toggleDeal = (id: number) => {
    setSelectedDealIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  };

  const bulkAssignDeals = () => {
    if (!assignOwner.trim() || !selectedDealIds.length) return;
    onUpdateDeals(deals.map((d) => selectedDealIds.includes(d.id) ? { ...d, ownerId: assignOwner.trim() } : d));
    setSelectedDealIds([]);
  };

  const bulkCreateTasks = () => {
    if (!bulkTaskTitle.trim() || !bulkTaskAssignee.trim()) return;
    const due = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
    const newTasks = selectedDealIds.map((dealId) => {
      const deal = deals.find((d) => d.id === dealId);
      return {
        id: nextId(tasks) + dealId,
        title: bulkTaskTitle.replace("{{deal}}", deal?.title || "deal"),
        contact: deal?.contact || "",
        due,
        priority: "High",
        done: false,
        assignee: bulkTaskAssignee,
        createdBy: currentUserName,
        createdAt: new Date().toISOString(),
      };
    });
    onUpdateTasks([...newTasks, ...tasks]);
    setBulkTaskTitle("");
  };

  const card = { background: T.bg2, border: `1px solid ${T.bg3}`, borderRadius: 12, padding: 16 };
  const scoped = crmScope === "own";

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: T.text0 }}>Team viewer</h1>
        <p style={{ margin: "4px 0 0", fontSize: 13, color: T.text2 }}>
          {scoped
            ? "See what everyone is doing. Your CRM records stay limited to your own work."
            : "Live team activity, adoption, and manager assignments across the org."}
        </p>
      </div>

      <div style={{ ...card, marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, marginBottom: 10 }}>
          <h2 style={{ margin: 0, fontSize: 14, color: T.text0 }}>What everyone is doing</h2>
          <span style={{ fontSize: 11, color: T.text3 }}>{feedLoading ? "Loading…" : "Live · 30s"}</span>
        </div>
        {feed.length === 0 && !feedLoading && (
          <div style={{ fontSize: 12, color: T.text3 }}>No recent team activity yet.</div>
        )}
        <div style={{ maxHeight: 320, overflowY: "auto", display: "flex", flexDirection: "column", gap: 8 }}>
          {feed.slice(0, 40).map((item, idx) => (
            <div
              key={`${item.at || "x"}-${item.user}-${idx}`}
              style={{
                display: "grid",
                gridTemplateColumns: "88px 1fr",
                gap: 10,
                fontSize: 12,
                padding: "6px 0",
                borderBottom: `1px solid ${T.bg3}`,
              }}
            >
              <div style={{ color: T.text3 }}>{formatWhen(item.at) || "—"}</div>
              <div>
                <div style={{ color: T.text1, fontWeight: 600 }}>{item.user}</div>
                <div style={{ color: T.text2, marginTop: 2 }}>{item.detail || item.action}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {inactive.length > 0 && canManageTeam && (
        <div style={{ ...card, marginBottom: 16, borderColor: `${T.accent}55`, background: `${T.accent}11` }}>
          <div style={{ fontWeight: 600, color: T.accent, fontSize: 13 }}>Usage nudge</div>
          <div style={{ fontSize: 12, color: T.text2, marginTop: 6 }}>
            No CRM activity in {teamPolicy.nudgeInactiveDays}+ days: {inactive.join(", ")}
          </div>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 16, marginBottom: 24 }}>
        <div style={card}>
          <h2 style={{ margin: "0 0 10px", fontSize: 14, color: T.text0 }}>Team activity (7d)</h2>
          {adoption.map((m) => (
            <div key={m.user} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "4px 0", color: m.inactive ? T.text3 : T.text2 }}>
              <span>{m.user}{m.inactive ? " ⚠" : ""}</span>
              <span>{m.actions} actions</span>
            </div>
          ))}
        </div>

        {canManageTeam && (
          <div style={card}>
            <h2 style={{ margin: "0 0 10px", fontSize: 14, color: T.text0 }}>Required fields</h2>
            <label style={{ display: "block", fontSize: 12, color: T.text2, marginBottom: 8 }}>
              <input type="checkbox" checked={teamPolicy.requireOwnerOnDeal} onChange={(e) => onUpdatePolicy({ ...teamPolicy, requireOwnerOnDeal: e.target.checked })} />
              {" "}Require deal owner before save
            </label>
            <label style={{ display: "block", fontSize: 12, color: T.text2, marginBottom: 8 }}>
              Inactive nudge after
              <input type="number" min={1} max={30} value={teamPolicy.nudgeInactiveDays} onChange={(e) => onUpdatePolicy({ ...teamPolicy, nudgeInactiveDays: Number(e.target.value) || 3 })} style={{ ...S.input as React.CSSProperties, width: 56, marginLeft: 8 }} />
              days
            </label>
            <button type="button" onClick={() => onUpdatePolicy({ ...DEFAULT_TEAM_POLICY })} style={{ ...S.btnGhost as React.CSSProperties, fontSize: 11, marginTop: 8 }}>Reset defaults</button>
          </div>
        )}
      </div>

      {canManageTeam && (
        <div style={card}>
          <h2 style={{ margin: "0 0 10px", fontSize: 14, color: T.text0 }}>Bulk assign unowned deals ({unownedDeals.length})</h2>
          <div style={{ maxHeight: 200, overflowY: "auto", marginBottom: 10 }}>
            {unownedDeals.slice(0, 30).map((d) => (
              <label key={d.id} style={{ display: "flex", gap: 8, fontSize: 12, color: T.text2, padding: "3px 0" }}>
                <input type="checkbox" checked={selectedDealIds.includes(d.id)} onChange={() => toggleDeal(d.id)} />
                {d.title} — {d.contact} ({d.stage})
              </label>
            ))}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
            <select value={assignOwner} onChange={(e) => setAssignOwner(e.target.value)} style={S.input as React.CSSProperties}>
              <option value="">Assign owner…</option>
              {teamMembers.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
            <button type="button" onClick={bulkAssignDeals} disabled={!assignOwner || !selectedDealIds.length} style={S.btn as React.CSSProperties}>Assign deals</button>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginTop: 12 }}>
            <input placeholder="Follow-up task for {{deal}}" value={bulkTaskTitle} onChange={(e) => setBulkTaskTitle(e.target.value)} style={{ ...S.input as React.CSSProperties, flex: 1, minWidth: 180 }} />
            <select value={bulkTaskAssignee} onChange={(e) => setBulkTaskAssignee(e.target.value)} style={S.input as React.CSSProperties}>
              <option value="">Assignee…</option>
              {teamMembers.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
            <button type="button" onClick={bulkCreateTasks} disabled={!bulkTaskTitle || !bulkTaskAssignee || !selectedDealIds.length} style={S.btn as React.CSSProperties}>Create tasks</button>
          </div>
        </div>
      )}

      {!canManageTeam && (
        <div style={{ ...card, fontSize: 12, color: T.text2 }}>
          You are viewing team activity only. Deal assignment and policy settings stay with owners and admins.
        </div>
      )}
    </div>
  );
}
