import { describe, it, expect } from "vitest";
import { parseCsv, parseCsvContacts, parseCsvDeals, detectCsvKind } from "@/lib/crm-csv";

describe("crm-csv", () => {
  it("parses quoted commas", () => {
    const csv = `Name,Company,Email
"Smith, Jane","Acme, Inc",jane@test.local`;
    const rows = parseCsvContacts(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("Smith, Jane");
    expect(rows[0].company).toBe("Acme, Inc");
  });

  it("parses deals with currency values", () => {
    const csv = `Title,Contact,Value,Stage,Probability,Close Date
"Big Deal","Acme Corp","$12,500",Proposal,60,2026-06-01`;
    const deals = parseCsvDeals(csv);
    expect(deals).toHaveLength(1);
    expect(deals[0].title).toBe("Big Deal");
    expect(deals[0].value).toBe(12500);
    expect(deals[0].stage).toBe("Proposal");
  });

  it("detects import kind from headers", () => {
    expect(detectCsvKind(["Name", "Email"])).toBe("contacts");
    expect(detectCsvKind(["Title", "Value", "Stage"])).toBe("deals");
  });

  it("handles escaped quotes", () => {
    const { rows } = parseCsv(`Note\n"He said ""hello"""`);
    expect(rows[0][0]).toBe('He said "hello"');
  });
});
