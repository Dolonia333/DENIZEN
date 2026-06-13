/**
 * Shared SubTabNav — reusable pill-style sub-tab navigation
 * used within consolidated sections (Sales, Schedule).
 */
import { T } from "@/lib/crm-data";

interface SubTab {
  key: string;
  label: string;
  icon: string;
}

interface Props {
  tabs: SubTab[];
  active: string;
  onSelect: (key: string) => void;
}

export function SubTabNav({ tabs, active, onSelect }: Props) {
  return (
    <div style={{ display: "flex", gap: 6, marginBottom: 20, flexWrap: "wrap" }}>
      {tabs.map(t => (
        <button
          key={t.key}
          type="button"
          onClick={() => onSelect(t.key)}
          style={{
            padding: "7px 16px",
            borderRadius: "9999px",
            fontSize: 12,
            fontWeight: 600,
            background: active === t.key ? `${T.accent}22` : T.bg3,
            color: active === t.key ? T.accent : T.text3,
            border: `1px solid ${active === t.key ? `${T.accent}66` : T.bg4}`,
            cursor: "pointer",
            transition: "all 0.15s ease",
          }}
        >
          {t.icon} {t.label}
        </button>
      ))}
    </div>
  );
}
