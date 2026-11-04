// The service over HTTP: free pages are free, bad inputs are refused before any payment, and a paid route asks for
// payment (402) with the price, Base USDC and the payee. Uses the live PayAI facilitator.
import { describe, expect, it } from "vitest";
import { makeApp, routes } from "../src/index";

const env = { PAY_TO: "0x1111111111111111111111111111111111111111", FACILITATOR_URL: "https://facilitator.payai.network", NETWORK: "eip155:8453" };
const app = makeApp(env);

describe("HTTP", () => {
  it("the index is free", async () => {
    const r = await app.request("/");
    expect(r.status).toBe(200);
    expect(((await r.json()) as { endpoints: unknown }).endpoints).toBeTruthy();
  });
  it("any probe, even with odd inputs, reaches the payment challenge (a failed paid call is never charged)", async () => {
    expect((await app.request("/v1/stamp-duty?state=XX&price=1")).status).toBe(402);
    expect((await app.request("/v1/stamp-duty?state=string&price=0")).status).toBe(402);
  }, 30000);
  it("a paid route asks for payment", async () => {
    const r = await app.request("/v1/stamp-duty?state=QLD&price=650000");
    expect(r.status).toBe(402);
    const hdr = r.headers.get("payment-required");
    const body = hdr ? JSON.parse(atob(hdr)) : await r.json();
    const acc = body.accepts[0];
    expect(acc.network).toBe("eip155:8453");
    expect(acc.payTo).toBe(env.PAY_TO);
    expect(Number(acc.amount ?? acc.maxAmountRequired)).toBe(5000); // $0.005 in USDC's 6 decimals
    expect(JSON.stringify(body)).toContain("bazaar");
  }, 30000);
  it("a bare probe (a directory checking the route) gets the payment challenge, not an error", async () => {
    for (const path of ["/v1/stamp-duty", "/v1/income-tax", "/v1/property-analysis"]) expect((await app.request(path)).status).toBe(402);
  }, 30000);
  it("discovery files list every paid route with its price", async () => {
    const wk = (await (await app.request("http://x.test/.well-known/x402")).json()) as { resources: string[] };
    expect(wk.resources).toEqual(["http://x.test/v1/stamp-duty", "http://x.test/v1/income-tax", "http://x.test/v1/property-analysis", "http://x.test/v1/property-report"]);
    const oa = (await (await app.request("http://x.test/openapi.json")).json()) as { paths: Record<string, { get: { "x-payment-info": { price: { amount: string } }; parameters: { name: string }[] } }> };
    expect(oa.paths["/v1/stamp-duty"]!.get["x-payment-info"].price.amount).toBe("0.005");
    expect(oa.paths["/v1/stamp-duty"]!.get.parameters.map((p) => p.name)).toEqual(["state", "price"]);
  });
  it("every route is listed for discovery", () => expect(Object.keys(routes(env.PAY_TO))).toHaveLength(4));
});
