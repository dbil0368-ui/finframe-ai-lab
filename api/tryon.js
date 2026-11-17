// Authenticated, rate-limited Vercel proxy for a compatible virtual try-on provider.
// Keep TRYON_API_KEY on the server. Never expose it in browser code.
export const config = { api: { bodyParser: false } };

const SUPABASE_URL = "https://pxgoaygwtxrrqkftluut.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_rmuwOPAIqOWlOC6S-Gpnrg_pNfAxHNh";
const MAX_BODY_BYTES = 20 * 1024 * 1024;

function send(res, status, body) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  return res.status(status).json(body);
}

async function authenticate(req) {
  const token = String(req.headers.authorization || "").replace(/^Bearer\\s+/i, "");
  if (!token || token.length > 8192) return null;
  const response = await fetch(SUPABASE_URL + "/auth/v1/user", {
    headers: { apikey: SUPABASE_PUBLISHABLE_KEY, Authorization: "Bearer " + token },
    signal: AbortSignal.timeout(8000)
  });
  if (!response.ok) return null;
  const user = await response.json().catch(() => null);
  return user?.id ? user : null;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return send(res, 405, { error: "Method not allowed." });
  }

  const user = await authenticate(req).catch(() => null);
  if (!user) return send(res, 401, { error: "Please sign in to use Virtual Try-On." });

  const serviceKey = process.env.SUPABASE_SECRET_KEY;
  if (!serviceKey) return send(res, 503, { error: "Virtual Try-On usage protection is not configured." });

  const contentType = String(req.headers["content-type"] || "");
  if (!/^multipart\\/form-data\\s*;\\s*boundary=/i.test(contentType)) {
    return send(res, 400, { error: "Expected multipart form data with person and garment images." });
  }
  const lengthHeader = req.headers["content-length"];
  const length = Number(lengthHeader);
  if (!lengthHeader || !Number.isSafeInteger(length) || length <= 0) {
    return send(res, 411, { error: "A valid Content-Length header is required." });
  }
  if (length > MAX_BODY_BYTES) {
    return send(res, 413, { error: "Please keep the combined image upload under 20 MB." });
  }

  const providerUrl = process.env.TRYON_PROVIDER_URL;
  const apiKey = process.env.TRYON_API_KEY;
  if (!providerUrl || !apiKey) {
    return send(res, 503, { error: "AI Virtual Try-On is not connected yet." });
  }
  let parsedProviderUrl;
  try { parsedProviderUrl = new URL(providerUrl); } catch { return send(res, 503, { error: "Virtual Try-On provider URL is invalid." }); }
  if (parsedProviderUrl.protocol !== "https:" || parsedProviderUrl.username || parsedProviderUrl.password) {
    return send(res, 503, { error: "Virtual Try-On provider must use a valid HTTPS URL." });
  }

  try {
    const quotaResponse = await fetch(SUPABASE_URL + "/rest/v1/rpc/consume_vybora_tryon_request", {
      method: "POST",
      headers: { apikey: serviceKey, Authorization: "Bearer " + serviceKey, "Content-Type": "application/json" },
      body: JSON.stringify({ p_user_id: user.id, p_daily_limit: 5 }),
      signal: AbortSignal.timeout(8000)
    });
    const quotaRows = await quotaResponse.json().catch(() => []);
    if (!quotaResponse.ok || !Array.isArray(quotaRows) || !quotaRows[0]) {
      return send(res, 503, { error: "Could not verify your Virtual Try-On daily allowance." });
    }
    const quota = quotaRows[0];
    if (!quota.allowed) {
      return send(res, 429, { error: "Today's Virtual Try-On limit has been reached. Please try again tomorrow.", quota: { used: quota.used, limit: quota.daily_limit, remaining: 0 } });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 90000);
    try {
      const upstream = await fetch(parsedProviderUrl, {
        method: "POST",
        headers: { Authorization: "Bearer " + apiKey, "Content-Type": contentType },
        body: req,
        duplex: "half",
        signal: controller.signal
      });
      const text = await upstream.text();
      let data;
      try { data = JSON.parse(text); } catch { data = { error: "The AI provider returned an unreadable response." }; }
      if (!upstream.ok) {
        return send(res, upstream.status >= 400 && upstream.status < 600 ? upstream.status : 502, {
          error: data.error || data.detail || "The AI provider could not process these images."
        });
      }
      return send(res, 200, data);
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    console.error("[VYBORA TryOn] request failed", String(error?.message || error).slice(0, 180));
    return send(res, error?.name === "AbortError" ? 504 : 502, { error: "Virtual Try-On is temporarily unavailable. Please try again." });
  }
}
