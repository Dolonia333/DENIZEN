// One icon set for CRM navigation. NAV_GROUPS still carries its original
// emoji/glyph `icon` strings (the command palette and a few toasts use them);
// the sidebar and mobile tab bar render these Lucide icons instead, so the nav
// no longer mixes geometric glyphs (◈ ◉ ◆ ⊞ ▣) with colour emoji (📅 🏢 🎧).
import {
  BarChart3, Building2, CalendarDays, ClipboardList, Contact, Database, Globe,
  Headphones, Kanban, LayoutDashboard, ListChecks, Mail, Mails, Megaphone,
  Package, ScanSearch, Settings, Sparkles, StickyNote, Users, Zap,
  type LucideIcon,
} from "lucide-react";

export const NAV_ICONS: Record<string, LucideIcon> = {
  dashboard: LayoutDashboard,
  contacts: Contact,
  sales: Kanban,
  schedule: CalendarDays,
  companies: Building2,
  support: Headphones,
  marketing: Megaphone,
  team: Users,
  notes: StickyNote,
  sequences: Mails,
  packages: Package,
  intake: ClipboardList,
  "email-templates": Mail,
  automations: Zap,
  analytics: BarChart3,
  "ai-prospector": ScanSearch,
  ai: Sparkles,
  portal: Globe,
  "data-tools": Database,
  onboarding: ListChecks,
  settings: Settings,
};

/** Lucide icon for a nav id; falls back to the legacy glyph for unknown ids. */
export function NavIcon({ id, fallback, size = 16 }: { id: string; fallback?: string; size?: number }) {
  const Icon = NAV_ICONS[id];
  if (!Icon) return <>{fallback}</>;
  return <Icon size={size} strokeWidth={1.8} aria-hidden="true" />;
}
