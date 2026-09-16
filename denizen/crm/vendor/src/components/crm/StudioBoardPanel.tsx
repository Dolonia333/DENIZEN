import { useCallback, useEffect, useState } from "react";
import { T, type Deal } from "@/lib/crm-data";
import {
  advanceDealStudioTask,
  createDealStudioTask,
  fetchDealStudioTasks,
  studioBoardDealUrl,
  unlinkDealStudioTask,
  type StudioBoardTaskSummary,
} from "@/lib/crm-api";

type Props = {
  deal: Deal;
  glass: React.CSSProperties;
};

export function StudioBoardPanel({ deal, glass }: Props) {
  const [tasks, setTasks] = useState<StudioBoardTaskSummary[]>([]);
  const [boardUrl, setBoardUrl] = useState(studioBoardDealUrl(deal.id));
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await fetchDealStudioTasks(deal.id);
    if (!res.ok) {
      setError(res.error || "Could not load Studio Board tasks");
      setTasks([]);
      setLoading(false);
      return;
    }
    setTasks(res.tasks || []);
    if (res.board_url) setBoardUrl(res.board_url);
    setLoading(false);
  }, [deal.id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const run = async (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setBusy(true);
    setError(null);
    const res = await fn();
    if (!res.ok) setError(res.error || "Action failed");
    await refresh();
    setBusy(false);
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: T.text3 }}>
          Studio Board
        </div>
        <a
          href={boardUrl}
          target="_blank"
          rel="noreferrer"
          style={{ fontSize: 11, fontWeight: 600, color: T.accent, textDecoration: "none" }}
        >
          Open board →
        </a>
      </div>

      {loading ? (
        <div style={{ ...glass, padding: 14, fontSize: 12, color: T.text3 }}>Loading delivery tasks…</div>
      ) : tasks.length === 0 ? (
        <div style={{ ...glass, padding: 14, fontSize: 12, color: T.text3 }}>
          No linked Studio Board tasks yet. Create a delivery task to hand this deal to the board.
        </div>
      ) : (
        tasks.map((t) => (
          <div key={t.id} style={{ ...glass, padding: 12, marginBottom: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: T.text1 }}>{t.title || t.id}</div>
                <div style={{ fontSize: 11, color: T.text3, marginTop: 4 }}>
                  {t.status || "—"}
                  {t.due ? ` · due ${t.due}` : ""}
                  {t.priority ? ` · ${t.priority}` : ""}
                </div>
              </div>
              <a
                href={studioBoardDealUrl(deal.id, t.id)}
                target="_blank"
                rel="noreferrer"
                style={{ fontSize: 11, color: T.accent, textDecoration: "none", flexShrink: 0 }}
              >
                View
              </a>
            </div>
            <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
              <button
                type="button"
                disabled={busy}
                onClick={() => void run(() => advanceDealStudioTask(deal.id, t.id))}
                style={{
                  flex: 1, padding: "6px 0", fontSize: 11, fontWeight: 700, cursor: busy ? "wait" : "pointer",
                  background: `${T.accent}18`, border: `1px solid ${T.accent}33`, borderRadius: T.radius.sm, color: T.accent,
                }}
              >
                Advance
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void run(() => unlinkDealStudioTask(deal.id, t.id))}
                style={{
                  flex: 1, padding: "6px 0", fontSize: 11, fontWeight: 600, cursor: busy ? "wait" : "pointer",
                  background: T.bg3, border: `1px solid ${T.bg4}`, borderRadius: T.radius.sm, color: T.text2,
                }}
              >
                Unlink
              </button>
            </div>
          </div>
        ))
      )}

      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <input
          value={draftTitle}
          onChange={(e) => setDraftTitle(e.target.value)}
          placeholder="Delivery task title…"
          disabled={busy}
          style={{
            flex: 1, background: T.bg3, border: `1px solid ${T.bg4}`, borderRadius: T.radius.md,
            color: T.text1, padding: "8px 12px", fontSize: 12,
          }}
        />
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            const title = draftTitle.trim();
            void run(async () => {
              const res = await createDealStudioTask(deal.id, title ? { title } : {});
              if (res.ok) setDraftTitle("");
              return res;
            });
          }}
          style={{
            background: T.accent, color: T.bg0, border: "none", borderRadius: T.radius.md,
            padding: "8px 14px", fontWeight: 700, fontSize: 12, cursor: busy ? "wait" : "pointer", whiteSpace: "nowrap",
          }}
        >
          Create delivery
        </button>
      </div>

      {error && (
        <div style={{ marginTop: 8, fontSize: 11, color: T.orange }}>{error}</div>
      )}
    </div>
  );
}
