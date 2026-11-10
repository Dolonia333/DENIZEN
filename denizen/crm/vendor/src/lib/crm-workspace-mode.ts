import type { CrmSyncStatus } from "@/hooks/use-crm-cloud-sync";

/** Solo = one person working the CRM. Team = 2+ people sharing a workspace. */
export type WorkspaceMode = "solo" | "team";

export function resolveWorkspaceMode(opts: {
  syncStatus: CrmSyncStatus;
  teamSize: number;
}): WorkspaceMode {
  const { syncStatus, teamSize } = opts;
  const connected = syncStatus === "synced" || syncStatus === "saving" || syncStatus === "draft" || syncStatus === "conflict";
  if (connected && teamSize >= 2) return "team";
  return "solo";
}

export function workspaceModeLabel(mode: WorkspaceMode): string {
  return mode === "team" ? "Team workspace" : "Solo workspace";
}

export function workspaceModeHint(mode: WorkspaceMode, syncStatus: CrmSyncStatus): string {
  if (mode === "team") {
    return "Shared with your org — contacts and deals sync for everyone.";
  }
  if (syncStatus === "no-session" || syncStatus === "no-org") {
    return "Everything stays on this device until you open Denizen with a team.";
  }
  if (syncStatus === "synced" || syncStatus === "saving" || syncStatus === "draft") {
    return "You're the only member so far — invite people from Team when ready.";
  }
  return "Work alone now; invite teammates anytime from Team.";
}
