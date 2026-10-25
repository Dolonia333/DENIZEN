import type { CSSProperties } from "react";
import { T } from "@/lib/crm-data";

/** Premium series palette — high contrast, colorblind-friendlier sequence. */
export const CHART_SERIES = [
  T.accent,
  T.blue,
  T.copper,
  T.green,
  "#a78bfa",
  T.orange,
  T.red,
  "#94a3b8",
] as const;

export const chartGridProps = {
  stroke: T.bg4,
  strokeDasharray: "4 6",
  vertical: false,
} as const;

export const chartAxisTick = {
  fill: T.text3,
  fontSize: 11,
  fontFamily: "var(--crm-sans)",
} as const;

export const chartMargin = { top: 8, right: 12, left: 0, bottom: 4 };

export function chartPanelStyle(): CSSProperties {
  return {
    background: `linear-gradient(165deg, ${T.bg2} 0%, ${T.bg1} 100%)`,
    border: `1px solid ${T.bg4}`,
    borderRadius: T.radius.lg,
    padding: "18px 18px 14px",
    boxShadow: T.shadow.card,
  };
}

export function moneyTick(v: number): string {
  if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1000) return `$${(v / 1000).toFixed(0)}k`;
  return `$${v}`;
}

export function gradientDefs(ids: { id: string; color: string }[]) {
  return ids.map(({ id, color }) => ({
    id,
    color,
  }));
}
