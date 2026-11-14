const MODELS = (process.env.GEMINI_MODEL || "gemini-3.5-flash-lite,gemini-3.1-flash-lite")
  .split(",").map(value => value.trim()).filter(Boolean);
const SUPABASE_URL = "https://pxgoaygwtxrrqkftluut.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_rmuwOPAIqOWlOC6S-Gpnrg_pNfAxHNh";

function send(res, status, body) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  return res.status(status).json(body);
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return send(res, 405, { error: "Use POST for Creator Studio." });
  }

  const token = String(req.headers.authorization || "").replace(/^Bearer\\s+/i, "");
  if (!token) return send(res, 401, { error: "Please sign in to use VYBORA AI." });
  const authResponse = await fetch(SUPABASE_URL + "/auth/v1/user", {
    headers: { apikey: SUPABASE_PUBLISHABLE_KEY, Authorization: "Bearer " + token }
  });
  if (!authResponse.ok) return send(res, 401, { error: "Your session expired. Please sign in again." });
  const user = await authResponse.json();
  const serviceKey = process.env.SUPABASE_SECRET_KEY;
  if (!serviceKey) return send(res, 503, { error: "Usage limits are not configured yet." });

  try {
    const subResponse = await fetch(SUPABASE_URL + "/rest/v1/billing_subscriptions?select=plan_key,status&user_id=eq." + encodeURIComponent(user.id) + "&status=eq.active&limit=1", {
      headers: { apikey: serviceKey, Authorization: "Bearer " + serviceKey }
    });
    if (!subResponse.ok) throw new Error("Could not check your VYBORA plan.");
    const subscriptions = await subResponse.json();
    let planKey = subscriptions[0]?.plan_key || "free";
    const rewardResponse = await fetch(SUPABASE_URL + "/rest/v1/vybora_referral_rewards?select=id&referrer_user_id=eq." + encodeURIComponent(user.id) + "&starts_at=lte." + encodeURIComponent(new Date().toISOString()) + "&expires_at=gt." + encodeURIComponent(new Date().toISOString()) + "&limit=1", {
      headers: { apikey: serviceKey, Authorization: "Bearer " + serviceKey }
    });
    if (!rewardResponse.ok) throw new Error("Could not check your referral Premium reward.");
    const activeRewards = await rewardResponse.json();
    if (activeRewards.length && planKey !== "pro") planKey = "pro";
    const dailyLimit = planKey === "pro" ? 50 : planKey === "starter" ? 15 : 3;

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return send(res, 503, { error: "Gemini is not configured yet. Add GEMINI_API_KEY to the Vercel Preview environment." });

    const body = req.body || {};
    const topic = typeof body.topic === "string" ? body.topic.trim().slice(0, 240) : "";
    const format = typeof body.format === "string" ? body.format.slice(0, 60) : "Short video";
    const audience = typeof body.audience === "string" ? body.audience.trim().slice(0, 160) : "curious viewers";
    const language = typeof body.language === "string" ? body.language.slice(0, 40) : "English";
    if (!topic) return send(res, 400, { error: "Please enter a topic." });

    const usageResponse = await fetch(SUPABASE_URL + "/rest/v1/rpc/consume_vybora_ai_generation", {
      method: "POST",
      headers: { apikey: serviceKey, Authorization: "Bearer " + serviceKey, "Content-Type": "application/json" },
      body: JSON.stringify({ p_user_id: user.id, p_daily_limit: dailyLimit })
    });
    const usageRows = await usageResponse.json().catch(() => []);
    if (!usageResponse.ok || !Array.isArray(usageRows) || !usageRows[0]) throw new Error("Could not check your daily AI allowance.");
    const usage = usageRows[0];
    if (!usage.allowed) {
      return send(res, 429, {
        error: "আজকের " + dailyLimit + "টি AI generation শেষ। আরও ব্যবহার করতে Starter (₹১৯৯/মাস) বা Pro Premium (₹৪৯৯/মাস) নিন।",
        quota: { plan: planKey, used: usage.used, limit: dailyLimit, remaining: 0 }
      });
    }

    const mode = typeof body.mode === "string" ? body.mode.slice(0, 30) : "brief";
    const instruction = typeof body.instruction === "string" ? body.instruction.slice(0, 1200) : "";
    const platform = typeof body.platform === "string" ? body.platform.slice(0, 60) : "Multiple platforms";
    const prompt = [
      "You are VYBORA Creator Studio, an ethical creator strategist. Create practical, original creator assets. Be specific, fresh, safe, and concise.",
      "Do not invent facts, statistics, quotes, or current events. If the topic needs verification, clearly mark claims to verify.",
      "Write all output in this language: " + (language || "English") + ".",
      "Audience: " + audience, "Platform: " + platform, "Format: " + format,
      "Task type: " + mode, "Topic: " + topic,
      instruction || "Create a concise creative brief with a big idea, hooks, content structure, caption, CTA, hashtags, and fact-check notes."
    ].join("\\n");

    let lastError;
    for (const model of MODELS) {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
            body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: 850 } }),
            signal: AbortSignal.timeout(75000)
          });
          const data = await response.json().catch(() => ({}));
          if (!response.ok) {
            const providerMessage = String(data?.error?.message || "");
            console.error("[VYBORA Creator] Gemini request failed", { status: response.status, message: providerMessage.slice(0, 220), attempt: attempt + 1 });
            if ([429,503,504].includes(response.status) && attempt === 0) { await new Promise(resolve => setTimeout(resolve, 1500)); continue; }
            if (response.status === 401 || response.status === 403) return send(res, 502, { error: "Gemini API key was rejected. Check the GEMINI_API_KEY configured for this Preview deployment." });
            if (response.status === 429) return send(res, 429, { error: "AI provider is busy. Please wait and try again." });
            if ([429,503,504].includes(response.status)) break;
            return send(res, 502, { error: "Gemini request failed. Please try again shortly." });
          }
          const brief = (data?.candidates?.[0]?.content?.parts || []).map(part => typeof part.text === "string" ? part.text : "").join("\\n").trim();
          if (!brief) return send(res, 502, { error: "Gemini returned an empty brief. Please try again." });
          return send(res, 200, { brief, model, quota: { plan: planKey, used: usage.used, limit: dailyLimit, remaining: usage.remaining } });
        } catch (error) {
          lastError = error;
          console.error("[VYBORA Creator] Gemini request error", { errorName: String(error?.name || "Error").slice(0, 80), message: String(error?.message || "").slice(0, 180), attempt: attempt + 1 });
          if (attempt === 0 && ["TimeoutError","AbortError","TypeError"].includes(error?.name)) { await new Promise(resolve => setTimeout(resolve, 1000)); continue; }
          break;
        }
      }
    }
    return send(res, 502, { error: lastError?.name === "TimeoutError" ? "Gemini is taking longer than expected. Please try again in a moment." : "Gemini service is temporarily unavailable. Please try again shortly." });
  } catch (error) {
    console.error("[VYBORA Creator] usage check failed", String(error?.message || error).slice(0, 200));
    return send(res, 503, { error: "Could not verify your plan or daily AI allowance. Please try again." });
  }
}
