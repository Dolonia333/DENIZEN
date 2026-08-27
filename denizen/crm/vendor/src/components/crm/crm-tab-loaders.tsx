import { lazy, Suspense, type ComponentType, type ReactNode } from "react";

export type { Board } from "./NotesTab";

function lazyTab<T extends ComponentType<unknown>>(
  loader: () => Promise<{ [key: string]: T }>,
  exportName: string,
) {
  return lazy(() => loader().then((m) => ({ default: m[exportName] as T })));
}

export const DashboardTab = lazyTab(() => import("./DashboardTab"), "DashboardTab");
export const ContactsTab = lazyTab(() => import("./ContactsTab"), "ContactsTab");
export const TasksTab = lazyTab(() => import("./TasksTab"), "TasksTab");
export const PackagesTab = lazyTab(() => import("./PackagesTab"), "PackagesTab");
export const IntakeTab = lazyTab(() => import("./IntakeTab"), "IntakeTab");
export const AnalyticsTab = lazyTab(() => import("./AnalyticsTab"), "AnalyticsTab");
export const AITab = lazyTab(() => import("./AITab"), "AITab");
export const OnboardingTab = lazyTab(() => import("./OnboardingTab"), "OnboardingTab");
export const NotesTab = lazyTab(() => import("./NotesTab"), "NotesTab");
export const ClientPortalTab = lazyTab(() => import("./ClientPortalTab"), "ClientPortalTab");
export const SettingsTab = lazyTab(() => import("./SettingsTab"), "SettingsTab");
export const DataToolsTab = lazyTab(() => import("./DataToolsTab"), "DataToolsTab");
export const EmailTemplatesTab = lazyTab(() => import("./EmailTemplatesTab"), "EmailTemplatesTab");
export const AutomationsTab = lazyTab(() => import("./AutomationsTab"), "AutomationsTab");
export const CompaniesTab = lazyTab(() => import("./CompaniesTab"), "CompaniesTab");
export const SequencesTab = lazyTab(() => import("./SequencesTab"), "SequencesTab");
export const SalesSection = lazyTab(() => import("./SalesSection"), "SalesSection");
export const SupportTab = lazyTab(() => import("./SupportTab"), "SupportTab");
export const MarketingTab = lazyTab(() => import("./MarketingTab"), "MarketingTab");
export const TeamTab = lazyTab(() => import("./TeamTab"), "TeamTab");
export const MyWorkPanel = lazyTab(() => import("./MyWorkPanel"), "MyWorkPanel");
export const WorkingSetDashboard = lazyTab(() => import("./WorkingSetDashboard"), "WorkingSetDashboard");
export const AIProspector = lazyTab(() => import("./AIProspector"), "AIProspector");
export const ScheduleSection = lazyTab(() => import("./ScheduleSection"), "ScheduleSection");

export function TabFallback({ label = "Loading Meridian…" }: { label?: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: 240,
        color: "#94a3b8",
        font: "500 13px/1.4 system-ui, sans-serif",
      }}
    >
      {label}
    </div>
  );
}

export function LazyTab({ children }: { children: ReactNode }) {
  return <Suspense fallback={<TabFallback />}>{children}</Suspense>;
}
