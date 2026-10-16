import { useEffect, useMemo, useState } from "react";
import { T, S, type Contact, type Deal, type Package, type Submission } from "@/lib/crm-data";
import { fetchCrmTeam, inviteCrmTeamMember, type CrmTeamMember } from "@/lib/crm-api";
import { markCrmUserEdited } from "@/lib/crm-api";
import type { IndustryConfig } from "@/lib/industry-config";

const SETUP_STEPS = [
  { id: "profile", label: "Set up your profile", owner: "Dan", tab: "settings" },
  { id: "invite", label: "Invite team members", owner: "Lucy", tab: "onboarding" },
  { id: "packages", label: "Build your packages", owner: "Sarah", tab: "packages" },
  { id: "intake", label: "Share public intake form", owner: "Lucy", tab: "intake" },
  { id: "contact", label: "Add your first contact", owner: "Lucy", tab: "contacts" },
  { id: "deal", label: "Create your first deal", owner: "Marcus", tab: "sales" },
  { id: "industry", label: "Pick your industry template", owner: "Sarah", tab: "settings" },
  { id: "ai", label: "Try the Meridian AI assistant", owner: "Abby", tab: "ai" },
] as const;

interface Props {
  contacts: Contact[];
  deals: Deal[];
  packages: Package[];
  submissions: Submission[];
  profile?: { name: string; role: string };
  industryConfig?: IndustryConfig;
  onboarding?: Record<string, unknown>;
  onUpdateOnboarding?: (next: Record<string, unknown>) => void;
  onNavigate?: (tab: string) => void;
}

export function OnboardingTab({
  contacts, deals, packages, submissions, profile, industryConfig, onboarding = {}, onUpdateOnboarding, onNavigate,
}: Props) {
  const [team, setTeam] = useState<CrmTeamMember[]>([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [invitePlatform, setInvitePlatform] = useState("windows");
  const [inviteStatus, setInviteStatus] = useState<string | null>(null);
  const [inviteBusy, setInviteBusy] = useState(false);

  useEffect(() => {
    void fetchCrmTeam().then(({ members }) => setTeam(members));
  }, []);

  const checklist = useMemo(() => SETUP_STEPS.map((step) => {
    let done = false;
    if (step.id === "profile") done = !!(profile?.name && profile.name !== "Guest");
    if (step.id === "invite") done = team.length > 1;
    if (step.id === "packages") done = packages.length > 0;
    if (step.id === "intake") done = submissions.length > 0;
    if (step.id === "contact") done = contacts.length > 0;
    if (step.id === "deal") done = deals.length > 0;
    if (step.id === "industry") done = !!(industryConfig?.id && industryConfig.id !== "custom");
    if (step.id === "ai") done = !!onboarding.triedAi;
    return { ...step, done };
  }), [profile, team, packages, submissions, contacts, deals, industryConfig, onboarding.triedAi]);

  const doneCount = checklist.filter((c) => c.done).length;
  const nextStep = checklist.find((c) => !c.done) || null;

  const markAiTried = () => {
    onUpdateOnboarding?.({ ...onboarding, triedAi: true });
    markCrmUserEdited();
    onNavigate?.("ai");
  };

  const askInOfficeChat = (owner: string, label: string) => {
    const message = `Help me with CRM setup: ${label}`;
    const chat = (globalThis as typeof globalThis & { __DenizenPlayerChat?: { sendMessage?: (t: string) => void } }).__DenizenPlayerChat;
    if (chat?.sendMessage) {
      void chat.sendMessage(message);
      return;
    }
    void navigator.clipboard?.writeText(message);
  };

  const sendInvite = async () => {
    const email = inviteEmail.trim();
    if (!email) return;
    setInviteBusy(true);
    setInviteStatus(null);
    const result = await inviteCrmTeamMember({
      email,
      displayName: inviteName.trim() || undefined,
      platform: invitePlatform,
    });
    setInviteBusy(false);
    if (!result.ok) {
      setInviteStatus(result.error === "already_member" ? "That email is already on your team." : (result.error || "Invite failed"));
      return;
    }
    if (result.emailed) {
      setInviteStatus(`Invitation sent to ${email}`);
    } else {
      setInviteStatus(result.message || `Share this link: ${result.joinUrl || "your Denizen URL"}`);
    }
    setInviteEmail("");
    setInviteName("");
    void fetchCrmTeam().then(({ members }) => setTeam(members));
  };

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: T.text0, margin: 0 }}>Team Setup</h1>
        <p style={{ fontSize: 14, color: T.text2, marginTop: 4 }}>
          {doneCount} of {checklist.length} complete
          {nextStep ? ` — next: ${nextStep.label} (${nextStep.owner})` : " — you're all set"}
        </p>
      </div>

      <div className="crm-onboarding-grid" style={{ display: "grid", gap: 16 }}>
        <div style={{ ...S.card }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: T.text0, marginBottom: 16 }}>Getting Started</div>
          {checklist.map((item) => (
            <div
              key={item.id}
              style={{
                display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderBottom: `1px solid ${T.bg3}`,
              }}
            >
              <button aria-label="Action"
                type="button"
                onClick={() => item.id === "ai" && !item.done ? markAiTried() : onNavigate?.(item.tab)}
                style={{
                  display: "flex", alignItems: "center", gap: 10, flex: 1,
                  background: "none", border: "none", cursor: "pointer", textAlign: "left", padding: 0,
                }}
              >
                <div style={{
                  width: 20, height: 20, borderRadius: T.radius.sm,
                  border: `2px solid ${item.done ? T.green : T.bg5}`,
                  background: item.done ? T.green : "transparent",
                  display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 14,
                }}>{item.done && "✓"}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, color: item.done ? T.text3 : T.text1, textDecoration: item.done ? "line-through" : "none" }}>{item.label}</div>
                  <div style={{ fontSize: 14, color: T.text3, marginTop: 2 }}>{item.owner} · office chat or CRM</div>
                </div>
              </button>
              {!item.done && (
                <button aria-label="Action"
                  type="button"
                  onClick={() => askInOfficeChat(item.owner, item.label)}
                  style={{ ...S.btnGhost, padding: "4px 10px", fontSize: 14, whiteSpace: "nowrap" }}
                >
                  Ask {item.owner}
                </button>
              )}
            </div>
          ))}
          <div style={{ marginTop: 12, fontSize: 14, color: T.text3 }}>
            Say <span style={{ color: T.accent }}>continue CRM setup</span> in office chat for step-by-step help.
          </div>
        </div>

        <div style={{ ...S.card }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: T.text0 }}>Team Members ({team.length || 1})</div>
            <button aria-label="Action" type="button" onClick={() => onNavigate?.("settings")} style={{ ...S.btnGhost, padding: "6px 14px", fontSize: 14 }}>Account settings</button>
          </div>
          {(team.length ? team : [{ display_name: profile?.name || "You", email: "", role: profile?.role || "member" }]).map((m) => (
            <div key={m.email || m.display_name} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 0", borderBottom: `1px solid ${T.bg3}` }}>
              <div style={{ width: 36, height: 36, borderRadius: T.radius.md, background: `linear-gradient(135deg,${T.accent},${T.bg4})`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>👤</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: T.text0 }}>{m.display_name}</div>
                <div style={{ fontSize: 14, color: T.text3 }}>{m.email || "Signed in via Denizen"}</div>
              </div>
              <span style={{ fontSize: 14, padding: "2px 8px", borderRadius: T.radius.sm, background: `${T.accent}18`, color: T.accent, fontWeight: 600 }}>{m.role}</span>
            </div>
          ))}

          <div style={{ marginTop: 18, paddingTop: 16, borderTop: `1px solid ${T.bg3}` }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: T.text0, marginBottom: 10 }}>Invite by email</div>
            <div style={{ display: "grid", gap: 8 }}>
              <input
                value={inviteName}
                onChange={(e) = aria-label="input"> setInviteName(e.target.value)}
                placeholder="Name (optional)"
                style={S.input as React.CSSProperties}
              />
              <input
                value={inviteEmail}
                onChange={(e) = aria-label="input"> setInviteEmail(e.target.value)}
                placeholder="colleague@company.com"
                type="email"
                style={S.input as React.CSSProperties}
              />
              <select
                value={invitePlatform}
                onChange={(e) => setInvitePlatform(e.target.value)}
                aria-label="Their computer"
                style={S.input as React.CSSProperties}
              >
                <option value="windows">Windows</option>
                <option value="macos">macOS</option>
                <option value="linux">Linux</option>
              </select>
              <button aria-label="Action"
                type="button"
                onClick={() => void sendInvite()}
                disabled={inviteBusy || !inviteEmail.trim()}
                style={{ ...S.btn as React.CSSProperties, opacity: inviteBusy || !inviteEmail.trim() ? 0.6 : 1 }}
              >
                {inviteBusy ? "Sending…" : "Send invite"}
              </button>
              {inviteStatus && (
                <p style={{ fontSize: 14, color: inviteStatus.includes("sent") ? T.green : T.text2, margin: 0 }}>{inviteStatus}</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
