import { T } from "@/lib/crm-data";

interface Props {
  /** Optional mark — prefer none; emoji reads as vibe-coded. */
  icon?: string;
  title: string;
  subtitle: string;
}

export function DashboardEmptyState({ icon, title, subtitle }: Props) {
  return (
    <div
      className="crm-empty-state"
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        padding: "28px 16px",
        gap: 8,
      }}
    >
      {icon ? (
        <span style={{ fontSize: 22, lineHeight: 1, color: T.text3, opacity: 0.7 }} aria-hidden>{icon}</span>
      ) : (
        <span
          aria-hidden
          style={{
            width: 28,
            height: 3,
            borderRadius: 2,
            background: T.bg5,
            marginBottom: 4,
          }}
        />
      )}
      <div style={{ fontSize: 14, fontWeight: 600, color: T.text1 }}>{title}</div>
      <div style={{ fontSize: 12, color: T.text2, maxWidth: 280, lineHeight: 1.45 }}>{subtitle}</div>
    </div>
  );
}
