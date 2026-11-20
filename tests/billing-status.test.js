import { test } from "node:test";
import assert from "node:assert/strict";
import billingStatus from "../api/billing/status.js";

async function invoke({ webhookSecret = "test-webhook-secret" } = {}) {
  const oldFetch = globalThis.fetch;
  const keys = ["SUPABASE_SECRET_KEY", "RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET", "RAZORPAY_WEBHOOK_SECRET"];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  process.env.SUPABASE_SECRET_KEY = "test-supabase-secret";
  process.env.RAZORPAY_KEY_ID = "rzp_test_123";
  process.env.RAZORPAY_KEY_SECRET = "test-razorpay-secret";
  if (webhookSecret) process.env.RAZORPAY_WEBHOOK_SECRET = webhookSecret;
  else delete process.env.RAZORPAY_WEBHOOK_SECRET;
  globalThis.fetch = async url => {
    if (String(url).endsWith("/auth/v1/user")) return { ok: true, json: async () => ({ id: "user-123" }) };
    if (String(url).includes("/billing_subscriptions?")) return { ok: true, json: async () => [] };
    if (String(url).includes("/billing_plans?")) return { ok: true, json: async () => [] };
    throw new Error("Unexpected URL: " + url);
  };
  const res = {
    statusCode: 200,
    setHeader() {},
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
  try {
    await billingStatus({ method: "GET", headers: { authorization: "Bearer test-session" } }, res);
    return res;
  } finally {
    globalThis.fetch = oldFetch;
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
}

test("billing status exposes only a test-mode readiness boolean", async () => {
  const res = await invoke();
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.checkoutAvailable, true);
  assert.equal(res.body.checkoutMode, "test");
  assert.equal(res.body.subscription, null);
  assert.equal("keyId" in res.body, false);
});

test("billing stays disabled until a webhook secret exists", async () => {
  const res = await invoke({ webhookSecret: "" });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.checkoutAvailable, false);
  assert.equal(res.body.checkoutMode, "disabled");
});
