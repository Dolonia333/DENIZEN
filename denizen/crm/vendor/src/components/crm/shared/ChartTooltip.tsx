/**
 * Shared ChartTooltip — extracted from AnalyticsTab, LeadGenTab, SalesTeamDashboard
 * to eliminate duplication across chart-rendering components.
 */
import { T, fmt } from "@/lib/crm-data";

interface ChartTooltipProps {
  active?: boolean;
  payload?: any[];
  label?: string;
  prefix?: string;
  suffix?: string;
}

export const ChartTooltip = ({ active, payload, label, prefix = "", suffix = "" }: ChartTooltipProps) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: T.bg2, border: `1px solid ${T.bg4}`, borderRadius: 10,
      padding: "10px 14px", fontSize: 12, boxShadow: "0 4px 20px rgba(0,0,0,0.4)",
    }}>
      <div style={{ color: T.text3, marginBottom: 6, fontWeight: 600, fontSize: 11 }}>{label}</div>
      {payload.map((p: any, i: number) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: p.color || p.fill || p.stroke || p.payload?.color }} />
          <span style={{ color: T.text1, fontWeight: 600, fontFamily: "'JetBrains Mono', monospace" }}>
            {p.name ? `${p.name}: ` : ""}
            {prefix}{typeof p.value === "number" && p.value > 999 ? fmt(p.value) : p.value}{suffix}
          </span>
        </div>
      ))}
    </div>
  );
};
