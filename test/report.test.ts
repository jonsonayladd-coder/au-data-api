// The US$1 full report: verdict, break-even rent, all states, what-ifs, the 2027 rules compared.
import { describe, expect, it } from "vitest";
import { analyse } from "../src/calc";
import { report } from "../src/report";
import { routes } from "../src/index";

describe("full property report", () => {
  const r = report({ state: "QLD", price: 650000, rent_per_week: 620 });
  it("matches the analysis and compares every state", () => {
    expect(r.analysis.buying.cash_needed).toBe(155475);
    expect(r.by_state).toHaveLength(8);
    expect(r.by_state.find((s) => s.state === "VIC")!.stamp_duty).toBe(34070);
  });
  it("break-even rent really breaks even", () => {
    const at = analyse({ state: "QLD", price: 650000, rent_per_week: r.break_even_rent_per_week }).year_1.cash_flow_after_tax;
    expect(Math.abs(at)).toBeLessThan(60);
    expect(r.break_even_rent_per_week).toBeGreaterThan(620);
  });
  it("higher rates cost more each week; more growth gains more", () => {
    const w = r.interest_rate_what_ifs.map((x) => x.weekly_after_tax);
    expect(w[3]!).toBeLessThan(w[1]!);
    const g = r.growth_what_ifs.map((x) => x.total_gain_10y);
    expect(g[3]!).toBeGreaterThan(g[0]!);
  });
  it("compares the 2027 rules and says it in plain words", () => {
    expect(r.rules_2027_compared.map((t) => t.property_type)).toEqual(["established", "new_build", "established_pre_may_2026"]);
    expect(r.verdict).toContain("$155,475 upfront");
    expect(r.verdict).toContain("$22,275 stamp duty");
    expect(r.verdict).toMatch(/a week out of pocket after tax/);
    expect(r.verdict).toContain("From 1 July 2027");
  });
  it("is sold at US$1", () => expect(routes("0x1111111111111111111111111111111111111111")["GET /v1/property-report"].accepts.price).toBe("$1.00"));
});
