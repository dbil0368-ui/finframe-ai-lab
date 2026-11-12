import crypto from "node:crypto";

const SUPABASE_URL = "https://pxgoaygwtxrrqkftluut.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_rmuwOPAIqOWlOC6S-Gpnrg_pNfAxHNh";

function send(res, status, body) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  return res.status(status).json(body);
}
async function authUser(req) {
  const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const response = await fetch(SUPABASE_URL + "/auth/v1/user", {
    headers: { apikey: SUPABASE_PUBLISHABLE_KEY, Authorization: "Bearer " + token }
  });
  if (!response.ok) return null;
  return response.json();
}
async function db(path, options = {}) {
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!secret) throw new Error("SUPABASE_SECRET_KEY is not configured for this Preview.");
  const response = await fetch(SUPABASE_URL + "/rest/v1/" + path, {
    ...options,
    headers: {
      apikey: secret,
      Authorization: "Bearer " + secret,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error("Billing database request failed (" + response.status + ").");
  return data;
}
async function razorpay(path, method, body) {
  const id = process.env.RAZORPAY_KEY_ID;
  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (!id || !secret || !id.startsWith("rzp_test_")) throw new Error("Razorpay Test Mode keys are not configured for Preview.");
  const response = await fetch("https://api.razorpay.com/v1/" + path, {
    method,
    headers: {
      Authorization: "Basic " + Buffer.from(id + ":" + secret).toString("base64"),
      "Content-Type": "application/json"
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.description || "Razorpay request failed.");
  return data;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return send(res, 405, { error: "Use POST." });
  }
  const user = await authUser(req);
  if (!user?.id) return send(res, 401, { error: "Please sign in to VYBORA first." });
  const planKey = req.body?.plan;
  if (!["starter", "pro"].includes(planKey)) return send(res, 400, { error: "Choose a valid plan." });

  try {
    const existing = await db("billing_subscriptions?select=razorpay_subscription_id,status,plan_key&user_id=eq." + encodeURIComponent(user.id) + "&order=updated_at.desc&limit=1");
    if (existing[0] && ["created", "authenticated", "active", "pending", "halted"].includes(existing[0].status)) {
      return send(res, 409, { error: "You already have a subscription in progress or active. Refresh your billing status before starting another." });
    }

    const planRows = await db("billing_plans?select=plan_key,razorpay_plan_id,amount_paise,currency,period,interval_count,total_count&plan_key=eq." + planKey + "&active=eq.true&limit=1");
    const plan = planRows[0];
    if (!plan) return send(res, 503, { error: "This plan is not available right now." });

    let razorpayPlanId = plan.razorpay_plan_id;
    if (!razorpayPlanId) {
      const createdPlan = await razorpay("plans", "POST", {
        period: "monthly",
        interval: 1,
        item: {
          name: "VYBORA " + (planKey === "starter" ? "Starter" : "Pro"),
          amount: plan.amount_paise,
          currency: "INR",
          description: "VYBORA " + (planKey === "starter" ? "Starter" : "Pro") + " monthly creator tools plan"
        },
        notes: { vybora_plan_key: planKey }
      });
      razorpayPlanId = createdPlan.id;
      await db("billing_plans?plan_key=eq." + planKey, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ razorpay_plan_id: razorpayPlanId, updated_at: new Date().toISOString() })
      });
    }

    const subscription = await razorpay("subscriptions", "POST", {
      plan_id: razorpayPlanId,
      total_count: plan.total_count || 12,
      quantity: 1,
      customer_notify: 1,
      notes: { vybora_user_id: user.id, vybora_plan_key: planKey, customer_email: user.email || "" }
    });

    await db("billing_subscriptions?on_conflict=user_id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({
        user_id: user.id,
        plan_key: planKey,
        razorpay_subscription_id: subscription.id,
        status: subscription.status || "created",
        current_start: subscription.current_start ? new Date(subscription.current_start * 1000).toISOString() : null,
        current_end: subscription.current_end ? new Date(subscription.current_end * 1000).toISOString() : null,
        charge_at: subscription.charge_at ? new Date(subscription.charge_at * 1000).toISOString() : null,
        total_count: subscription.total_count || 12,
        customer_email: user.email || null,
        updated_at: new Date().toISOString()
      })
    });

    return send(res, 200, {
      subscriptionId: subscription.id,
      keyId: process.env.RAZORPAY_KEY_ID,
      plan: planKey,
      amount: plan.amount_paise,
      currency: plan.currency,
      status: subscription.status || "created",
      customerEmail: user.email || ""
    });
  } catch (error) {
    console.error("[VYBORA Billing] create subscription failed", String(error?.message || error).slice(0, 240));
    return send(res, 503, { error: error?.message || "Could not start checkout. Please try again." });
  }
}
