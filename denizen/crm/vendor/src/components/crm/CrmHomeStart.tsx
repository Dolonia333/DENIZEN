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
    step: "1",
    title: "Add a contact",
    body: "People you sell to. Deals, emails, and tasks hang off contacts.",
    cta: "Add contact",
    accent: T.blue,
  },
  {
    id: "deal",
    step: "2",
    title: "Track a deal",
    body: "Same pipeline board whether you work alone or with a team.",
    cta: "Open pipeline",
    accent: T.accent,
  },
  {
    id: "intake",
    step: "3",
    title: "Publish intake",
    body: "Public form + quotes. Submissions land here for you or assignees.",
    cta: "Open intake",
    accent: T.green,
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
    ? "Everyone on the org shares contacts, deals, and intake. Start with a contact or deal, or load sample data so the team can click around."
    : "Every Meridian module is here — contacts, pipeline, intake, AI, analytics. Work solo now; invite teammates later without changing how you sell.";

  return (
    <div className="crm-home-start crm-panel-enter" style={{ maxWidth: 960 }}>
      <div style={{
        position: "relative",
        overflow: "hidden",
        borderRadius: 18,
        padding: "36px 32px 28px",
        marginBottom: 24,
        background:
          "radial-gradient(ellipse 80% 120% at 0% 0%, rgba(62,207,154,0.2), transparent 55%)," +
          "radial-gradient(ellipse 70% 100% at 100% 20%, rgba(212,165,116,0.14), transparent 50%)," +
          `linear-gradient(160deg, ${T.bg2} 0%, ${T.bg1} 100%)`,
        border: `1px solid ${T.bg4}`,
      }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 14 }}>
          <span style={{
            fontFamily: "var(--crm-display)",
            fontSize: 13,
            fontWeight: 600,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: T.accent,
          }}>
            Meridian
          </span>
          <span style={{
            fontSize: 11, fontWeight: 700, letterSpacing: "0.04em",
            padding: "3px 9px", borderRadius: 999,
            background: mode === "team" ? `${T.purple}22` : `${T.blue}22`,
            color: mode === "team" ? T.purple : T.blue,
            border: `1px solid ${mode === "team" ? `${T.purple}44` : `${T.blue}44`}`,
          }}>
            {workspaceModeLabel(mode)}
          </span>
        </div>
        <h1 style={{
          margin: 0,
          fontFamily: "var(--crm-display)",
          fontSize: "clamp(28px, 4vw, 40px)",
          fontWeight: 600,
          letterSpacing: "-0.03em",
          lineHeight: 1.15,
          color: T.text0,
          maxWidth: 580,
        }}>
          {headline}
        </h1>
        <p style={{
          margin: "14px 0 0",
          fontSize: 15,
          lineHeight: 1.55,
          color: T.text2,
          maxWidth: 540,
        }}>
          {blurb}
        </p>
        <p style={{ margin: "10px 0 0", fontSize: 12.5, color: T.text3, maxWidth: 520 }}>
          {workspaceModeHint(mode, syncStatus)}
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 22 }}>
          <button type="button" onClick={onAddContact} style={{
            background: T.accent, color: "#080d18", border: "none", borderRadius: 10,
            padding: "11px 18px", fontSize: 13, fontWeight: 700, cursor: "pointer",
          }}>
            Add your first contact
          </button>
          <button type="button" onClick={onLoadSample} style={{
            background: "transparent", color: T.text1, border: `1px solid ${T.bg4}`,
            borderRadius: 10, padding: "11px 18px", fontSize: 13, fontWeight: 600, cursor: "pointer",
          }}>
            Load sample data
          </button>
          {mode === "solo" ? (
            <button type="button" onClick={onOpenTeam} style={{
              background: "transparent", color: T.text2, border: "none",
              padding: "11px 8px", fontSize: 13, fontWeight: 600, cursor: "pointer",
              textDecoration: "underline", textUnderlineOffset: 3,
            }}>
              Invite teammates
            </button>
          ) : (
            <button type="button" onClick={onOpenSetup} style={{
              background: "transparent", color: T.text2, border: "none",
              padding: "11px 8px", fontSize: 13, fontWeight: 600, cursor: "pointer",
              textDecoration: "underline", textUnderlineOffset: 3,
            }}>
              Setup checklist
            </button>
          )}
        </div>
      </div>

      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
        gap: 14,
        marginBottom: 24,
      }}>
        {STEPS.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => run(s.id)}
            style={{
              textAlign: "left",
              background: T.bg2,
              border: `1px solid ${T.bg4}`,
              borderRadius: 14,
              padding: "20px 18px",
              cursor: "pointer",
              color: "inherit",
            }}
          >
            <div style={{
              width: 28, height: 28, borderRadius: 8, marginBottom: 14,
              background: `${s.accent}22`, color: s.accent,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 13, fontWeight: 800, fontFamily: "var(--crm-display)",
            }}>
              {s.step}
            </div>
            <div style={{
              fontFamily: "var(--crm-display)", fontSize: 17, fontWeight: 600,
              color: T.text0, letterSpacing: "-0.02em", marginBottom: 6,
            }}>
              {s.title}
            </div>
            <div style={{ fontSize: 13, color: T.text2, lineHeight: 1.5, marginBottom: 14 }}>
              {s.body}
            </div>
            <span style={{ fontSize: 12, fontWeight: 700, color: s.accent }}>
              {s.cta} →
            </span>
          </button>
        ))}
      </div>

      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
        gap: 12,
      }}>
        <div style={{
          padding: "16px 18px", borderRadius: 12, border: `1px solid ${T.bg4}`,
          background: `${T.bg3}88`, fontSize: 12.5, color: T.text2, lineHeight: 1.5,
        }}>
          <strong style={{ color: T.text1 }}>Still all here</strong>
          <div style={{ marginTop: 8, display: "grid", gap: 4 }}>
            <span>Support · Notes · Portal · Analytics · AI Prospector · Automations · Data tools</span>
            <span style={{ color: T.text3 }}>Nothing was removed — sidebar groups just organize the same modules.</span>
          </div>
        </div>
        <div style={{
          padding: "16px 18px", borderRadius: 12, border: `1px solid ${T.bg4}`,
          background: `${T.bg3}88`, fontSize: 12.5, color: T.text2, lineHeight: 1.5,
        }}>
          <strong style={{ color: T.text1 }}>{mode === "team" ? "Team tips" : "Solo tips"}</strong>
          <div style={{ marginTop: 8, display: "grid", gap: 4 }}>
            {mode === "team" ? (
              <>
                <span>Assign deal owners so My Work stays personal.</span>
                <span>Team viewer shows activity across the org.</span>
              </>
            ) : (
              <>
                <span>You own every record until you invite people.</span>
                <span>Open Team anytime to send invites — features stay the same.</span>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
