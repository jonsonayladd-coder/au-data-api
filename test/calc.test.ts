// The service's figures must match the spreadsheet (checked by hand against the official tables).
import { describe, expect, it } from "vitest";
import { analyse, incomeTaxReport, stampDuty } from "../src/calc";

describe("stamp duty, all states (same as the spreadsheet)", () => {
  const want: Record<string, [number, number, number]> = {
    NSW: [12187, 23437, 48187], VIC: [19070, 34070, 66000], QLD: [12425, 22275, 49525], WA: [13015, 24890, 52916],
    SA: [16330, 29580, 59830], TAS: [13998, 24623, 49185], ACT: [8000, 17880, 49750], NT: [16514, 32175, 59400],
  };
  for (const [s, v] of Object.entries(want)) it(s, () => {
    expect([400000, 650000, 1200000].map((p) => stampDuty(s as never, p).duty)).toEqual(v);
  });
  it("refuses a bad price", () => expect(() => stampDuty("QLD", -1)).toThrow(/positive/));
});

describe("income tax 2026-27", () => {
  it("matches the ATO scale", () => {
    expect(incomeTaxReport(95000)).toMatchObject({ income_tax: 19020, medicare_levy: 1900, total: 20920, marginal_rate: 0.3 });
    expect(incomeTaxReport(18200).total).toBeCloseTo(364, 0);
    expect(incomeTaxReport(200000).income_tax).toBe(55870);
  });
});

describe("property analysis (same defaults as the spreadsheet)", () => {
  const a = analyse({ state: "QLD", price: 650000, rent_per_week: 620 });
  it("buying and year 1", () => {
    expect(a.buying).toEqual({ stamp_duty: 22275, deposit: 130000, cash_needed: 155475, loan: 520000 });
    expect(a.year_1.tax_saved).toBe(5314);
    expect(a.year_1.cash_flow_after_tax).toBe(-5293);
  });
  it("2027 rules: established loses wage offset after year 1, losses carry forward", () => {
    expect(a.ten_years[1]).toMatchObject({ loss_reduces_wage_tax: false, tax_saved: 0, losses_carried_forward: 15350 });
    expect(a.ten_years[9]!.losses_carried_forward).toBe(96494);
    expect(a.sale_after_10_years).toMatchObject({ capital_gains_tax: 40471, total_gain: 247659 });
  });
  it("new build and pre-May-2026 keep negative gearing", () => {
    expect(analyse({ state: "QLD", price: 650000, rent_per_week: 620, property_type: "new_build" }).sale_after_10_years.total_gain).toBe(236180);
    expect(analyse({ state: "QLD", price: 650000, rent_per_week: 620, property_type: "established_pre_may_2026" }).sale_after_10_years.total_gain).toBe(233185);
  });
  it("principal and interest", () => {
    const p = analyse({ state: "QLD", price: 650000, rent_per_week: 620, interest_only: false });
    expect(p.year_1.repayments).toBe(38421);
    expect(p.ten_years[9]!.loan_owing).toBeLessThan(520000);
  });
});
