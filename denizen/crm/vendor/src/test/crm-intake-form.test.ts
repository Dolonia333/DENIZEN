import { describe, it, expect } from "vitest";
import {
  createBlankIntakeQuestion,
  embedSnippet,
  moveIntakeQuestion,
  normalizeIntakeQuestions,
  parseOptionsText,
  removeIntakeQuestion,
  updateIntakeQuestion,
} from "@/lib/crm-intake-form";
import { defaultIntakeQuestions } from "@/lib/crm-data";

describe("crm-intake-form", () => {
  it("normalizes empty input to defaults", () => {
    expect(normalizeIntakeQuestions(null)).toEqual(defaultIntakeQuestions);
    expect(normalizeIntakeQuestions([])).toEqual(defaultIntakeQuestions);
  });

  it("keeps valid custom questions and drops blank labels", () => {
    const next = normalizeIntakeQuestions([
      { id: 9, label: "Budget", type: "select", required: true, options: ["A", "B"], icon: "$" },
      { id: 10, label: "  ", type: "text", required: false },
      { label: "Notes", type: "weird", required: false },
    ]);
    expect(next).toHaveLength(2);
    expect(next[0].label).toBe("Budget");
    expect(next[0].options).toEqual(["A", "B"]);
    expect(next[1].type).toBe("text");
  });

  it("moves, updates, and removes questions", () => {
    let list = defaultIntakeQuestions.slice(0, 3);
    list = moveIntakeQuestion(list, list[0].id, 1);
    expect(list[1].id).toBe(defaultIntakeQuestions[0].id);

    list = updateIntakeQuestion(list, list[0].id, { label: "Updated", type: "select" });
    expect(list[0].label).toBe("Updated");
    expect(list[0].options?.length).toBeGreaterThan(0);

    const before = list.length;
    list = removeIntakeQuestion(list, list[0].id);
    expect(list.length).toBe(before - 1);
  });

  it("creates blank questions and parses options", () => {
    const blank = createBlankIntakeQuestion([]);
    expect(blank.id).toBe(1);
    expect(parseOptionsText("A\nB, C")).toEqual(["A", "B", "C"]);
  });

  it("builds an embed snippet", () => {
    expect(embedSnippet("acme", "https://example.com/crm/intake.html?org=acme")).toContain("iframe");
    expect(embedSnippet("acme", "")).toContain("org=acme");
  });
});
