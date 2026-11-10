import { T } from "@/lib/crm-data";
import type { WorkspaceMode } from "@/lib/crm-workspace-mode";
import { workspaceModeHint, workspaceModeLabel } from "@/lib/crm-workspace-mode";
import type { CrmSyncStatus } from "@/hooks/use-crm-cloud-sync";

interface Props {
  mode: WorkspaceMode;
  syncStatus: CrmSyncStatus;
  onAddContact: () => void;
  onOpenPipeline: () => void;
  onOpenIntake: () => void;
  onLoadSample: () => void;
  onOpenSetup: () => void;
  onOpenTeam: () => void;
}

const STEPS = [
  {
    id: "contact",
    step: "01",
    title: "Add a contact",
    body: "People you sell to. Deals, emails, and tasks hang off contacts.",
    cta: "Add contact",
  },
  {
    id: "deal",
    step: "02",
    title: "Track a deal",
    body: "Same pipeline board whether you work alone or with a team.",
    cta: "Open pipeline",
  },
  {
    id: "intake",
    step: "03",
    title: "Publish intake",
    body: "Public form + quotes. Submissions land here for you or assignees.",
    cta: "Open intake",
  },
] as const;

export function CrmHomeStart({
  mode, syncStatus,
  onAddContact, onOpenPipeline, onOpenIntake, onLoadSample, onOpenSetup, onOpenTeam,
}: Props) {
  const run = (id: string) => {
    if (id === "contact") onAddContact();
    else if (id === "deal") onOpenPipeline();
    else onOpenIntake();
  };

  const headline = mode === "team"
    ? "Your shared sales workspace is ready."
    : "Your sales workspace starts empty — on purpose.";

  const blurb = mode === "team"
    ? "Everyone on the org shares contacts, deals, and intake. Start with a contact or deal, or load sample data so the team can explore."
    : "Contacts, pipeline, intake, AI, and analytics are all here. Work solo now; invite teammates later without changing how you sell.";

  return (
    <div className="crm-home-start crm-panel-enter" style={{ maxWidth: 880 }}>
      <div style={{ marginBottom: 28 }}>
        <div className="crm-kicker" style={{ color: T.accent, marginBottom: 10 }}>
          Meridian · {workspaceModeLabel(mode)}
        </div>
        <h1 className="crm-page-title" style={{ fontSize: "clamp(28px, 4vw, 38px)", maxWidth: 560 }}>
          {headline}
        </h1>
        <p className="crm-page-sub" style={{ maxWidth: 520, fontSize: 15 }}>
          {blurb}
        </p>
        <p style={{ margin: "10px 0 0", fontSize: 12.5, color: T.text3, maxWidth: 520 }}>
          {workspaceModeHint(mode, syncStatus)}
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 22 }}>
          <button type="button" onClick={onAddContact} style={{
            background: T.accent, color: "#071410", border: "none", borderRadius: 8,
            padding: "10px 16px", fontSize: 13, fontWeight: 700, cursor: "pointer",
          }}>
            Add your first contact
          </button>
          <button type="button" onClick={onLoadSample} style={{
            background: "transparent", color: T.text1, border: `1px solid ${T.bg4}`,
            borderRadius: 8, padding: "10px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer",
          }}>
            Load sample data
          </button>
          <button
            type="button"
            onClick={mode === "solo" ? onOpenTeam : onOpenSetup}
            style={{
              background: "transparent", color: T.text2, border: "none",
              padding: "10px 6px", fontSize: 13, fontWeight: 600, cursor: "pointer",
              textDecoration: "underline", textUnderlineOffset: 3,
            }}
          >
            {mode === "solo" ? "Invite teammates" : "Setup checklist"}
          </button>
        </div>
      </div>

      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
        gap: 1,
        background: T.bg4,
        border: `1px solid ${T.bg4}`,
        borderRadius: 12,
        overflow: "hidden",
        marginBottom: 20,
      }}>
        {STEPS.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => run(s.id)}
            style={{
              textAlign: "left",
              background: T.bg2,
              border: "none",
              padding: "22px 20px",
              cursor: "pointer",
              color: "inherit",
            }}
          >
            <div className="crm-kicker" style={{ marginBottom: 12 }}>{s.step}</div>
            <div style={{
              fontFamily: "var(--crm-display)", fontSize: 18, fontWeight: 600,
              color: T.text0, letterSpacing: "-0.02em", marginBottom: 6,
            }}>
              {s.title}
            </div>
            <div style={{ fontSize: 13, color: T.text2, lineHeight: 1.5, marginBottom: 14, minHeight: 40 }}>
              {s.body}
            </div>
            <span style={{ fontSize: 12, fontWeight: 700, color: T.accent }}>
              {s.cta} →
            </span>
          </button>
        ))}
      </div>

      <p style={{ fontSize: 12.5, color: T.text3, lineHeight: 1.5, margin: 0 }}>
        {mode === "team"
          ? "Assign deal owners so My Work stays personal. Team activity shows org-wide movement."
          : "You own every record until you invite people. Open Team anytime — features stay the same."}
      </p>
    </div>
  );
}
