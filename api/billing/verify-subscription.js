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
  const response = await fetch(SUPABASE_URL + "/auth/v1/user", { headers: { apikey: SUPABASE_PUBLISHABLE_KEY, Authorization: "Bearer " + token } });
  return response.ok ? response.json() : null;
}
async function db(path, options = {}) {
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!secret) throw new Error("SUPABASE_SECRET_KEY is not configured for this Preview.");
  const response = await fetch(SUPABASE_URL + "/rest/v1/" + path, {
    ...options,
    headers: { apikey: secret, Authorization: "Bearer " + secret, "Content-Type": "application/json", ...(options.headers || {}) }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error("Billing database request failed (" + response.status + ").");
  return data;
}
async function razorpay(path) {
  const id = process.env.RAZORPAY_KEY_ID, secret = process.env.RAZORPAY_KEY_SECRET;
  if (!id || !secret || !id.startsWith("rzp_test_")) throw new Error("Razorpay Test Mode keys are not configured.");
  const response = await fetch("https://api.razorpay.com/v1/" + path, {
    headers: { Authorization: "Basic " + Buffer.from(id + ":" + secret).toString("base64") }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error("Could not confirm the payment with Razorpay.");
  return data;
}
export default async function handler(req, res) {
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return send(res, 405, { error: "Use POST." }); }
  const user = await authUser(req);
  if (!user?.id) return send(res, 401, { error: "Please sign in again." });
  const { razorpay_subscription_id: subscriptionId, razorpay_payment_id: paymentId, razorpay_signature: signature } = req.body || {};
  if (![subscriptionId, paymentId, signature].every(v => typeof v === "string" && v.length < 300)) return send(res, 400, { error: "Missing payment verification details." });
  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (!secret || !String(process.env.RAZORPAY_KEY_ID || "").startsWith("rzp_test_")) return send(res, 503, { error: "Razorpay Test Mode is not configured." });
  try {
    const expected = crypto.createHmac("sha256", secret).update(paymentId + "|" + subscriptionId).digest();
    const supplied = Buffer.from(signature, "hex");
    if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) return send(res, 400, { error: "Payment signature could not be verified." });

    const rows = await db("billing_subscriptions?select=user_id,plan_key,status&razorpay_subscription_id=eq." + encodeURIComponent(subscriptionId) + "&limit=1");
    if (!rows[0] || rows[0].user_id !== user.id) return send(res, 403, { error: "This subscription does not belong to your account." });

    const [subscription, payment] = await Promise.all([
      razorpay("subscriptions/" + encodeURIComponent(subscriptionId)),
      razorpay("payments/" + encodeURIComponent(paymentId))
    ]);
    if (payment.subscription_id !== subscriptionId || !["authorized", "captured"].includes(payment.status)) {
      return send(res, 400, { error: "Razorpay has not confirmed the subscription payment yet." });
    }
    const status = ["active", "authenticated"].includes(subscription.status) ? subscription.status : "pending";
    await db("billing_subscriptions?razorpay_subscription_id=eq." + encodeURIComponent(subscriptionId), {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        status,
        last_payment_id: paymentId,
        current_start: subscription.current_start ? new Date(subscription.current_start * 1000).toISOString() : null,
        current_end: subscription.current_end ? new Date(subscription.current_end * 1000).toISOString() : null,
        charge_at: subscription.charge_at ? new Date(subscription.charge_at * 1000).toISOString() : null,
        paid_count: subscription.paid_count || 0,
        updated_at: new Date().toISOString()
      })
    });
    return send(res, 200, { ok: true, status, message: status === "active" ? "Your VYBORA plan is active." : "Payment authorization verified. Razorpay is finalizing your subscription." });
  } catch (error) {
    console.error("[VYBORA Billing] verify failed", String(error?.message || error).slice(0, 220));
    return send(res, 503, { error: "Payment verification is temporarily unavailable. If money was deducted, do not pay again; contact support." });
  }
}
