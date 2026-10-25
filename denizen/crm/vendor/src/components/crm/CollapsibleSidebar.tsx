// REFACTORED: Collapsible sidebar component with expand/collapse group toggles,
// dividers between groups, count badges, and icon-only mode with tooltips
import { useState, useCallback } from "react";
import { T, NAV_GROUPS, type Contact, type Deal, type Task } from "@/lib/crm-data";
import { useCRMTranslation } from "@/hooks/use-crm-translation";

interface Props {
  tab: string;
  isMobile: boolean;
  contacts: Contact[];
  deals: Deal[];
  tasks: Task[];
  onNavigate: (id: string) => void;
}

export function CollapsibleSidebar({ tab, isMobile, contacts, deals, tasks, onNavigate }: Props) {
  const { t } = useCRMTranslation();
  // Collapsed groups — DAILY stays open; secondary groups start collapsed once (less overwhelm, all items kept).
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>(() => {
    try {
      const stored = localStorage.getItem("crm-sidebar-collapsed");
      if (stored) return JSON.parse(stored);
    } catch { /* ignore */ }
    return { SELL: true, COLLABORATE: true, INTELLIGENCE: true, SYSTEM: true };
  });

  const toggleGroup = useCallback((group: string) => {
    setCollapsedGroups(prev => {
      const next = { ...prev, [group]: !prev[group] };
      localStorage.setItem("crm-sidebar-collapsed", JSON.stringify(next));
      return next;
    });
  }, []);

  // Count badges per nav item
  const getCount = (id: string): number | null => {
    switch (id) {
      case "contacts": return contacts.length || null;
      case "sales": {
        const open = deals.filter(d => !["Closed Won", "Closed Lost"].includes(d.stage)).length;
        return open || null;
      }
      case "schedule": {
        const due = tasks.filter(t => !t.done).length;
        return due || null;
      }
      default: return null;
    }
  };

  return (
    <nav style={{ display: "flex", flexDirection: "column", gap: 0, flex: 1, overflowY: "auto" }}>
      {NAV_GROUPS.map((group, gi) => {
        const globalIdx = NAV_GROUPS.slice(0, gi).reduce((s, g) => s + g.items.length, 0);
        const isCollapsed = !!collapsedGroups[group.group];
        const isFirst = gi === 0;

        return (
          <div key={group.group}>
            {/* Divider between groups */}
            {!isFirst && (
              <div style={{
                height: 1, background: `${T.bg4}88`, margin: "4px 12px 4px",
              }} />
            )}

            {/* Group header — collapsible toggle */}
            <button
              onClick={() => toggleGroup(group.group)}
              style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                width: "100%", background: "none", border: "none",
                fontSize: 9, fontWeight: 700, color: T.text3, textTransform: "uppercase",
                letterSpacing: "0.1em", padding: "10px 12px 4px",
                cursor: "pointer", opacity: 0.6,
                transition: "opacity 0.15s",
              }}
              onMouseEnter={e => e.currentTarget.style.opacity = "1"}
              onMouseLeave={e => e.currentTarget.style.opacity = "0.6"}
            >
              <span>{isFirst ? "" : group.group}</span>
              {!isFirst && (
                <span style={{
                  fontSize: 10, transition: "transform 0.2s ease",
                  transform: isCollapsed ? "rotate(-90deg)" : "rotate(0deg)",
                  display: "inline-block",
                }}>▾</span>
              )}
            </button>

            {/* Nav items — collapse animation */}
            <div style={{
              overflow: "hidden",
              maxHeight: (isFirst || !isCollapsed) ? 500 : 0,
              opacity: (isFirst || !isCollapsed) ? 1 : 0,
              transition: "max-height 0.2s ease, opacity 0.15s ease",
            }}>
              {group.items.map((item, idx) => {
                const termLabel = item.id === "contacts" ? t("contacts")
                  : item.id === "sales" ? t("pipeline")
                  : item.id === "notes" ? t("notes")
                  : item.id === "companies" ? t("accounts")
                  : item.label;
                const active = tab === item.id;
                const shortcutIdx = globalIdx + idx;
                const shortcutKey = shortcutIdx < 9 ? String(shortcutIdx + 1) : shortcutIdx === 9 ? "0" : null;
                const count = getCount(item.id);

                return (
                  <button
                    key={item.id}
                    onClick={() => onNavigate(item.id)}
                    data-tooltip={termLabel}
                    className="crm-nav-pill"
                    style={{
                      display: "flex", alignItems: "center", gap: 10, width: "100%",
                      background: active ? `${T.accent}14` : "transparent",
                      border: "none", borderRadius: 8, padding: "9px 12px",
                      cursor: "pointer", color: active ? T.accent : T.text2,
                      fontSize: 13, fontWeight: active ? 600 : 400,
                      textAlign: "left", position: "relative",
                    }}
                  >
                    {/* Active left-border accent */}
                    {active && (
                      <span style={{
                        position: "absolute", left: 0, top: 4, bottom: 4, width: 2,
                        borderRadius: "0 2px 2px 0", background: T.accent,
                      }} />
                    )}
                    <span style={{ fontSize: 16, width: 20, textAlign: "center", opacity: active ? 1 : 0.6 }}>{item.icon}</span>
                    <span style={{ flex: 1 }}>{termLabel}</span>
                    {/* Count badge */}
                    {count !== null && count > 0 && (
                      <span style={{
                        fontSize: 10, fontWeight: 700, color: T.text3,
                        background: T.bg3, padding: "1px 6px", borderRadius: 8,
                        fontFamily: "'JetBrains Mono', monospace",
                        minWidth: 20, textAlign: "center",
                      }}>{count}</span>
                    )}
                    {/* Keyboard shortcut (desktop only) */}
                    {shortcutKey && !isMobile && !count && (
                      <span style={{
                        fontSize: 9, fontWeight: 600, color: T.text3, opacity: 0.5,
                        background: T.bg3, padding: "1px 5px", borderRadius: 3,
                        fontFamily: "'JetBrains Mono', monospace",
                      }}>{shortcutKey}</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </nav>
  );
}
