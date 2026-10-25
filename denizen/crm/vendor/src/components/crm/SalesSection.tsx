/**
 * CONSOLIDATED: Sales section merges Lead Gen + Pipeline + Sales Hub + Quotas
 * into a single sidebar entry with internal sub-tab navigation.
 */
import { useState, useEffect } from "react";
import { CRM_SUBNAV_EVENT, dispatchCrmSubNav } from "@/lib/crm-nav";
import { T, type Contact, type Deal, type Note, type Quota, type EmailLogEntry, type AuditEntry, type DealComment } from "@/lib/crm-data";
import { SubTabNav } from "./shared/SubTabNav";
import { LeadGenTab } from "./LeadGenTab";
import { PipelineTab } from "./PipelineTab";
import { DealProbabilityAI } from "./DealProbabilityAI";
import { PipelineVelocity } from "./PipelineVelocity";
import { PipelineInsights } from "./PipelineInsights";
import { MobileSwipePipeline } from "./MobileSwipePipeline";
import { SalesTeamDashboard } from "./SalesTeamDashboard";
import { QuotaManagementTab } from "./QuotaManagementTab";
import type { IndustryConfig } from "@/lib/industry-config";
import type { LeadModelState } from "@/lib/crm-lead-model";
import type { Task } from "@/lib/crm-data";

function salesTabs(industryConfig?: IndustryConfig) {
  const term = industryConfig?.terminology;
  return [
    { key: "leads", label: "Leads", icon: "🎯" },
    { key: "pipeline", label: term?.pipeline || "Pipeline", icon: "◆" },
    { key: "hub", label: term?.salesHub || "Sales Hub", icon: "📊" },
    { key: "quotas", label: "Quotas", icon: "🏆" },
  ];
}

interface Props {
  deals: Deal[];
  contacts: Contact[];
  notes: Note[];
  emailLog: EmailLogEntry[];
  auditLog?: AuditEntry[];
  dealComments?: DealComment[];
  onAddDealComment?: (comment: DealComment) => void;
  currentUserName?: string;
  quotas: Quota[];
  onUpdateQuotas: (q: Quota[]) => void;
  onDealStageChange: (dealId: number, newStage: string) => void;
  onEditDeal: (deal: Deal) => void;
  onDeleteDeal: (id: number) => void;
  industryConfig?: IndustryConfig;
  tasks?: Task[];
  leadModelState?: LeadModelState;
  onLeadModelStateChange?: (state: LeadModelState) => void;
  isMobile?: boolean;
  /** Allow external code to set the initial sub-tab */
  initialTab?: string;
  /** Keep CRMApp navSubTab in sync when user picks a sub-tab pill */
  onSubTabChange?: (subTab: string) => void;
}

export function SalesSection({
  deals, contacts, notes, emailLog, auditLog = [], dealComments = [], onAddDealComment, currentUserName,
  quotas, onUpdateQuotas,
  onDealStageChange, onEditDeal, onDeleteDeal, industryConfig,
  tasks = [], leadModelState, onLeadModelStateChange,
  isMobile, initialTab, onSubTabChange,
}: Props) {
  const [activeTab, setActiveTab] = useState(initialTab || "leads");

  const selectTab = (key: string) => {
    setActiveTab(key);
    onSubTabChange?.(key);
    dispatchCrmSubNav("sales", key);
  };
  const [pipelineView, setPipelineView] = useState<"kanban" | "swipe" | "ai" | "velocity" | "insights">("kanban");
  const [quotaViewMode, setQuotaViewMode] = useState<"manager" | "member">("manager");

  useEffect(() => {
    if (initialTab) setActiveTab(initialTab);
  }, [initialTab]);

  useEffect(() => {
    const onSubNav = (e: Event) => {
      const { tab, subTab } = (e as CustomEvent<{ tab: string; subTab: string }>).detail || {};
      if (tab === "sales" && subTab) setActiveTab(subTab);
    };
    window.addEventListener(CRM_SUBNAV_EVENT, onSubNav);
    return () => window.removeEventListener(CRM_SUBNAV_EVENT, onSubNav);
  }, []);

  return (
    <div>
      <SubTabNav tabs={salesTabs(industryConfig)} active={activeTab} onSelect={selectTab} />

      {activeTab === "leads" && (
        <LeadGenTab
          contacts={contacts}
          deals={deals}
          notes={notes}
          emailLog={emailLog}
          tasks={tasks}
          leadModelState={leadModelState}
          onLeadModelStateChange={onLeadModelStateChange}
        />
      )}

      {activeTab === "pipeline" && (
        <div>
          {/* Pipeline view toggle */}
          <div style={{ display: "flex", gap: 6, marginBottom: 16, flexWrap: "wrap" }}>
            {([
              { key: "kanban", label: "Kanban", icon: "◆" },
              ...(isMobile ? [{ key: "swipe", label: "Swipe", icon: "◇" }] : []),
              { key: "insights", label: "Insights", icon: "▣" },
              { key: "ai", label: "AI Probability", icon: "✦" },
              { key: "velocity", label: "Velocity", icon: "⚡" },
            ] as { key: string; label: string; icon: string }[]).map(v => (
              <button key={v.key} onClick={() => setPipelineView(v.key as typeof pipelineView)} style={{
                padding: "6px 14px", borderRadius: "9999px", fontSize: 12, fontWeight: 600,
                background: pipelineView === v.key ? `${T.accent}22` : T.bg3,
                color: pipelineView === v.key ? T.accent : T.text3,
                border: `1px solid ${pipelineView === v.key ? `${T.accent}66` : T.bg4}`,
                cursor: "pointer", transition: "all 0.15s",
              }}>{v.icon} {v.label}</button>
            ))}
          </div>
          {pipelineView === "kanban" && <PipelineTab deals={deals} contacts={contacts} notes={notes} emailLog={emailLog} auditLog={auditLog} dealComments={dealComments} onAddDealComment={onAddDealComment} currentUserName={currentUserName} onDealStageChange={onDealStageChange} onEditDeal={onEditDeal} onDeleteDeal={onDeleteDeal} industryConfig={industryConfig} />}
          {pipelineView === "swipe" && <MobileSwipePipeline deals={deals} onDealStageChange={onDealStageChange} onEditDeal={onEditDeal} />}
          {pipelineView === "insights" && <PipelineInsights deals={deals} />}
          {pipelineView === "ai" && <DealProbabilityAI deals={deals} contacts={contacts} emailLog={emailLog} notes={notes} />}
          {pipelineView === "velocity" && <PipelineVelocity deals={deals} />}
        </div>
      )}

      {activeTab === "hub" && (
        <SalesTeamDashboard contacts={contacts} deals={deals} />
      )}

      {activeTab === "quotas" && (
        <div>
          <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
            {([{ key: "manager", label: "Manager View", icon: "📊" }, { key: "member", label: "My Quotas", icon: "🎯" }] as const).map(v => (
              <button key={v.key} onClick={() => setQuotaViewMode(v.key)} style={{
                padding: "6px 14px", borderRadius: "9999px", fontSize: 12, fontWeight: 600,
                background: quotaViewMode === v.key ? `${T.accent}22` : T.bg3,
                color: quotaViewMode === v.key ? T.accent : T.text3,
                border: `1px solid ${quotaViewMode === v.key ? `${T.accent}66` : T.bg4}`,
                cursor: "pointer",
              }}>{v.icon} {v.label}</button>
            ))}
          </div>
          <QuotaManagementTab quotas={quotas} onUpdateQuotas={onUpdateQuotas} isManager={quotaViewMode === "manager"} currentUserId="john" deals={deals} />
        </div>
      )}
    </div>
  );
}
