import React, { createContext, useContext, useState, useMemo, useRef, useCallback, useEffect } from "react";
import { useLocalStorage } from "@/lib/crm-hooks";
import {
  type CRMUserRole,
  type ActiveIndustry,
  isCRMUserRole,
  isActiveIndustry,
  CRM_PREFS_STORAGE_KEYS,
} from "@/lib/industry-dictionary";
import {
  type Contact, type Deal, type Note, type Task, type Goal, type Package, type Submission,
  type Quote, type Company, type Automation, type Meeting, type Sequence, type AuditEntry,
  type EmailLogEntry, type Commission, type IntakeQuestion,
  initialBranding,
  initialAvailability, initialViews, initialPipelines, defaultIntakeQuestions,
  fmt, calcLeadScore,
} from "@/lib/crm-data";

interface ToastItem { id: number; message: string; type: string; title: string; }
interface NotifItem { id: number; type: string; icon: string; title: string; body: string; read: boolean; at: string; link?: string; }

interface CRMContextType {
  // State
  tab: string; setTab: (t: string) => void;
  contacts: Contact[]; setContacts: (v: Contact[] | ((p: Contact[]) => Contact[])) => void;
  deals: Deal[]; setDeals: (v: Deal[] | ((p: Deal[]) => Deal[])) => void;
  notes: Note[]; setNotes: (v: Note[] | ((p: Note[]) => Note[])) => void;
  tasks: Task[]; setTasks: (v: Task[] | ((p: Task[]) => Task[])) => void;
  goals: Goal[]; setGoals: (v: Goal[] | ((p: Goal[]) => Goal[])) => void;
  packages: Package[]; setPackages: (v: Package[] | ((p: Package[]) => Package[])) => void;
  submissions: Submission[]; setSubmissions: (v: Submission[] | ((p: Submission[]) => Submission[])) => void;
  quotes: Quote[]; setQuotes: (v: Quote[] | ((p: Quote[]) => Quote[])) => void;
  companies: Company[]; setCompanies: (v: Company[] | ((p: Company[]) => Company[])) => void;
  automations: Automation[]; setAutomations: (v: Automation[] | ((p: Automation[]) => Automation[])) => void;
  meetings: Meeting[]; setMeetings: (v: Meeting[] | ((p: Meeting[]) => Meeting[])) => void;
  sequences: Sequence[]; setSequences: (v: Sequence[] | ((p: Sequence[]) => Sequence[])) => void;
  auditLog: AuditEntry[]; setAuditLog: (v: AuditEntry[] | ((p: AuditEntry[]) => AuditEntry[])) => void;
  emailLog: EmailLogEntry[]; setEmailLog: (v: EmailLogEntry[] | ((p: EmailLogEntry[]) => EmailLogEntry[])) => void;
  commissions: Commission[]; setCommissions: (v: Commission[] | ((p: Commission[]) => Commission[])) => void;
  notifications: NotifItem[]; setNotifications: (v: NotifItem[] | ((p: NotifItem[]) => NotifItem[])) => void;
  comments: Record<number, any[]>; setComments: (v: any) => void;
  branding: any; setBranding: (v: any) => void;
  userProfile: any; setUserProfile: (v: any) => void;
  teamRoster: any[]; setTeamRoster: (v: any) => void;
  checklistCompleted: string[]; setChecklistCompleted: (v: string[] | ((p: string[]) => string[])) => void;
  products: any[]; setProducts: (v: any) => void;
  emailTemplates: any[]; setEmailTemplates: (v: any) => void;
  customFields: Record<string, any[]>; setCustomFields: (v: any) => void;
  webhooks: any[]; setWebhooks: (v: any) => void;
  availability: any; setAvailability: (v: any) => void;
  intakeQuestions: IntakeQuestion[]; setIntakeQuestions: (v: any) => void;
  formConfig: any; setFormConfig: (v: any) => void;
  pipelines: any[]; views: any[];
  // UI State
  modal: string | null; setModal: (m: string | null) => void;
  contactDrawer: Contact | null; setContactDrawer: (c: Contact | null) => void;
  toasts: ToastItem[]; addToast: (msg: string, type?: string, title?: string) => void; removeToast: (id: number) => void;
  sidebarCollapsed: boolean; setSidebarCollapsed: (v: boolean | ((p: boolean) => boolean)) => void;
  cmdOpen: boolean; setCmdOpen: (v: boolean) => void;
  notifOpen: boolean; setNotifOpen: (v: boolean) => void;
  isMobile: boolean;
  // Actions
  addContact: (c: Contact) => void;
  addDeal: (d: Deal) => void;
  addNote: (n: Note) => void;
  addTask: (t: Task) => void;
  toggleTask: (id: number) => void;
  markDone: (id: string) => void;
  addNotification: (n: Partial<NotifItem>) => void;
  markNotifRead: (id: number) => void;
  markAllNotifsRead: () => void;
  logAudit: (action: string, entity: string, entityName: string, extra?: any) => void;
  recalcScores: () => void;
  // Computed
  filteredContacts: Contact[];
  filteredDeals: Deal[];
  openPipeline: number;
  weightedForecast: number;
  wonValue: number;
  openTasks: number;
  unreadCount: number;
  // Filters
  contactSearch: string; setContactSearch: (v: string) => void;
  contactFilter: string; setContactFilter: (v: string) => void;
  dealSearch: string; setDealSearch: (v: string) => void;
  // Deal modals
  dealDetailModal: Deal | null; setDealDetailModal: (d: Deal | null) => void;
  winLossModal: any; setWinLossModal: (v: any) => void;
  emailComposerContact: Contact | null; setEmailComposerContact: (c: Contact | null) => void;
  reportBuilder: boolean; setReportBuilder: (v: boolean) => void;
  csvImporter: boolean; setCsvImporter: (v: boolean) => void;
  exportModal: boolean; setExportModal: (v: boolean) => void;
  mergeModal: boolean; setMergeModal: (v: boolean) => void;
  bulkEnrollOpen: boolean; setBulkEnrollOpen: (v: boolean) => void;
  dedupOpen: boolean; setDedupOpen: (v: boolean) => void;
  showClientForm: boolean; setShowClientForm: (v: boolean) => void;
  portalQuote: Quote | null; setPortalQuote: (q: Quote | null) => void;
  showChecklist: boolean; setShowChecklist: (v: boolean) => void;
  onboardingDone: boolean; setOnboardingDone: (v: boolean) => void;
  fileInputRef: React.RefObject<HTMLInputElement>;
  // New form state
  newContact: Partial<Contact>; setNewContact: (v: any) => void;
  newDeal: Partial<Deal>; setNewDeal: (v: any) => void;
  newNote: Partial<Note>; setNewNote: (v: any) => void;
  newTask: Partial<Task>; setNewTask: (v: any) => void;
  // Workspace preferences (role + industry vertical)
  currentUserRole: CRMUserRole;
  setCurrentUserRole: (role: CRMUserRole) => void;
  activeIndustry: ActiveIndustry;
  setActiveIndustry: (industry: ActiveIndustry) => void;
  prefsHydrated: boolean;
}

export interface CRMPreferencesContextType {
  currentUserRole: CRMUserRole;
  setCurrentUserRole: (role: CRMUserRole) => void;
  activeIndustry: ActiveIndustry;
  setActiveIndustry: (industry: ActiveIndustry) => void;
  prefsHydrated: boolean;
}

/** Hydrate from localStorage after mount; persist only inside setters. */
function useCRMPreferencesState(): CRMPreferencesContextType {
  const [currentUserRole, setCurrentUserRoleState] = useState<CRMUserRole>("Manager");
  const [activeIndustry, setActiveIndustryState] = useState<ActiveIndustry>("default");
  const [prefsHydrated, setPrefsHydrated] = useState(false);

  useEffect(() => {
    try {
      const rawRole = localStorage.getItem(CRM_PREFS_STORAGE_KEYS.role);
      if (isCRMUserRole(rawRole)) setCurrentUserRoleState(rawRole);
      const rawIndustry = localStorage.getItem(CRM_PREFS_STORAGE_KEYS.industry);
      if (isActiveIndustry(rawIndustry)) setActiveIndustryState(rawIndustry);
    } catch {
      /* localStorage unavailable */
    }
    setPrefsHydrated(true);
  }, []);

  const setCurrentUserRole = useCallback((role: CRMUserRole) => {
    setCurrentUserRoleState(role);
    try {
      localStorage.setItem(CRM_PREFS_STORAGE_KEYS.role, role);
    } catch {
      /* ignore quota / private mode */
    }
  }, []);

  const setActiveIndustry = useCallback((industry: ActiveIndustry) => {
    setActiveIndustryState(industry);
    try {
      localStorage.setItem(CRM_PREFS_STORAGE_KEYS.industry, industry);
    } catch {
      /* ignore */
    }
  }, []);

  return {
    currentUserRole,
    setCurrentUserRole,
    activeIndustry,
    setActiveIndustry,
    prefsHydrated,
  };
}

const CRMPreferencesContext = createContext<CRMPreferencesContextType | null>(null);

export function CRMPreferencesProvider({ children }: { children: React.ReactNode }) {
  const prefs = useCRMPreferencesState();
  return (
    <CRMPreferencesContext.Provider value={prefs}>
      {children}
    </CRMPreferencesContext.Provider>
  );
}

export function useCRMPreferences(): CRMPreferencesContextType {
  const ctx = useContext(CRMPreferencesContext);
  if (!ctx) {
    throw new Error("useCRMPreferences must be used within CRMPreferencesProvider");
  }
  return ctx;
}

export type { CRMUserRole, ActiveIndustry };

const CRMContext = createContext<CRMContextType>(null!);
export const useCRM = () => useContext(CRMContext);

const initialNotifications: NotifItem[] = [
  { id:1, type:"deal", icon:"⚠", title:"Nexus Integration at risk", body:"21 days in Qualified stage", read:false, at:"2026-03-19T10:00:00", link:"pipeline" },
  { id:2, type:"task", icon:"📋", title:"2 tasks due today", body:"Follow up with Marcus, Send contract to Sarah", read:false, at:"2026-03-20T08:00:00", link:"tasks" },
];
const initialComments: Record<number, any[]> = {};

export function CRMProvider({ children }: { children: React.ReactNode }) {
  const {
    currentUserRole,
    setCurrentUserRole,
    activeIndustry,
    setActiveIndustry,
    prefsHydrated,
  } = useCRMPreferencesState();

  const [tab, setTab] = useState("dashboard");
  const [onboardingDone, setOnboardingDone] = useLocalStorage("onboardingDone", false);
  const [userProfile, setUserProfile] = useLocalStorage("userProfile", null);
  const [teamRoster, setTeamRoster] = useLocalStorage<any[]>("teamRoster", []);
  const [checklistCompleted, setChecklistCompleted] = useLocalStorage<string[]>("checklistCompleted", []);
  const [contacts, setContacts] = useLocalStorage("contacts", []);
  const [deals, setDeals] = useLocalStorage("deals", []);
  const [notes, setNotes] = useLocalStorage("notes", []);
  const [tasks, setTasks] = useLocalStorage("tasks", []);
  const [goals, setGoals] = useLocalStorage("goals", []);
  const [packages, setPackages] = useLocalStorage("packages", []);
  const [submissions, setSubmissions] = useLocalStorage("submissions", []);
  const [quotes, setQuotes] = useLocalStorage("quotes", []);
  const [companies, setCompanies] = useLocalStorage("companies", []);
  const [automations, setAutomations] = useLocalStorage("automations", []);
  const [meetings, setMeetings] = useLocalStorage("meetings", []);
  const [sequences, setSequences] = useLocalStorage("sequences", []);
  const [auditLog, setAuditLog] = useLocalStorage("auditLog", []);
  const [emailLog, setEmailLog] = useLocalStorage("emailLog", []);
  const [commissions, setCommissions] = useLocalStorage("commissions", []);
  const [notifications, setNotifications] = useLocalStorage<NotifItem[]>("notifications", []);
  const [comments, setComments] = useLocalStorage<Record<number, any[]>>("comments", {});
  const [branding, setBranding] = useLocalStorage("branding", initialBranding);
  const [products, setProducts] = useLocalStorage("products", []);
  const [emailTemplates, setEmailTemplates] = useLocalStorage("emailTemplates", []);
  const [customFields, setCustomFields] = useLocalStorage("customFields", []);
  const [webhooks, setWebhooks] = useLocalStorage("webhooks", []);
  const [availability, setAvailability] = useLocalStorage("availability", initialAvailability);
  const [intakeQuestions, setIntakeQuestions] = useLocalStorage("intakeQuestions", defaultIntakeQuestions);
  const [formConfig, setFormConfig] = useLocalStorage("formConfig", { title:"Tell us about your business", description:"Help us understand your goals — we'll build a custom quote in 24 hours." });
  const [pipelines] = useState(initialPipelines);
  const [views] = useState(initialViews);

  // UI state
  const [modal, setModal] = useState<string | null>(null);
  const [contactDrawer, setContactDrawer] = useState<Contact | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [cmdOpen, setCmdOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [dealDetailModal, setDealDetailModal] = useState<Deal | null>(null);
  const [winLossModal, setWinLossModal] = useState<any>(null);
  const [emailComposerContact, setEmailComposerContact] = useState<Contact | null>(null);
  const [reportBuilder, setReportBuilder] = useState(false);
  const [csvImporter, setCsvImporter] = useState(false);
  const [exportModal, setExportModal] = useState(false);
  const [mergeModal, setMergeModal] = useState(false);
  const [bulkEnrollOpen, setBulkEnrollOpen] = useState(false);
  const [dedupOpen, setDedupOpen] = useState(false);
  const [showClientForm, setShowClientForm] = useState(false);
  const [portalQuote, setPortalQuote] = useState<Quote | null>(null);
  const [showChecklist, setShowChecklist] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null!);

  // Filters
  const [contactSearch, setContactSearch] = useState("");
  const [contactFilter, setContactFilter] = useState("All");
  const [dealSearch, setDealSearch] = useState("");

  // Form state
  const [newContact, setNewContact] = useState<Partial<Contact>>({});
  const [newDeal, setNewDeal] = useState<Partial<Deal>>({});
  const [newNote, setNewNote] = useState<Partial<Note>>({});
  const [newTask, setNewTask] = useState<Partial<Task>>({});

  const isMobile = typeof window !== "undefined" ? window.innerWidth < 768 : false;

  const addToast = useCallback((message: string, type = "success", title = "") => {
    const id = Date.now();
    setToasts(p => [...p, { id, message, type, title }]);
    setTimeout(() => setToasts(p => p.filter(t => t.id !== id)), 4000);
  }, []);
  const removeToast = useCallback((id: number) => setToasts(p => p.filter(t => t.id !== id)), []);

  const addNotification = useCallback((notif: Partial<NotifItem>) => {
    setNotifications(p => [{ id: Date.now(), read: false, at: new Date().toISOString(), type: "", icon: "", title: "", body: "", ...notif } as NotifItem, ...p].slice(0, 50));
  }, [setNotifications]);
  const markNotifRead = useCallback((id: number) => setNotifications(p => p.map(n => n.id === id ? { ...n, read: true } : n)), [setNotifications]);
  const markAllNotifsRead = useCallback(() => setNotifications(p => p.map(n => ({ ...n, read: true }))), [setNotifications]);

  const logAudit = useCallback((action: string, entity: string, entityName: string, extra: any = {}) => {
    setAuditLog(prev => [{ id: Date.now(), user: userProfile?.name || "You", action, entity, entityName, ...extra, at: new Date().toISOString() }, ...prev].slice(0, 100));
  }, [setAuditLog, userProfile]);

  const markDone = useCallback((id: string) => setChecklistCompleted(p => p.includes(id) ? p : [...p, id]), [setChecklistCompleted]);

  const addContact = useCallback((c: Contact) => {
    setContacts(p => [...p, c]);
    logAudit("created", "contact", c.name);
    addToast(`${c.name} added`, "success", "Contact Created");
    markDone("contact");
  }, [setContacts, logAudit, addToast, markDone]);

  const addDeal = useCallback((d: Deal) => {
    setDeals(p => [...p, d]);
    logAudit("created", "deal", d.title);
    addToast(`${d.title} added`, "success", "Deal Created");
    markDone("deal");
  }, [setDeals, logAudit, addToast, markDone]);

  const addNote = useCallback((n: Note) => {
    setNotes(p => [...p, n]);
    addToast("Note logged", "success");
  }, [setNotes, addToast]);

  const addTask = useCallback((t: Task) => {
    setTasks(p => [...p, t]);
    addToast(`Task created`, "success");
  }, [setTasks, addToast]);

  const toggleTask = useCallback((id: number) => {
    setTasks(p => p.map(t => t.id === id ? { ...t, done: !t.done } : t));
  }, [setTasks]);

  const recalcScores = useCallback(() => {
    setContacts(prev => prev.map(c => ({ ...c, score: calcLeadScore(c, emailLog, deals, notes, tasks) })));
    addToast("Lead scores updated", "success", "Scoring");
  }, [setContacts, emailLog, deals, notes, addToast]);

  // Computed
  const filteredContacts = useMemo(() => {
    let fc = contacts;
    if (contactFilter !== "All") fc = fc.filter(c => c.status === contactFilter);
    if (contactSearch) {
      const q = contactSearch.toLowerCase();
      fc = fc.filter(c => c.name.toLowerCase().includes(q) || c.company.toLowerCase().includes(q) || c.email.toLowerCase().includes(q));
    }
    return fc;
  }, [contacts, contactFilter, contactSearch]);

  const filteredDeals = useMemo(() => {
    if (!dealSearch) return deals;
    const q = dealSearch.toLowerCase();
    return deals.filter(d => d.title.toLowerCase().includes(q) || d.contact.toLowerCase().includes(q));
  }, [deals, dealSearch]);

  const openPipeline = useMemo(() => deals.filter(d => !["Closed Won", "Closed Lost"].includes(d.stage)).reduce((s, d) => s + d.value, 0), [deals]);
  const weightedForecast = useMemo(() => deals.filter(d => !["Closed Won", "Closed Lost"].includes(d.stage)).reduce((s, d) => s + d.value * (d.probability / 100), 0), [deals]);
  const wonValue = useMemo(() => deals.filter(d => d.stage === "Closed Won").reduce((s, d) => s + d.value, 0), [deals]);
  const openTasks = useMemo(() => tasks.filter(t => !t.done).length, [tasks]);
  const unreadCount = useMemo(() => notifications.filter(n => !n.read).length, [notifications]);

  const value: CRMContextType = {
    tab, setTab, contacts, setContacts, deals, setDeals, notes, setNotes,
    tasks, setTasks, goals, setGoals, packages, setPackages, submissions, setSubmissions,
    quotes, setQuotes, companies, setCompanies, automations, setAutomations,
    meetings, setMeetings, sequences, setSequences, auditLog, setAuditLog,
    emailLog, setEmailLog, commissions, setCommissions, notifications, setNotifications,
    comments, setComments, branding, setBranding, userProfile, setUserProfile,
    teamRoster, setTeamRoster, checklistCompleted, setChecklistCompleted,
    products, setProducts, emailTemplates, setEmailTemplates, customFields, setCustomFields,
    webhooks, setWebhooks, availability, setAvailability, intakeQuestions, setIntakeQuestions,
    formConfig, setFormConfig, pipelines, views,
    modal, setModal, contactDrawer, setContactDrawer, toasts, addToast, removeToast,
    sidebarCollapsed, setSidebarCollapsed, cmdOpen, setCmdOpen, notifOpen, setNotifOpen,
    isMobile,
    addContact, addDeal, addNote, addTask, toggleTask, markDone,
    addNotification, markNotifRead, markAllNotifsRead, logAudit, recalcScores,
    filteredContacts, filteredDeals, openPipeline, weightedForecast, wonValue, openTasks, unreadCount,
    contactSearch, setContactSearch, contactFilter, setContactFilter, dealSearch, setDealSearch,
    dealDetailModal, setDealDetailModal, winLossModal, setWinLossModal,
    emailComposerContact, setEmailComposerContact, reportBuilder, setReportBuilder,
    csvImporter, setCsvImporter, exportModal, setExportModal, mergeModal, setMergeModal,
    bulkEnrollOpen, setBulkEnrollOpen, dedupOpen, setDedupOpen,
    showClientForm, setShowClientForm, portalQuote, setPortalQuote,
    showChecklist, setShowChecklist, onboardingDone, setOnboardingDone,
    fileInputRef,
    newContact, setNewContact, newDeal, setNewDeal, newNote, setNewNote, newTask, setNewTask,
    currentUserRole, setCurrentUserRole, activeIndustry, setActiveIndustry, prefsHydrated,
  };

  return <CRMContext.Provider value={value}>{children}</CRMContext.Provider>;
}
