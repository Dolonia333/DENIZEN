import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { MessageCircle, Layers, Zap, GripVertical } from "lucide-react";
import { T } from "@/lib/crm-data";
import {
  CRM_DOCK_EVENTS,
  DOCK_BTN,
  DOCK_GAP,
  DOCK_HIDDEN_TABS,
  type DockButtonId,
  type DockOffset,
  clampDockOffset,
  dispatchDockState,
  setCrmDockMounted,
  dockBaseRight,
  dockBottomCss,
  dockBottomPx,
  dockStackHeight,
  loadDockOffset,
  loadDockOrder,
  saveDockOffset,
  saveDockOrder,
} from "@/lib/crm-dock";

const LS_EXPANDED = "crm-dock-expanded";
const DRAG_THRESHOLD = 8;

interface FabItem {
  icon: string;
  label: string;
  key: string;
  color: string;
}

interface Props {
  isMobile: boolean;
  tab: string;
  fabItems: FabItem[];
  fabOpen: boolean;
  setFabOpen: (open: boolean | ((prev: boolean) => boolean)) => void;
  onFabSelect: (key: string) => void;
  activityOpen: boolean;
  onActivityToggle: () => void;
  activityUnread: number;
  chatUnread: number;
}

type DragMode = "move" | "reorder";

interface DragSession {
  pointerId: number;
  startX: number;
  startY: number;
  origOffset: DockOffset;
  moved: boolean;
  mode: DragMode | null;
  buttonId: DockButtonId | "launcher";
  reorderFrom: number;
  reorderPreview: DockButtonId[];
}

function dockBtnStyle(active: boolean, gradient: string, dragging: boolean, activeColor = T.text0): CSSProperties {
  return {
    position: "fixed",
    width: DOCK_BTN,
    height: DOCK_BTN,
    borderRadius: "50%",
    background: active ? T.bg3 : gradient,
    color: active ? activeColor : "#fff",
    border: `1px solid ${dragging ? T.accent : T.bg5}`,
    cursor: dragging ? "grabbing" : "grab",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    boxShadow: dragging ? "0 8px 28px rgba(0,0,0,0.7)" : "0 4px 20px rgba(0,0,0,0.55)",
    transition: dragging ? "none" : "background 0.15s, box-shadow 0.15s, border-color 0.15s",
    flexShrink: 0,
    padding: 0,
    touchAction: "manipulation",
    userSelect: "none",
  };
}

function Badge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span
      style={{
        position: "absolute",
        top: -2,
        right: -2,
        minWidth: 18,
        height: 18,
        borderRadius: "50%",
        background: T.red,
        color: "#fff",
        fontSize: 14,
        fontWeight: 800,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "0 4px",
        border: "2px solid #080d18",
        pointerEvents: "none",
      }}
    >
      {count > 9 ? "9+" : count}
    </span>
  );
}

function DockButton({
  slot,
  isMobile,
  right,
  offsetY,
  title,
  onClick,
  style,
  dragging,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  children,
}: {
  slot: number;
  isMobile: boolean;
  right: number;
  offsetY: number;
  title: string;
  onClick: (e: React.MouseEvent) => void;
  style: CSSProperties;
  dragging: boolean;
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      style={{
        ...style,
        right,
        bottom: dockBottomCss(slot, isMobile, offsetY),
        zIndex: 800 + slot + (dragging ? 20 : 0),
        opacity: dragging ? 0.92 : 1,
        transform: dragging ? "scale(1.06)" : undefined,
      }}
    >
      {children}
    </button>
  );
}

export function CrmFloatingDock({
  isMobile,
  tab,
  fabItems,
  fabOpen,
  setFabOpen,
  onFabSelect,
  activityOpen,
  onActivityToggle,
  activityUnread,
  chatUnread,
}: Props) {
  const hidden = DOCK_HIDDEN_TABS.has(tab);
  const [expanded, setExpanded] = useState(() => {
    try {
      return localStorage.getItem(LS_EXPANDED) === "1";
    } catch {
      return false;
    }
  });
  const [edgePeek, setEdgePeek] = useState(false);
  const [offset, setOffset] = useState<DockOffset>(loadDockOffset);
  const [order, setOrder] = useState<DockButtonId[]>(loadDockOrder);
  const [previewOrder, setPreviewOrder] = useState<DockButtonId[] | null>(null);
  const [draggingId, setDraggingId] = useState<DockButtonId | "launcher" | null>(null);
  const dragRef = useRef<DragSession | null>(null);
  const suppressClickRef = useRef(false);

  const showDock = !hidden || edgePeek;
  const activeOrder = previewOrder ?? order;
  const buttonCount = showDock ? (expanded ? 4 : 1) : 0;
  const stackHeight = dockStackHeight(buttonCount);
  const baseRight = dockBaseRight(isMobile);
  const dockRight = baseRight + offset.dx;

  useEffect(() => {
    try {
      localStorage.setItem(LS_EXPANDED, expanded ? "1" : "0");
    } catch {}
  }, [expanded]);

  useEffect(() => {
    const announce = () => {
      setCrmDockMounted(true);
      window.dispatchEvent(new CustomEvent(CRM_DOCK_EVENTS.ACTIVE, { detail: { active: true } }));
    };
    announce();
    window.addEventListener(CRM_DOCK_EVENTS.CHAT_SYNC, announce);
    return () => {
      window.removeEventListener(CRM_DOCK_EVENTS.CHAT_SYNC, announce);
      setCrmDockMounted(false);
      window.dispatchEvent(new CustomEvent(CRM_DOCK_EVENTS.ACTIVE, { detail: { active: false } }));
    };
  }, []);

  useEffect(() => {
    dispatchDockState({
      expanded: expanded && showDock,
      hidden: hidden && !edgePeek,
      buttonCount,
      stackHeight,
      isMobile,
      offsetDx: offset.dx,
      offsetDy: offset.dy,
    });
  }, [expanded, showDock, hidden, edgePeek, buttonCount, stackHeight, isMobile, offset]);

  useEffect(() => {
    if (hidden) {
      setFabOpen(false);
      setExpanded(false);
      setEdgePeek(false);
    }
  }, [hidden, setFabOpen]);

  const toggleChat = useCallback(() => {
    window.dispatchEvent(new Event(CRM_DOCK_EVENTS.CHAT_TOGGLE));
  }, []);

  const canReorder = useCallback((id: DockButtonId | "launcher") => {
    return expanded && id !== "collapse" && id !== "launcher";
  }, [expanded]);

  const slotFor = useCallback((id: DockButtonId) => activeOrder.indexOf(id), [activeOrder]);

  const reorderAtPointer = useCallback((clientY: number, fromIndex: number, current: DockButtonId[]) => {
    const step = DOCK_BTN + DOCK_GAP;
    const anchorBottom = dockBottomPx(0, isMobile, offset.dy);
    const anchorTop = window.innerHeight - anchorBottom - stackHeight;
    const relativeY = clientY - anchorTop;
    let target = Math.floor(relativeY / step);
    target = Math.max(0, Math.min(current.length - 1, target));
    if (target === fromIndex) return current;
    const next = [...current];
    const [item] = next.splice(fromIndex, 1);
    next.splice(target, 0, item);
    return next;
  }, [isMobile, offset.dy, stackHeight]);

  const onButtonPointerDown = useCallback((buttonId: DockButtonId | "launcher") => (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      origOffset: { ...offset },
      moved: false,
      mode: null,
      buttonId,
      reorderFrom: buttonId === "launcher" ? -1 : slotFor(buttonId as DockButtonId),
      reorderPreview: [...order],
    };
    setDraggingId(buttonId);
  }, [offset, order, slotFor]);

  const onButtonPointerMove = useCallback((e: React.PointerEvent) => {
    const session = dragRef.current;
    if (!session || session.pointerId !== e.pointerId) return;

    const dx = session.startX - e.clientX;
    const dy = session.startY - e.clientY;
    const adx = Math.abs(dx);
    const ady = Math.abs(dy);

    if (!session.mode) {
      if (adx < DRAG_THRESHOLD && ady < DRAG_THRESHOLD) return;
      session.moved = true;
      session.mode = canReorder(session.buttonId) && ady > adx * 1.2 ? "reorder" : "move";
    }

    if (session.mode === "move") {
      setOffset(clampDockOffset(
        session.origOffset.dx + dx,
        session.origOffset.dy + dy,
        isMobile,
        stackHeight,
      ));
      return;
    }

    if (session.reorderFrom < 0) return;
    const next = reorderAtPointer(e.clientY, session.reorderFrom, session.reorderPreview);
    session.reorderPreview = next;
    setPreviewOrder(next);
  }, [canReorder, isMobile, reorderAtPointer, stackHeight]);

  const onButtonPointerUp = useCallback((e: React.PointerEvent) => {
    const session = dragRef.current;
    if (!session || session.pointerId !== e.pointerId) return;

    if (session.moved) {
      suppressClickRef.current = true;
      if (session.mode === "move") {
        const final = clampDockOffset(
          session.origOffset.dx + (session.startX - e.clientX),
          session.origOffset.dy + (session.startY - e.clientY),
          isMobile,
          stackHeight,
        );
        setOffset(final);
        saveDockOffset(final);
      } else if (session.mode === "reorder") {
        setOrder(session.reorderPreview);
        saveDockOrder(session.reorderPreview);
      }
    }

    dragRef.current = null;
    setDraggingId(null);
    setPreviewOrder(null);
  }, [isMobile, stackHeight]);

  const guardClick = useCallback((handler: (e: React.MouseEvent) => void) => (e: React.MouseEvent) => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    handler(e);
  }, []);

  const combinedUnread = activityUnread + chatUnread;
  const topSlot = expanded ? activeOrder.length - 1 : 0;
  const fabMenuBottomPx = dockBottomPx(topSlot, isMobile, offset.dy) + DOCK_BTN + DOCK_GAP;
  const fabMenuBottom = isMobile
    ? `calc(${fabMenuBottomPx}px + env(safe-area-inset-bottom, 0px))`
    : fabMenuBottomPx;

  const renderExpandedButton = (id: DockButtonId) => {
    const slot = slotFor(id);
    const isDragging = draggingId === id;
    const shared = {
      slot,
      isMobile,
      right: dockRight,
      offsetY: offset.dy,
      dragging: isDragging,
      onPointerMove: onButtonPointerMove,
      onPointerUp: onButtonPointerUp,
    };

    if (id === "add") {
      return (
        <DockButton
          key={id}
          {...shared}
          title="Quick add — drag to move, drag up/down to reorder"
          onClick={guardClick((e) => {
            e.stopPropagation();
            setFabOpen((p) => !p);
          })}
          onPointerDown={onButtonPointerDown("add")}
          style={dockBtnStyle(fabOpen, `linear-gradient(135deg,${T.accent},#d97706)`, isDragging, "#080d18")}
        >
          <span style={{ fontSize: 24, fontWeight: 300, lineHeight: 1, color: fabOpen ? T.text0 : "#080d18", pointerEvents: "none" }}>
            {fabOpen ? "×" : "+"}
          </span>
        </DockButton>
      );
    }

    if (id === "activity") {
      return (
        <DockButton
          key={id}
          {...shared}
          title="Activity feed — drag to move, drag up/down to reorder"
          onClick={guardClick(() => onActivityToggle())}
          onPointerDown={onButtonPointerDown("activity")}
          style={dockBtnStyle(activityOpen, `linear-gradient(135deg, ${T.purple}, #6366f1)`, isDragging)}
        >
          <Zap size={20} style={{ pointerEvents: "none" }} />
          <Badge count={activityUnread} />
        </DockButton>
      );
    }

    if (id === "chat") {
      return (
        <DockButton
          key={id}
          {...shared}
          title="CRM scratch chat — drag to move, drag up/down to reorder"
          onClick={guardClick(() => toggleChat())}
          onPointerDown={onButtonPointerDown("chat")}
          style={dockBtnStyle(false, `linear-gradient(135deg, ${T.purple}, #6d28d9)`, isDragging)}
        >
          <MessageCircle size={20} style={{ pointerEvents: "none" }} />
          <Badge count={chatUnread} />
        </DockButton>
      );
    }

    return (
      <DockButton
        key={id}
        {...shared}
        title="Collapse — drag to move dock"
        onClick={guardClick(() => {
          setExpanded(false);
          setFabOpen(false);
          if (hidden) setEdgePeek(false);
        })}
        onPointerDown={onButtonPointerDown("collapse")}
        style={dockBtnStyle(false, T.bg3, isDragging, T.text2)}
      >
        <GripVertical size={16} color={T.text2} style={{ pointerEvents: "none" }} />
      </DockButton>
    );
  };

  if (hidden && !edgePeek) {
    return (
      <button
        type="button"
        title="Show tools"
        onClick={() => setEdgePeek(true)}
        style={{
          position: "fixed",
          right: 0,
          bottom: "42%",
          zIndex: 799,
          width: 22,
          height: 52,
          borderRadius: "10px 0 0 10px",
          background: T.bg2,
          border: `1px solid ${T.bg4}`,
          borderRight: "none",
          color: T.text3,
          cursor: "pointer",
          fontSize: 14,
          boxShadow: "-4px 0 16px rgba(0,0,0,0.35)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        ⋮
      </button>
    );
  }

  return (
    <>
      {fabOpen && (
        <div
          className="animate-fade-in"
          style={{
            position: "fixed",
            right: dockRight,
            bottom: fabMenuBottom,
            zIndex: 810,
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          {fabItems.map((o, i) => (
            <button aria-label="Action"
              key={o.key}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onFabSelect(o.key);
                setFabOpen(false);
              }}
              className="animate-slide-up"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 9,
                background: T.bg2,
                border: `1px solid ${T.bg5}`,
                borderRadius: T.radius.md,
                padding: "10px 16px",
                color: T.text1,
                fontSize: 14,
                cursor: "pointer",
                whiteSpace: "nowrap",
                boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
                borderLeft: `3px solid ${o.color}`,
                animationDelay: `${i * 0.03}s`,
                touchAction: "manipulation",
              }}
            >
              {o.icon} {o.label}
            </button>
          ))}
        </div>
      )}

      {!expanded ? (
        <DockButton
          slot={0}
          isMobile={isMobile}
          right={dockRight}
          offsetY={offset.dy}
          title="Tools — drag to reposition"
          dragging={draggingId === "launcher"}
          onClick={guardClick(() => setExpanded(true))}
          onPointerDown={onButtonPointerDown("launcher")}
          onPointerMove={onButtonPointerMove}
          onPointerUp={onButtonPointerUp}
          style={dockBtnStyle(false, `linear-gradient(135deg, ${T.bg3}, ${T.bg4})`, draggingId === "launcher", T.text1)}
        >
          <Layers size={20} color={T.text1} style={{ pointerEvents: "none" }} />
          <Badge count={combinedUnread} />
        </DockButton>
      ) : (
        activeOrder.map((id) => renderExpandedButton(id))
      )}
    </>
  );
}
