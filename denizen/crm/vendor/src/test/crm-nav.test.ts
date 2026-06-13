import { describe, it, expect } from "vitest";
import { isKnownCrmTab, resolveCrmNav } from "@/lib/crm-nav";

describe("resolveCrmNav", () => {
  it("maps legacy pipeline to sales", () => {
    expect(resolveCrmNav("pipeline")).toEqual({ tab: "sales", subTab: "pipeline" });
  });

  it("maps legacy tasks to schedule", () => {
    expect(resolveCrmNav("tasks")).toEqual({ tab: "schedule", subTab: "tasks" });
  });

  it("maps sales hub aliases", () => {
    expect(resolveCrmNav("hub")).toEqual({ tab: "sales", subTab: "hub" });
    expect(resolveCrmNav("sales-hub")).toEqual({ tab: "sales", subTab: "hub" });
  });

  it("passes through known tabs", () => {
    expect(resolveCrmNav("contacts")).toEqual({ tab: "contacts" });
  });

  it("recognizes known tabs", () => {
    expect(isKnownCrmTab("analytics")).toBe(true);
    expect(isKnownCrmTab("pipeline")).toBe(true);
    expect(isKnownCrmTab("nope")).toBe(false);
  });
});
