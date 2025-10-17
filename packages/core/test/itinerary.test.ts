import { describe, expect, it } from "vitest";
import { createSkeletonPlan, summarizePreferences, type TravelPreferences } from "../src";

describe("Travel core utilities", () => {
  const preferences: TravelPreferences = {
    destination: "东京",
    days: 3,
    budgetCNY: 8000,
    companions: 2,
    interests: ["美食", "文化"]
  };

  it("summarizePreferences produces human readable output", () => {
    const summary = summarizePreferences(preferences);
    expect(summary).toContain("东京");
    expect(summary).toContain("3 天");
    expect(summary).toContain("8000 元");
  });

  it("createSkeletonPlan initializes placeholders for each day", () => {
    const plan = createSkeletonPlan(preferences);
    expect(plan.dayPlans).toHaveLength(3);
    expect(plan.dayPlans[0].highlights).toContain("即将由大模型补全");
  });
});
