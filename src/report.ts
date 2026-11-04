// The full property report (US$1): one call answers "should I buy this rental?". The analysis, the same buy in every
// state, what-ifs on rates and growth, the 2027 rules compared, the break-even rent, and a plain-English verdict.
import { PROPERTY_TYPES, STATES, analyse, type AnalysisInput } from "./calc";

const money = (n: number) => `${n < 0 ? "-" : ""}$${Math.abs(Math.round(n)).toLocaleString("en-AU")}`;
const pct = (n: number) => `${Math.round(n * 1000) / 10}%`;

export function report(i: AnalysisInput) {
  const base = analyse(i);
  const weekly = (a: ReturnType<typeof analyse>) => a.year_1.cash_flow_after_tax_per_week;
  const by_state = STATES.map((s) => {
    const a = analyse({ ...i, state: s });
    return { state: s, stamp_duty: a.buying.stamp_duty, cash_needed: a.buying.cash_needed, weekly_after_tax: weekly(a), total_gain_10y: a.sale_after_10_years.total_gain };
  });
  const rate0 = base.inputs.interest_rate, g0 = base.inputs.capital_growth;
  const interest_rate_what_ifs = [-0.01, 0, 0.01, 0.02].map((d) => {
    const r = Math.max(0, Math.round((rate0 + d) * 10000) / 10000), a = analyse({ ...i, interest_rate: r });
    return { interest_rate: r, weekly_after_tax: weekly(a), total_gain_10y: a.sale_after_10_years.total_gain };
  });
  const growth_what_ifs = [0.02, 0.035, 0.05, 0.07].map((g) => ({ capital_growth: g, total_gain_10y: analyse({ ...i, capital_growth: g }).sale_after_10_years.total_gain }));
  const rules_2027_compared = PROPERTY_TYPES.map((t) => {
    const a = analyse({ ...i, property_type: t });
    return { property_type: t, weekly_after_tax_year_2: Math.round(a.ten_years[1]!.cash_flow_after_tax / 52), total_gain_10y: a.sale_after_10_years.total_gain };
  });
  // the weekly rent at which year-1 cash flow after tax is zero
  let lo = 0, hi = Math.max(5000, i.rent_per_week * 4);
  for (let k = 0; k < 40; k++) {
    const mid = (lo + hi) / 2;
    if (analyse({ ...i, rent_per_week: mid }).year_1.cash_flow_after_tax < 0) lo = mid; else hi = mid;
  }
  const breakEven = Math.round(hi);
  const w = weekly(base), up2 = interest_rate_what_ifs[3]!.weekly_after_tax, gain = base.sale_after_10_years.total_gain, low = growth_what_ifs[0]!.total_gain_10y;
  const cheapest = [...by_state].sort((a, b) => a.stamp_duty - b.stamp_duty)[0]!;
  const est = rules_2027_compared.find((t) => t.property_type === "established")!, nb = rules_2027_compared.find((t) => t.property_type === "new_build")!;
  const verdict = [
    `Buying at ${money(base.inputs.price)} in ${base.inputs.state} needs about ${money(base.buying.cash_needed)} upfront, including ${money(base.buying.stamp_duty)} stamp duty.`,
    w >= 0 ? `It pays for itself: about ${money(w)} a week in your pocket after tax in year 1.`
      : `It costs about ${money(-w)} a week out of pocket after tax in year 1; rent would need to be about ${money(breakEven)} a week to break even.`,
    `If interest rates rise 2 points, ${up2 >= 0 ? `it still pays about ${money(up2)} a week` : `that becomes about ${money(-up2)} a week out of pocket`}.`,
    `Over 10 years at ${pct(g0)} growth the estimated total gain is ${money(gain)}; at only 2% growth it would be ${low >= 0 ? `a gain of ${money(low)}` : `a loss of ${money(-low)}`}.`,
    base.inputs.property_type === "established"
      ? `From 1 July 2027 its rental losses can't reduce tax on your wages (they carry forward to later profits and the sale); under those rules the 10-year gain is ${money(est.total_gain_10y)} as an established home vs ${money(nb.total_gain_10y)} as a new build.` : "",
    `Lowest stamp duty for the same price: ${cheapest.state} (${money(cheapest.stamp_duty)}).`,
  ].filter(Boolean).join(" ");
  return { verdict, break_even_rent_per_week: breakEven, by_state, interest_rate_what_ifs, growth_what_ifs, rules_2027_compared, analysis: base,
    note: base.note };
}
