const SUPABASE_URL = "https://pxgoaygwtxrrqkftluut.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_rmuwOPAIqOWlOC6S-Gpnrg_pNfAxHNh";
function send(res, status, body) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  return res.status(status).json(body);
}
export default async function handler(req, res) {
  if (req.method !== "GET") { res.setHeader("Allow", "GET"); return send(res, 405, { error: "Use GET." }); }
  const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) return send(res, 401, { error: "Sign in to view billing." });
  const userResponse = await fetch(SUPABASE_URL + "/auth/v1/user", { headers: { apikey: SUPABASE_PUBLISHABLE_KEY, Authorization: "Bearer " + token } });
  if (!userResponse.ok) return send(res, 401, { error: "Please sign in again." });
  const user = await userResponse.json();
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!secret) return send(res, 503, { error: "Billing is not fully configured yet." });
  const response = await fetch(SUPABASE_URL + "/rest/v1/billing_subscriptions?select=plan_key,status,current_start,current_end,charge_at,paid_count,total_count,updated_at&user_id=eq." + encodeURIComponent(user.id) + "&limit=1", {
    headers: { apikey: secret, Authorization: "Bearer " + secret }
  });
  if (!response.ok) return send(res, 503, { error: "Could not load your billing status." });
  const rows = await response.json();
  return send(res, 200, { subscription: rows[0] || null });
}
