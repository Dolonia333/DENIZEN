import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import {
  T, S, NAV_ITEMS, NAV_GROUPS, fmt,
  initialPackages, initialSubmissions, initialQuotes, initialBranding,
  defaultIntakeQuestions, initialAvailability, type IntakeQuestion,
  initialAutomations, contactsToCsv, dealsToCsv, parseCsvAuto, loadDemoWorkspace,
  type Contact, type Deal, type Note, type Task, type ToastItem, type Automation,
  CONTACT_FREQUENCIES, type Quota,
  type EmailLogEntry, type Meeting, type AuditEntry, type Submission, type Quote,
  type Company, type Goal, type Sequence, type SequenceEnrollment,
  type AutomationRun, type DealComment, type MetricSnapshot, type AiThread,
  type SupportTicket, type MarketingCampaign, type TeamPolicy, type UsageLogEntry,
  DEFAULT_TEAM_POLICY,
} from "@/lib/crm-data";
import { validateDeal, validateContact, logUsage, resolveTeamPolicy } from "@/lib/crm-adoption";
import { DEFAULT_INDUSTRY_CONFIG, type IndustryConfig } from "@/lib/industry-config";
import { RoleDashboard } from "./RoleDashboard";
import { CRM_ROLES, getRole, DEFAULT_ROLE_ID } from "@/lib/crm-roles";
import { DEFAULT_LEAD_MODEL_STATE, type LeadModelState } from "@/lib/crm-lead-model";
import { IndustryConfigBridge } from "@/lib/crm-industry-bridge";
import type { ProspectorLead } from "./AIProspector";
import { ensureDenizenSession, markCrmDemoLoaded, markCrmUserEdited, postCrmEvent, intakeHandoff, fetchCrmWorkspace, fetchCrmTeam, fetchCrmSession, fetchVisitorAssistant, isCeoPrincipalSession, resolveProfileDisplayName, type CrmSendEmailResult, type CrmWorkspaceState, type CrmTeamMember, type CrmScope } from "@/lib/crm-api";
import { appendAudit, restoreWorkspace, type ClearableEntity, type RestoreMode } from "@/lib/crm-data-management";
import { purgeCrmDemoSeedIfPresent } from "@/lib/crm-demo-seed";
import { EmailComposeModal, type ComposeSeed } from "./EmailComposeModal";
import { CommandPalette } from "./CommandPalette";
import { ContactDrawer } from "./ContactDrawer";
import {
  ContactsTab,
  TasksTab,
  PackagesTab,
  IntakeTab,
  AnalyticsTab,
  AITab,
  OnboardingTab,
  NotesTab,
  ClientPortalTab,
  SettingsTab,
  DataToolsTab,
  EmailTemplatesTab,
  AutomationsTab,
  CompaniesTab,
  SequencesTab,
  SalesSection,
  ScheduleSection,
  SupportTab,
  MarketingTab,
  TeamTab,
  MyWorkPanel,
  AIProspector,
  LazyTab,
  type Board,
} from "./crm-tab-loaders";
import { NotificationsPanel, NotificationBell } from "./NotificationsPanel";
import { ActivityFeed } from "./ActivityFeed";
import { CrmFloatingDock } from "./CrmFloatingDock";
import { CRM_DOCK_EVENTS, dispatchCrmTab } from "@/lib/crm-dock";
import type { EmailTemplate } from "./EmailTemplatesTab";
import { UndoSnackbar, type UndoAction } from "./UndoSnackbar";
import { CollapsibleSidebar } from "./CollapsibleSidebar";
import { MobileBottomTabBar } from "./MobileBottomTabBar";
import { useIsMobile } from "@/hooks/use-mobile";
import { useLocalStorage } from "@/lib/crm-hooks";
import { dispatchCrmSubNav, isKnownCrmTab, resolveCrmNav } from "@/lib/crm-nav";
import { useCrmCloudSync, crmSyncLabel } from "@/hooks/use-crm-cloud-sync";
import { CrmHomeStart } from "./CrmHomeStart";
import { resolveWorkspaceMode, workspaceModeLabel } from "@/lib/crm-workspace-mode";


export default function CRMApp() {
  const [tab, setTab] = useState("dashboard");
  const [navSubTab, setNavSubTab] = useState<string | undefined>();
  const [contacts, setContacts] = useLocalStorage<Contact[]>("contacts", []);
  const [deals, setDeals] = useLocalStorage<Deal[]>("deals", []);
  const [notes, setNotes] = useLocalStorage<Note[]>("notes", []);
  const [tasks, setTasks] = useLocalStorage<Task[]>("tasks", []);
  const [companies, setCompanies] = useLocalStorage<Company[]>("companies", []);
  const [goals, setGoals] = useLocalStorage<Goal[]>("goals", []);
  const [sequences, setSequences] = useLocalStorage<Sequence[]>("sequences", []);
  const [sequenceEnrollments, setSequenceEnrollments] = useLocalStorage<SequenceEnrollment[]>("sequenceEnrollments", []);
  const [submissions, setSubmissions] = useLocalStorage<Submission[]>("submissions", []);
  const [quotes, setQuotes] = useLocalStorage<Quote[]>("quotes", []);
  const [packages, setPackages] = useLocalStorage("packages", []);
  const [emailLog, setEmailLog] = useLocalStorage<EmailLogEntry[]>("emailLog", []);
  const [meetings, setMeetings] = useLocalStorage<Meeting[]>("meetings", []);
  const [auditLog, setAuditLog] = useLocalStorage<AuditEntry[]>("auditLog", []);
  const [crmQuotas, setCrmQuotas] = useLocalStorage<Quota[]>("crmQuotas", []);
  const [automations, setAutomations] = useLocalStorage<Automation[]>("automations", []);
  const [emailTemplates, setEmailTemplates] = useLocalStorage<EmailTemplate[]>("emailTemplates", []);
  const [noteBoards, setNoteBoards] = useLocalStorage<unknown[]>("noteBoards", []);
  const [undoActions, setUndoActions] = useState<UndoAction[]>([]);
  const dismissUndo = useCallback((id: number) => setUndoActions(p => p.filter(a => a.id !== id)), []);

  const [activeRole, setActiveRole] = useLocalStorage<string>("activeRole", DEFAULT_ROLE_ID);
  const [industryConfig, setIndustryConfigRaw] = useLocalStorage<IndustryConfig>("industryConfig", DEFAULT_INDUSTRY_CONFIG);
  const handleUpdateIndustryConfig = useCallback((config: IndustryConfig) => {
    setIndustryConfigRaw(config);
  }, [setIndustryConfigRaw]);
  const term = industryConfig.terminology;
  const [leadModelState, setLeadModelState] = useLocalStorage<LeadModelState>("leadModelState", DEFAULT_LEAD_MODEL_STATE);

  const [contactGroups, setContactGroups] = useLocalStorage<import("./ContactGroups").ContactGroup[]>("contactGroups", []);
  const [contactGroupMap, setContactGroupMap] = useLocalStorage<Record<number, number[]>>("contactGroupMap", {});
  const [userPrefs, setUserPrefs] = useLocalStorage<Record<string, unknown>>("userPrefs", {});
  const [onboarding, setOnboarding] = useLocalStorage<Record<string, unknown>>("onboarding", {});
  const [availability, setAvailability] = useLocalStorage<typeof initialAvailability>("availability", initialAvailability);
  const [integrations, setIntegrations] = useLocalStorage<Record<string, unknown>>("integrations", {});
  const [metricSnapshots, setMetricSnapshots] = useLocalStorage<MetricSnapshot[]>("metricSnapshots", []);
  const [automationRuns, setAutomationRuns] = useLocalStorage<AutomationRun[]>("automationRuns", []);
  const [dealComments, setDealComments] = useLocalStorage<DealComment[]>("dealComments", []);
  const [supportTickets, setSupportTickets] = useLocalStorage<SupportTicket[]>("supportTickets", []);
  const [marketingCampaigns, setMarketingCampaigns] = useLocalStorage<MarketingCampaign[]>("marketingCampaigns", []);
  const [teamPolicy, setTeamPolicy] = useLocalStorage<TeamPolicy>("teamPolicy", DEFAULT_TEAM_POLICY);
  const [usageLog, setUsageLog] = useLocalStorage<UsageLogEntry[]>("usageLog", []);
  const [aiThreads, setAiThreads] = useLocalStorage<AiThread[]>("aiThreads", []);
  const [intakeQuestions, setIntakeQuestions] = useLocalStorage<IntakeQuestion[]>("intakeQuestions", defaultIntakeQuestions);
  // pipelineView moved into SalesSection

  const [cmdOpen, setCmdOpen] = useState(false);
  const [contactDrawer, setContactDrawer] = useState<Contact | null>(null);
  const [modal, setModal] = useState<string | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [fabOpen, setFabOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const [activityUnread, setActivityUnread] = useState(0);
  const [chatUnread, setChatUnread] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeSeed, setComposeSeed] = useState<ComposeSeed | null>(null);
  const [crmTeam, setCrmTeam] = useState<CrmTeamMember[]>([]);
  const [selfEmail, setSelfEmail] = useState<string | null>(null);

  const [formData, setFormData] = useState<Record<string, string>>({});
  const [editId, setEditId] = useState<number | null>(null);
  const [selectedGroupIds, setSelectedGroupIds] = useState<number[]>([]);
  const [inlineNewGroup, setInlineNewGroup] = useState(false);
  const [inlineGroupName, setInlineGroupName] = useState("");

  const isMobile = useIsMobile();

  useEffect(() => {
    dispatchCrmTab(tab);
  }, [tab]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tabParam = params.get('tab');
    if (tabParam && isKnownCrmTab(tabParam)) {
      const { tab: resolvedTab, subTab } = resolveCrmNav(tabParam);
      setTab(resolvedTab);
      if (subTab) setNavSubTab(subTab);
    }
    const subParam = params.get('sub');
    if (subParam) setNavSubTab(subParam);

    const urlPrefill: Record<string, string> = {};
    for (const key of ['name', 'email', 'company', 'phone', 'title']) {
      const val = params.get(key);
      if (val) urlPrefill[key] = val;
    }

    try {
      const prefillRaw = sessionStorage.getItem('denizen-crm-prefill');
      if (prefillRaw) sessionStorage.removeItem('denizen-crm-prefill');
      const storedPrefill = prefillRaw ? JSON.parse(prefillRaw) : {};
      const prefill = { ...storedPrefill, ...urlPrefill };
      if (prefill.name || prefill.email || prefill.company) {
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent('crm-prefill', { detail: prefill }));
        }, 400);
      }
    } catch (_) {}
  }, []);

  useEffect(() => {
    const onPrefill = (e: Event) => {
      const detail = ((e as CustomEvent).detail || {}) as Record<string, string>;
      if (!detail.name && !detail.email && !detail.company) return;
      setFormData({
        name: detail.name || '',
        email: detail.email || '',
        company: detail.company || '',
        phone: detail.phone || '',
        status: detail.status || industryConfig.contactStatuses[0] || 'Lead',
      });
      setTab('contacts');
      setModal('add-contact');
    };
    window.addEventListener('crm-prefill', onPrefill);
    return () => window.removeEventListener('crm-prefill', onPrefill);
  }, [industryConfig]);

  useEffect(() => {
    const onChatUnread = (e: Event) => {
      setChatUnread(Number((e as CustomEvent).detail?.unread) || 0);
    };
    window.addEventListener(CRM_DOCK_EVENTS.CHAT_UNREAD, onChatUnread);
    return () => window.removeEventListener(CRM_DOCK_EVENTS.CHAT_UNREAD, onChatUnread);
  }, []);

  const workspaceSnapshot = useMemo(() => ({
    contacts,
    deals,
    notes,
    tasks,
    companies,
    goals,
    sequences,
    sequenceEnrollments,
    submissions,
    quotes,
    packages,
    meetings,
    automations,
    emailTemplates,
    emailLog,
    auditLog,
    noteBoards,
    industryConfig,
    contactGroups,
    contactGroupMap,
    crmQuotas,
    userPrefs,
    onboarding,
    availability,
    integrations,
    metricSnapshots,
    automationRuns,
    dealComments,
    aiThreads,
    leadModelState,
    supportTickets,
    marketingCampaigns,
    teamPolicy,
    usageLog,
    intakeQuestions,
  }), [
    contacts, deals, notes, tasks, companies, goals, sequences, sequenceEnrollments,
    submissions, quotes, packages, meetings, automations, emailTemplates,
    emailLog, auditLog, noteBoards, industryConfig, contactGroups, contactGroupMap, crmQuotas,
    userPrefs, onboarding, availability, integrations, metricSnapshots, automationRuns,
    dealComments, aiThreads, leadModelState, supportTickets, marketingCampaigns, teamPolicy, usageLog,
    intakeQuestions,
  ]);

  const { status: syncStatus, orgLabel, teamLabel, lastSavedAt, updatedByName } = useCrmCloudSync(workspaceSnapshot, {
    setContacts,
    setDeals,
    setNotes,
    setTasks,
    setCompanies,
    setGoals,
    setSequences,
    setSequenceEnrollments,
    setSubmissions,
    setQuotes,
    setPackages,
    setMeetings,
    setAutomations,
    setEmailTemplates,
    setEmailLog,
    setAuditLog,
    setNoteBoards,
    setIndustryConfig: handleUpdateIndustryConfig,
    setContactGroups,
    setContactGroupMap,
    setCrmQuotas,
    setUserPrefs,
    setOnboarding,
    setAvailability,
    setIntegrations,
    setMetricSnapshots,
    setAutomationRuns,
    setDealComments,
    setAiThreads,
    setLeadModelState,
    setSupportTickets,
    setMarketingCampaigns,
    setTeamPolicy,
    setUsageLog,
    setIntakeQuestions,
  });

  const syncLabel = crmSyncLabel(syncStatus, teamLabel, lastSavedAt, updatedByName);

  const [denizenProfile, setDenizenProfile] = useState({ name: "Guest", role: "Solo" });
  const [claimedNpcKey, setClaimedNpcKey] = useState<string | null>(null);
  const [crmScope, setCrmScope] = useState<CrmScope>("org");
  const [selfIdentityId, setSelfIdentityId] = useState<string | null>(null);
  const [canManageTeam, setCanManageTeam] = useState(true);

  const trackUsage = useCallback((action: string, entity?: string, entityId?: number) => {
    const user = denizenProfile.name || "Guest";
    setUsageLog((prev) => logUsage(prev, user, action, entity, entityId));
  }, [denizenProfile.name, setUsageLog]);

  const policy = useMemo(() => resolveTeamPolicy(teamPolicy), [teamPolicy]);

  const handleSupportTicketsUpdate = useCallback((next: SupportTicket[]) => {
    const prevIds = new Set(supportTickets.map((t) => t.id));
    setSupportTickets(next);
    next.filter((t) => !prevIds.has(t.id)).forEach((t) => trackUsage("ticket_created", "ticket", t.id));
  }, [supportTickets, setSupportTickets, trackUsage]);

  const handleMarketingCampaignsUpdate = useCallback((next: MarketingCampaign[]) => {
    const prevById = new Map(marketingCampaigns.map((c) => [c.id, c]));
    setMarketingCampaigns(next);
    for (const c of next) {
      const prev = prevById.get(c.id);
      if (!prev) trackUsage("campaign_created", "campaign", c.id);
      else if (prev.status !== "active" && c.status === "active") trackUsage("campaign_started", "campaign", c.id);
      else if (prev.status === "active" && c.status === "completed") trackUsage("campaign_completed", "campaign", c.id);
    }
  }, [marketingCampaigns, setMarketingCampaigns, trackUsage]);

  useEffect(() => {
    void (async () => {
      const [info, team] = await Promise.all([fetchCrmSession(), fetchCrmTeam()]);
      if (!info) return;
      const name = resolveProfileDisplayName(info.display_name, {
        tier: info.tier,
        username: info.username,
        ceo: info.ceo,
        org_slug: info.org_slug,
        email: info.email,
      })
        || (info.ceo ? "Dolonia" : null)
        || info.username
        || (info.email ? info.email.split("@")[0] : null)
        || (info.tier === "demo" || String(info.org_slug || "").toLowerCase() === "acme" ? "Demo user" : "Team member");
      const roleLabel = (session: NonNullable<Awaited<ReturnType<typeof fetchCrmSession>>>) => {
        if (session.tier === "demo" || String(session.org_slug || "").toLowerCase() === "acme") {
          const title = String(session.work_position?.title || "").trim();
          return title || "Demo user";
        }
        if (session.ceo || session.tier === "ceo" || session.is_owner) return "CEO";
        const tr = String(session.team_role || "").toLowerCase();
        if (tr === "owner") return "Owner";
        if (tr === "admin") return "Admin";
        const members = Array.isArray(team?.members) ? team.members.length : 0;
        return members >= 2 ? "Team member" : "Solo";
      };
      setDenizenProfile({ name, role: roleLabel(info) });
      if (info.email) setSelfEmail(info.email);
      setCrmScope(info.crm_scope === "own" ? "own" : "org");
      setSelfIdentityId(info.identity_id || null);
      const manage = !!(info.ceo || info.is_owner || ["owner", "admin", "ceo"].includes(String(info.team_role || "").toLowerCase()) || info.crm_scope !== "own");
      setCanManageTeam(manage);
      setCrmTeam(team.members);
      if (team.self?.email) setSelfEmail(team.self.email);
    })();
    void fetchVisitorAssistant().then((a) => {
      if (a?.npc_key) setClaimedNpcKey(String(a.npc_key));
    });
  }, []);

  const teamMemberNames = useMemo(() => {
    const names = crmTeam.map((m) => m.display_name).filter(Boolean);
    if (denizenProfile.name && !names.includes(denizenProfile.name)) {
      return [denizenProfile.name, ...names];
    }
    return names.length ? names : [denizenProfile.name];
  }, [crmTeam, denizenProfile.name]);

  const workspaceMode = useMemo(
    () => resolveWorkspaceMode({
      syncStatus,
      teamSize: Math.max(crmTeam.length, teamMemberNames.length > 1 ? teamMemberNames.length : (orgLabel ? 1 : 0)),
    }),
    [syncStatus, crmTeam.length, teamMemberNames.length, orgLabel],
  );
  const isTeamMode = workspaceMode === "team";

  // MOBILE: lock body scroll while sidebar drawer is open to prevent background scrolling
  useEffect(() => {
    if (!isMobile) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = sidebarOpen ? "hidden" : prev || "";
    return () => { document.body.style.overflow = prev; };
  }, [isMobile, sidebarOpen]);

  // MOBILE: close sidebar / FAB / modal on Escape for accessibility
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (modal) closeModal();
      else if (sidebarOpen) setSidebarOpen(false);
      else if (fabOpen) setFabOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sidebarOpen, fabOpen, modal]);

  const addToast = useCallback((type: ToastItem["type"], message: string, title?: string) => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, type, message, title }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3500);
  }, []);

  // One-shot: strip bundled Acme/Bright Labs sample data so CRM tracks real records.
  useEffect(() => {
    const purged = purgeCrmDemoSeedIfPresent(
      { contacts, deals },
      {
        setContacts,
        setDeals,
        setNotes,
        setTasks,
        setCompanies,
        setGoals,
        setSequences,
        setSubmissions,
        setQuotes,
        setPackages,
        setMeetings,
        setAutomations,
        setEmailLog,
        setAuditLog,
      },
    );
    if (purged) {
      addToast("info", "Sample CRM data cleared — ready for your real pipeline");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on mount against initial localStorage
  }, [addToast]);

  const openCompose = useCallback((seed?: ComposeSeed) => {
    setComposeSeed(seed || null);
    setComposeOpen(true);
  }, []);

  const handleEmailSent = useCallback((result: CrmSendEmailResult) => {
    if (result.logEntry) {
      setEmailLog((prev) => [result.logEntry as EmailLogEntry, ...prev]);
    }
    addToast(
      "success",
      result.mode === "resend" ? "Email sent to client" : "Email logged — finish in your mail app if it opened",
    );
  }, [addToast]);

  const refreshWorkspaceFromServer = useCallback(async () => {
    const data = await fetchCrmWorkspace();
    const state = data?.state;
    if (!state) return;
    if (state.sequences) setSequences(state.sequences as Sequence[]);
    if (state.sequenceEnrollments) setSequenceEnrollments(state.sequenceEnrollments as SequenceEnrollment[]);
    if (state.emailLog) setEmailLog(state.emailLog as EmailLogEntry[]);
    if (state.contacts) setContacts(state.contacts as Contact[]);
  }, [setSequences, setSequenceEnrollments, setEmailLog, setContacts]);

  const handleLoadDemoData = useCallback(() => {
    const demo = loadDemoWorkspace();
    setContacts(demo.contacts);
    setDeals(demo.deals);
    setNotes(demo.notes);
    setTasks(demo.tasks);
    setCompanies(demo.companies);
    setGoals(demo.goals);
    setSequences(demo.sequences);
    setSubmissions(demo.submissions);
    setQuotes(demo.quotes);
    setPackages(demo.packages);
    setMeetings(demo.meetings);
    setAutomations(demo.automations);
    setEmailLog(demo.emailLog);
    setAuditLog(demo.auditLog);
    setCrmQuotas(demo.crmQuotas);
    markCrmDemoLoaded();
    addToast("success", "Sample CRM data loaded — will sync to your team workspace");
  }, [addToast]);

  const mainRef = useRef<HTMLElement>(null);
  const handleNavigate = useCallback((id: string) => {
    const { tab: nextTab, subTab } = resolveCrmNav(id);
    const safeTab = isKnownCrmTab(nextTab) ? nextTab : "dashboard";
    setNavSubTab(subTab);
    setTab(safeTab);
    if (subTab) dispatchCrmSubNav(safeTab, subTab);
    if (isMobile) setSidebarOpen(false);
    setTimeout(() => { mainRef.current?.scrollTo(0, 0); }, 0);
  }, [isMobile]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") { e.preventDefault(); setCmdOpen(true); return; }
      // Number key shortcuts for sidebar navigation (1-9, 0)
      if (!e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        const target = e.target as HTMLElement;
        if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable) return;
        const num = parseInt(e.key);
        if (!isNaN(num) && num >= 0 && num <= 9) {
          const idx = num === 0 ? 9 : num - 1;
          if (idx < NAV_ITEMS.length) {
            e.preventDefault();
            handleNavigate(NAV_ITEMS[idx].id);
          }
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleNavigate]);

  useEffect(() => {
    if (!fabOpen) return;
    const close = () => setFabOpen(false);
    const timer = window.setTimeout(() => {
      window.addEventListener("click", close, { once: true });
    }, 0);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("click", close);
    };
  }, [fabOpen]);

  // Listen for navigation requests from global team chat
  useEffect(() => {
    const handler = (e: Event) => {
      const tabId = (e as CustomEvent<string>).detail;
      handleNavigate(tabId);
    };
    window.addEventListener("crm-navigate", handler);
    return () => window.removeEventListener("crm-navigate", handler);
  }, [handleNavigate]);

  const handleDealStageChange = (dealId: number, newStage: string) => {
    handleDealStageChangeWithUndo(dealId, newStage);
  };

  const handleToggleTask = (id: number) => {
    setTasks(prev => prev.map(t => t.id === id ? { ...t, done: !t.done } : t));
  };

  const handleSubmissionStatus = (id: number, status: string) => {
    const sub = submissions.find((s) => s.id === id);
    setSubmissions(prev => prev.map(s => s.id === id ? { ...s, status } : s));
    if (/qualified/i.test(status) && sub) {
      const email = String(sub.clientEmail || "").trim().toLowerCase();
      const exists = email && contacts.some((c) => String(c.email || "").toLowerCase() === email);
      if (!exists) {
        const contact: Contact = {
          id: Date.now(),
          name: sub.clientName || email,
          company: sub.company || "",
          email: email || "",
          phone: "",
          status: "Prospect",
          tags: ["intake"],
          score: 65,
          lastContact: new Date().toISOString().slice(0, 10),
          interactions: 1,
          leadSource: "intake",
        };
        setContacts((prev) => [...prev, contact]);
        setDeals((prev) => [...prev, {
          id: Date.now() + 1,
          title: `${sub.company || sub.clientName} — Intake`,
          contact: contact.name,
          value: 0,
          stage: "Lead",
          probability: 15,
          closeDate: new Date(Date.now() + 45 * 86400000).toISOString().slice(0, 10),
          daysInStage: 0,
          health: "good",
          leadSource: "intake",
        }]);
        addToast("success", `Created contact + deal for ${sub.clientName}`);
      }
      intakeHandoff(sub as unknown as Record<string, unknown>);
    } else {
      addToast("info", `Submission status updated`);
    }
  };

  const handleAiCreateTask = useCallback((partial: Partial<Task>) => {
    const task: Task = {
      id: Date.now(),
      title: partial.title || "Follow up",
      contact: partial.contact || "",
      due: partial.due || new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10),
      priority: partial.priority || "High",
      done: false,
      status: "todo",
      ...partial,
    };
    setTasks((prev) => [...prev, task]);
    addToast("success", `Task created: ${task.title}`);
  }, [addToast]);

  const handleAddSubmission = (sub: Submission) => {
    setSubmissions(prev => [sub, ...prev]);
    addToast("success", `Intake from ${sub.clientName} added`);
  };

  const handleAddQuote = (quote: Quote) => {
    setQuotes(prev => [quote, ...prev]);
    // Link quote to submission if applicable
    if (quote.submissionId) {
      setSubmissions(prev => prev.map(s => s.id === quote.submissionId ? { ...s, quoteId: quote.id, status: "quoted" } : s));
    }
    addToast("success", `Quote created for ${quote.clientName}`);
  };

  const handleImportSubmissions = (subs: Submission[]) => {
    setSubmissions(prev => [...subs, ...prev]);
    addToast("success", `Imported ${subs.length} submissions`);
  };

  // Helper: extract custom field values from formData
  const extractCustomFields = (entity: "contact" | "deal"): Record<string, any> => {
    const cfv: Record<string, any> = {};
    industryConfig.customFields.filter(f => f.entity === entity).forEach(f => {
      const val = formData[`cf_${f.id}`];
      if (val !== undefined && val !== "") {
        cfv[f.id] = f.type === "number" ? Number(val) : f.type === "checkbox" ? val === "true" : val;
      }
    });
    return cfv;
  };

  // Helper: render custom field inputs
  const renderCustomFields = (entity: "contact" | "deal") => {
    const fields = industryConfig.customFields.filter(f => f.entity === entity);
    if (fields.length === 0) return null;
    return (
      <>
        <div style={{ ...S.sectionLabel as React.CSSProperties, marginTop: 8 }}>Custom Fields</div>
        {fields.map(f => (
          <div key={f.id} style={{ marginBottom: 12 }}>
            <label style={S.label as React.CSSProperties}>{f.label}</label>
            {f.type === "select" ? (
              <select value={formData[`cf_${f.id}`] || ""} onChange={e => setFormData(p => ({ ...p, [`cf_${f.id}`]: e.target.value }))} style={S.input as React.CSSProperties}>
                <option value="">Select…</option>
                {f.options?.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            ) : f.type === "checkbox" ? (
              <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                <input type="checkbox" checked={formData[`cf_${f.id}`] === "true"} onChange={e => setFormData(p => ({ ...p, [`cf_${f.id}`]: e.target.checked ? "true" : "false" }))} />
                <span style={{ fontSize: 13, color: T.text1 }}>{f.label}</span>
              </label>
            ) : f.type === "textarea" ? (
              <textarea value={formData[`cf_${f.id}`] || ""} onChange={e => setFormData(p => ({ ...p, [`cf_${f.id}`]: e.target.value }))} style={{ ...S.input as React.CSSProperties, minHeight: 60, resize: "vertical" as const }} />
            ) : (
              <input type={f.type === "number" ? "number" : f.type === "date" ? "date" : f.type === "url" ? "url" : f.type === "email" ? "email" : "text"}
                value={formData[`cf_${f.id}`] || ""} onChange={e => setFormData(p => ({ ...p, [`cf_${f.id}`]: e.target.value }))} style={S.input as React.CSSProperties} />
            )}
          </div>
        ))}
      </>
    );
  };

  // ADD handlers
  const handleAddContact = () => {
    if (!formData.name?.trim()) return;
    const newContact: Contact = {
      id: Date.now(), name: formData.name, company: formData.company || "",
      email: formData.email || "", phone: formData.phone || "",
      status: formData.status || industryConfig.contactStatuses[0] || "Lead", tags: [], score: 50,
      avatar: formData.avatar || undefined,
      contactFrequency: (formData.contactFrequency as any) || undefined,
      customFieldValues: extractCustomFields("contact"),
      lastContact: new Date().toISOString().split("T")[0], interactions: 0,
    };
    const missing = validateContact(newContact, policy);
    if (missing.length) {
      addToast("error", `Missing required: ${missing.join(", ")}`);
      return;
    }
    setContacts(prev => [...prev, newContact]);
    trackUsage("contact_created", "contact", newContact.id);
    // Assign selected groups
    if (selectedGroupIds.length > 0) {
      setContactGroupMap(p => ({ ...p, [newContact.id]: [...selectedGroupIds] }));
    }
    setModal(null); setFormData({}); setSelectedGroupIds([]); setInlineNewGroup(false); setInlineGroupName("");
    addToast("success", `${newContact.name} added to contacts`);
  };

  const handleAddDeal = () => {
    if (!formData.title?.trim()) return;
    const newDeal: Deal = {
      id: Date.now(), title: formData.title, contact: formData.contact || "",
      value: Number(formData.value) || 0, stage: industryConfig.pipelineStages[0] || "Lead", probability: 10,
      closeDate: formData.closeDate || "", daysInStage: 0, health: "good",
      ownerId: formData.ownerId || denizenProfile.name,
      ownerIdentityId: selfIdentityId || undefined,
      ownerEmail: selfEmail || undefined,
      customFieldValues: extractCustomFields("deal"),
    };
    const missing = validateDeal(newDeal, policy);
    if (missing.length) {
      addToast("error", `Missing required: ${missing.join(", ")}`);
      return;
    }
    setDeals(prev => [...prev, newDeal]);
    trackUsage("deal_created", "deal", newDeal.id);
    setModal(null); setFormData({});
    addToast("success", `Deal "${newDeal.title}" created`);
  };

  const handleAddNote = () => {
    if (!formData.text?.trim()) return;
    const newNote: Note = {
      id: Date.now(), contact: formData.contact || contacts[0]?.name || "",
      text: formData.text, date: new Date().toISOString().split("T")[0], type: formData.type || "Call",
    };
    setNotes(prev => [newNote, ...prev]);
    setModal(null); setFormData({});
    addToast("success", "Note logged");
  };

  const handleAddTask = () => {
    if (!formData.title?.trim()) return;
    const newTask: Task = {
      id: Date.now(), title: formData.title, contact: formData.contact || "",
      due: formData.due || "", priority: formData.priority || "Medium", done: false,
    };
    setTasks(prev => [...prev, newTask]);
    trackUsage("task_created", "task", newTask.id);
    setModal(null); setFormData({});
    addToast("success", "Task created");
  };

  const handleProspectorImport = useCallback((lead: ProspectorLead) => {
    const baseId = Date.now();
    const today = new Date().toISOString().split("T")[0];
    const due = new Date(Date.now() + 3 * 86400000).toISOString().split("T")[0];
    const newContact: Contact = {
      id: baseId,
      name: lead.name,
      company: lead.company,
      email: lead.email,
      phone: "",
      status: industryConfig.contactStatuses[0] || "Lead",
      tags: ["AI Prospector"],
      score: 72,
      lastContact: today,
      interactions: 0,
      leadSource: lead.source,
    };
    const newDeal: Deal = {
      id: baseId + 1,
      title: lead.dealTitle,
      contact: lead.name,
      value: lead.value,
      stage: industryConfig.pipelineStages[0] || "Lead",
      probability: 25,
      closeDate: "",
      daysInStage: 0,
      health: "good",
      leadSource: lead.source,
    };
    const newTask: Task = {
      id: baseId + 2,
      title: `Launch outreach: ${lead.dealTitle}`,
      contact: lead.name,
      due,
      priority: "High",
      done: false,
      description: lead.signal,
      createdAt: today,
    };
    setContacts((prev) => [...prev, newContact]);
    setDeals((prev) => [...prev, newDeal]);
    setTasks((prev) => [...prev, newTask]);
    markCrmUserEdited();
    addToast("success", `${lead.name} imported — task added to your dashboard`);
  }, [industryConfig, addToast]);

  // EDIT handlers
  const openEditContact = (c: Contact) => {
    const cfData: Record<string, string> = {};
    if (c.customFieldValues) {
      Object.entries(c.customFieldValues).forEach(([k, v]) => { cfData[`cf_${k}`] = String(v); });
    }
    setFormData({ name: c.name, email: c.email, company: c.company, phone: c.phone, status: c.status, avatar: c.avatar || "", contactFrequency: c.contactFrequency || "", ...cfData });
    setEditId(c.id);
    setSelectedGroupIds(contactGroupMap[c.id] || []);
    setModal("edit-contact");
  };

  const handleEditContact = () => {
    if (!formData.name?.trim() || !editId) return;
    const existing = contacts.find((c) => c.id === editId);
    if (!existing) return;
    const updated: Contact = {
      ...existing, name: formData.name, email: formData.email || existing.email,
      company: formData.company || existing.company, phone: formData.phone || existing.phone,
      status: formData.status || existing.status,
      avatar: formData.avatar || existing.avatar,
      contactFrequency: (formData.contactFrequency as any) || existing.contactFrequency,
      customFieldValues: { ...(existing.customFieldValues || {}), ...extractCustomFields("contact") },
    };
    const missing = validateContact(updated, policy);
    if (missing.length) {
      addToast("error", `Missing required: ${missing.join(", ")}`);
      return;
    }
    setContacts(prev => prev.map(c => c.id === editId ? updated : c));
    trackUsage("contact_updated", "contact", editId);
    // Update group assignments
    setContactGroupMap(p => ({ ...p, [editId]: [...selectedGroupIds] }));
    setModal(null); setFormData({}); setEditId(null); setSelectedGroupIds([]); setInlineNewGroup(false); setInlineGroupName("");
    addToast("success", "Contact updated");
  };

  const openEditDeal = (d: Deal) => {
    const cfData: Record<string, string> = {};
    if (d.customFieldValues) {
      Object.entries(d.customFieldValues).forEach(([k, v]) => { cfData[`cf_${k}`] = String(v); });
    }
    setFormData({ title: d.title, contact: d.contact, value: String(d.value), closeDate: d.closeDate, stage: d.stage, ownerId: d.ownerId || denizenProfile.name, ...cfData });
    setEditId(d.id);
    setModal("edit-deal");
  };

  const handleEditDeal = () => {
    if (!formData.title?.trim() || !editId) return;
    const existing = deals.find((d) => d.id === editId);
    if (!existing) return;
    const updated: Deal = {
      ...existing, title: formData.title, contact: formData.contact || existing.contact,
      value: Number(formData.value) || existing.value, closeDate: formData.closeDate || existing.closeDate,
      stage: formData.stage || existing.stage,
      ownerId: formData.ownerId || existing.ownerId || denizenProfile.name,
      ownerIdentityId: existing.ownerIdentityId || selfIdentityId || undefined,
      ownerEmail: existing.ownerEmail || selfEmail || undefined,
      customFieldValues: { ...(existing.customFieldValues || {}), ...extractCustomFields("deal") },
    };
    const missing = validateDeal(updated, policy);
    if (missing.length) {
      addToast("error", `Missing required: ${missing.join(", ")}`);
      return;
    }
    setDeals(prev => prev.map(d => d.id === editId ? updated : d));
    trackUsage("deal_updated", "deal", editId);
    setModal(null); setFormData({}); setEditId(null);
    addToast("success", "Deal updated");
  };

  // DELETE handlers
  const handleDeleteContact = (id: number) => {
    const c = contacts.find(x => x.id === id);
    const snapshot = [...contacts];
    setContacts(prev => prev.filter(x => x.id !== id));
    setUndoActions(prev => [...prev, {
      id: Date.now(), message: `${c?.name || "Contact"} deleted`,
      undo: () => setContacts(snapshot), expiresAt: Date.now() + 8000,
    }]);
  };

  const handleDeleteDeal = (id: number) => {
    const d = deals.find(x => x.id === id);
    const snapshot = [...deals];
    setDeals(prev => prev.filter(x => x.id !== id));
    setUndoActions(prev => [...prev, {
      id: Date.now(), message: `Deal "${d?.title || ""}" deleted`,
      undo: () => setDeals(snapshot), expiresAt: Date.now() + 8000,
    }]);
  };

  const handleDeleteTask = (id: number) => {
    const snapshot = [...tasks];
    setTasks(prev => prev.filter(t => t.id !== id));
    setUndoActions(prev => [...prev, {
      id: Date.now(), message: "Task deleted",
      undo: () => setTasks(snapshot), expiresAt: Date.now() + 8000,
    }]);
  };

  const handleDeleteNote = (id: number) => {
    const snapshot = [...notes];
    setNotes(prev => prev.filter(n => n.id !== id));
    setUndoActions(prev => [...prev, {
      id: Date.now(), message: "Note deleted",
      undo: () => setNotes(snapshot), expiresAt: Date.now() + 8000,
    }]);
  };

  // Deal clone
  const handleCloneDeal = (deal: Deal) => {
    const cloned: Deal = {
      ...deal, id: Date.now(), title: `${deal.title} (Copy)`,
      stage: "Lead", probability: 10, daysInStage: 0,
    };
    setDeals(prev => [...prev, cloned]);
    addToast("success", `Deal "${cloned.title}" cloned`);
  };

  // Deal stage change with undo + automation triggers
  const handleDealStageChangeWithUndo = (dealId: number, newStage: string) => {
    const deal = deals.find(d => d.id === dealId);
    const oldStage = deal?.stage;
    setDeals(prev => prev.map(d => d.id === dealId ? { ...d, stage: newStage, daysInStage: 0 } : d));
    addToast("success", `Deal moved to ${newStage}`);

    if (newStage === "Closed Won" && deal) {
      postCrmEvent("deal-won", {
        dealId: deal.id,
        title: deal.title,
        value: deal.value,
        contact: deal.contact,
      });
    }

    // Check automations
    automations.filter(a => a.active).forEach(a => {
      let shouldFire = false;
      if (a.trigger === "deal_moved") shouldFire = true;
      if (a.trigger === "deal_won" && newStage === "Closed Won") shouldFire = true;
      if (a.trigger === "deal_lost" && newStage === "Closed Lost") shouldFire = true;
      if (shouldFire && deal) {
        if (a.action === "create_task") {
          const newTask: Task = {
            id: Date.now() + Math.random(), title: a.actionDetail || `Follow up: ${deal.title}`,
            contact: deal.contact, due: new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10),
            priority: "High", done: false,
          };
          setTasks(prev => [...prev, newTask]);
          addToast("info", `⚡ Automation: Task created for "${deal.title}"`);
        } else if (a.action === "notify") {
          addToast("info", `⚡ Automation: ${a.actionDetail || a.actionLabel}`);
        }
        setAutomations(prev => prev.map(x => x.id === a.id ? { ...x, runCount: x.runCount + 1, lastRun: new Date().toISOString().slice(0, 10) } : x));
      }
    });

    // Add undo for Closed Lost
    if (newStage === "Closed Lost" && oldStage) {
      setUndoActions(prev => [...prev, {
        id: Date.now(), message: `"${deal?.title}" moved to Closed Lost`,
        undo: () => setDeals(p => p.map(d => d.id === dealId ? { ...d, stage: oldStage, daysInStage: deal?.daysInStage || 0 } : d)),
        expiresAt: Date.now() + 10000,
      }]);
    }
  };

  // CSV IMPORT/EXPORT
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleExportContacts = () => {
    const csv = contactsToCsv(contacts);
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "contacts.csv"; a.click();
    URL.revokeObjectURL(url);
    addToast("success", "Contacts exported");
  };

  const handleExportDeals = () => {
    const csv = dealsToCsv(deals);
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "deals.csv"; a.click();
    URL.revokeObjectURL(url);
    addToast("success", "Deals exported");
  };

  const applyWorkspaceState = useCallback((state: CrmWorkspaceState) => {
    if (state.contacts) setContacts(state.contacts as Contact[]);
    if (state.deals) setDeals(state.deals as Deal[]);
    if (state.notes) setNotes(state.notes as Note[]);
    if (state.tasks) setTasks(state.tasks as Task[]);
    if (state.companies) setCompanies(state.companies as Company[]);
    if (state.goals) setGoals(state.goals as Goal[]);
    if (state.sequences) setSequences(state.sequences as Sequence[]);
    if (state.sequenceEnrollments) setSequenceEnrollments(state.sequenceEnrollments as SequenceEnrollment[]);
    if (state.submissions) setSubmissions(state.submissions as Submission[]);
    if (state.quotes) setQuotes(state.quotes as Quote[]);
    if (state.packages) setPackages(state.packages as typeof packages);
    if (state.meetings) setMeetings(state.meetings as Meeting[]);
    if (state.automations) setAutomations(state.automations as Automation[]);
    if (state.emailTemplates) setEmailTemplates(state.emailTemplates as EmailTemplate[]);
    if (state.emailLog) setEmailLog(state.emailLog as EmailLogEntry[]);
    if (state.auditLog) setAuditLog(state.auditLog as AuditEntry[]);
    if (state.noteBoards) setNoteBoards(state.noteBoards);
    if (state.industryConfig) setIndustryConfigRaw(state.industryConfig as IndustryConfig);
    if (state.contactGroups) setContactGroups(state.contactGroups as import("./ContactGroups").ContactGroup[]);
    if (state.contactGroupMap) setContactGroupMap(state.contactGroupMap);
    if (state.crmQuotas) setCrmQuotas(state.crmQuotas as Quota[]);
    if (state.userPrefs) setUserPrefs(state.userPrefs as Record<string, unknown>);
    if (state.onboarding) setOnboarding(state.onboarding as Record<string, unknown>);
    if (state.availability) setAvailability(state.availability as typeof initialAvailability);
    if (state.integrations) setIntegrations(state.integrations as Record<string, unknown>);
    if (state.supportTickets) setSupportTickets(state.supportTickets as SupportTicket[]);
    if (state.marketingCampaigns) setMarketingCampaigns(state.marketingCampaigns as MarketingCampaign[]);
    if (state.teamPolicy) setTeamPolicy(state.teamPolicy as TeamPolicy);
    if (state.usageLog) setUsageLog(state.usageLog as UsageLogEntry[]);
    if (state.intakeQuestions) setIntakeQuestions(state.intakeQuestions as IntakeQuestion[]);
    markCrmUserEdited();
  }, [setContacts, setDeals, setNotes, setTasks, setCompanies, setGoals, setSequences, setSequenceEnrollments, setSubmissions, setQuotes, setPackages, setMeetings, setAutomations, setEmailTemplates, setEmailLog, setAuditLog, setNoteBoards, setIndustryConfigRaw, setContactGroups, setContactGroupMap, setCrmQuotas, setUserPrefs, setOnboarding, setAvailability, setIntegrations, setSupportTickets, setMarketingCampaigns, setTeamPolicy, setUsageLog, setIntakeQuestions]);

  const handleRestoreWorkspace = useCallback((imported: CrmWorkspaceState, mode: RestoreMode) => {
    const next = restoreWorkspace(workspaceSnapshot, imported, mode);
    applyWorkspaceState(next);
    setAuditLog((prev) => appendAudit(prev, {
      user: denizenProfile.name,
      action: mode === "replace" ? "restored (replace)" : "restored (merge)",
      entity: "workspace",
      entityName: "JSON backup",
    }));
    addToast("success", mode === "replace" ? "Workspace replaced from backup" : "Backup merged into workspace");
  }, [workspaceSnapshot, applyWorkspaceState, denizenProfile.name, addToast]);

  const handleClearEntity = useCallback((entity: ClearableEntity) => {
    const clearMap: Record<ClearableEntity, () => void> = {
      contacts: () => setContacts([]),
      deals: () => setDeals([]),
      notes: () => setNotes([]),
      tasks: () => setTasks([]),
      companies: () => setCompanies([]),
      submissions: () => setSubmissions([]),
      quotes: () => setQuotes([]),
      meetings: () => setMeetings([]),
      emailLog: () => setEmailLog([]),
      auditLog: () => setAuditLog([]),
    };
    clearMap[entity]?.();
    markCrmUserEdited();
    if (entity !== "auditLog") {
      setAuditLog((prev) => appendAudit(prev, {
        user: denizenProfile.name,
        action: "cleared",
        entity,
        entityName: entity,
      }));
    }
    addToast("info", `Cleared ${entity}`);
  }, [denizenProfile.name, addToast]);

  const handleImportContacts = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const auto = parseCsvAuto(ev.target?.result as string, industryConfig.customFields);
      if (auto.kind === "deals") {
        if (auto.deals.length === 0) { addToast("error", "No valid deals found in CSV"); return; }
        const newDeals = auto.deals.map((d, i) => ({
          title: "", contact: "", value: 0, stage: "Lead", probability: 25,
          closeDate: new Date().toISOString().slice(0, 10), daysInStage: 0, health: "good",
          ...d, id: Date.now() + i,
        } as Deal));
        setDeals((prev) => [...prev, ...newDeals]);
        addToast("success", `${newDeals.length} deals imported`);
      } else {
        if (auto.contacts.length === 0) { addToast("error", "No valid contacts found in CSV"); return; }
        const newContacts = auto.contacts.map((c, i) => ({
          name: "", company: "", email: "", phone: "", status: "Lead", tags: [] as string[],
          score: 50, lastContact: new Date().toISOString().slice(0, 10), interactions: 0,
          ...c, id: Date.now() + i,
        } as Contact));
        setContacts((prev) => [...prev, ...newContacts]);
        addToast("success", `${newContacts.length} contacts imported`);
      }
    };
    reader.readAsText(file);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const closeModal = () => { setModal(null); setFormData({}); setEditId(null); setSelectedGroupIds([]); setInlineNewGroup(false); setInlineGroupName(""); };

  const editionLabels: Record<string, string> = {
    sales: "Sales Cloud Edition",
    saas: "SaaS Cloud Edition",
    iaas: "Infrastructure Cloud Edition",
    govcon: "Public Sector Cloud Edition",
    cybersecurity: "Security Cloud Edition",
    msp: "MSP Cloud Edition",
    telecom: "Communications Cloud Edition",
    "energy-utilities": "Energy & Utilities Cloud Edition",
    ecommerce: "Commerce Cloud Edition",
    "aerospace-defense": "Defense Cloud Edition",
    "pharma-life-sciences": "Life Sciences Cloud Edition",
    "property-management": "Property Cloud Edition",
    franchise: "Franchise Cloud Edition",
    staffing: "Staffing Cloud Edition",
    healthcare: "Health Cloud Edition",
    "financial-services": "Financial Services Cloud Edition",
    nonprofit: "Nonprofit Cloud Edition",
    education: "Education Cloud Edition",
    manufacturing: "Manufacturing Cloud Edition",
    retail: "Retail Cloud Edition",
    "real-estate": "Real Estate Edition",
    legal: "Legal Cloud Edition",
    consulting: "Consulting Edition",
    recruitment: "Recruiting Edition",
    media: "Media Cloud Edition",
    custom: "Custom Edition",
  };
  const editionTitle = `Meridian — ${editionLabels[industryConfig.id] || `${industryConfig.name} Edition`}`;

  const fabItems = [
    { icon: "◉", label: `Create ${term.contact}`, key: "add-contact", color: T.blue },
    { icon: "◆", label: `New ${term.deal}`, key: "add-deal", color: T.accent },
    { icon: "✎", label: "Log Interaction", key: "add-note", color: T.purple },
    { icon: "◇", label: `New Task`, key: "add-task", color: T.green },
  ];

  const SIDEBAR_W = 220;
  const denizenPhoneHref = "/?phone=1";
  const studioBoardHref = "/studio-board/";

  const handleUpdateTask = useCallback((t: Task) => {
    setTasks(prev => {
      const exists = prev.find(x => x.id === t.id);
      if (exists) return prev.map(x => x.id === t.id ? t : x);
      return [...prev, t];
    });
  }, []);

  const role = getRole(activeRole);
  const switchRole = (id: string) => {
    setActiveRole(id);
    const r = getRole(id);
    addToast("info", `${r.icon} ${r.label} view`);
    if (r.defaultTab && r.defaultTab !== tab) handleNavigate(r.defaultTab);
  };

  const isEmptyWorkspace = contacts.length === 0 && deals.length === 0;

  const renderDashboard = () => {
    if (isEmptyWorkspace) {
      return (
        <CrmHomeStart
          mode={workspaceMode}
          syncStatus={syncStatus}
          onAddContact={() => setModal("add-contact")}
          onOpenPipeline={() => handleNavigate("sales")}
          onOpenIntake={() => handleNavigate("intake")}
          onLoadSample={handleLoadDemoData}
          onOpenSetup={() => handleNavigate("onboarding")}
          onOpenTeam={() => handleNavigate("team")}
        />
      );
    }

    return (
    <div>
      <div style={{
        display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap",
        marginBottom: 16, paddingBottom: 14, borderBottom: `1px solid ${T.bg4}`,
      }}>
        <span style={{
          fontSize: 11, fontWeight: 700, letterSpacing: "0.04em",
          padding: "4px 10px", borderRadius: 999,
          background: isTeamMode ? `${T.purple}18` : `${T.blue}18`,
          color: isTeamMode ? T.purple : T.blue,
          border: `1px solid ${isTeamMode ? `${T.purple}33` : `${T.blue}33`}`,
        }}>
          {workspaceModeLabel(workspaceMode)}
        </span>
        <span style={{ fontSize: 11, fontWeight: 700, color: T.text3, textTransform: "uppercase", letterSpacing: "0.06em", marginRight: 4 }}>
          Role view
        </span>
        {CRM_ROLES.map((r) => {
          const on = r.id === activeRole;
          return (
            <button
              key={r.id}
              onClick={() => switchRole(r.id)}
              title={r.blurb}
              style={{
                display: "flex", alignItems: "center", gap: 6,
                background: on ? `${r.accent}1f` : T.bg3,
                border: `1px solid ${on ? r.accent : T.bg4}`,
                color: on ? r.accent : T.text2,
                borderRadius: T.radius.full, padding: "6px 12px",
                fontSize: 12.5, fontWeight: on ? 700 : 600, cursor: "pointer",
                transition: "all 0.12s",
              }}
            >
              <span style={{ fontSize: 14 }}>{r.icon}</span>{r.label}
            </button>
          );
        })}
      </div>
      <div style={{ marginBottom: 14 }}>
        <h1 style={{ margin: 0, fontSize: 28, fontWeight: 600, color: T.text0, fontFamily: "var(--crm-display)", letterSpacing: "-0.02em" }}>
          {role.label}
        </h1>
        <p style={{ margin: "4px 0 0", fontSize: 13, color: T.text2 }}>{role.blurb}</p>
      </div>
      <MyWorkPanel
        userName={denizenProfile.name}
        deals={deals}
        tasks={tasks}
        tickets={supportTickets}
        isTeamMode={isTeamMode}
        onNavigate={handleNavigate}
      />
      <RoleDashboard
        roleId={activeRole}
        contacts={contacts}
        deals={deals}
        tasks={tasks}
        notes={notes}
        meetings={meetings}
        goals={goals}
        auditLog={auditLog}
        emailLog={emailLog}
        sequences={sequences}
        sequenceEnrollments={sequenceEnrollments}
        submissions={submissions}
        companies={companies}
        onNavigate={handleNavigate}
      />
    </div>
    );
  };

  const renderTab = () => (
    <LazyTab>
    {(() => { switch (tab) {
      case "dashboard": return renderDashboard();
      case "companies": return <CompaniesTab companies={companies} contacts={contacts} deals={deals} onUpdateCompanies={setCompanies} />;
      case "sequences": return (
        <SequencesTab
          sequences={sequences}
          contacts={contacts}
          enrollments={sequenceEnrollments}
          onUpdateSequences={setSequences}
          onEnrolled={refreshWorkspaceFromServer}
          onCompose={(contactId) => openCompose({ contactId })}
        />
      );
      case "contacts": return <ContactsTab contacts={contacts} onSelectContact={setContactDrawer} onEditContact={openEditContact} onDeleteContact={handleDeleteContact} onExport={handleExportContacts} onImport={() => fileInputRef.current?.click()} groups={contactGroups} contactGroupMap={contactGroupMap} onCreateGroup={(g) => { setContactGroups(p => [...p, g]); addToast("success", `Group "${g.name}" created`); }} onEditGroup={(g) => { setContactGroups(p => p.map(x => x.id === g.id ? g : x)); addToast("success", `Group "${g.name}" updated`); }} onDeleteGroup={(id) => { setContactGroups(p => p.filter(x => x.id !== id)); setContactGroupMap(p => { const next = { ...p }; Object.keys(next).forEach(k => { next[Number(k)] = next[Number(k)].filter(gId => gId !== id); }); return next; }); addToast("info", "Group deleted"); }} onToggleContactGroup={(cId, gId) => { setContactGroupMap(p => { const current = p[cId] || []; return { ...p, [cId]: current.includes(gId) ? current.filter(x => x !== gId) : [...current, gId] }; }); }} />;
      /* CONSOLIDATED: Sales section (Lead Gen + Pipeline + Sales Hub + Quotas) */
      case "sales": return <SalesSection deals={deals} contacts={contacts} notes={notes} emailLog={emailLog} tasks={tasks} leadModelState={leadModelState} onLeadModelStateChange={setLeadModelState} auditLog={auditLog} dealComments={dealComments} onAddDealComment={(c) => setDealComments((prev) => [c, ...prev])} currentUserName={denizenProfile.name} quotas={crmQuotas} onUpdateQuotas={setCrmQuotas} onDealStageChange={handleDealStageChange} onEditDeal={openEditDeal} onDeleteDeal={handleDeleteDeal} industryConfig={industryConfig} isMobile={isMobile} initialTab={navSubTab} onSubTabChange={setNavSubTab} />;
      /* CONSOLIDATED: Schedule section (Tasks & Meetings + Calendar + Interactions) */
      case "schedule": return <ScheduleSection tasks={tasks} deals={deals} meetings={meetings} contacts={contacts} notes={notes} availability={availability} onToggleTask={handleToggleTask} onDeleteTask={handleDeleteTask} onUpdateTask={handleUpdateTask} onAddMeeting={(m) => setMeetings(prev => [...prev, {
        ...m,
        ownerId: m.ownerId || denizenProfile.name,
        ownerName: m.ownerName || denizenProfile.name,
        ownerIdentityId: m.ownerIdentityId || selfIdentityId || undefined,
        visibility: m.visibility || "team",
      }])} onUpdateMeeting={(m) => setMeetings(prev => prev.map(x => x.id === m.id ? {
        ...m,
        ownerId: m.ownerId || x.ownerId || denizenProfile.name,
        ownerName: m.ownerName || x.ownerName || denizenProfile.name,
        ownerIdentityId: m.ownerIdentityId || x.ownerIdentityId || selfIdentityId || undefined,
        visibility: m.visibility || x.visibility || "team",
      } : x))} onDeleteNote={handleDeleteNote} onNavigate={handleNavigate} onCalendarSync={refreshWorkspaceFromServer} initialTab={navSubTab} onSubTabChange={setNavSubTab} />;
      case "notes": return (
        <NotesTab
          boards={noteBoards as Board[]}
          onBoardsChange={setNoteBoards}
          currentUserName={denizenProfile.name}
          teamMembers={teamMemberNames}
        />
      );
      case "packages": return <PackagesTab packages={packages} quotes={quotes} onUpdatePackages={setPackages} onAddQuote={handleAddQuote} contacts={contacts} />;
      case "intake": return <IntakeTab submissions={submissions} quotes={quotes} packages={packages} branding={initialBranding} intakeQuestions={intakeQuestions} orgSlug={orgLabel} onStatusChange={handleSubmissionStatus} onAddSubmission={handleAddSubmission} onAddQuote={handleAddQuote} onImportSubmissions={handleImportSubmissions} onUpdateIntakeQuestions={setIntakeQuestions} />;
      case "tasks": return <TasksTab tasks={tasks} teamMembers={teamMemberNames} currentUserName={denizenProfile.name} onToggleTask={handleToggleTask} onDeleteTask={handleDeleteTask} onUpdateTask={(t) => setTasks(prev => prev.map(x => x.id === t.id ? t : x))} />;
      case "analytics": return <AnalyticsTab deals={deals} contacts={contacts} metricSnapshots={metricSnapshots} />;
      case "ai-prospector": return <AIProspector onImportLead={handleProspectorImport} />;
      case "ai": return <AITab contacts={contacts} deals={deals} tasks={tasks} workspace={workspaceSnapshot} aiThreads={aiThreads} onSaveAiThreads={setAiThreads} userName={denizenProfile.name} userEmail={selfEmail} teamMembers={crmTeam} defaultNpcKey={claimedNpcKey} onNavigate={handleNavigate} onCreateTask={handleAiCreateTask} />;
      case "onboarding": return (
        <OnboardingTab
          contacts={contacts}
          deals={deals}
          packages={packages}
          submissions={submissions}
          profile={denizenProfile}
          industryConfig={industryConfig}
          onboarding={onboarding}
          onUpdateOnboarding={setOnboarding}
          onNavigate={handleNavigate}
        />
      );
      case "portal": return <ClientPortalTab quotes={quotes} packages={packages} />;
      case "email-templates": return (
        <EmailTemplatesTab
          templates={emailTemplates}
          onSave={setEmailTemplates}
          onCompose={(templateId) => openCompose(templateId ? { templateId } : undefined)}
        />
      );
      case "automations": return <AutomationsTab automations={automations} automationRuns={automationRuns} onUpdate={setAutomations} />;
      case "support": return (
        <SupportTab
          tickets={supportTickets}
          contacts={contacts}
          currentUserName={denizenProfile.name}
          teamMembers={teamMemberNames}
          onUpdate={handleSupportTicketsUpdate}
          onSelectContact={setContactDrawer}
        />
      );
      case "marketing": return (
        <MarketingTab
          campaigns={marketingCampaigns}
          contacts={contacts}
          deals={deals}
          notes={notes}
          tasks={tasks}
          emailLog={emailLog}
          sequences={sequences}
          contactGroups={contactGroups}
          contactGroupMap={contactGroupMap}
          currentUserName={denizenProfile.name}
          onUpdateCampaigns={handleMarketingCampaignsUpdate}
          onNavigate={handleNavigate}
        />
      );
      case "team": return (
        <TeamTab
          deals={deals}
          contacts={contacts}
          tasks={tasks}
          teamMembers={teamMemberNames}
          teamPolicy={policy}
          usageLog={usageLog}
          currentUserName={denizenProfile.name}
          crmScope={crmScope}
          canManageTeam={canManageTeam}
          onUpdateDeals={(next) => { setDeals(next); trackUsage("bulk_assign_deals", "deal"); }}
          onUpdateTasks={(next) => { setTasks(next); trackUsage("bulk_create_tasks", "task"); }}
          onUpdatePolicy={(p) => { setTeamPolicy(p); trackUsage("policy_updated", "team"); }}
        />
      );
      case "data-tools": return (
        <DataToolsTab
          contacts={contacts}
          deals={deals}
          notes={notes}
          tasks={tasks}
          companies={companies}
          auditLog={auditLog}
          workspace={workspaceSnapshot}
          industryConfig={industryConfig}
          userName={denizenProfile.name}
          onSetContacts={setContacts}
          onSetDeals={setDeals}
          onSetNotes={setNotes}
          onSetTasks={setTasks}
          onSetCompanies={setCompanies}
          onSetAuditLog={setAuditLog}
          onRestoreWorkspace={handleRestoreWorkspace}
          onClearEntity={handleClearEntity}
          onLoadDemoData={handleLoadDemoData}
          onNavigate={handleNavigate}
        />
      );
      case "settings": return (
        <SettingsTab
          industryConfig={industryConfig}
          onUpdateConfig={handleUpdateIndustryConfig}
          profile={denizenProfile}
          userPrefs={userPrefs}
          onSaveUserPrefs={setUserPrefs}
          integrations={integrations}
          onSaveIntegrations={setIntegrations}
          availability={availability}
          onSaveAvailability={setAvailability}
          onLoadDemoData={handleLoadDemoData}
        />
      );
      default: return renderDashboard();
    } })()}
    </LazyTab>
  );

  const currentNavItem = NAV_ITEMS.find(n => n.id === tab);

  const contactSelect = (key: string, label: string) => (
    <div style={{ marginBottom: 12 }}>
      <label style={S.label as React.CSSProperties}>{label}</label>
      <select value={formData[key] || ""} onChange={e => setFormData(p => ({ ...p, [key]: e.target.value }))} style={S.input as React.CSSProperties}>
        <option value="">Select {term.contact.toLowerCase()}…</option>
        {contacts.map(c => <option key={c.id} value={c.name}>{c.name} — {c.company}</option>)}
      </select>
    </div>
  );

  return (
    <IndustryConfigBridge config={industryConfig}>
    <div style={{ display: "flex", height: "100vh", background: T.bg0, overflow: "hidden" }}>
      <input ref={fileInputRef} type="file" accept=".csv" onChange={handleImportContacts} style={{ display: "none" }} />

      {/* MOBILE HEADER */}
      {isMobile && (
        <div style={{
          position: "fixed", top: 0, left: 0, right: 0, zIndex: 850,
          background: T.bg1, borderBottom: `1px solid ${T.bg4}`,
          display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", height: 52,
        }}>
          <a
            href={denizenPhoneHref}
            title="Back to Denizen phone"
            style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              width: 32, height: 32, borderRadius: T.radius.sm,
              border: `1px solid ${T.bg4}`, background: T.bg3,
              color: T.accent, fontSize: 15, textDecoration: "none", flexShrink: 0,
            }}
          >⬡</a>
          <button onClick={() => setSidebarOpen(p => !p)} style={{ background: "none", border: "none", color: T.text1, fontSize: 20, cursor: "pointer", padding: "2px 4px" }}>☰</button>
          <div style={{
            width: 24, height: 24, borderRadius: T.radius.sm,
            background: `linear-gradient(135deg,${T.accent},#d97706)`,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 11, fontWeight: 900, color: "#080d18",
          }}>M</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: T.text0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {currentNavItem?.label || "Meridian"}
            </div>
            <div style={{ fontSize: 8, fontWeight: 600, color: T.text2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {editionTitle.replace("Meridian — ", "")}
            </div>
          </div>
          <NotificationBell deals={deals} tasks={tasks} onClick={() => setNotificationsOpen(true)} />
          <button onClick={() => setCmdOpen(true)} style={{
            background: T.bg3, border: `1px solid ${T.bg4}`, borderRadius: T.radius.sm,
            padding: "4px 8px", color: T.text3, fontSize: 14, cursor: "pointer",
          }}>⌘</button>
        </div>
      )}

      {/* SIDEBAR OVERLAY — swipe-to-close support */}
      {isMobile && sidebarOpen && (
        <div
          onClick={() => setSidebarOpen(false)}
          className="animate-fade-in"
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 899, backdropFilter: "blur(4px)",
          }}
        />
      )}

      {/* SIDEBAR — with touch swipe-to-close */}
      <aside
        onTouchStart={isMobile ? (e) => {
          const touch = e.touches[0];
          (e.currentTarget as any)._swipeStartX = touch.clientX;
          (e.currentTarget as any)._swipeStartY = touch.clientY;
        } : undefined}
        onTouchMove={isMobile ? (e) => {
          const startX = (e.currentTarget as any)._swipeStartX;
          const startY = (e.currentTarget as any)._swipeStartY;
          if (startX == null) return;
          const dx = e.touches[0].clientX - startX;
          const dy = Math.abs(e.touches[0].clientY - startY);
          // Only track horizontal swipes left
          if (dx < -30 && dy < 50) {
            setSidebarOpen(false);
            (e.currentTarget as any)._swipeStartX = null;
          }
        } : undefined}
        style={{
          width: SIDEBAR_W, flexShrink: 0, background: T.bg1,
          borderRight: `1px solid ${T.bg4}`, display: "flex", flexDirection: "column",
          padding: "16px 12px",
          ...(isMobile ? {
            position: "fixed", top: 0, left: 0, bottom: 0, zIndex: 900,
            transform: sidebarOpen ? "translateX(0)" : "translateX(-100%)",
            transition: "transform 0.2s ease",
            boxShadow: sidebarOpen ? "4px 0 20px rgba(0,0,0,0.5)" : "none",
          } : {}),
        }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 8px", marginBottom: 20 }}>
          <div style={{
            width: 28, height: 28, borderRadius: T.radius.md,
            background: `linear-gradient(135deg,${T.accent},#d97706)`,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 14, fontWeight: 900, color: "#080d18",
          }}>M</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: T.text0, letterSpacing: "-0.02em" }}>Meridian</div>
            <div style={{
              fontSize: 9, fontWeight: 600, color: T.text2, marginTop: 2,
              padding: "2px 6px", borderRadius: 4, display: "inline-block",
              background: `${T.purple}18`, border: `1px solid ${T.purple}33`,
              letterSpacing: "0.04em", maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }} title={editionTitle}>
              {editionTitle.replace("Meridian — ", "")}
            </div>
          </div>
          {!isMobile && <NotificationBell deals={deals} tasks={tasks} onClick={() => setNotificationsOpen(true)} />}
          {isMobile && (
            <button onClick={() => setSidebarOpen(false)} style={{ background: "none", border: "none", color: T.text3, fontSize: 18, cursor: "pointer" }}>✕</button>
          )}
        </div>

        <button onClick={() => { setCmdOpen(true); if (isMobile) setSidebarOpen(false); }} style={{
          display: "flex", alignItems: "center", gap: 8, width: "100%",
          background: T.bg3, border: `1px solid ${T.bg4}`, borderRadius: T.radius.md,
          padding: "8px 12px", marginBottom: 16, cursor: "pointer", color: T.text3, fontSize: 12,
        }}>
          <span>⌘</span>
          <span style={{ flex: 1, textAlign: "left" }}>Search…</span>
          <span style={{ fontSize: 10, background: T.bg4, padding: "1px 5px", borderRadius: 3 }}>K</span>
        </button>

        {/* REFACTORED: Collapsible sidebar groups with dividers, count badges, tooltips */}
        <CollapsibleSidebar
          tab={tab}
          isMobile={isMobile}
          contacts={contacts}
          deals={deals}
          tasks={tasks}
          onNavigate={handleNavigate}
        />

        <div style={{
          marginTop: 8,
          padding: "8px 10px",
          borderRadius: T.radius.sm,
          border: `1px solid ${T.bg4}`,
          background: T.bg3,
          fontSize: 10,
          lineHeight: 1.4,
        }}>
          <div style={{
            fontWeight: 700,
            color: isTeamMode ? T.purple : T.blue,
            marginBottom: 2,
          }}>
            {workspaceModeLabel(workspaceMode)}
          </div>
          <div style={{
            color: syncStatus === "error" ? T.red : syncStatus === "no-session" || syncStatus === "draft" ? T.text3 : T.green,
          }}>
            {syncLabel}
          </div>
        </div>

        <a
          href={studioBoardHref}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginTop: 8,
            padding: "10px 12px",
            borderRadius: T.radius.md,
            border: `1px solid ${T.bg4}`,
            background: T.bg2,
            color: T.text2,
            fontSize: 12,
            fontWeight: 600,
            textDecoration: "none",
          }}
        >
          <span style={{ fontSize: 14, color: T.accent }}>▦</span>
          <span>Studio Board</span>
        </a>

        <a
          href={denizenPhoneHref}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginTop: 8,
            padding: "10px 12px",
            borderRadius: T.radius.md,
            border: `1px solid ${T.bg4}`,
            background: T.bg2,
            color: T.text2,
            fontSize: 12,
            fontWeight: 600,
            textDecoration: "none",
          }}
        >
          <span style={{ fontSize: 14, color: T.accent }}>⬡</span>
          <span>Back to Denizen Phone</span>
        </a>

        <div style={{
          display: "flex", alignItems: "center", gap: 10, padding: "12px 8px",
          borderTop: `1px solid ${T.bg4}`, marginTop: 8,
        }}>
          <div style={{
            width: 30, height: 30, borderRadius: T.radius.md,
            background: `linear-gradient(135deg,${T.purple},${T.bg4})`,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 12, fontWeight: 700, color: "#fff",
          }}>{denizenProfile.name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase() || "?"}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: T.text1 }}>{denizenProfile.name}</div>
            <div style={{ fontSize: 10, color: T.text3 }}>{denizenProfile.role}</div>
          </div>
        </div>
      </aside>

      {/* MAIN CONTENT */}
      <main ref={mainRef} style={{
        flex: 1, overflowY: "auto",
        background:
          "radial-gradient(ellipse 90% 50% at 10% -10%, rgba(240,180,41,0.07), transparent 50%)," +
          "radial-gradient(ellipse 70% 40% at 100% 0%, rgba(77,158,247,0.06), transparent 45%)," +
          T.bg0,
        padding: isMobile ? "66px 14px 80px" : "28px 32px",
        ...(isMobile ? { width: "100%" } : {}),
      }}>
        {crmScope === "own" && isTeamMode && (
          <div style={{
            marginBottom: 14,
            padding: "10px 14px",
            borderRadius: 10,
            border: `1px solid ${T.bg3}`,
            background: T.bg2,
            fontSize: 12,
            color: T.text2,
          }}>
            Showing <strong style={{ color: T.text0 }}>your records</strong> in this shared workspace.
            {" "}Open <button type="button" onClick={() => handleNavigate("team")} style={{ background: "none", border: "none", color: T.accent, cursor: "pointer", padding: 0, fontSize: 12 }}>Team activity</button> to see what everyone is doing.
          </div>
        )}
        <div key={tab} className="crm-page-fade">
          {renderTab()}
        </div>
      </main>

      {/* OVERLAYS */}
      <CommandPalette isOpen={cmdOpen} onClose={() => setCmdOpen(false)} contacts={contacts} deals={deals} notes={notes} tasks={tasks} companies={companies} onNavigate={handleNavigate} onSelectContact={setContactDrawer} />
      {contactDrawer && (
        <ContactDrawer
          contact={contactDrawer}
          deals={deals}
          notes={notes}
          tasks={tasks}
          emailLog={emailLog}
          meetings={meetings}
          auditLog={auditLog}
          onClose={() => setContactDrawer(null)}
          onEdit={() => { openEditContact(contactDrawer); setContactDrawer(null); }}
          onSendEmail={(contactId) => openCompose({ contactId })}
          industryConfig={industryConfig}
        />
      )}
      <EmailComposeModal
        open={composeOpen}
        onClose={() => setComposeOpen(false)}
        contacts={contacts}
        deals={deals}
        templates={emailTemplates}
        senderName={denizenProfile.name}
        seed={composeSeed}
        onSent={handleEmailSent}
      />
      <NotificationsPanel isOpen={notificationsOpen} onClose={() => setNotificationsOpen(false)} deals={deals} tasks={tasks} />
      <ActivityFeed
        contacts={contacts}
        deals={deals}
        notes={notes}
        tasks={tasks}
        auditLog={auditLog}
        launcher="none"
        isOpen={activityOpen}
        onOpenChange={setActivityOpen}
        onUnreadChange={setActivityUnread}
      />
      <CrmFloatingDock
        isMobile={isMobile}
        tab={tab}
        fabItems={fabItems}
        fabOpen={fabOpen}
        setFabOpen={setFabOpen}
        onFabSelect={(key) => { setModal(key); setFormData({}); setEditId(null); }}
        activityOpen={activityOpen}
        onActivityToggle={() => setActivityOpen((p) => !p)}
        activityUnread={activityUnread}
        chatUnread={chatUnread}
      />
      <UndoSnackbar actions={undoActions} onDismiss={dismissUndo} />

      {/* MOBILE BOTTOM TAB BAR */}
      {isMobile && <MobileBottomTabBar activeTab={tab} onNavigate={handleNavigate} />}

      {/* MODALS */}
      {modal && (
        <div onClick={closeModal} style={S.modalBg as React.CSSProperties} role="dialog" aria-modal="true">
          <div onClick={e => e.stopPropagation()} className="animate-scale-in" style={{ ...S.modalBox as React.CSSProperties, ...(isMobile ? { width: "100%", margin: "0 8px", padding: 20, maxHeight: "85vh", overflowY: "auto", WebkitOverflowScrolling: "touch" } : {}) }}>
            {modal === "add-contact" && (
              <>
                <h2 style={{ fontSize: 18, fontWeight: 700, color: T.text0, margin: "0 0 20px" }}>New {term.contact}</h2>
                {/* Photo Upload */}
                <div style={{ marginBottom: 16, display: "flex", alignItems: "center", gap: 14 }}>
                  <div style={{ width: 56, height: 56, borderRadius: "50%", background: formData.avatar ? "none" : T.bg4, overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, fontWeight: 700, color: T.text3, flexShrink: 0, border: `2px dashed ${T.bg5}` }}>
                    {formData.avatar ? <img src={formData.avatar} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : "📷"}
                  </div>
                  <div>
                    <label style={{ display: "inline-block", background: T.bg3, border: `1px solid ${T.bg4}`, borderRadius: T.radius.sm, padding: "6px 12px", color: T.accent, fontSize: 11, cursor: "pointer", fontWeight: 600 }}>
                      Upload Photo
                      <input type="file" accept="image/*" style={{ display: "none" }} onChange={e => { const file = e.target.files?.[0]; if (file) { const reader = new FileReader(); reader.onload = () => setFormData(p => ({ ...p, avatar: reader.result as string })); reader.readAsDataURL(file); } }} />
                    </label>
                    {formData.avatar && <button onClick={() => setFormData(p => ({ ...p, avatar: "" }))} style={{ background: "none", border: "none", color: T.red, fontSize: 11, cursor: "pointer", marginLeft: 8 }}>Remove</button>}
                    <div style={{ fontSize: 10, color: T.text3, marginTop: 4 }}>JPG, PNG · Max 2MB</div>
                  </div>
                </div>
                {[["name", "Name *", "text"], ["email", "Email", "email"], ["company", "Company", "text"], ["phone", "Phone", "tel"]].map(([key, label, type]) => (
                  <div key={key} style={{ marginBottom: 12 }}>
                    <label style={S.label as React.CSSProperties}>{label}</label>
                    <input value={formData[key] || ""} onChange={e => setFormData(p => ({ ...p, [key]: e.target.value }))} style={S.input as React.CSSProperties} type={type} />
                  </div>
                ))}
                <div style={{ marginBottom: 12 }}>
                  <label style={S.label as React.CSSProperties}>Status</label>
                  <select value={formData.status || industryConfig.contactStatuses[0] || "Lead"} onChange={e => setFormData(p => ({ ...p, status: e.target.value }))} style={S.input as React.CSSProperties}>
                    {industryConfig.contactStatuses.map(s => <option key={s}>{s}</option>)}
                  </select>
                </div>
                <div style={{ marginBottom: 12 }}>
                  <label style={S.label as React.CSSProperties}>Follow-up Frequency</label>
                  <select value={formData.contactFrequency || ""} onChange={e => setFormData(p => ({ ...p, contactFrequency: e.target.value }))} style={S.input as React.CSSProperties}>
                    <option value="">Select frequency…</option>
                    {CONTACT_FREQUENCIES.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
                  </select>
                </div>
                {renderCustomFields("contact")}
                {/* Group Assignment */}
                <div style={{ marginBottom: 12 }}>
                  <label style={S.label as React.CSSProperties}>Groups</label>
                  {contactGroups.length > 0 && (
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
                      {contactGroups.map(g => {
                        const active = selectedGroupIds.includes(g.id);
                        return (
                          <button key={g.id} onClick={() => setSelectedGroupIds(p => active ? p.filter(x => x !== g.id) : [...p, g.id])} style={{
                            display: "flex", alignItems: "center", gap: 5, padding: "5px 10px", borderRadius: T.radius.sm,
                            background: active ? `${g.color}22` : T.bg3, color: active ? g.color : T.text2,
                            border: `1px solid ${active ? `${g.color}66` : T.bg4}`, fontSize: 12, cursor: "pointer", fontWeight: active ? 600 : 400,
                          }}>
                            <div style={{ width: 8, height: 8, borderRadius: 2, background: g.color }} />
                            {g.name}
                            {active && <span style={{ marginLeft: 2 }}>✓</span>}
                          </button>
                        );
                      })}
                    </div>
                  )}
                  {!inlineNewGroup ? (
                    <button onClick={() => setInlineNewGroup(true)} style={{ background: "none", border: `1px dashed ${T.bg5}`, borderRadius: T.radius.sm, padding: "5px 10px", color: T.accent, fontSize: 11, cursor: "pointer" }}>+ New Group</button>
                  ) : (
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <input value={inlineGroupName} onChange={e => setInlineGroupName(e.target.value)} placeholder="Group name…" style={{ ...S.input as React.CSSProperties, flex: 1 }} />
                      <button onClick={() => { if (!inlineGroupName.trim()) return; const ng = { id: Date.now(), name: inlineGroupName.trim(), color: "#f0b429", description: "" }; setContactGroups(p => [...p, ng]); setSelectedGroupIds(p => [...p, ng.id]); setInlineNewGroup(false); setInlineGroupName(""); addToast("success", `Group "${ng.name}" created`); }} style={{ ...S.btn as React.CSSProperties, padding: "6px 12px", fontSize: 11 }}>Add</button>
                      <button onClick={() => { setInlineNewGroup(false); setInlineGroupName(""); }} style={{ background: "none", border: "none", color: T.text3, cursor: "pointer", fontSize: 14 }}>✕</button>
                    </div>
                  )}
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
                  <button onClick={handleAddContact} style={S.btn as React.CSSProperties}>Add {term.contact}</button>
                  <button onClick={closeModal} style={S.btnGhost as React.CSSProperties}>Cancel</button>
                </div>
              </>
            )}
            {modal === "edit-contact" && (
              <>
                <h2 style={{ fontSize: 18, fontWeight: 700, color: T.text0, margin: "0 0 20px" }}>Edit {term.contact}</h2>
                {/* Photo Upload */}
                <div style={{ marginBottom: 16, display: "flex", alignItems: "center", gap: 14 }}>
                  <div style={{ width: 56, height: 56, borderRadius: "50%", background: formData.avatar ? "none" : T.bg4, overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, fontWeight: 700, color: T.text3, flexShrink: 0, border: `2px dashed ${T.bg5}` }}>
                    {formData.avatar ? <img src={formData.avatar} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : (formData.name?.[0] || "📷")}
                  </div>
                  <div>
                    <label style={{ display: "inline-block", background: T.bg3, border: `1px solid ${T.bg4}`, borderRadius: T.radius.sm, padding: "6px 12px", color: T.accent, fontSize: 11, cursor: "pointer", fontWeight: 600 }}>
                      Upload Photo
                      <input type="file" accept="image/*" style={{ display: "none" }} onChange={e => { const file = e.target.files?.[0]; if (file) { const reader = new FileReader(); reader.onload = () => setFormData(p => ({ ...p, avatar: reader.result as string })); reader.readAsDataURL(file); } }} />
                    </label>
                    {formData.avatar && <button onClick={() => setFormData(p => ({ ...p, avatar: "" }))} style={{ background: "none", border: "none", color: T.red, fontSize: 11, cursor: "pointer", marginLeft: 8 }}>Remove</button>}
                    <div style={{ fontSize: 10, color: T.text3, marginTop: 4 }}>JPG, PNG · Max 2MB</div>
                  </div>
                </div>
                {[["name", "Name *", "text"], ["email", "Email", "email"], ["company", "Company", "text"], ["phone", "Phone", "tel"]].map(([key, label, type]) => (
                  <div key={key} style={{ marginBottom: 12 }}>
                    <label style={S.label as React.CSSProperties}>{label}</label>
                    <input value={formData[key] || ""} onChange={e => setFormData(p => ({ ...p, [key]: e.target.value }))} style={S.input as React.CSSProperties} type={type} />
                  </div>
                ))}
                <div style={{ marginBottom: 12 }}>
                  <label style={S.label as React.CSSProperties}>Status</label>
                  <select value={formData.status || industryConfig.contactStatuses[0] || "Lead"} onChange={e => setFormData(p => ({ ...p, status: e.target.value }))} style={S.input as React.CSSProperties}>
                    {industryConfig.contactStatuses.map(s => <option key={s}>{s}</option>)}
                  </select>
                </div>
                <div style={{ marginBottom: 12 }}>
                  <label style={S.label as React.CSSProperties}>Follow-up Frequency</label>
                  <select value={formData.contactFrequency || ""} onChange={e => setFormData(p => ({ ...p, contactFrequency: e.target.value }))} style={S.input as React.CSSProperties}>
                    <option value="">Select frequency…</option>
                    {CONTACT_FREQUENCIES.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
                  </select>
                </div>
                {renderCustomFields("contact")}
                {/* Group Assignment */}
                <div style={{ marginBottom: 12 }}>
                  <label style={S.label as React.CSSProperties}>Groups</label>
                  {contactGroups.length > 0 && (
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
                      {contactGroups.map(g => {
                        const active = selectedGroupIds.includes(g.id);
                        return (
                          <button key={g.id} onClick={() => setSelectedGroupIds(p => active ? p.filter(x => x !== g.id) : [...p, g.id])} style={{
                            display: "flex", alignItems: "center", gap: 5, padding: "5px 10px", borderRadius: T.radius.sm,
                            background: active ? `${g.color}22` : T.bg3, color: active ? g.color : T.text2,
                            border: `1px solid ${active ? `${g.color}66` : T.bg4}`, fontSize: 12, cursor: "pointer", fontWeight: active ? 600 : 400,
                          }}>
                            <div style={{ width: 8, height: 8, borderRadius: 2, background: g.color }} />
                            {g.name}
                            {active && <span style={{ marginLeft: 2 }}>✓</span>}
                          </button>
                        );
                      })}
                    </div>
                  )}
                  {!inlineNewGroup ? (
                    <button onClick={() => setInlineNewGroup(true)} style={{ background: "none", border: `1px dashed ${T.bg5}`, borderRadius: T.radius.sm, padding: "5px 10px", color: T.accent, fontSize: 11, cursor: "pointer" }}>+ New Group</button>
                  ) : (
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <input value={inlineGroupName} onChange={e => setInlineGroupName(e.target.value)} placeholder="Group name…" style={{ ...S.input as React.CSSProperties, flex: 1 }} />
                      <button onClick={() => { if (!inlineGroupName.trim()) return; const ng = { id: Date.now(), name: inlineGroupName.trim(), color: "#f0b429", description: "" }; setContactGroups(p => [...p, ng]); setSelectedGroupIds(p => [...p, ng.id]); setInlineNewGroup(false); setInlineGroupName(""); addToast("success", `Group "${ng.name}" created`); }} style={{ ...S.btn as React.CSSProperties, padding: "6px 12px", fontSize: 11 }}>Add</button>
                      <button onClick={() => { setInlineNewGroup(false); setInlineGroupName(""); }} style={{ background: "none", border: "none", color: T.text3, cursor: "pointer", fontSize: 14 }}>✕</button>
                    </div>
                  )}
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
                  <button onClick={handleEditContact} style={S.btn as React.CSSProperties}>Save Changes</button>
                  <button onClick={closeModal} style={S.btnGhost as React.CSSProperties}>Cancel</button>
                </div>
              </>
            )}
            {modal === "add-deal" && (
              <>
                <h2 style={{ fontSize: 18, fontWeight: 700, color: T.text0, margin: "0 0 20px" }}>New {term.deal}</h2>
                <div style={{ marginBottom: 12 }}>
                  <label style={S.label as React.CSSProperties}>{term.deal} Title *</label>
                  <input value={formData.title || ""} onChange={e => setFormData(p => ({ ...p, title: e.target.value }))} style={S.input as React.CSSProperties} />
                </div>
                {contactSelect("contact", term.contact)}
                <div style={{ marginBottom: 12 }}>
                  <label style={S.label as React.CSSProperties}>Owner{policy.requireOwnerOnDeal ? " *" : ""}</label>
                  <select value={formData.ownerId || denizenProfile.name} onChange={e => setFormData(p => ({ ...p, ownerId: e.target.value }))} style={S.input as React.CSSProperties}>
                    {teamMemberNames.map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                </div>
                {[["value", `${term.value} ($)`, "number"], ["closeDate", term.closeDate, "date"]].map(([key, label, type]) => (
                  <div key={key} style={{ marginBottom: 12 }}>
                    <label style={S.label as React.CSSProperties}>{label}</label>
                    <input value={formData[key] || ""} onChange={e => setFormData(p => ({ ...p, [key]: e.target.value }))} style={S.input as React.CSSProperties} type={type} />
                  </div>
                ))}
                {renderCustomFields("deal")}
                <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
                  <button onClick={handleAddDeal} style={S.btn as React.CSSProperties}>Create {term.deal}</button>
                  <button onClick={closeModal} style={S.btnGhost as React.CSSProperties}>Cancel</button>
                </div>
              </>
            )}
            {modal === "edit-deal" && (
              <>
                <h2 style={{ fontSize: 18, fontWeight: 700, color: T.text0, margin: "0 0 20px" }}>Edit {term.deal}</h2>
                <div style={{ marginBottom: 12 }}>
                  <label style={S.label as React.CSSProperties}>{term.deal} Title *</label>
                  <input value={formData.title || ""} onChange={e => setFormData(p => ({ ...p, title: e.target.value }))} style={S.input as React.CSSProperties} />
                </div>
                {contactSelect("contact", term.contact)}
                <div style={{ marginBottom: 12 }}>
                  <label style={S.label as React.CSSProperties}>Owner{policy.requireOwnerOnDeal ? " *" : ""}</label>
                  <select value={formData.ownerId || denizenProfile.name} onChange={e => setFormData(p => ({ ...p, ownerId: e.target.value }))} style={S.input as React.CSSProperties}>
                    {teamMemberNames.map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                </div>
                {[["value", `${term.value} ($)`, "number"], ["closeDate", term.closeDate, "date"]].map(([key, label, type]) => (
                  <div key={key} style={{ marginBottom: 12 }}>
                    <label style={S.label as React.CSSProperties}>{label}</label>
                    <input value={formData[key] || ""} onChange={e => setFormData(p => ({ ...p, [key]: e.target.value }))} style={S.input as React.CSSProperties} type={type} />
                  </div>
                ))}
                <div style={{ marginBottom: 12 }}>
                  <label style={S.label as React.CSSProperties}>{term.stage}</label>
                  <select value={formData.stage || industryConfig.pipelineStages[0]} onChange={e => setFormData(p => ({ ...p, stage: e.target.value }))} style={S.input as React.CSSProperties}>
                    {industryConfig.pipelineStages.map(s => <option key={s}>{s}</option>)}
                  </select>
                </div>
                {renderCustomFields("deal")}
                <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
                  <button onClick={handleEditDeal} style={S.btn as React.CSSProperties}>Save Changes</button>
                  <button onClick={closeModal} style={S.btnGhost as React.CSSProperties}>Cancel</button>
                </div>
              </>
            )}
            {modal === "add-note" && (
              <>
                <h2 style={{ fontSize: 18, fontWeight: 700, color: T.text0, margin: "0 0 20px" }}>Log {term.note}</h2>
                {contactSelect("contact", term.contact)}
                <div style={{ marginBottom: 12 }}>
                  <label style={S.label as React.CSSProperties}>Type</label>
                  <select value={formData.type || industryConfig.noteTypes[0] || "Call"} onChange={e => setFormData(p => ({ ...p, type: e.target.value }))} style={S.input as React.CSSProperties}>
                    {industryConfig.noteTypes.map(t => <option key={t}>{t}</option>)}
                  </select>
                </div>
                <div style={{ marginBottom: 12 }}>
                  <label style={S.label as React.CSSProperties}>{term.note} *</label>
                  <textarea value={formData.text || ""} onChange={e => setFormData(p => ({ ...p, text: e.target.value }))} style={{ ...S.input as React.CSSProperties, minHeight: 100, resize: "vertical" as const }} />
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
                  <button onClick={handleAddNote} style={S.btn as React.CSSProperties}>Log {term.note}</button>
                  <button onClick={closeModal} style={S.btnGhost as React.CSSProperties}>Cancel</button>
                </div>
              </>
            )}
            {modal === "add-task" && (
              <>
                <h2 style={{ fontSize: 18, fontWeight: 700, color: T.text0, margin: "0 0 20px" }}>New {term.task}</h2>
                <div style={{ marginBottom: 12 }}>
                  <label style={S.label as React.CSSProperties}>{term.task} Title *</label>
                  <input value={formData.title || ""} onChange={e => setFormData(p => ({ ...p, title: e.target.value }))} style={S.input as React.CSSProperties} />
                </div>
                {contactSelect("contact", "Contact")}
                <div style={{ marginBottom: 12 }}>
                  <label style={S.label as React.CSSProperties}>Due Date</label>
                  <input value={formData.due || ""} onChange={e => setFormData(p => ({ ...p, due: e.target.value }))} style={S.input as React.CSSProperties} type="date" />
                </div>
                <div style={{ marginBottom: 12 }}>
                  <label style={S.label as React.CSSProperties}>Priority</label>
                  <select value={formData.priority || "Medium"} onChange={e => setFormData(p => ({ ...p, priority: e.target.value }))} style={S.input as React.CSSProperties}>
                    {["High", "Medium", "Low"].map(p => <option key={p}>{p}</option>)}
                  </select>
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
                  <button onClick={handleAddTask} style={S.btn as React.CSSProperties}>Create {term.task}</button>
                  <button onClick={closeModal} style={S.btnGhost as React.CSSProperties}>Cancel</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* TOASTS */}
      {toasts.length > 0 && (
        <div style={{ position: "fixed", top: isMobile ? 60 : 16, right: isMobile ? 8 : 16, left: isMobile ? 8 : "auto", zIndex: 1200, display: "flex", flexDirection: "column", gap: 8 }}>
          {toasts.map(t => (
            <div key={t.id} className="animate-slide-up" style={{
              background: T.bg2, border: `1px solid ${T.bg4}`, borderRadius: T.radius.md,
              padding: "12px 16px", display: "flex", alignItems: "center", gap: 10,
              boxShadow: "0 8px 24px rgba(0,0,0,0.4)", minWidth: isMobile ? undefined : 260,
              borderLeft: `3px solid ${t.type === "success" ? T.green : t.type === "error" ? T.red : T.blue}`,
            }}>
              <span style={{ fontSize: 14 }}>{t.type === "success" ? "✓" : t.type === "error" ? "✕" : "ℹ"}</span>
              <span style={{ fontSize: 13, color: T.text1, flex: 1 }}>{t.message}</span>
              <button onClick={() => setToasts(prev => prev.filter(x => x.id !== t.id))} style={{ background: "none", border: "none", color: T.text3, cursor: "pointer", fontSize: 16, padding: 0 }}>×</button>
            </div>
          ))}
        </div>
      )}
    </div>
    </IndustryConfigBridge>
  );
}
