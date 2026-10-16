import { useCallback, useEffect, useState } from "react";
import { T, S } from "@/lib/crm-data";
import {
  fetchMyDay,
  acceptSuggestedTask,
  dismissSuggestedTask,
  type MyDayItem,
  type MyDayResult,
} from "@/lib/crm-api";

type Props = {
  onNavigate?: (tab: string) => void;
};

function ItemRow({
  item,
  onAccept,
  onDismiss,
  busy,
}: {
  item: MyDayItem;
  onAccept?: () => void;
  onDismiss?: () => void;
  busy?: boolean;
}) {
  const isSuggested = item.kind === "suggested_task" || !!(item as { suggested?: boolean }).suggested;
  const accent = item.overdue
    ? "#f85b5b"
    : isSuggested
      ? "#22d3a0"
      : item.kind === "task"
        ? "#4d9ef7"
        : item.kind === "email"
          ? "#8b5cf6"
          : "#fb923c";
  return (
    <div style={{
      padding: "10px 12px",
      borderRadius: 8,
      border: `1px solid ${isSuggested ? "#22d3a055" : T.bg4}`,
      background: isSuggested ? "#22d3a012" : T.bg2,
      display: "flex",
      gap: 10,
      alignItems: "flex-start",
    }}>
      <span style={{
        width: 8,
        height: 8,
        borderRadius: "50%",
        background: accent,
        marginTop: 5,
        flexShrink: 0,
      }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: T.text0 }}>
          {isSuggested ? "Suggested · " : ""}{item.title}
          {item.overdue ? <span style={{ color: "#f85b5b", marginLeft: 6, fontWeight: 600 }}>overdue</span> : null}
          {item.due && !item.overdue ? <span style={{ color: T.text3, marginLeft: 6, fontWeight: 500 }}>due {item.due}</span> : null}
        </div>
        {item.text ? (
          <div style={{ fontSize: 14, color: T.text2, marginTop: 3, lineHeight: 1.45 }}>
            {item.text}
          </div>
        ) : null}
        <div style={{ fontSize: 14, color: T.text3, marginTop: 4 }}>
          {item.kind}{item.author ? ` · ${item.author}` : ""}{item.at ? ` · ${String(item.at).slice(0, 10)}` : ""}
        </div>
        {isSuggested && (onAccept || onDismiss) ? (
          <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
            {onAccept ? (
              <button aria-label="Action"
                type="button"
                disabled={busy}
                onClick={onAccept}
                style={{ ...S.btn, padding: "5px 10px", fontSize: 14, opacity: busy ? 0.6 : 1 } as React.CSSProperties}
              >
                Accept task
              </button>
            ) : null}
            {onDismiss ? (
              <button aria-label="Action"
                type="button"
                disabled={busy}
                onClick={onDismiss}
                style={{ ...S.btnGhost, padding: "5px 10px", fontSize: 14 } as React.CSSProperties}
              >
                Dismiss
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function MyDayPanel({ onNavigate }: Props) {
  const [data, setData] = useState<MyDayResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | number | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    const result = await fetchMyDay(168);
    setData(result);
    setLoading(false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const result = await fetchMyDay(168);
      if (!cancelled) {
        setData(result);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const due = data?.dueTasks || [];
  const suggested = data?.suggestedTasks || due.filter((t) => t.kind === "suggested_task");
  const items = data?.items || [];
  const counts = data?.counts || {};

  const handleAccept = async (id: string | number) => {
    setBusyId(id);
    await acceptSuggestedTask(id);
    setBusyId(null);
    await reload();
  };

  const handleDismiss = async (id: string | number) => {
    setBusyId(id);
    await dismissSuggestedTask(id);
    setBusyId(null);
    await reload();
  };

  return (
    <div style={{
      borderRadius: 12,
      border: `1px solid ${T.bg4}`,
      background: T.bg1,
      padding: 16,
      marginBottom: 16,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: T.text0 }}>My Day</div>
          <div style={{ fontSize: 14, color: T.text3, marginTop: 2 }}>
            Your captures, email follow-ups, and CRM activity
          </div>
        </div>
        <button aria-label="Action"
          type="button"
          onClick={() => onNavigate?.("ai")}
          style={{ ...S.btnGhost, fontSize: 14, padding: "6px 10px" } as React.CSSProperties}
        >
          Tell AI
        </button>
      </div>

      {loading && <div style={{ fontSize: 14, color: T.text3 }}>Loading…</div>}
      {!loading && data && !data.ok && (
        <div style={{ fontSize: 14, color: T.text3 }}>{data.error || "Could not load My Day."}</div>
      )}

      {!loading && data?.ok && (
        <>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
            {[
              { label: "Suggested", value: counts.suggested || suggested.length || 0 },
              { label: "Due", value: counts.dueTasks || 0 },
              { label: "Overdue", value: counts.overdue || 0 },
              { label: "Logged", value: counts.notes || 0 },
              { label: "Email", value: counts.email || 0 },
            ].map((chip) => (
              <div key={chip.label} style={{
                padding: "6px 10px",
                borderRadius: 999,
                background: T.bg2,
                border: `1px solid ${T.bg4}`,
                fontSize: 14,
                color: T.text2,
              }}>
                <strong style={{ color: T.text0 }}>{chip.value}</strong> {chip.label}
              </div>
            ))}
          </div>

          {suggested.length > 0 && (
            <>
              <div style={{ fontSize: 14, fontWeight: 700, color: T.text0, marginBottom: 8 }}>
                From email — confirm follow-ups
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 14, maxHeight: 260, overflowY: "auto" }}>
                {suggested.map((t) => (
                  <ItemRow
                    key={`sug-${t.id}-${t.title}`}
                    item={t}
                    busy={busyId === t.id}
                    onAccept={() => t.id != null && handleAccept(t.id as string | number)}
                    onDismiss={() => t.id != null && handleDismiss(t.id as string | number)}
                  />
                ))}
              </div>
            </>
          )}

          <div style={{ fontSize: 14, fontWeight: 700, color: T.text0, marginBottom: 8 }}>Due soon</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 14, maxHeight: 220, overflowY: "auto" }}>
            {due.filter((t) => t.kind !== "suggested_task").length === 0 ? (
              <div style={{ fontSize: 14, color: T.text3 }}>No open follow-ups. Tell the AI what you did today.</div>
            ) : due.filter((t) => t.kind !== "suggested_task").map((t) => (
              <ItemRow key={`due-${t.id}-${t.title}`} item={t} />
            ))}
          </div>

          <div style={{ fontSize: 14, fontWeight: 700, color: T.text0, marginBottom: 8 }}>Recent activity</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 280, overflowY: "auto" }}>
            {items.length === 0 ? (
              <div style={{ fontSize: 14, color: T.text3 }}>Nothing logged yet this week.</div>
            ) : items.slice(0, 12).map((item, i) => (
              <ItemRow key={`item-${item.kind}-${item.id}-${i}`} item={item} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
