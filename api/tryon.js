// Vercel serverless proxy for a compatible virtual try-on provider.
// Authenticates the VYBORA user and enforces the server-side daily AI quota.
export const config = { api: { bodyParser: false } };

const SUPABASE_URL = process.env.SUPABASE_URL || "https://pxgoaygwtxrrqkftluut.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY || "sb_publishable_rmuwOPAIqOWlOC6S-Gpnrg_pNfAxHNh";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed." });
  }

  const providerUrl = process.env.TRYON_PROVIDER_URL;
  const apiKey = process.env.TRYON_API_KEY;
  if (!providerUrl || !apiKey) {
    return res.status(503).json({
      error: "AI Virtual Try-On is not connected yet. The daily free quota will apply after the AI provider is configured."
    });
  }

  const contentType = req.headers["content-type"] || "";
  if (!contentType.toLowerCase().includes("multipart/form-data")) {
    return res.status(400).json({ error: "Expected multipart form data with person and garment images." });
  }

  const length = Number(req.headers["content-length"] || 0);
  if (length > 21 * 1024 * 1024) {
    return res.status(413).json({ error: "Please keep both images under 10 MB each." });
  }

  const authorization = req.headers.authorization || "";
  const accessToken = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!accessToken) {
    return res.status(401).json({ error: "Please log in to use your daily free AI generations." });
  }

  try {
    const userResponse = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${accessToken}` }
    });
    if (!userResponse.ok) {
      return res.status(401).json({ error: "Your login session expired. Please log in again." });
    }

    const quotaResponse = await fetch(`${SUPABASE_URL}/rest/v1/rpc/consume_vybora_ai_generation_for_current_user`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: "{}"
    });
    const quotaRows = await quotaResponse.json().catch(() => []);
    if (!quotaResponse.ok || !Array.isArray(quotaRows) || !quotaRows[0]) {
      return res.status(503).json({ error: "Could not verify your daily AI quota. Please try again shortly." });
    }

    const quota = quotaRows[0];
    if (!quota.allowed) {
      return res.status(429).json({
        code: "DAILY_AI_LIMIT_REACHED",
        error: "You have used all 5 free AI generations for today. Upgrade to STARTER for more daily generations.",
        used: quota.used,
        dailyLimit: quota.daily_limit,
        remaining: quota.remaining,
        plan: quota.plan_key
      });
    }

    const upstream = await fetch(providerUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": contentType
      },
      body: req,
      duplex: "half"
    });

    const text = await upstream.text();
    let data;
    try { data = JSON.parse(text); }
    catch { data = { error: text || "The AI provider returned an unreadable response." }; }

    if (!upstream.ok) {
      return res.status(upstream.status >= 400 && upstream.status < 600 ? upstream.status : 502)
        .json({ error: data.error || data.detail || "The AI provider could not process these images.", quota: {
          used: quota.used, dailyLimit: quota.daily_limit, remaining: quota.remaining
        } });
    }
    return res.status(200).json({
      ...data,
      quota: { used: quota.used, dailyLimit: quota.daily_limit, remaining: quota.remaining, plan: quota.plan_key }
    });
  } catch (error) {
    return res.status(502).json({ error: "Could not reach the configured AI provider. Check the backend settings." });
  }
}
