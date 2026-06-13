import { useMemo, useState } from "react";
import {
  T, S,
  type Contact, type Deal, type Note, type Task, type EmailLogEntry,
  type MarketingCampaign, type Sequence,
} from "@/lib/crm-data";
import type { ContactGroup } from "./ContactGroups";
import { campaignLeadQuality, summarizeCampaigns } from "@/lib/crm-adoption";

interface Props {
  campaigns: MarketingCampaign[];
  contacts: Contact[];
  deals: Deal[];
  notes: Note[];
  tasks: Task[];
  emailLog: EmailLogEntry[];
  sequences: Sequence[];
  contactGroups: ContactGroup[];
  contactGroupMap: Record<number, number[]>;
  currentUserName: string;
  onUpdateCampaigns: (campaigns: MarketingCampaign[]) => void;
  onNavigate: (tab: string) => void;
}

function nextId(list: { id: number }[]) {
  return list.length ? Math.max(...list.map((r) => r.id)) + 1 : Date.now();
}

export function MarketingTab({
  campaigns, contacts, deals, notes, tasks, emailLog, sequences,
  contactGroups, contactGroupMap, currentUserName, onUpdateCampaigns, onNavigate,
}: Props) {
  const [showNew, setShowNew] = useState(false);
  const [draft, setDraft] = useState({
    name: "", type: "nurture" as const, segmentGroupIds: [] as number[], sequenceId: 0, subject: "", body: "",
  });

  const stats = useMemo(() => summarizeCampaigns(campaigns), [campaigns]);

  const topSegments = useMemo(() => {
    return contactGroups.map((g) => {
      const q = campaignLeadQuality(contacts, [g.id], contactGroupMap, emailLog, deals);
      return { group: g, ...q };
    }).sort((a, b) => b.rate - a.rate);
  }, [contactGroups, contacts, contactGroupMap, emailLog, deals]);

  const saveCampaign = () => {
    if (!draft.name.trim()) return;
    const now = new Date().toISOString();
    const enrolled = draft.segmentGroupIds.reduce((sum, gid) => {
      return sum + Object.entries(contactGroupMap).filter(([, gIds]) => gIds.includes(gid)).length;
    }, 0);
    const c: MarketingCampaign = {
      id: nextId(campaigns),
      name: draft.name.trim(),
      status: "draft",
      type: draft.type,
      segmentGroupIds: [...draft.segmentGroupIds],
      sequenceId: draft.sequenceId || undefined,
      subject: draft.subject.trim() || undefined,
      body: draft.body.trim() || undefined,
      sentCount: 0,
      enrolledCount: enrolled,
      qualifiedLeads: 0,
      createdAt: now,
      createdBy: currentUserName,
    };
    onUpdateCampaigns([c, ...campaigns]);
    setShowNew(false);
    setDraft({ name: "", type: "nurture", segmentGroupIds: [], sequenceId: 0, subject: "", body: "" });
  };

  const launchCampaign = (id: number) => {
    const now = new Date().toISOString();
    onUpdateCampaigns(campaigns.map((c) => {
      if (c.id !== id) return c;
      const q = campaignLeadQuality(contacts, c.segmentGroupIds, contactGroupMap, emailLog, deals);
      return {
        ...c,
        status: "active" as const,
        startedAt: now,
        enrolledCount: q.total,
        qualifiedLeads: q.qualified,
      };
    }));
  };

  const card = { background: T.bg2, border: `1px solid ${T.bg3}`, borderRadius: 12, padding: 16 };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: T.text0 }}>📣 Marketing</h1>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: T.text2 }}>
            Segments, nurture campaigns, and lead quality — {stats.active} active
          </p>
        </div>
        <button type="button" onClick={() => setShowNew(true)} style={S.btn as React.CSSProperties}>+ New campaign</button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 10, marginBottom: 20 }}>
        {[
          { label: "Active campaigns", value: stats.active, color: "#fb923c" },
          { label: "Enrolled contacts", value: stats.enrolled, color: T.blue },
          { label: "Segments", value: contactGroups.length, color: T.purple },
        ].map((s) => (
          <div key={s.label} style={{ ...card, textAlign: "center" }}>
            <div style={{ fontSize: 22, fontWeight: 800, color: s.color }}>{s.value}</div>
            <div style={{ fontSize: 11, color: T.text3 }}>{s.label}</div>
          </div>
        ))}
      </div>

      <h2 style={{ fontSize: 14, color: T.text1, marginBottom: 10 }}>Audience segments & lead quality</h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 10, marginBottom: 24 }}>
        {topSegments.length === 0 && (
          <div style={{ ...card, fontSize: 12, color: T.text3 }}>
            No segments yet — <button type="button" onClick={() => onNavigate("contacts")} style={{ background: "none", border: "none", color: T.accent, cursor: "pointer" }}>create contact groups</button>
          </div>
        )}
        {topSegments.map(({ group, total, qualified, rate }) => (
          <div key={group.id} style={card}>
            <div style={{ fontWeight: 600, color: T.text0 }}>{group.name}</div>
            <div style={{ fontSize: 12, color: T.text2, marginTop: 4 }}>{total} contacts · {qualified} qualified</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: rate >= 50 ? T.green : T.accent, marginTop: 8 }}>{rate}%</div>
          </div>
        ))}
      </div>

      <h2 style={{ fontSize: 14, color: T.text1, marginBottom: 10 }}>Campaigns</h2>
      {campaigns.length === 0 && (
        <div style={{ ...card, fontSize: 13, color: T.text3 }}>Launch a nurture or announcement campaign tied to a segment and optional sequence.</div>
      )}
      {campaigns.map((c) => {
        const segs = c.segmentGroupIds.map((id) => contactGroups.find((g) => g.id === id)?.name).filter(Boolean).join(", ");
        const seq = sequences.find((s) => s.id === c.sequenceId)?.name;
        return (
          <div key={c.id} style={{ ...card, marginBottom: 10, display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontWeight: 600, color: T.text0 }}>{c.name}</div>
              <div style={{ fontSize: 11, color: T.text3, marginTop: 4 }}>
                {c.type} · {c.status} · {segs || "No segment"}{seq ? ` · sequence: ${seq}` : ""}
              </div>
              <div style={{ fontSize: 11, color: T.text2, marginTop: 4 }}>
                {c.enrolledCount} enrolled · {c.qualifiedLeads} qualified leads
              </div>
            </div>
            {c.status === "draft" && (
              <button type="button" onClick={() => launchCampaign(c.id)} style={S.btn as React.CSSProperties}>Launch</button>
            )}
          </div>
        );
      })}

      {showNew && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200 }}>
          <div style={{ ...card, width: "min(520px, 92vw)", maxHeight: "90vh", overflowY: "auto" }}>
            <h3 style={{ margin: "0 0 12px", color: T.text0 }}>New marketing campaign</h3>
            <input placeholder="Campaign name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} style={{ ...S.input as React.CSSProperties, width: "100%", marginBottom: 8 }} />
            <select value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value as MarketingCampaign["type"] })} style={{ ...S.input as React.CSSProperties, width: "100%", marginBottom: 8 }}>
              <option value="nurture">Nurture sequence</option>
              <option value="email">Email blast</option>
              <option value="announcement">Announcement</option>
            </select>
            <div style={{ fontSize: 11, color: T.text3, marginBottom: 4 }}>Target segments</div>
            {contactGroups.map((g) => (
              <label key={g.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: T.text2, marginBottom: 4 }}>
                <input type="checkbox" checked={draft.segmentGroupIds.includes(g.id)} onChange={(e) => {
                  setDraft({
                    ...draft,
                    segmentGroupIds: e.target.checked
                      ? [...draft.segmentGroupIds, g.id]
                      : draft.segmentGroupIds.filter((x) => x !== g.id),
                  });
                }} />
                {g.name}
              </label>
            ))}
            <select value={draft.sequenceId} onChange={(e) => setDraft({ ...draft, sequenceId: Number(e.target.value) })} style={{ ...S.input as React.CSSProperties, width: "100%", marginBottom: 8, marginTop: 8 }}>
              <option value={0}>No linked sequence</option>
              {sequences.filter((s) => s.active).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <input placeholder="Email subject (optional)" value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} style={{ ...S.input as React.CSSProperties, width: "100%", marginBottom: 8 }} />
            <textarea placeholder="Campaign message…" value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} rows={3} style={{ ...S.input as React.CSSProperties, width: "100%", marginBottom: 12, resize: "vertical" }} />
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button type="button" onClick={() => setShowNew(false)} style={S.btnGhost as React.CSSProperties}>Cancel</button>
              <button type="button" onClick={saveCampaign} style={S.btn as React.CSSProperties}>Save draft</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
