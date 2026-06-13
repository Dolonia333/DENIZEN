/**
 * Shared MiniRing — extracted from PipelineTab and ScheduleTab
 * Apple-style ring chart component used in multiple views.
 */
import { T } from "@/lib/crm-data";

interface Segment {
  value: number;
  color: string;
  label: string;
}

export function MiniRing({ segments, size = 72, stroke = 6 }: { segments: Segment[]; size?: number; stroke?: number }) {
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const total = segments.reduce((s, seg) => s + seg.value, 0) || 1;
  let offset = 0;

  return (
    <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={T.bg4} strokeWidth={stroke} opacity={0.3} />
      {segments.map((seg, i) => {
        const len = (seg.value / total) * circ;
        const gap = segments.length > 1 ? 3 : 0;
        const el = (
          <circle
            key={i}
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={seg.color}
            strokeWidth={stroke}
            strokeDasharray={`${Math.max(0, len - gap)} ${circ}`}
            strokeDashoffset={-offset}
            strokeLinecap="round"
            style={{ transition: "stroke-dasharray 0.6s ease, stroke-dashoffset 0.6s ease" }}
          />
        );
        offset += len;
        return el;
      })}
    </svg>
  );
}
