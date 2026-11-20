const SUPABASE_URL = "https://pxgoaygwtxrrqkftluut.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_rmuwOPAIqOWlOC6S-Gpnrg_pNfAxHNh";
function send(res, status, body) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  return res.status(status).json(body);
}
export default async function handler(req, res) {
  if (req.method !== "GET") { res.setHeader("Allow", "GET"); return send(res, 405, { error: "Use GET." }); }
  const token = String(req.headers.authorization || "").replace(/^Bearer\\s+/i, "");
  if (!token || token.length > 8192) return send(res, 401, { error: "Sign in to view billing." });
  let userResponse;
  try {
    userResponse = await fetch(SUPABASE_URL + "/auth/v1/user", {
      headers: { apikey: SUPABASE_PUBLISHABLE_KEY, Authorization: "Bearer " + token },
      signal: AbortSignal.timeout(8000)
    });
  } catch {
    return send(res, 503, { error: "Could not verify your session. Please try again." });
  }
  if (!userResponse.ok) return send(res, 401, { error: "Please sign in again." });
  const user = await userResponse.json();
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!secret) return send(res, 503, { error: "Billing is not fully configured yet." });
  const headers = { apikey: secret, Authorization: "Bearer " + secret };
  try {
    const [subscriptionResponse, plansResponse] = await Promise.all([
      fetch(SUPABASE_URL + "/rest/v1/billing_subscriptions?select=plan_key,status,current_start,current_end,charge_at,paid_count,total_count,updated_at&user_id=eq." + encodeURIComponent(user.id) + "&limit=1", { headers, signal: AbortSignal.timeout(8000) }),
      fetch(SUPABASE_URL + "/rest/v1/billing_plans?select=plan_key,amount_paise,currency,period,interval_count,daily_limit&active=eq.true&plan_key=in.(starter,pro)&order=amount_paise.asc", { headers, signal: AbortSignal.timeout(8000) })
    ]);
    if (!subscriptionResponse.ok || !plansResponse.ok) return send(res, 503, { error: "Could not load your billing details." });
    const subscriptions = await subscriptionResponse.json();
    const plans = await plansResponse.json();
    const checkoutAvailable = Boolean(
      process.env.RAZORPAY_KEY_ID &&
      String(process.env.RAZORPAY_KEY_ID).startsWith("rzp_test_") &&
      process.env.RAZORPAY_KEY_SECRET &&
      process.env.RAZORPAY_WEBHOOK_SECRET
    );
    return send(res, 200, {
      subscription: subscriptions[0] || null,
      plans: Array.isArray(plans) ? plans : [],
      checkoutAvailable,
      checkoutMode: checkoutAvailable ? "test" : "disabled"
    });
  } catch (error) {
    console.error("[VYBORA Billing] status failed", String(error?.message || error).slice(0, 180));
    return send(res, 503, { error: "Could not load your billing status. Please try again." });
  }
}
