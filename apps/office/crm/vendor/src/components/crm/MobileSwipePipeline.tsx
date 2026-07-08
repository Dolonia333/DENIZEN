import { useState, useRef, useCallback } from "react";
import { T, fmt, STAGES, STAGE_COLORS, badgeStyle, type Deal } from "@/lib/crm-data";

interface Props {
  deals: Deal[];
  onDealStageChange: (dealId: number, newStage: string) => void;
  onEditDeal: (deal: Deal) => void;
}

export function MobileSwipePipeline({ deals, onDealStageChange, onEditDeal }: Props) {
  const openDeals = deals.filter(d => !["Closed Won", "Closed Lost"].includes(d.stage));
  const [currentIndex, setCurrentIndex] = useState(0);
  const [swipeX, setSwipeX] = useState(0);
  const [swiping, setSwiping] = useState(false);
  const [swipeAction, setSwipeAction] = useState<"left" | "right" | null>(null);
  const [lastAction, setLastAction] = useState<string | null>(null);
  const touchStart = useRef<{ x: number; y: number; time: number } | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  const currentDeal = openDeals[currentIndex];
  const SWIPE_THRESHOLD = 80;

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, time: Date.now() };
    setSwiping(true);
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!touchStart.current) return;
    const dx = e.touches[0].clientX - touchStart.current.x;
    setSwipeX(dx);
    if (dx > SWIPE_THRESHOLD) setSwipeAction("right");
    else if (dx < -SWIPE_THRESHOLD) setSwipeAction("left");
    else setSwipeAction(null);
  }, []);

  const handleTouchEnd = useCallback(() => {
    if (!currentDeal) { setSwiping(false); setSwipeX(0); setSwipeAction(null); return; }

    const stageIdx = STAGES.indexOf(currentDeal.stage);

    if (swipeAction === "right" && stageIdx < STAGES.length - 2) {
      // Advance stage
      const nextStage = STAGES[stageIdx + 1];
      onDealStageChange(currentDeal.id, nextStage);
      setLastAction(`→ ${nextStage}`);
      setTimeout(() => setLastAction(null), 1500);
    } else if (swipeAction === "left") {
      if (stageIdx > 0) {
        const prevStage = STAGES[stageIdx - 1];
        onDealStageChange(currentDeal.id, prevStage);
        setLastAction(`← ${prevStage}`);
        setTimeout(() => setLastAction(null), 1500);
      } else {
        onDealStageChange(currentDeal.id, "Closed Lost");
        setLastAction("✕ Lost");
        setTimeout(() => setLastAction(null), 1500);
      }
    }

    setSwiping(false);
    setSwipeX(0);
    setSwipeAction(null);
    touchStart.current = null;
  }, [currentDeal, swipeAction, onDealStageChange]);

  if (openDeals.length === 0) {
    return (
      <div style={{ textAlign: "center", padding: 60, color: T.text3 }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>🎉</div>
        <div style={{ fontSize: 16, fontWeight: 600 }}>No open deals</div>
        <div style={{ fontSize: 12, marginTop: 4 }}>Create a deal to start swiping</div>
      </div>
    );
  }

  const stageColor = STAGE_COLORS[currentDeal?.stage] || T.bg4;
  const stageIdx = STAGES.indexOf(currentDeal?.stage || "Lead");

  return (
    <div style={{ padding: "0 4px" }}>
      {/* Header */}
      <div style={{ textAlign: "center", marginBottom: 16 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: T.text0 }}>📱 Swipe Pipeline</div>
        <div style={{ fontSize: 11, color: T.text3, marginTop: 2 }}>
          {currentIndex + 1} of {openDeals.length} deals
        </div>
      </div>

      {/* Swipe hints */}
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12, padding: "0 8px" }}>
        <div style={{
          fontSize: 10, color: swipeAction === "left" ? T.red : T.text3,
          fontWeight: swipeAction === "left" ? 700 : 400, transition: "all 0.15s",
          opacity: swipeAction === "left" ? 1 : 0.5,
        }}>
          ← {stageIdx > 0 ? `Back to ${STAGES[stageIdx - 1]}` : "Mark Lost"}
        </div>
        <div style={{
          fontSize: 10, color: swipeAction === "right" ? T.green : T.text3,
          fontWeight: swipeAction === "right" ? 700 : 400, transition: "all 0.15s",
          opacity: swipeAction === "right" ? 1 : 0.5,
        }}>
          {stageIdx < STAGES.length - 2 ? `Advance to ${STAGES[stageIdx + 1]}` : "Already last"} →
        </div>
      </div>

      {/* Action toast */}
      {lastAction && (
        <div style={{
          position: "fixed", top: 70, left: "50%", transform: "translateX(-50%)",
          background: T.bg2, border: `1px solid ${T.accent}44`, borderRadius: T.radius.md,
          padding: "8px 20px", fontSize: 13, fontWeight: 700, color: T.accent,
          boxShadow: T.shadow.elevated, zIndex: 1000,
        }}>
          {lastAction}
        </div>
      )}

      {/* Swipe Card */}
      {currentDeal && (
        <div
          ref={cardRef}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          style={{
            background: `linear-gradient(145deg,${T.bg2},${T.bg3})`,
            border: `2px solid ${swipeAction === "right" ? T.green : swipeAction === "left" ? T.red : T.bg4}`,
            borderRadius: T.radius.xl, padding: "28px 24px",
            transform: `translateX(${swipeX * 0.6}px) rotate(${swipeX * 0.05}deg)`,
            transition: swiping ? "none" : "all 0.3s ease",
            touchAction: "pan-y",
            position: "relative", overflow: "hidden",
            boxShadow: swipeAction ? `0 8px 30px ${swipeAction === "right" ? T.green : T.red}22` : T.shadow.card,
          }}
        >
          {/* Background swipe color */}
          <div style={{
            position: "absolute", inset: 0, opacity: Math.min(1, Math.abs(swipeX) / 200) * 0.15,
            background: swipeAction === "right" ? T.green : swipeAction === "left" ? T.red : "transparent",
            transition: "opacity 0.1s",
          }} />

          {/* Stage badge */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, position: "relative" }}>
            <span style={{
              fontSize: 11, padding: "3px 10px", borderRadius: T.radius.sm,
              background: `${stageColor}22`, color: stageColor, fontWeight: 700,
              border: `1px solid ${stageColor}44`,
            }}>{currentDeal.stage}</span>
            <span style={{ fontSize: 11, color: T.text3 }}>{currentDeal.daysInStage}d in stage</span>
          </div>

          {/* Deal info */}
          <div style={{ position: "relative" }}>
            <div style={{ fontSize: 20, fontWeight: 800, color: T.text0, marginBottom: 6 }}>{currentDeal.title}</div>
            <div style={{ fontSize: 14, color: T.text2, marginBottom: 16 }}>{currentDeal.contact}</div>

            <div style={{ fontSize: 32, fontWeight: 900, color: T.accent, fontFamily: "'JetBrains Mono', monospace", marginBottom: 20 }}>
              {fmt(currentDeal.value)}
            </div>

            {/* Stats grid */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16 }}>
              {[
                { label: "Probability", value: `${currentDeal.probability}%`, color: currentDeal.probability >= 60 ? T.green : T.accent },
                { label: "Close Date", value: currentDeal.closeDate, color: T.blue },
                { label: "Health", value: currentDeal.health === "good" ? "Healthy" : "At Risk", color: currentDeal.health === "good" ? T.green : T.red },
                { label: "Stage", value: `${stageIdx + 1}/${STAGES.length}`, color: stageColor },
              ].map(s => (
                <div key={s.label} style={{ background: T.bg4 + "44", borderRadius: T.radius.md, padding: "10px 12px" }}>
                  <div style={{ fontSize: 9, color: T.text3, textTransform: "uppercase", fontWeight: 600, letterSpacing: "0.05em" }}>{s.label}</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: s.color, marginTop: 2 }}>{s.value}</div>
                </div>
              ))}
            </div>

            {/* Quick action buttons */}
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => onEditDeal(currentDeal)} style={{
                flex: 1, background: T.bg4, border: "none", borderRadius: T.radius.md,
                padding: "10px", color: T.text2, fontSize: 12, cursor: "pointer", fontWeight: 600,
              }}>✎ Edit</button>
              <button onClick={() => {
                if (stageIdx < STAGES.length - 2) {
                  onDealStageChange(currentDeal.id, STAGES[stageIdx + 1]);
                  setLastAction(`→ ${STAGES[stageIdx + 1]}`);
                  setTimeout(() => setLastAction(null), 1500);
                }
              }} style={{
                flex: 1, background: `${T.green}22`, border: `1px solid ${T.green}44`,
                borderRadius: T.radius.md, padding: "10px", color: T.green, fontSize: 12,
                cursor: "pointer", fontWeight: 700,
              }}>Advance →</button>
            </div>
          </div>
        </div>
      )}

      {/* Navigation dots */}
      <div style={{ display: "flex", justifyContent: "center", gap: 8, marginTop: 20, alignItems: "center" }}>
        <button onClick={() => setCurrentIndex(i => Math.max(0, i - 1))} disabled={currentIndex === 0} style={{
          background: "none", border: "none", color: currentIndex > 0 ? T.text1 : T.text3,
          fontSize: 18, cursor: currentIndex > 0 ? "pointer" : "default", padding: "4px 8px",
        }}>‹</button>
        <div style={{ display: "flex", gap: 4 }}>
          {openDeals.slice(Math.max(0, currentIndex - 3), currentIndex + 4).map((d, i) => {
            const idx = Math.max(0, currentIndex - 3) + i;
            return (
              <button key={d.id} onClick={() => setCurrentIndex(idx)} style={{
                width: idx === currentIndex ? 16 : 6, height: 6, borderRadius: 3,
                background: idx === currentIndex ? T.accent : T.bg4,
                border: "none", cursor: "pointer", transition: "all 0.15s", padding: 0,
              }} />
            );
          })}
        </div>
        <button onClick={() => setCurrentIndex(i => Math.min(openDeals.length - 1, i + 1))} disabled={currentIndex >= openDeals.length - 1} style={{
          background: "none", border: "none", color: currentIndex < openDeals.length - 1 ? T.text1 : T.text3,
          fontSize: 18, cursor: currentIndex < openDeals.length - 1 ? "pointer" : "default", padding: "4px 8px",
        }}>›</button>
      </div>
    </div>
  );
}
