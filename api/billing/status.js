const SUPABASE_URL = "https://pxgoaygwtxrrqkftluut.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_rmuwOPAIqOWlOC6S-Gpnrg_pNfAxHNh";

function send(res, status, body) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  return res.status(status).json(body);
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return send(res, 405, { error: "Use GET." });
  }

  const token = String(req.headers.authorization || "").replace(/^Bearer\\s+/i, "");
  if (!token) return send(res, 401, { error: "Sign in to view billing." });

  const userResponse = await fetch(SUPABASE_URL + "/auth/v1/user", {
    headers: { apikey: SUPABASE_PUBLISHABLE_KEY, Authorization: "Bearer " + token }
  });
  if (!userResponse.ok) return send(res, 401, { error: "Please sign in again." });

  const user = await userResponse.json();
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!secret) return send(res, 200, { subscription: null, checkout_ready: false, setup_required: true });

  const headers = { apikey: secret, Authorization: "Bearer " + secret };
  const billingEnvironment = process.env.VERCEL_ENV === "production" ? "live" : "test";
  const razorpayPlanId = process.env.RAZORPAY_USD_PLAN_ID;
  const [subscriptionResponse, planResponse] = await Promise.all([
    fetch(SUPABASE_URL + "/rest/v1/billing_subscriptions?select=plan_key,status,current_start,current_end,charge_at,paid_count,total_count,updated_at&user_id=eq." + encodeURIComponent(user.id) + "&environment=eq." + billingEnvironment + "&limit=1", { headers }),
    fetch(SUPABASE_URL + "/rest/v1/billing_plans?select=amount_paise,currency,active&plan_key=eq.pro_usd&limit=1", { headers })
  ]);

  if (!subscriptionResponse.ok || !planResponse.ok) {
    return send(res, 503, { error: "Could not load billing status.", checkout_ready: false });
  }

  const [subscriptions, plans] = await Promise.all([subscriptionResponse.json(), planResponse.json()]);
  const plan = plans[0];
  const keyId = process.env.RAZORPAY_KEY_ID || "";
  const environmentMatches = process.env.VERCEL_ENV === "production"
    ? keyId.startsWith("rzp_live_")
    : keyId.startsWith("rzp_test_");
  const checkoutReady = !!(
    plan?.active &&
    plan?.currency === "USD" &&
    Number(plan?.amount_paise) === 500 &&
    razorpayPlanId &&
    keyId &&
    process.env.RAZORPAY_KEY_SECRET &&
    process.env.RAZORPAY_WEBHOOK_SECRET &&
    environmentMatches
  );

  return send(res, 200, {
    subscription: subscriptions[0] || null,
    checkout_ready: checkoutReady,
    setup_required: !checkoutReady
  });
}
