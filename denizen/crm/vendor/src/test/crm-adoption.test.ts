import { describe, it, expect } from "vitest";
import {
  validateDeal,
  validateContact,
  filterMyDeals,
  filterMyTickets,
  computeAdoptionMetrics,
  campaignLeadQuality,
} from "@/lib/crm-adoption";
import { DEFAULT_TEAM_POLICY, type Contact, type Deal } from "@/lib/crm-data";

describe("crm-adoption", () => {
  it("validateDeal enforces owner when required", () => {
    const missing = validateDeal({ title: "X", stage: "Lead", value: 100 }, DEFAULT_TEAM_POLICY);
    expect(missing).toContain("owner");
    const ok = validateDeal({ title: "X", stage: "Lead", value: 100, ownerId: "Alex" }, DEFAULT_TEAM_POLICY);
    expect(ok).toEqual([]);
  });

  it("validateContact enforces email", () => {
    expect(validateContact({ name: "A" }, DEFAULT_TEAM_POLICY)).toContain("email");
    expect(validateContact({ name: "A", email: "a@b.com" }, DEFAULT_TEAM_POLICY)).toEqual([]);
  });

  it('filterMyDeals matches owner case-insensitively', () => {
    const deals: Deal[] = [
      { id: 1, title: "A", contact: "C", value: 1, stage: "Lead", probability: 10, closeDate: "", daysInStage: 0, health: "good", ownerId: "alex" },
      { id: 2, title: "B", contact: "C", value: 1, stage: "Lead", probability: 10, closeDate: "", daysInStage: 0, health: "good", ownerId: "Bob" },
      { id: 3, title: "Unowned", contact: "C", value: 1, stage: "Lead", probability: 10, closeDate: "", daysInStage: 0, health: "good" },
    ];
    expect(filterMyDeals(deals, "Alex")).toHaveLength(1);
    expect(filterMyDeals(deals, "Alex").map((d) => d.id)).toEqual([1]);
  });

  it("computeAdoptionMetrics flags inactive users", () => {
    const old = new Date(Date.now() - 10 * 86400000).toISOString();
    const metrics = computeAdoptionMetrics(
      [{ id: 1, user: "Sam", action: "deal_created", at: old }],
      ["Sam", "Lee"],
      7,
    );
    expect(metrics.find((m) => m.user === "Sam")?.inactive).toBe(true);
    expect(metrics.find((m) => m.user === "Lee")?.inactive).toBe(true);
  });

  it("campaignLeadQuality scores engaged contacts", () => {
    const contacts: Contact[] = [{ id: 1, name: "A", company: "", email: "", phone: "", status: "Lead", tags: [], score: 80, lastContact: "2026-01-01", interactions: 0 }];
    const q = campaignLeadQuality(contacts, [5], { 1: [5] }, [], []);
    expect(q.total).toBe(1);
    expect(q.qualified).toBe(1);
  });
});
