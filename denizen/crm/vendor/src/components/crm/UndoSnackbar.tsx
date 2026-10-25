import { useEffect } from "react";
import { T } from "@/lib/crm-data";

export interface UndoAction {
  id: number;
  message: string;
  undo: () => void;
  expiresAt: number;
}

interface Props {
  actions: UndoAction[];
  onDismiss: (id: number) => void;
}

export function UndoSnackbar({ actions, onDismiss }: Props) {
  useEffect(() => {
    if (actions.length === 0) return;
    const interval = setInterval(() => {
      const now = Date.now();
      actions.forEach(a => {
        if (now >= a.expiresAt) onDismiss(a.id);
      });
    }, 500);
    return () => clearInterval(interval);
  }, [actions, onDismiss]);

  if (actions.length === 0) return null;

  return (
    <div style={{
      position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)",
      zIndex: 1300, display: "flex", flexDirection: "column", gap: 8,
    }}>
      {actions.map(action => {
        const remaining = Math.max(0, Math.ceil((action.expiresAt - Date.now()) / 1000));
        return (
          <div key={action.id} className="animate-slide-up" style={{
            background: T.bg2, border: `1px solid ${T.bg4}`, borderRadius: T.radius.lg,
            padding: "12px 20px", display: "flex", alignItems: "center", gap: 14,
            boxShadow: "0 8px 32px rgba(0,0,0,0.5)", minWidth: 320,
          }}>
            <span style={{ fontSize: 14 }}>↩</span>
            <span style={{ fontSize: 14, color: T.text1, flex: 1 }}>{action.message}</span>
            <span style={{ fontSize: 14, color: T.text3, fontFamily: "monospace" }}>{remaining}s</span>
            <button aria-label="Action" onClick={() => { action.undo(); onDismiss(action.id); }} style={{
              background: T.accent, color: "#080d18", border: "none", borderRadius: T.radius.sm,
              padding: "5px 14px", fontSize: 14, fontWeight: 700, cursor: "pointer",
            }}>Undo</button>
            <button aria-label="Action" onClick={() => onDismiss(action.id)} style={{
              background: "none", border: "none", color: T.text3, cursor: "pointer", fontSize: 16, padding: "0 2px",
            }}>×</button>
          </div>
        );
      })}
    </div>
  );
}
