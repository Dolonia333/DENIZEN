export const CRM_DOCK_EVENTS = {
  TAB: "crm-tab-change",
  STATE: "crm-dock-state",
  ACTIVE: "crm-dock-active",
  CHAT_SYNC: "crm-dock-sync-request",
  CHAT_TOGGLE: "crm-team-chat-toggle",
  CHAT_UNREAD: "crm-team-chat-unread",
} as const;

/** True while CrmFloatingDock is mounted (CRM main app, not portal-only routes). */
let dockMounted = false;

export function isCrmDockMounted(): boolean {
  return dockMounted;
}

export function setCrmDockMounted(active: boolean) {
  dockMounted = active;
}

export const DOCK_BTN = 48;
export const DOCK_GAP = 12;
export const DOCK_RIGHT = 20;

export const DOCK_HIDDEN_TABS = new Set(["ai"]);

export type DockButtonId = "add" | "activity" | "chat" | "collapse";

export const DEFAULT_DOCK_ORDER: DockButtonId[] = ["add", "activity", "chat", "collapse"];

export interface DockOffset {
  dx: number;
  dy: number;
}

const LS_POSITION = "crm-dock-position";
const LS_ORDER = "crm-dock-order";

export function loadDockOffset(): DockOffset {
  try {
    const raw = localStorage.getItem(LS_POSITION);
    if (raw) {
      const parsed = JSON.parse(raw) as DockOffset;
      if (typeof parsed.dx === "number" && typeof parsed.dy === "number") return parsed;
    }
  } catch {}
  return { dx: 0, dy: 0 };
}

export function saveDockOffset(offset: DockOffset) {
  try {
    localStorage.setItem(LS_POSITION, JSON.stringify(offset));
  } catch {}
}

export function loadDockOrder(): DockButtonId[] {
  try {
    const raw = localStorage.getItem(LS_ORDER);
    if (raw) {
      const parsed = JSON.parse(raw) as DockButtonId[];
      if (Array.isArray(parsed) && parsed.length === DEFAULT_DOCK_ORDER.length
        && DEFAULT_DOCK_ORDER.every((id) => parsed.includes(id))) {
        return parsed;
      }
    }
  } catch {}
  return [...DEFAULT_DOCK_ORDER];
}

export function saveDockOrder(order: DockButtonId[]) {
  try {
    localStorage.setItem(LS_ORDER, JSON.stringify(order));
  } catch {}
}

export function dockBaseRight(isMobile: boolean): number {
  return isMobile ? 16 : DOCK_RIGHT;
}

export function dockBaseBottom(isMobile: boolean): number {
  if (isMobile) return 72;
  return 24;
}

/** Bottom offset for stack slot 0 = lowest button. */
export function dockStackBottom(slot: number, isMobile: boolean): number {
  return dockBaseBottom(isMobile) + slot * (DOCK_BTN + DOCK_GAP);
}

export function dockStackHeight(buttonCount: number): number {
  if (buttonCount <= 0) return 0;
  return buttonCount * DOCK_BTN + (buttonCount - 1) * DOCK_GAP;
}

export function dockBottomPx(slot: number, isMobile: boolean, offsetY = 0): number {
  return dockStackBottom(slot, isMobile) + offsetY;
}

export function dockBottomCss(slot: number, isMobile: boolean, offsetY = 0): string | number {
  const px = dockBottomPx(slot, isMobile, offsetY);
  return isMobile ? `calc(${px}px + env(safe-area-inset-bottom, 0px))` : px;
}

export function clampDockOffset(
  dx: number,
  dy: number,
  isMobile: boolean,
  stackHeight: number,
): DockOffset {
  const margin = 8;
  const baseRight = dockBaseRight(isMobile);
  const baseBottom = dockBaseBottom(isMobile);
  const minDx = margin - baseRight;
  const maxDx = window.innerWidth - DOCK_BTN - margin - baseRight;
  const minDy = margin - baseBottom;
  const maxDy = window.innerHeight - stackHeight - margin - baseBottom;
  return {
    dx: Math.max(minDx, Math.min(maxDx, dx)),
    dy: Math.max(minDy, Math.min(maxDy, dy)),
  };
}

export function dispatchDockState(detail: {
  expanded: boolean;
  hidden: boolean;
  buttonCount: number;
  stackHeight: number;
  isMobile: boolean;
  offsetDx?: number;
  offsetDy?: number;
}) {
  window.dispatchEvent(new CustomEvent(CRM_DOCK_EVENTS.STATE, { detail }));
}

export function dispatchCrmTab(tab: string) {
  window.dispatchEvent(new CustomEvent(CRM_DOCK_EVENTS.TAB, { detail: { tab } }));
}
