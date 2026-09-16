import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  isCrmDemoSeedContacts,
  isCrmDemoSeedDeals,
  isCrmDemoSeedWorkspace,
  purgeCrmDemoSeedIfPresent,
} from "@/lib/crm-demo-seed";
import { initialContacts, initialDeals, type Contact, type Deal } from "@/lib/crm-data";

describe("crm-demo-seed", () => {
  beforeEach(() => {
    localStorage.setItem("meridian_demo_loaded", "1");
  });
  afterEach(() => {
    localStorage.clear();
  });

  it("detects bundled sample contacts and deals", () => {
    expect(isCrmDemoSeedContacts(initialContacts)).toBe(true);
    expect(isCrmDemoSeedDeals(initialDeals)).toBe(true);
    expect(isCrmDemoSeedWorkspace({ contacts: initialContacts, deals: initialDeals })).toBe(true);
  });

  it("ignores empty or real customer data", () => {
    expect(isCrmDemoSeedContacts([])).toBe(false);
    expect(isCrmDemoSeedDeals([])).toBe(false);
    const real: Contact[] = [{
      id: 9, name: "Ada Real", company: "Real Co", email: "ada@real.co", phone: "",
      status: "Lead", tags: [], score: 10, lastContact: "2026-09-01", interactions: 1,
    }];
    const realDeals: Deal[] = [{
      id: 9, title: "Real Enterprise Deal", contact: "Ada Real", value: 5000,
      stage: "Qualified", probability: 40, closeDate: "2026-12-01", daysInStage: 2, health: "healthy",
    }];
    expect(isCrmDemoSeedContacts(real)).toBe(false);
    expect(isCrmDemoSeedDeals(realDeals)).toBe(false);
  });

  it("purges sample workspace and clears demo flag", () => {
    const calls: string[] = [];
    const mk = (name: string) => (v: unknown[]) => { calls.push(`${name}:${v.length}`); };
    const purged = purgeCrmDemoSeedIfPresent(
      { contacts: initialContacts, deals: initialDeals },
      {
        setContacts: mk("contacts") as (v: Contact[]) => void,
        setDeals: mk("deals") as (v: Deal[]) => void,
        setNotes: mk("notes") as never,
        setTasks: mk("tasks") as never,
        setCompanies: mk("companies") as never,
        setGoals: mk("goals") as never,
        setSequences: mk("sequences") as never,
        setSubmissions: mk("submissions") as never,
        setQuotes: mk("quotes") as never,
        setPackages: mk("packages") as never,
        setMeetings: mk("meetings") as never,
        setAutomations: mk("automations") as never,
        setEmailLog: mk("emailLog") as never,
        setAuditLog: mk("auditLog") as never,
      },
    );
    expect(purged).toBe(true);
    expect(calls).toContain("contacts:0");
    expect(calls).toContain("deals:0");
    expect(localStorage.getItem("meridian_demo_loaded")).toBeNull();
  });
});
