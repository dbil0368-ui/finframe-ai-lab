const SUPABASE_URL = "https://pxgoaygwtxrrqkftluut.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_rmuwOPAIqOWlOC6S-Gpnrg_pNfAxHNh";

function send(res, status, body) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  return res.status(status).json(body);
}

async function supabaseRequest(path, options = {}) {
  const secret = process.env.SUPABASE_SECRET_KEY;
  const response = await fetch(SUPABASE_URL + "/rest/v1/" + path, {
    ...options,
    headers: {
      apikey: secret,
      Authorization: "Bearer " + secret,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  const data = await response.json().catch(() => []);
  if (!response.ok) throw new Error("Billing database request failed.");
  return data;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return send(res, 405, { error: "Use POST." });
  }

  const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) return send(res, 401, { error: "Sign in to start Premium." });

  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  const supabaseSecret = process.env.SUPABASE_SECRET_KEY;
  if (!keyId || !keySecret || !supabaseSecret) {
    return send(res, 503, { error: "Premium checkout is not configured yet." });
  }

  try {
    const userResponse = await fetch(SUPABASE_URL + "/auth/v1/user", {
      headers: { apikey: SUPABASE_PUBLISHABLE_KEY, Authorization: "Bearer " + token }
    });
    if (!userResponse.ok) return send(res, 401, { error: "Please sign in again." });
    const user = await userResponse.json();
    if (!user.id || !user.email || !user.email_confirmed_at) return send(res, 403, { error: "Confirm your VYBORA account email before subscribing." });

    const plans = await supabaseRequest("billing_plans?select=razorpay_plan_id,amount_paise,currency,total_count,active&plan_key=eq.pro_usd&limit=1");
    const plan = plans[0];
    if (!plan?.active || plan.currency !== "USD" || Number(plan.amount_paise) !== 500 || !plan.razorpay_plan_id) {
      return send(res, 503, { error: "The USD $5 monthly plan is awaiting Razorpay setup." });
    }

    const existing = await supabaseRequest("billing_subscriptions?select=status&user_id=eq." + encodeURIComponent(user.id) + "&limit=1");
    const existingStatus = existing[0]?.status;
    if (["created", "authenticated", "active", "pending", "halted"].includes(existingStatus)) {
      return send(res, 409, { error: "You already have a subscription in progress or active. Check Plans & Billing." });
    }

    const razorpayResponse = await fetch("https://api.razorpay.com/v1/subscriptions", {
      method: "POST",
      headers: {
        Authorization: "Basic " + Buffer.from(keyId + ":" + keySecret).toString("base64"),
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        plan_id: plan.razorpay_plan_id,
        total_count: Number(plan.total_count) || 1200,
        quantity: 1,
        customer_notify: 1,
        notes: { vybora_user_id: user.id, vybora_plan_key: "pro_usd" }
      })
    });
    const subscription = await razorpayResponse.json().catch(() => ({}));
    if (!razorpayResponse.ok || !subscription.id || !subscription.short_url) {
      console.error("[VYBORA Billing] Razorpay subscription create failed", razorpayResponse.status);
      return send(res, 502, { error: "Razorpay could not create the subscription link. Please try again later." });
    }

    await supabaseRequest("billing_subscriptions?on_conflict=user_id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({
        user_id: user.id,
        plan_key: "pro_usd",
        razorpay_subscription_id: subscription.id,
        status: subscription.status || "created",
        total_count: subscription.total_count || plan.total_count || 1200,
        paid_count: subscription.paid_count || 0,
        customer_email: user.email,
        updated_at: new Date().toISOString()
      })
    });

    return send(res, 200, { checkout_url: subscription.short_url, subscription_id: subscription.id });
  } catch (error) {
    console.error("[VYBORA Billing] checkout failed", String(error?.message || error).slice(0, 180));
    return send(res, 500, { error: "Could not start Premium checkout. Please try again later." });
  }
}
