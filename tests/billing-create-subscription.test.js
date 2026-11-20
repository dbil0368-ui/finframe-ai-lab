import { test } from "node:test";
import assert from "node:assert/strict";
import createSubscription from "../api/billing/create-subscription.js";

function response(body, ok = true) {
  return { ok, json: async () => body };
}
function createResponse() {
  return {
    statusCode: 200,
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

test("Razorpay checkout stores subscriptions against the test environment primary key", async () => {
  const oldFetch = globalThis.fetch;
  const keys = ["SUPABASE_SECRET_KEY", "RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET", "RAZORPAY_WEBHOOK_SECRET"];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  const calls = [];
  process.env.SUPABASE_SECRET_KEY = "test-supabase-secret";
  process.env.RAZORPAY_KEY_ID = "rzp_test_123";
  process.env.RAZORPAY_KEY_SECRET = "test-razorpay-secret";
  process.env.RAZORPAY_WEBHOOK_SECRET = "test-webhook-secret";

  globalThis.fetch = async (input, options = {}) => {
    const url = String(input);
    calls.push({ url, options });
    if (url.endsWith("/auth/v1/user")) return response({ id: "user-123", email: "creator@example.test" });
    if (url.includes("/rest/v1/billing_subscriptions?select=")) return response([]);
    if (url.includes("/rest/v1/billing_plans?")) {
      return response([{
        plan_key: "starter",
        razorpay_plan_id: "plan_test_starter",
        amount_paise: 19900,
        currency: "INR",
        period: "monthly",
        interval_count: 1,
        total_count: 12
      }]);
    }
    if (url === "https://api.razorpay.com/v1/subscriptions" && options.method === "POST") {
      return response({ id: "sub_test_123", status: "created", total_count: 12 });
    }
    if (url.includes("/rest/v1/billing_subscriptions?on_conflict=user_id,environment")) return response([]);
    throw new Error("Unexpected request: " + url);
  };

  const res = createResponse();
  try {
    await createSubscription({
      method: "POST",
      headers: { authorization: "Bearer test-session" },
      body: { plan: "starter" }
    }, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.subscriptionId, "sub_test_123");
    assert.equal(res.body.keyId, "rzp_test_123");

    const existingQuery = calls.find(call => call.url.includes("/rest/v1/billing_subscriptions?select="));
    assert.match(existingQuery.url, /environment=eq\.test/);

    const insert = calls.find(call => call.url.includes("/rest/v1/billing_subscriptions?on_conflict="));
    assert.ok(insert);
    assert.match(insert.url, /on_conflict=user_id,environment/);
    const row = JSON.parse(insert.options.body);
    assert.equal(row.user_id, "user-123");
    assert.equal(row.environment, "test");
    assert.equal(row.razorpay_subscription_id, "sub_test_123");
  } finally {
    globalThis.fetch = oldFetch;
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
});
