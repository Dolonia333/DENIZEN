import { describe, it, expect } from "vitest";
import {
  buildWorkingSet,
  isOpenPipelineDeal,
  isWatchlistDeal,
} from "@/lib/crm-working-set";
import type { Contact, Deal, Task } from "@/lib/crm-data";

const baseDeal = (over: Partial<Deal>): Deal => ({
  id: 1,
  title: "X",
  contact: "",
  value: 0,
  stage: "Lead",
  probability: 10,
  closeDate: "",
  daysInStage: 0,
  health: "good",
  ...over,
});

describe("crm-working-set", () => {
  it("excludes watchlist and expired from open pipeline", () => {
    const deals = [
      baseDeal({ id: 17, title: "OMES teaming", stage: "Partnership Development", value: 0, contact: "Ballard" }),
      baseDeal({ id: 20, title: "DMEA", stage: "Watch / Research", status: "watchlist", tags: ["federal-rfp", "watchlist"], value: 0 }),
      baseDeal({ id: 7, title: "OMES old", stage: "Expired / Needs Correction", status: "expired", value: 0 }),
      baseDeal({ id: 12, title: "CloudForge", stage: "Lost / Disqualified", status: "disqualified", value: 45000 }),
      baseDeal({ id: 99, title: "Won", stage: "Closed Won", value: 100 }),
    ];
    expect(isOpenPipelineDeal(deals[0])).toBe(true);
    expect(isWatchlistDeal(deals[1])).toBe(true);
    expect(isOpenPipelineDeal(deals[1])).toBe(false);
    expect(isOpenPipelineDeal(deals[2])).toBe(false);
    expect(isOpenPipelineDeal(deals[3])).toBe(false);
    expect(isOpenPipelineDeal(deals[4])).toBe(false);

    const ws = buildWorkingSet({
      deals,
      contacts: [{ id: 1, name: "A", company: "", email: "", phone: "", status: "Partner", tags: [], score: 0, lastContact: "", interactions: 0 }] as Contact[],
      tasks: [{ id: 1, title: "Email Ballard", contact: "Ballard", due: "2099-01-01", priority: "High", done: false }] as Task[],
      today: "2026-08-27",
    });
    expect(ws.pipelineDeals).toHaveLength(1);
    expect(ws.pipelineValue).toBe(0);
    expect(ws.watchlistDeals).toHaveLength(1);
    expect(ws.expiredDeals).toHaveLength(1);
    expect(ws.openTasks).toHaveLength(1);
  });

  it("flags at-risk when next date is missed", () => {
    const ws = buildWorkingSet({
      deals: [
        baseDeal({ id: 1, title: "Live", stage: "Onboarding", closeDate: "2026-01-01", value: 0 }),
      ],
      contacts: [],
      tasks: [],
      today: "2026-08-27",
    });
    expect(ws.atRiskDeals).toHaveLength(1);
  });
});
