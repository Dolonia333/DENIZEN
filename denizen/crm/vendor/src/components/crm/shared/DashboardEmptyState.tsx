import { T } from "@/lib/crm-data";

interface Props {
  icon: string;
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
      <span style={{ fontSize: 32, lineHeight: 1 }} aria-hidden>{icon}</span>
      <div style={{ fontSize: 14, fontWeight: 600, color: T.text1 }}>{title}</div>
      <div style={{ fontSize: 14, color: T.text2, maxWidth: 280, lineHeight: 1.45 }}>{subtitle}</div>
    </div>
  );
}
