// Australia Data for agents: Australian stamp duty, income tax and investment-property analysis, sold per call over
// x402 (USDC on Base) through the PayAI facilitator, and listed in the x402 Bazaar so agents can find it.
import { Hono } from "hono";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { bazaarResourceServerExtension, declareDiscoveryExtension } from "@x402/extensions/bazaar";
import { paymentMiddleware, x402ResourceServer } from "@x402/hono";
import { PROPERTY_TYPES, STATES, analyse, incomeTaxReport, stampDuty, type AnalysisInput, type State } from "./calc";
import { report } from "./report";

export interface Env { PAY_TO: string; FACILITATOR_URL: string; NETWORK: string; VERIFY_402INDEX?: string }

const BASE = "eip155:8453";
const num = (v: string | undefined) => (v == null || v === "" ? undefined : Number(v));
const state = (v: string | undefined): State => {
  const s = (v ?? "").toUpperCase();
  if (!(STATES as readonly string[]).includes(s)) throw new RangeError(`state must be one of ${STATES.join(", ")}`);
  return s as State;
};

export const PRICES = { duty: "$0.005", tax: "$0.003", analysis: "$0.03", report: "$1.00" } as const;

const PROPERTY_INPUTS = {
  properties: {
    state: { type: "string", enum: [...STATES] }, price: { type: "number", description: "Purchase price in AUD" }, rent_per_week: { type: "number", description: "Weekly rent in AUD" },
    property_type: { type: "string", enum: [...PROPERTY_TYPES], description: "established (bought after 12 May 2026), new_build, or established_pre_may_2026" },
    deposit_pct: { type: "number", description: "0.2 = 20%" }, interest_rate: { type: "number", description: "0.0625 = 6.25%" }, interest_only: { type: "boolean" },
    other_income: { type: "number", description: "Owner's other taxable income, AUD" }, depreciation: { type: "number", description: "Year-1 depreciation claim, AUD" },
  },
  required: ["state", "price", "rent_per_week"],
};

export function routes(payTo: string, network = BASE) {
  const pay = (price: string) => ({ scheme: "exact" as const, price, network: network as `${string}:${string}`, payTo });
  return {
    "GET /v1/stamp-duty": {
      accepts: pay(PRICES.duty), mimeType: "application/json",
      description: "Australian stamp duty (transfer duty) for an investor buying residential property, any state or territory, official 2026-27 rates with source.",
      extensions: declareDiscoveryExtension({
        input: { state: "QLD", price: 650000 },
        inputSchema: { properties: { state: { type: "string", enum: [...STATES], description: "NSW, VIC, QLD, WA, SA, TAS, ACT or NT" }, price: { type: "number", description: "Purchase price in AUD" } }, required: ["state", "price"] },
        output: { example: { duty: 22275, state: "QLD", price: 650000, applies: "Current (checked Jun 2026)", source: "https://qro.qld.gov.au/duties/transfer-duty/calculating/rates/" } },
      }),
    },
    "GET /v1/income-tax": {
      accepts: pay(PRICES.tax), mimeType: "application/json",
      description: "Australian resident income tax and Medicare levy for 2026-27 (ATO rates), with marginal and average rates.",
      extensions: declareDiscoveryExtension({
        input: { income: 95000 },
        inputSchema: { properties: { income: { type: "number", description: "Taxable income in AUD" } }, required: ["income"] },
        output: { example: { income: 95000, year: "2026-27", income_tax: 19020, medicare_levy: 1900, total: 20920, marginal_rate: 0.3 } },
      }),
    },
    "GET /v1/property-analysis": {
      accepts: pay(PRICES.analysis), mimeType: "application/json",
      description: "Full Australian investment-property analysis: stamp duty, cash needed, year-1 cash flow after tax (negative gearing), yields, and a 10-year projection with the 1 July 2027 negative gearing and CGT changes.",
      extensions: declareDiscoveryExtension({
        input: { state: "NSW", price: 850000, rent_per_week: 700 },
        inputSchema: PROPERTY_INPUTS,
        output: { example: { buying: { stamp_duty: 30187, cash_needed: 203387 }, year_1: { cash_flow_after_tax_per_week: -230 }, sale_after_10_years: { total_gain: 290000 } } },
      }),
    },
    "GET /v1/property-report": {
      accepts: pay(PRICES.report), mimeType: "application/json",
      description: "Complete Australian investment-property report in one call: plain-English verdict, break-even rent, the same buy compared across all 8 states, interest-rate and growth what-ifs, established vs new build under the 1 July 2027 negative gearing and CGT changes, plus the full 10-year analysis.",
      extensions: declareDiscoveryExtension({
        input: { state: "NSW", price: 850000, rent_per_week: 700 },
        inputSchema: PROPERTY_INPUTS,
        output: { example: { verdict: "Buying at $850,000 in NSW needs about $203,000 upfront, including $30,187 stamp duty. It costs about $230 a week out of pocket after tax in year 1…", break_even_rent_per_week: 905, by_state: [{ state: "NSW", stamp_duty: 30187 }] } },
      }),
    },
  };
}

export function openapi(origin: string) {
  const paths: Record<string, unknown> = {};
  for (const [key, r] of Object.entries(routes("0x0000000000000000000000000000000000000000"))) {
    const path = key.split(" ")[1]!;
    const info = (r.extensions as unknown as { bazaar: { info: { input: unknown }; schema: { properties: { input: { properties: { queryParams: { properties: Record<string, { type: string; description?: string; enum?: string[] }>; required?: string[] } } } } } } }).bazaar;
    const qp = info.schema.properties.input.properties.queryParams;
    paths[path] = { get: {
      summary: r.description, operationId: path.replace(/\W+/g, "_"),
      parameters: Object.entries(qp.properties).map(([name, sch]) => ({ name, in: "query", required: (qp.required ?? []).includes(name), schema: sch, description: sch.description })),
      "x-payment-info": { protocols: ["x402"], price: { mode: "fixed", currency: "USD", amount: r.accepts.price.replace("$", "") } },
      responses: { "200": { description: "Result (JSON)" }, "402": { description: "Payment required (x402, USDC on Base)" }, "400": { description: "Bad input" } },
    } };
  }
  return { openapi: "3.1.0", info: { title: "Australia Data for agents", version: "1.0.0", description: DOCS.about }, servers: [{ url: origin }], paths };
}

const DOCS = {
  name: "Australia Data for agents",
  about: "Australian stamp duty, income tax and investment-property analysis from official 2026-27 rates, with the 1 July 2027 negative gearing and CGT changes. Pay per call in USDC on Base (x402).",
  endpoints: {
    "GET /v1/stamp-duty?state=QLD&price=650000": PRICES.duty,
    "GET /v1/income-tax?income=95000": PRICES.tax,
    "GET /v1/property-analysis?state=NSW&price=850000&rent_per_week=700[&property_type=new_build&...]": PRICES.analysis,
    "GET /v1/property-report?state=NSW&price=850000&rent_per_week=700[&...same options]": PRICES.report,
  },
  free: { "GET /": "this page", "GET /health": "status" },
  note: "Estimates; general information, not financial, tax or legal advice.",
};

export function makeApp(env: Env) {
  const app = new Hono();
  app.onError((e, c) => c.json({ error: e instanceof RangeError ? e.message : "internal error" }, e instanceof RangeError ? 400 : 500));
  app.get("/", (c) => c.json(DOCS));
  app.get("/health", (c) => c.json({ ok: true }));
  // discovery for the x402 directories (x402scan, agentcash): OpenAPI first, /.well-known/x402 for compatibility
  app.get("/.well-known/x402", (c) => {
    const o = new URL(c.req.url).origin;
    return c.json({ version: 1, resources: Object.keys(routes(env.PAY_TO)).map((k) => o + k.split(" ")[1]), ownershipProofs: [] });
  });
  app.get("/openapi.json", (c) => c.json(openapi(new URL(c.req.url).origin)));
  // 402 Index domain ownership: the public hash of the claim token (the token itself is a Cloudflare secret)
  app.get("/.well-known/402index-verify.txt", (c) => (env.VERIFY_402INDEX ? c.text(env.VERIFY_402INDEX) : c.notFound()));
  // inputs are checked in the handlers: a call that fails returns 400 and its payment is cancelled (the x402
  // middleware never settles a response of 400 or more), so a directory's probe always reaches the 402 challenge
  // some directories (x402dash) read the payment terms from the body, not the v2 PAYMENT-REQUIRED header: send both
  app.use("/v1/*", async (c, next) => {
    await next();
    const hdr = c.res.headers.get("payment-required");
    if (c.res.status !== 402 || !hdr || !(c.res.headers.get("content-type") ?? "").includes("json")) return;
    const body = await c.res.clone().text();
    if (body.includes('"accepts"')) return;
    const headers = new Headers(c.res.headers);
    c.res = new Response(atob(hdr), { status: 402, headers });
  });
  const server = new x402ResourceServer(new HTTPFacilitatorClient({ url: env.FACILITATOR_URL }))
    .register(env.NETWORK as `${string}:${string}`, new ExactEvmScheme())
    .registerExtension(bazaarResourceServerExtension);
  // On Workers, a fetch belongs to the request that started it: the middleware's own start-up sync would begin in
  // whichever request built the app (say, the index page) and hang later paid calls. Each paid request syncs with
  // the facilitator itself until one succeeds.
  let ready = false;
  app.use("/v1/*", async (_c, next) => {
    if (!ready) { await server.initialize(); ready = true; }
    await next();
  });
  app.use(paymentMiddleware(routes(env.PAY_TO, env.NETWORK), server, undefined, undefined, false));
  app.get("/v1/stamp-duty", (c) => c.json(stampDuty(state(c.req.query("state")), Number(c.req.query("price")))));
  app.get("/v1/income-tax", (c) => c.json(incomeTaxReport(Number(c.req.query("income")))));
  app.get("/v1/property-analysis", (c) => c.json(analyse(inputsFrom(c.req.query()))));
  app.get("/v1/property-report", (c) => c.json(report(inputsFrom(c.req.query()))));
  return app;
}

export function inputsFrom(q: Record<string, string>): AnalysisInput {
  const pt = q.property_type && (PROPERTY_TYPES as readonly string[]).includes(q.property_type) ? (q.property_type as (typeof PROPERTY_TYPES)[number]) : undefined;
  const price = Number(q.price), rent = Number(q.rent_per_week);
  if (!(price > 0)) throw new RangeError("price must be a positive number");
  if (!(rent >= 0)) throw new RangeError("rent_per_week must be zero or more");
  return {
    state: state(q.state), price, rent_per_week: rent, property_type: pt,
    deposit_pct: num(q.deposit_pct), interest_rate: num(q.interest_rate), loan_years: num(q.loan_years),
    interest_only: q.interest_only == null ? undefined : q.interest_only !== "false",
    other_income: num(q.other_income), depreciation: num(q.depreciation), council: num(q.council), strata: num(q.strata),
    insurance: num(q.insurance), maintenance: num(q.maintenance), land_tax: num(q.land_tax), capital_growth: num(q.capital_growth), rent_growth: num(q.rent_growth),
  };
}

let app: Hono | undefined;
export default {
  fetch(req: Request, env: Env, ctx: ExecutionContext) {
    if (!/^0x[0-9a-fA-F]{40}$/.test(env.PAY_TO ?? "")) return Response.json({ error: "not open yet" }, { status: 503 });
    app ??= makeApp(env);
    return app.fetch(req, env, ctx);
  },
};
