import { describe, it, expect } from "vitest";
import {
  findDuplicateContacts,
  mergeContacts,
  applyContactImport,
  analyzeDataQuality,
  parseWorkspaceJson,
  restoreWorkspace,
} from "@/lib/crm-data-management";
import type { Contact } from "@/lib/crm-data";

const baseContact = (id: number, email: string, name: string): Contact => ({
  id, name, email, company: "Acme", phone: "", status: "Lead",
  tags: [], score: 50, lastContact: "2026-01-01", interactions: 0,
});

describe("crm-data-management", () => {
  it("finds duplicate contacts by email", () => {
    const contacts = [baseContact(1, "a@test.local", "A"), baseContact(2, "a@test.local", "A Copy")];
    const groups = findDuplicateContacts(contacts);
    expect(groups).toHaveLength(1);
    expect(groups[0].contacts).toHaveLength(2);
  });

  it("merges contact records", () => {
    const primary = baseContact(1, "a@test.local", "A");
    const other = { ...baseContact(2, "a@test.local", "A"), tags: ["VIP"], score: 90, phone: "555" };
    const merged = mergeContacts(primary, [other]);
    expect(merged.tags).toContain("VIP");
    expect(merged.score).toBe(90);
    expect(merged.phone).toBe("555");
  });

  it("skips duplicates on import", () => {
    const existing = [baseContact(1, "a@test.local", "A")];
    const incoming = [baseContact(99, "a@test.local", "A New")];
    const out = applyContactImport(existing, incoming, "skip_duplicates");
    expect(out).toHaveLength(1);
  });

  it("updates by email on import", () => {
    const existing = [baseContact(1, "a@test.local", "A")];
    const incoming = [{ ...baseContact(99, "a@test.local", "A Updated"), company: "NewCo" }];
    const out = applyContactImport(existing, incoming, "update_by_email");
    expect(out).toHaveLength(1);
    expect(out[0].company).toBe("NewCo");
    expect(out[0].id).toBe(1);
  });

  it("flags orphan deals in health check", () => {
    const report = analyzeDataQuality({
      contacts: [baseContact(1, "a@test.local", "A")],
      deals: [{ id: 1, title: "Deal", contact: "Missing Person", value: 1000, stage: "Lead", probability: 25, closeDate: "2026-06-01", daysInStage: 0, health: "good" }],
    });
    expect(report.issues.some((i) => i.category === "Deals")).toBe(true);
  });

  it("parses workspace JSON", () => {
    const result = parseWorkspaceJson(JSON.stringify({ contacts: [], deals: [] }));
    expect(result.ok).toBe(true);
  });

  it("restores workspace in merge mode", () => {
    const current = { contacts: [baseContact(1, "a@test.local", "A")], deals: [] };
    const imported = { contacts: [baseContact(2, "b@test.local", "B")] };
    const next = restoreWorkspace(current, imported, "merge");
    expect(next.contacts).toHaveLength(1);
    expect(next.contacts![0].email).toBe("b@test.local");
  });
});
