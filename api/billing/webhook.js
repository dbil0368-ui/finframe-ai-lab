import crypto from "node:crypto";
export const config = { api: { bodyParser: false } };
async function rawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}
function send(res, status, body) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  return res.status(status).json(body);
}
async function db(path, options = {}) {
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!secret) throw new Error("SUPABASE_SECRET_KEY is not configured.");
  const response = await fetch("https://pxgoaygwtxrrqkftluut.supabase.co/rest/v1/" + path, {
    ...options,
    headers: { apikey: secret, Authorization: "Bearer " + secret, "Content-Type": "application/json", ...(options.headers || {}) }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error("Billing database request failed.");
  return data;
}
export default async function handler(req, res) {
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return send(res, 405, { error: "Use POST." }); }
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!webhookSecret) return send(res, 503, { error: "Webhook secret is not configured." });
  try {
    const raw = await rawBody(req);
    const supplied = Buffer.from(String(req.headers["x-razorpay-signature"] || ""), "hex");
    const expected = crypto.createHmac("sha256", webhookSecret).update(raw).digest();
    if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) return send(res, 400, { error: "Invalid webhook signature." });
    const eventId = String(req.headers["x-razorpay-event-id"] || "");
    if (!eventId) return send(res, 400, { error: "Missing event ID." });
    const event = JSON.parse(raw.toString("utf8"));
    const type = String(event.event || "");
    const subscription = event.payload?.subscription?.entity;
    const payment = event.payload?.payment?.entity;
    const subscriptionId = subscription?.id || payment?.subscription_id;
    if (!subscriptionId) return send(res, 200, { received: true, ignored: true });

    const seen = await db("billing_webhook_events?select=event_id&event_id=eq." + encodeURIComponent(eventId) + "&limit=1");
    if (seen.length) return send(res, 200, { received: true, duplicate: true });

    const allowed = new Set(["subscription.authenticated","subscription.activated","subscription.charged","subscription.pending","subscription.halted","subscription.cancelled","subscription.completed","subscription.paused","subscription.resumed","payment.captured","payment.failed"]);
    if (allowed.has(type)) {
      const statusMap = {
        "subscription.authenticated":"authenticated",
        "subscription.activated":"active",
        "subscription.charged":"active",
        "subscription.pending":"pending",
        "subscription.halted":"halted",
        "subscription.cancelled":"cancelled",
        "subscription.completed":"completed",
        "subscription.paused":"pending",
        "subscription.resumed":"active",
        "payment.captured":"active",
        "payment.failed":"pending"
      };
      const patch = { status: statusMap[type], updated_at: new Date().toISOString() };
      if (subscription?.current_start) patch.current_start = new Date(subscription.current_start * 1000).toISOString();
      if (subscription?.current_end) patch.current_end = new Date(subscription.current_end * 1000).toISOString();
      if (subscription?.charge_at) patch.charge_at = new Date(subscription.charge_at * 1000).toISOString();
      if (typeof subscription?.paid_count === "number") patch.paid_count = subscription.paid_count;
      if (payment?.id) patch.last_payment_id = payment.id;
      await db("billing_subscriptions?razorpay_subscription_id=eq." + encodeURIComponent(subscriptionId), {
        method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify(patch)
      });
    }
    await db("billing_webhook_events", {
      method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
      body: JSON.stringify({ event_id: eventId, event_type: type })
    });
    return send(res, 200, { received: true });
  } catch (error) {
    console.error("[VYBORA Billing] webhook failed", String(error?.message || error).slice(0, 220));
    return send(res, 500, { error: "Webhook processing failed." });
  }
}
