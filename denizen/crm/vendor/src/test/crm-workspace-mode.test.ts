import { describe, it, expect } from "vitest";
import { resolveWorkspaceMode, workspaceModeLabel } from "@/lib/crm-workspace-mode";

describe("crm-workspace-mode", () => {
  it("treats offline / single-user as solo", () => {
    expect(resolveWorkspaceMode({ syncStatus: "no-session", teamSize: 0 })).toBe("solo");
    expect(resolveWorkspaceMode({ syncStatus: "synced", teamSize: 1 })).toBe("solo");
  });

  it("treats connected multi-member orgs as team", () => {
    expect(resolveWorkspaceMode({ syncStatus: "synced", teamSize: 3 })).toBe("team");
    expect(resolveWorkspaceMode({ syncStatus: "saving", teamSize: 2 })).toBe("team");
  });

  it("labels modes", () => {
    expect(workspaceModeLabel("solo")).toMatch(/Solo/i);
    expect(workspaceModeLabel("team")).toMatch(/Team/i);
  });
});
