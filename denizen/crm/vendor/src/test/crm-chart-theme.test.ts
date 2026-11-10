import { describe, it, expect } from "vitest";
import { CHART_SERIES, moneyTick } from "@/lib/crm-chart-theme";
import { STAGE_COLORS, T } from "@/lib/crm-data";

describe("crm chart theme + palette", () => {
  it("exposes a multi-color series and money ticks", () => {
    expect(CHART_SERIES.length).toBeGreaterThanOrEqual(6);
    expect(moneyTick(1500)).toBe("$2k");
    expect(moneyTick(2_500_000)).toBe("$2.5M");
  });

  it("uses verdigris accent and carbon surfaces", () => {
    expect(T.accent.toLowerCase()).toBe("#3ecf9a");
    expect(T.bg0.toLowerCase()).toBe("#07090c");
    expect(T.copper).toBeTruthy();
  });

  it("maps every default stage to a color", () => {
    for (const stage of ["Lead", "Qualified", "Proposal", "Negotiation", "Closed Won", "Closed Lost"]) {
      expect(STAGE_COLORS[stage]).toMatch(/^#/);
    }
  });
});
