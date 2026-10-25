import { useEffect, useRef, useState } from "react";
import {
  fetchCrmWorkspace,
  saveCrmWorkspace,
  hasDenizenSession,
  ensureDenizenSession,
  canPushLocalToCloud,
  markCrmUserEdited,
  getCrmWorkspaceVersion,
  subscribeCrmWorkspaceStream,
  type CrmWorkspaceState,
} from "@/lib/crm-api";

export type CrmSyncStatus = "loading" | "local" | "synced" | "saving" | "error" | "no-session" | "no-org" | "conflict" | "draft";

export type CrmSyncApplyFns = {
  setContacts: (v: unknown[]) => void;
  setDeals: (v: unknown[]) => void;
  setNotes: (v: unknown[]) => void;
  setTasks: (v: unknown[]) => void;
  setCompanies?: (v: unknown[]) => void;
  setGoals?: (v: unknown[]) => void;
  setSequences?: (v: unknown[]) => void;
  setSequenceEnrollments?: (v: unknown[]) => void;
  setSubmissions: (v: unknown[]) => void;
  setQuotes: (v: unknown[]) => void;
  setPackages: (v: unknown[]) => void;
  setMeetings: (v: unknown[]) => void;
  setAutomations: (v: unknown[]) => void;
  setEmailTemplates: (v: unknown[]) => void;
  setEmailLog: (v: unknown[]) => void;
  setAuditLog: (v: unknown[]) => void;
  setNoteBoards: (v: unknown[]) => void;
  setIndustryConfig: (v: Record<string, unknown>) => void;
  setContactGroups: (v: unknown[]) => void;
  setContactGroupMap: (v: Record<string, number[]>) => void;
  setCrmQuotas: (v: unknown[]) => void;
  setUserPrefs?: (v: Record<string, unknown>) => void;
  setOnboarding?: (v: Record<string, unknown>) => void;
  setAvailability?: (v: unknown[]) => void;
  setIntegrations?: (v: Record<string, unknown>) => void;
  setMetricSnapshots?: (v: unknown[]) => void;
  setAutomationRuns?: (v: unknown[]) => void;
  setDealComments?: (v: unknown[]) => void;
  setAiThreads?: (v: unknown[]) => void;
  setLeadModelState?: (v: Record<string, unknown>) => void;
  setSupportTickets?: (v: unknown[]) => void;
  setMarketingCampaigns?: (v: unknown[]) => void;
  setTeamPolicy?: (v: Record<string, unknown>) => void;
  setUsageLog?: (v: unknown[]) => void;
  setIntakeQuestions?: (v: unknown[]) => void;
};

function applyWorkspace(state: CrmWorkspaceState, fns: CrmSyncApplyFns) {
  if (state.contacts) fns.setContacts(state.contacts);
  if (state.deals) fns.setDeals(state.deals);
  if (state.notes) fns.setNotes(state.notes);
  if (state.tasks) fns.setTasks(state.tasks);
  if (state.companies && fns.setCompanies) fns.setCompanies(state.companies);
  if (state.goals && fns.setGoals) fns.setGoals(state.goals);
  if (state.sequences && fns.setSequences) fns.setSequences(state.sequences);
  if (state.sequenceEnrollments && fns.setSequenceEnrollments) fns.setSequenceEnrollments(state.sequenceEnrollments);
  if (state.submissions) fns.setSubmissions(state.submissions);
  if (state.quotes) fns.setQuotes(state.quotes);
  if (state.packages) fns.setPackages(state.packages);
  if (state.meetings) fns.setMeetings(state.meetings);
  if (state.automations) fns.setAutomations(state.automations);
  if (state.emailTemplates) fns.setEmailTemplates(state.emailTemplates);
  if (state.emailLog) fns.setEmailLog(state.emailLog);
  if (state.auditLog) fns.setAuditLog(state.auditLog);
  if (state.noteBoards) fns.setNoteBoards(state.noteBoards);
  if (state.industryConfig) fns.setIndustryConfig(state.industryConfig);
  if (state.contactGroups) fns.setContactGroups(state.contactGroups);
  if (state.contactGroupMap) fns.setContactGroupMap(state.contactGroupMap);
  if (state.crmQuotas) fns.setCrmQuotas(state.crmQuotas);
  if (state.userPrefs && fns.setUserPrefs) fns.setUserPrefs(state.userPrefs);
  if (state.onboarding && fns.setOnboarding) fns.setOnboarding(state.onboarding);
  if (state.availability && fns.setAvailability) fns.setAvailability(state.availability);
  if (state.integrations && fns.setIntegrations) fns.setIntegrations(state.integrations);
  if (state.metricSnapshots && fns.setMetricSnapshots) fns.setMetricSnapshots(state.metricSnapshots);
  if (state.automationRuns && fns.setAutomationRuns) fns.setAutomationRuns(state.automationRuns);
  if (state.dealComments && fns.setDealComments) fns.setDealComments(state.dealComments);
  if (state.aiThreads && fns.setAiThreads) fns.setAiThreads(state.aiThreads);
  if (state.leadModelState && fns.setLeadModelState) fns.setLeadModelState(state.leadModelState);
  if (state.supportTickets && fns.setSupportTickets) fns.setSupportTickets(state.supportTickets);
  if (state.marketingCampaigns && fns.setMarketingCampaigns) fns.setMarketingCampaigns(state.marketingCampaigns);
  if (state.teamPolicy && fns.setTeamPolicy) fns.setTeamPolicy(state.teamPolicy);
  if (state.usageLog && fns.setUsageLog) fns.setUsageLog(state.usageLog);
  if (state.intakeQuestions && fns.setIntakeQuestions) fns.setIntakeQuestions(state.intakeQuestions);
}

function hasLocalData(state: CrmWorkspaceState): boolean {
  // Only count real pipeline/ops entities — ignore soft config defaults.
  const keys: (keyof CrmWorkspaceState)[] = [
    "contacts", "deals", "notes", "tasks", "companies", "goals",
    "sequences", "sequenceEnrollments", "submissions", "quotes", "packages",
    "meetings", "automations", "emailTemplates", "emailLog", "auditLog",
    "dealComments", "supportTickets", "marketingCampaigns", "crmQuotas",
  ];
  return keys.some((k) => {
    const v = state[k];
    return Array.isArray(v) && v.length > 0;
  });
}

const POLL_MS = 30_000;

export function useCrmCloudSync(
  snapshot: CrmWorkspaceState,
  applyFns: CrmSyncApplyFns,
): { status: CrmSyncStatus; orgLabel: string | null; teamLabel: string | null; lastSavedAt: string | null; updatedByName: string | null } {
  const [status, setStatus] = useState<CrmSyncStatus>("loading");
  const [orgLabel, setOrgLabel] = useState<string | null>(null);
  const [teamLabel, setTeamLabel] = useState<string | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [updatedByName, setUpdatedByName] = useState<string | null>(null);
  const hydrated = useRef(false);
  const noSession = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const snapshotRef = useRef(snapshot);
  const applyFnsRef = useRef(applyFns);
  const userEditSeen = useRef(false);
  const remoteUpdatedAt = useRef<string | null>(null);
  snapshotRef.current = snapshot;
  applyFnsRef.current = applyFns;

  useEffect(() => {
    let cancelled = false;

    async function hydrateFromCloud(silent = false) {
      await ensureDenizenSession();
      if (cancelled) return;
      const session = await ensureDenizenSession();
      if (!session?.session_id && !hasDenizenSession()) {
        noSession.current = true;
        setStatus("no-session");
        return;
      }
      noSession.current = false;
      if (!silent) setStatus("loading");
      const result = await fetchCrmWorkspace();
      if (cancelled) return;
      if (!result.ok) {
        if (result.reason === "no_session") {
          noSession.current = true;
          setStatus("no-session");
          return;
        }
        if (result.reason === "no_org") {
          setStatus("no-org");
          return;
        }
        setStatus("local");
        return;
      }
      setOrgLabel(result.orgSlug);
      setTeamLabel(result.orgDisplayName || null);
      remoteUpdatedAt.current = result.updatedAt;
      setLastSavedAt(result.updatedAt);
      setUpdatedByName(result.updatedByName || null);

      if (!result.empty) {
        const remoteTs = result.updatedAt || "";
        const localTs = getCrmWorkspaceVersion() || "";
        if (!silent || !localTs || remoteTs > localTs) {
          requestAnimationFrame(() => {
            if (!cancelled) applyWorkspace(result.state, applyFnsRef.current);
          });
        }
        setStatus("synced");
      } else if (hasLocalData(snapshotRef.current) && canPushLocalToCloud()) {
        saveCrmWorkspace(snapshotRef.current).then((saved) => {
          if (cancelled) return;
          if (saved.ok) {
            setOrgLabel(saved.orgSlug);
            setTeamLabel(saved.orgDisplayName || null);
            setLastSavedAt(saved.updatedAt);
            setUpdatedByName(saved.updatedByName || null);
          }
          setStatus(saved.ok ? "synced" : "local");
        });
      } else if (hasLocalData(snapshotRef.current) && !canPushLocalToCloud()) {
        setStatus("draft");
      } else {
        setStatus("synced");
      }
    }

    hydrated.current = true;
    hydrateFromCloud();

    const onStorage = (e: StorageEvent) => {
      if (e.key === "denizen-visitor-session" || e.key === "denizen-ceo-grant") {
        noSession.current = false;
        hydrateFromCloud();
      }
    };
    window.addEventListener("storage", onStorage);

    const poll = setInterval(() => {
      if (!noSession.current) hydrateFromCloud(true);
    }, POLL_MS);

    const stopStream = subscribeCrmWorkspaceStream((payload) => {
      if (cancelled || noSession.current) return;
      if (payload.updated_by_name) setUpdatedByName(payload.updated_by_name);
      hydrateFromCloud(true);
    });

    return () => {
      cancelled = true;
      window.removeEventListener("storage", onStorage);
      clearInterval(poll);
      stopStream();
    };
  }, []);

  useEffect(() => {
    if (!hydrated.current || noSession.current) return;
    if (!userEditSeen.current) {
      userEditSeen.current = true;
      return;
    }
    markCrmUserEdited();
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      setStatus("saving");
      const result = await saveCrmWorkspace(snapshotRef.current);
      if (result.ok) {
        setOrgLabel(result.orgSlug);
        setTeamLabel(result.orgDisplayName || null);
        setLastSavedAt(result.updatedAt);
        setUpdatedByName(result.updatedByName || null);
        remoteUpdatedAt.current = result.updatedAt;
        setStatus("synced");
      } else if (result.reason === "conflict" && result.state) {
        applyWorkspace(result.state, applyFnsRef.current);
        setLastSavedAt(result.updatedAt || null);
        setStatus("conflict");
        setTimeout(() => setStatus("synced"), 2500);
      } else if (result.reason === "no_session") {
        noSession.current = true;
        setStatus("no-session");
      } else {
        setStatus("error");
      }
    }, 1500);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [snapshot]);

  return { status, orgLabel, teamLabel, lastSavedAt, updatedByName };
}

export function crmSyncLabel(
  status: CrmSyncStatus,
  teamLabel: string | null,
  lastSavedAt?: string | null,
  updatedByName?: string | null,
): string {
  const timeSuffix = lastSavedAt
    ? ` · ${new Date(lastSavedAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`
    : "";
  const bySuffix = updatedByName ? ` · ${updatedByName}` : "";
  switch (status) {
    case "loading":
      return "Connecting…";
    case "saving":
      return "Saving to your team…";
    case "synced":
      return teamLabel ? `Synced · ${teamLabel}${timeSuffix}${bySuffix}` : `Synced${timeSuffix}${bySuffix}`;
    case "draft":
      return teamLabel
        ? `On this device · Team ${teamLabel}`
        : "On this device — add data to sync with your team";
    case "conflict":
      return "Updated from a teammate";
    case "no-session":
      return "On this device — open the Denizen office to sync";
    case "no-org":
      return "Join a team in Denizen to sync across devices";
    case "error":
      return "Couldn’t sync — still working on this device";
    default:
      return "On this device";
  }
}
