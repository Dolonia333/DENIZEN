import { useEffect, useRef, useState } from "react";
import { T, S } from "@/lib/crm-data";
import type { SignatureRecord } from "@/lib/signature-store";

export type SignatureDraft = Omit<SignatureRecord, "auditLog" | "id" | "lockedAt"> & { id?: string };

interface Props {
  defaultName: string;
  consent: string;
  onSign: (record: SignatureDraft) => void;
  disabled?: boolean;
  /** Optional role label captured with the signature (e.g. "CFO", "Witness"). */
  showRole?: boolean;
}

type Mode = "typed" | "drawn";

export function SignaturePad({ defaultName, consent, onSign, disabled, showRole }: Props) {
  const [mode, setMode] = useState<Mode>("typed");
  const [name, setName] = useState(defaultName);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [hasDrawing, setHasDrawing] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);

  // Init canvas at proper DPR
  useEffect(() => {
    if (mode !== "drawn") return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = 2.2;
    ctx.strokeStyle = T.accent;
  }, [mode]);

  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = (e.currentTarget as HTMLCanvasElement).getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const start = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (disabled) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;
    last.current = pos(e);
  };
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current || !last.current) return;
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const p = pos(e);
    ctx.beginPath();
    ctx.moveTo(last.current.x, last.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last.current = p;
    if (!hasDrawing) setHasDrawing(true);
  };
  const end = () => {
    drawing.current = false;
    last.current = null;
  };

  const clear = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasDrawing(false);
  };

  const canSubmit =
    !disabled &&
    agreed &&
    name.trim().length > 0 &&
    (mode === "typed" || hasDrawing);

  const submit = () => {
    if (!canSubmit) return;
    const value =
      mode === "drawn"
        ? canvasRef.current?.toDataURL("image/png") ?? ""
        : name.trim();
    onSign({
      method: mode,
      value,
      signerName: name.trim(),
      signerEmail: email.trim() || undefined,
      signerRole: role.trim() || undefined,
      signedAt: new Date().toISOString(),
      userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "",
      consent,
    });
  };

  const tabBtn = (m: Mode, label: string, icon: string) => (
    <button aria-label="Action"
      key={m}
      onClick={() => setMode(m)}
      style={{
        flex: 1,
        padding: "10px 12px",
        background: mode === m ? `${T.accent}14` : T.bg3,
        border: `1px solid ${mode === m ? T.accent : T.bg4}`,
        borderRadius: T.radius.md,
        cursor: "pointer",
        fontSize: 14,
        fontWeight: 600,
        color: mode === m ? T.accent : T.text2,
        transition: "all 0.15s",
      }}
    >
      {icon} {label}
    </button>
  );

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        {tabBtn("typed", "Type", "⌨")}
        {tabBtn("drawn", "Draw", "✍")}
      </div>

      <label style={S.label as React.CSSProperties}>Full legal name</label>
      <input
        value={name}
        onChange={(e) = aria-label="input"> setName(e.target.value)}
        placeholder={defaultName}
        style={{ ...(S.input as React.CSSProperties), marginBottom: 10 }}
      />
      <label style={S.label as React.CSSProperties}>Email (optional)</label>
      <input
        value={email}
        onChange={(e) = aria-label="input"> setEmail(e.target.value)}
        placeholder="you@company.com"
        style={{ ...(S.input as React.CSSProperties), marginBottom: showRole ? 10 : 14 }}
      />
      {showRole && (
        <>
          <label style={S.label as React.CSSProperties}>Role / title (optional)</label>
          <input
            value={role}
            onChange={(e) = aria-label="input"> setRole(e.target.value)}
            placeholder="e.g. CFO, Witness"
            style={{ ...(S.input as React.CSSProperties), marginBottom: 14 }}
          />
        </>
      )}

      {mode === "typed" ? (
        <div
          aria-live="polite"
          style={{
            fontFamily: "'Caveat', cursive",
            fontSize: 38,
            color: T.accent,
            padding: "16px 20px",
            background: T.bg3,
            border: `1px dashed ${T.bg5}`,
            borderRadius: T.radius.md,
            minHeight: 70,
            marginBottom: 14,
          }}
        >
          {name || <span style={{ color: T.text3, fontSize: 14, fontFamily: "inherit" }}>Your signature will appear here</span>}
        </div>
      ) : (
        <div style={{ marginBottom: 14 }}>
          <div
            style={{
              position: "relative",
              background: T.bg3,
              border: `1px dashed ${T.bg5}`,
              borderRadius: T.radius.md,
              height: 160,
              overflow: "hidden",
              touchAction: "none",
            }}
          >
            <canvas
              ref={canvasRef}
              onPointerDown={start}
              onPointerMove={move}
              onPointerUp={end}
              onPointerCancel={end}
              style={{ width: "100%", height: "100%", display: "block", cursor: "crosshair" }}
            />
            {!hasDrawing && (
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 14,
                  color: T.text3,
                  pointerEvents: "none",
                }}
              >
                Sign with your mouse or finger
              </div>
            )}
          </div>
          <button aria-label="clear"
            onClick={clear}
            disabled={!hasDrawing}
            style={{
              ...(S.btnGhost as React.CSSProperties),
              marginTop: 8,
              opacity: hasDrawing ? 1 : 0.5,
              cursor: hasDrawing ? "pointer" : "not-allowed",
            }}
          >
            Clear
          </button>
        </div>
      )}

      <label
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 10,
          fontSize: 14,
          color: T.text2,
          lineHeight: 1.5,
          cursor: "pointer",
          marginBottom: 14,
        }}
      >
        <input
          type="checkbox"
          checked={agreed}
          onChange={(e) = aria-label="checkbox"> setAgreed(e.target.checked)}
          style={{ marginTop: 3 }}
        />
        <span>
          I agree that my electronic signature is the legal equivalent of my handwritten signature and binds me to this agreement.
        </span>
      </label>

      <button aria-label="Action"
        onClick={submit}
        disabled={!canSubmit}
        style={{
          ...(S.btn as React.CSSProperties),
          width: "100%",
          padding: "12px 16px",
          opacity: canSubmit ? 1 : 0.5,
          cursor: canSubmit ? "pointer" : "not-allowed",
        }}
      >
        Sign &amp; submit
      </button>
    </div>
  );
}
