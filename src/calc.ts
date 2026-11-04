// Australian property and tax figures, from official rates (rates.json: every figure carries its source and date).
// The same model as the Australian Property Investment Calculator spreadsheet, so the two always agree.
import R from "./rates.json";

export const STATES = ["NSW", "VIC", "QLD", "WA", "SA", "TAS", "ACT", "NT"] as const;
export type State = (typeof STATES)[number];
export const PROPERTY_TYPES = ["established", "new_build", "established_pre_may_2026"] as const;
export type PropertyType = (typeof PROPERTY_TYPES)[number];

const duty = R.duty as unknown as Record<State, { applies: string; source: string; brackets: [number, number, number][] }>;
const round2 = (n: number) => Math.round(n * 100) / 100;

/** General (investor) transfer duty on an established residential property, Australian-resident buyer. */
export function stampDuty(state: State, price: number): { duty: number; state: State; price: number; applies: string; source: string } {
  if (!(price > 0) || !Number.isFinite(price)) throw new RangeError("price must be a positive number");
  const d = duty[state];
  let amount: number;
  if (state === "NT" && price <= 525_000) {
    const v = price / 1000;
    amount = 0.06571441 * v * v + 15 * v;
  } else {
    const row = d.brackets.filter((b) => b[0] <= price).at(-1) ?? d.brackets[0]!;
    amount = row[1] + (Math.ceil((price - row[0]) / 100) * 100 * row[2]) / 100; // per $100 or part of $100
  }
  return { duty: Math.round(amount), state, price, applies: d.applies, source: d.source };
}

/** Resident income tax + Medicare levy (no offsets), 2026-27. */
export function incomeTax(income: number): number {
  let tax = 0, prevRate = 0;
  for (const [over, rate] of R.tax.brackets as [number, number][]) {
    if (income > over) tax += (income - over) * (rate - prevRate);
    prevRate = rate;
  }
  return tax + Math.max(0, income) * R.tax.medicare;
}
export function incomeTaxReport(income: number) {
  if (!Number.isFinite(income) || income < 0) throw new RangeError("income must be zero or more");
  const total = incomeTax(income);
  const medicare = Math.max(0, income) * R.tax.medicare;
  const marginal = (R.tax.brackets as [number, number][]).filter(([o]) => income > o).at(-1)?.[1] ?? 0;
  return { income, year: R.tax.applies, income_tax: round2(total - medicare), medicare_levy: round2(medicare), total: round2(total),
    marginal_rate: marginal, average_rate: income > 0 ? round2((total / income) * 100) / 100 : 0, source: R.tax.source,
    note: "Resident rates; low-income offsets and the Medicare levy low-income threshold are not applied." };
}

function pmt(rate: number, n: number, pv: number) { return rate === 0 ? pv / n : (pv * rate) / (1 - (1 + rate) ** -n); }
/** Loan balance after k monthly payments. */
function balance(rate: number, n: number, pv: number, k: number) { const p = pmt(rate, n, pv); return rate === 0 ? pv - p * k : pv * (1 + rate) ** k - p * (((1 + rate) ** k - 1) / rate); }

export interface AnalysisInput {
  state: State; price: number; rent_per_week: number; property_type?: PropertyType;
  deposit_pct?: number; interest_rate?: number; loan_years?: number; interest_only?: boolean;
  legal?: number; inspection?: number; lmi?: number; other_buying?: number;
  vacancy_weeks?: number; management_pct?: number; letting_weeks?: number;
  council?: number; water?: number; insurance?: number; strata?: number; maintenance?: number; land_tax?: number; other_running?: number;
  other_income?: number; depreciation?: number;
  capital_growth?: number; rent_growth?: number; cost_growth?: number; depreciation_decline?: number; cpi?: number; selling_pct?: number;
}

/** A full investment-property analysis: buying costs, year-1 cash flow after tax, yields, and 10 years with the
 *  1 July 2027 negative gearing and CGT rules (same method as the spreadsheet). */
export function analyse(i: AnalysisInput) {
  const v = {
    property_type: "established" as PropertyType, deposit_pct: 0.2, interest_rate: 0.0625, loan_years: 30, interest_only: true,
    legal: 1800, inspection: 600, lmi: 0, other_buying: 800, vacancy_weeks: 2, management_pct: 0.077, letting_weeks: 1,
    council: 2200, water: 800, insurance: 1600, strata: 0, maintenance: 1500, land_tax: 0, other_running: 0,
    other_income: 95000, depreciation: 6000, capital_growth: 0.05, rent_growth: 0.03, cost_growth: 0.03, depreciation_decline: 0.1, cpi: 0.025, selling_pct: 0.025,
    ...Object.fromEntries(Object.entries(i).filter(([, x]) => x !== undefined)),
  } as Required<AnalysisInput>;
  if (!(v.rent_per_week >= 0)) throw new RangeError("rent_per_week must be zero or more");
  const duty = stampDuty(v.state, v.price).duty;
  const deposit = v.price * v.deposit_pct, loan = v.price - deposit;
  const cash = deposit + duty + v.legal + v.inspection + v.lmi + v.other_buying;
  const r = v.interest_rate / 12, n = v.loan_years * 12;
  const repay = v.interest_only ? loan * v.interest_rate : pmt(r, n, loan) * 12;
  const fixed = v.council + v.water + v.insurance + v.strata + v.maintenance + v.land_tax + v.other_running;
  const inc = v.other_income, tax0 = incomeTax(inc);
  const years = [];
  let pool = 0, total = 0;
  for (let y = 1; y <= 10; y++) {
    const rent = v.rent_per_week * (52 - v.vacancy_weeks) * (1 + v.rent_growth) ** (y - 1);
    const costs = fixed * (1 + v.cost_growth) ** (y - 1) + rent * v.management_pct + (rent / (52 - v.vacancy_weeks)) * v.letting_weeks;
    const interest = v.interest_only ? loan * v.interest_rate : (balance(r, n, loan, (y - 1) * 12) - balance(r, n, loan, y * 12)) * -1 + repay;
    const dep = v.depreciation * (1 - v.depreciation_decline) ** (y - 1);
    const result = rent - costs - interest - dep;
    const wages = v.property_type !== "established" || y === 1;
    let saved: number;
    if (wages) saved = tax0 - incomeTax(inc + result);
    else if (result > 0) { saved = tax0 - incomeTax(inc + Math.max(0, result - pool)); pool = Math.max(0, pool - result); }
    else { saved = 0; pool -= result; }
    const pre = rent - costs - repay, post = pre + saved;
    total += post;
    years.push({ year: y, value: Math.round(v.price * (1 + v.capital_growth) ** y), loan_owing: Math.round(v.interest_only ? loan : balance(r, n, loan, y * 12)),
      rent: Math.round(rent), costs: Math.round(costs), interest: Math.round(interest), cash_flow_before_tax: Math.round(pre), tax_profit_or_loss: Math.round(result),
      loss_reduces_wage_tax: wages, tax_saved: Math.round(saved), losses_carried_forward: Math.round(pool), cash_flow_after_tax: Math.round(post) });
  }
  const y10 = years[9]!, deps = Array.from({ length: 10 }, (_, k) => v.depreciation * (1 - v.depreciation_decline) ** k).reduce((a, b) => a + b, 0);
  const sale = v.price * (1 + v.capital_growth) ** 10, selling = sale * v.selling_pct;
  const costBase = v.price + duty + v.legal + v.inspection - deps;
  const months = 8 / 12; // bought around Nov 2026: about 8 months to 1 July 2027
  const at2027 = v.price * (1 + v.capital_growth) ** months;
  const preGain = Math.max(0, at2027 - costBase);
  const indexed = at2027 * (1 + v.cpi) ** (10 - months);
  const realGain = Math.max(0, sale - selling - indexed);
  const used = Math.min(pool, 0.5 * preGain + realGain);
  const preTax = incomeTax(inc + Math.max(0, 0.5 * preGain - used)) - tax0;
  const blended = Math.max(incomeTax(inc + Math.max(0, 0.5 * preGain + realGain - used)) - tax0, preTax + R.cgt.min_rate * Math.max(0, realGain - Math.max(0, used - 0.5 * preGain)));
  const discountOnly = incomeTax(inc + Math.max(0, 0.5 * (sale - selling - costBase) - used)) - tax0;
  const cgt = v.property_type === "new_build" ? Math.min(discountOnly, blended) : blended;
  const left = sale - selling - y10.loan_owing - cgt;
  const y1 = years[0]!;
  return {
    inputs: v,
    buying: { stamp_duty: duty, deposit: Math.round(deposit), cash_needed: Math.round(cash), loan: Math.round(loan) },
    year_1: { rent: y1.rent, costs: y1.costs, repayments: Math.round(repay), interest: y1.interest, cash_flow_before_tax: y1.cash_flow_before_tax,
      tax_profit_or_loss: y1.tax_profit_or_loss, tax_saved: y1.tax_saved, cash_flow_after_tax: y1.cash_flow_after_tax, cash_flow_after_tax_per_week: Math.round(y1.cash_flow_after_tax / 52) },
    returns: { gross_yield: round2((v.rent_per_week * 52 / v.price) * 10000) / 10000, net_yield: round2(((y1.rent - y1.costs) / v.price) * 10000) / 10000,
      cash_on_cash_after_tax: round2((y1.cash_flow_after_tax / cash) * 10000) / 10000 },
    ten_years: years,
    sale_after_10_years: { sale_price: Math.round(sale), selling_costs: Math.round(selling), cost_base: Math.round(costBase), value_1_july_2027: Math.round(at2027),
      gain_before_1_july_2027: Math.round(preGain), real_gain_after_1_july_2027: Math.round(realGain), losses_used: Math.round(used), capital_gains_tax: Math.round(cgt),
      left_after_selling: Math.round(left), total_gain: Math.round(left - cash + total) },
    rules: R.cgt.note,
    note: "Estimates for comparing properties; general information, not financial, tax or legal advice. Foreign-buyer surcharges and first-home concessions are not applied.",
  };
}
