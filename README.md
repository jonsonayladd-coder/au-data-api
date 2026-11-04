# Australia Data for agents

**Live:** https://au-data-api.allgoodnow.workers.dev · **Network:** Base (USDC) · **Protocol:** [x402](https://x402.org) · **Listed on:** [x402scan](https://www.x402scan.com)

A pay-per-call API that AI agents use to answer Australian property and tax questions: stamp duty in every state, 2026-27 income tax, and full investment-property analysis, already updated for the **1 July 2027 negative gearing and capital gains tax changes**. There are no accounts and no API keys. An agent calls the endpoint, gets a `402 Payment Required`, pays a few cents (or US$1 for the full report) in USDC on Base, and gets the answer.

It runs on one Cloudflare Worker, needs no server, and costs nothing to host.

## Endpoints

| Endpoint | Price | What it returns |
|---|---|---|
| `GET /v1/stamp-duty?state=QLD&price=650000` | $0.005 | Transfer duty for an investor, any state or territory, with the official source |
| `GET /v1/income-tax?income=95000` | $0.003 | 2026-27 resident income tax + Medicare levy, marginal and average rates |
| `GET /v1/property-analysis?state=NSW&price=850000&rent_per_week=700` | $0.03 | Cash needed, year-1 cash flow after tax (negative gearing), yields, 10-year projection |
| `GET /v1/property-report?state=NSW&price=850000&rent_per_week=700` | $1.00 | Plain-English verdict, break-even rent, all 8 states compared, rate and growth what-ifs, 2027 rules compared |

Free: `GET /` (index), `GET /openapi.json`, `GET /.well-known/x402`, `GET /health`.

Sample verdict from `/v1/property-report`:

> Buying at $850,000 in NSW needs about $205,637 upfront, including $32,437 stamp duty. It costs about $185 a week out of pocket after tax in year 1; rent would need to be about $1,014 a week to break even. If interest rates rise 2 points, that becomes about $363 a week out of pocket. Over 10 years at 5% growth the estimated total gain is $296,942; at only 2% growth it would be a loss of $651. …

## How it's built (x402 on Cloudflare Workers, in about 150 lines)

```ts
import { Hono } from "hono";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { bazaarResourceServerExtension, declareDiscoveryExtension } from "@x402/extensions/bazaar";
import { paymentMiddleware, x402ResourceServer } from "@x402/hono";

const server = new x402ResourceServer(new HTTPFacilitatorClient({ url: "https://facilitator.payai.network" }))
  .register("eip155:8453", new ExactEvmScheme())          // Base mainnet, USDC
  .registerExtension(bazaarResourceServerExtension);      // discovery metadata

app.use(paymentMiddleware({
  "GET /v1/stamp-duty": {
    accepts: { scheme: "exact", price: "$0.005", network: "eip155:8453", payTo: env.PAY_TO },
    description: "Australian stamp duty …",
    extensions: declareDiscoveryExtension({ input: { state: "QLD", price: 650000 }, inputSchema: { /* … */ } }),
  },
}, server));
```

Lessons worth sharing:

- **The facilitator.** The x402.org facilitator only covers testnets. [PayAI's facilitator](https://facilitator.payai.network/supported) settles on Base mainnet with no API keys and supports the Bazaar discovery extension.
- **Let probes reach the 402.** Directories such as x402scan probe each route with no inputs, or with placeholder inputs. If you validate the query before the paywall, they get a 400 and won't register the route. Validate in the handler instead. The x402 middleware never settles a response of 400 or more, so a failed call is never charged.
- **Discovery.** Serve `/openapi.json` (with `x-payment-info` per operation) and `/.well-known/x402`. Then x402scan registers every route in one go.
- **Keep the payee out of git.** `PAY_TO` is a Worker secret (`wrangler secret put PAY_TO`). The Worker returns 503 until it's set.
- **Price for the whole answer.** Most x402 value moves in calls of US$1 or more. One call that answers the question an agent actually has ("should I buy this rental?") is worth more than many tiny lookups.

## The numbers

All rates sit in [`src/rates.json`](src/rates.json), each with its official source and date: the eight state revenue offices, the ATO 2026-27 resident scale, and the ATO and Budget 2026-27 explainers on the 1 July 2027 changes. Stamp duty is charged per $100 or part of $100. Victoria (from $960k), the ACT top band and the NT (over $525k) tax the whole value at a flat rate, and the NT formula applies below $525k. The tests check every state at three prices against hand calculations.

The same model also ships as a spreadsheet: the Australian Property Investment Calculator.

## Run it yourself

```bash
npm install
npm test                      # 25 tests (one hits the live PayAI facilitator)
npx wrangler deploy
printf '0xYourAddress' | npx wrangler secret put PAY_TO
```

## Please note

These are estimates for comparing properties. They are general information, not financial, tax or legal advice. Foreign-buyer surcharges, first-home concessions, low-income tax offsets and land-tax thresholds aren't applied.

MIT licensed.
