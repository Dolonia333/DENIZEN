import { T } from "@/lib/crm-data";

interface EmptyStateProps {
  icon: string;
  title: string;
  description: string;
  action?: { label: string; onClick: () => void };
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="crm-empty-state crm-panel-enter">
      <div className="icon">{icon}</div>
      <div className="title">{title}</div>
      <div className="desc">{description}</div>
      {action && (
        <button aria-label="Action"
          onClick={action.onClick}
          style={{
            marginTop: 16,
            background: T.accent,
            color: "#080d18",
            border: "none",
            borderRadius: T.radius.sm,
            padding: "8px 20px",
            fontSize: 14,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          {action.label}
        </button>
      )}
    </div>
  );
}

export function TableSkeleton({ rows = 5, cols = 7 }: { rows?: number; cols?: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, r) => (
        <div
          key={r}
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${cols}, 1fr)`,
            padding: "14px 20px",
            gap: 12,
            animationDelay: `${r * 80}ms`,
          }}
        >
          {Array.from({ length: cols }).map((_, c) => (
            <div
              key={c}
              className="crm-skeleton"
              style={{
                height: c === 0 ? 18 : 14,
                width: c === 0 ? "80%" : `${50 + Math.random() * 40}%`,
                borderRadius: 6,
              }}
            />
          ))}
        </div>
      ))}
    </>
  );
}

export function CardSkeleton({ count = 3 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          style={{
            padding: 16,
            borderRadius: 10,
            border: `1px solid ${T.bg4}`,
            display: "flex",
            flexDirection: "column",
            gap: 10,
            animationDelay: `${i * 100}ms`,
          }}
        >
          <div className="crm-skeleton" style={{ height: 14, width: "70%", borderRadius: 6 }} />
          <div className="crm-skeleton" style={{ height: 10, width: "50%", borderRadius: 6 }} />
          <div className="crm-skeleton" style={{ height: 10, width: "40%", borderRadius: 6 }} />
        </div>
      ))}
    </>
  );
}
