// REFACTORED: Mobile bottom tab bar with keyboard nav, swipe gestures, and loading skeleton
// REFACTORED: nav-lock prevents overlapping swipe+tap nav; respects prefers-reduced-motion
import { useState, useCallback, useRef, useEffect, KeyboardEvent, TouchEvent } from "react";
import { T } from "@/lib/crm-data";

const TABS = [
  { id: "dashboard", label: "Dashboard", icon: "◈" },
  { id: "contacts", label: "Contacts", icon: "◉" },
  { id: "sales", label: "Sales", icon: "◆" },
  { id: "schedule", label: "Schedule", icon: "📅" },
];

const SWIPE_THRESHOLD = 50; // px horizontal travel needed to trigger tab change
const SWIPE_MAX_VERTICAL = 40; // ignore if vertical scroll dominates
const SKELETON_DELAY = 120; // ms — only show skeleton if render takes longer than this
const NAV_LOCK_MS = 350; // ms — debounce window to prevent overlapping nav from swipe+tap

// Hook: detect prefers-reduced-motion and react to system changes
function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(() =>
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  );
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);
  return reduced;
}

interface Props {
  activeTab: string;
  onNavigate: (id: string) => void;
}

export function MobileBottomTabBar({ activeTab, onNavigate }: Props) {
  const [tapped, setTapped] = useState<string | null>(null);
  const [focusedIdx, setFocusedIdx] = useState<number>(-1);
  const [isLoading, setIsLoading] = useState(false);
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const touchStart = useRef<{ x: number; y: number; t: number } | null>(null);
  const touchHandled = useRef(false); // marks that a swipe already navigated; suppress click
  const loadingTimer = useRef<number | null>(null);
  const navLockUntil = useRef<number>(0); // timestamp until which navigation is locked
  const reducedMotion = usePrefersReducedMotion();

  const activeIdx = Math.max(0, TABS.findIndex(t => t.id === activeTab));
  const indicatorWidth = 24;

  // REFACTORED: centralized navigation with nav-lock to prevent overlapping swipe+tap
  const navigate = useCallback((id: string) => {
    const now = Date.now();
    if (now < navLockUntil.current) return; // suppress overlapping nav
    if (id === activeTab) return;
    navLockUntil.current = now + NAV_LOCK_MS;
    setTapped(id);
    // Show skeleton only if next paint is delayed past threshold (skip if motion reduced)
    if (loadingTimer.current) window.clearTimeout(loadingTimer.current);
    if (!reducedMotion) {
      loadingTimer.current = window.setTimeout(() => setIsLoading(true), SKELETON_DELAY);
    }
    onNavigate(id);
    setTimeout(() => setTapped(null), 200);
  }, [onNavigate, activeTab, reducedMotion]);

  // Hide skeleton after activeTab actually changes (next render cycle settles)
  useEffect(() => {
    if (loadingTimer.current) {
      window.clearTimeout(loadingTimer.current);
      loadingTimer.current = null;
    }
    // Allow one frame for the new section to mount, then hide skeleton
    const raf = requestAnimationFrame(() => {
      requestAnimationFrame(() => setIsLoading(false));
    });
    return () => cancelAnimationFrame(raf);
  }, [activeTab]);

  // REFACTORED: Arrow key navigation with roving tabindex pattern
  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLButtonElement>, idx: number) => {
    if (e.key === "ArrowRight") {
      e.preventDefault();
      const next = (idx + 1) % TABS.length;
      setFocusedIdx(next);
      buttonRefs.current[next]?.focus();
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      const prev = (idx - 1 + TABS.length) % TABS.length;
      setFocusedIdx(prev);
      buttonRefs.current[prev]?.focus();
    } else if (e.key === "Home") {
      e.preventDefault();
      setFocusedIdx(0);
      buttonRefs.current[0]?.focus();
    } else if (e.key === "End") {
      e.preventDefault();
      const last = TABS.length - 1;
      setFocusedIdx(last);
      buttonRefs.current[last]?.focus();
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      navigate(TABS[idx].id);
    }
  }, [navigate]);

  // REFACTORED: Swipe gesture handlers — left swipe = next tab, right swipe = previous
  const handleTouchStart = useCallback((e: TouchEvent<HTMLElement>) => {
    const t = e.touches[0];
    touchStart.current = { x: t.clientX, y: t.clientY, t: Date.now() };
    touchHandled.current = false;
  }, []);

  const handleTouchEnd = useCallback((e: TouchEvent<HTMLElement>) => {
    if (!touchStart.current) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - touchStart.current.x;
    const dy = t.clientY - touchStart.current.y;
    touchStart.current = null;
    if (Math.abs(dy) > SWIPE_MAX_VERTICAL) return;
    if (Math.abs(dx) < SWIPE_THRESHOLD) return;
    // Mark this gesture as a swipe so the synthetic click that follows is suppressed
    touchHandled.current = true;
    if (dx < 0 && activeIdx < TABS.length - 1) {
      navigate(TABS[activeIdx + 1].id);
    } else if (dx > 0 && activeIdx > 0) {
      navigate(TABS[activeIdx - 1].id);
    }
  }, [activeIdx, navigate]);

  // Click handler that ignores synthetic clicks fired right after a swipe gesture
  const handleButtonClick = useCallback((id: string) => {
    if (touchHandled.current) {
      touchHandled.current = false;
      return;
    }
    navigate(id);
  }, [navigate]);

  return (
    <>
      {/* Subtle loading skeleton bar shown above the tab bar during slow tab switches */}
      {isLoading && (
        <div
          aria-hidden
          style={{
            position: "fixed", bottom: `calc(56px + env(safe-area-inset-bottom, 0px))`,
            left: 0, right: 0, height: 2, zIndex: 851,
            background: T.bg3, overflow: "hidden",
          }}
        >
          <div style={{
            width: "40%", height: "100%", background: T.accent,
            animation: reducedMotion ? "none" : "skeletonSlide 1.1s ease-in-out infinite",
            opacity: reducedMotion ? 0.6 : 1,
          }} />
          <style>{`
            @keyframes skeletonSlide {
              0% { transform: translateX(-100%); }
              100% { transform: translateX(350%); }
            }
          `}</style>
        </div>
      )}
      <nav
        role="tablist"
        aria-label="Primary navigation"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        style={{
          position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 850,
          background: T.bg1, borderTop: `0.5px solid ${T.bg4}`,
          display: "flex", height: 56, paddingBottom: "env(safe-area-inset-bottom, 0px)",
          backdropFilter: "blur(12px)",
          touchAction: "pan-y",
        }}
      >
        {/* Sliding active indicator — animates left position + opacity glow */}
        <span
          aria-hidden
          style={{
            position: "absolute", top: 0, height: 2,
            width: `calc((100% / ${TABS.length}) )`,
            left: `calc((100% / ${TABS.length}) * ${activeIdx})`,
            display: "flex", justifyContent: "center", alignItems: "flex-start",
            pointerEvents: "none",
            transition: reducedMotion ? "none" : "left 0.32s cubic-bezier(0.32, 0.72, 0, 1)",
          }}
        >
          <span style={{
            width: indicatorWidth, height: 2,
            borderRadius: "0 0 2px 2px",
            background: T.accent,
            boxShadow: `0 0 12px ${T.accent}99, 0 0 4px ${T.accent}`,
            animation: reducedMotion ? "none" : "fadeIn 0.25s ease-out",
          }} />
        </span>

        {TABS.map((t, idx) => {
          const active = activeTab === t.id;
          const pulsing = tapped === t.id;
          // Roving tabindex: only the active (or last focused) button is in tab order
          const isTabStop = focusedIdx === -1 ? active : focusedIdx === idx;
          return (
            <button
              key={t.id}
              ref={el => buttonRefs.current[idx] = el}
              role="tab"
              aria-selected={active}
              aria-label={t.label}
              tabIndex={isTabStop ? 0 : -1}
              onClick={() => handleButtonClick(t.id)}
              onKeyDown={(e) => handleKeyDown(e, idx)}
              onFocus={() => setFocusedIdx(idx)}
              style={{
                flex: 1, display: "flex", flexDirection: "column",
                alignItems: "center", justifyContent: "center", gap: 2,
                background: "none", border: "none", cursor: "pointer",
                color: active ? T.accent : T.text3,
                outline: "none",
                transition: reducedMotion
                  ? "color 0.15s ease"
                  : "color 0.25s ease, transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1)",
                transform: !reducedMotion && pulsing ? "scale(0.88)" : "scale(1)",
              }}
              onFocusCapture={(e) => {
                e.currentTarget.style.boxShadow = `inset 0 0 0 2px ${T.accent}66`;
              }}
              onBlurCapture={(e) => {
                e.currentTarget.style.boxShadow = "none";
              }}
            >
              <span style={{
                fontSize: 18, lineHeight: 1,
                transform: active && !reducedMotion ? "scale(1.1)" : "scale(1)",
                transition: reducedMotion ? "none" : "transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1)",
              }}>{t.icon}</span>
              <span style={{
                fontSize: 9, fontWeight: active ? 700 : 500,
                letterSpacing: "0.04em",
                transition: reducedMotion ? "color 0.15s ease" : "font-weight 0.2s ease, color 0.25s ease",
              }}>{t.label}</span>
            </button>
          );
        })}
      </nav>
    </>
  );
}
