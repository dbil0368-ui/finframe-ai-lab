export const config = { maxDuration: 60 };

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

  const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token || token.length > 8192) return send(res, 401, { error: "Please sign in to use VYBORA AI." });
  let authResponse;
  try {
    authResponse = await fetch(SUPABASE_URL + "/auth/v1/user", {
      headers: { apikey: SUPABASE_PUBLISHABLE_KEY, Authorization: "Bearer " + token },
      signal: AbortSignal.timeout(8000)
    });
  } catch {
    return send(res, 503, { error: "Could not verify your VYBORA session. Please try again." });
  }
  if (!authResponse.ok) return send(res, 401, { error: "Your session expired. Please sign in again." });
  const user = await authResponse.json();
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return send(res, 503, { error: "Gemini is not configured yet. Add GEMINI_API_KEY to this deployment’s secure Vercel environment." });

    const body = req.body || {};
    const topic = typeof body.topic === "string" ? body.topic.trim().slice(0, 240) : "";
    const format = typeof body.format === "string" ? body.format.slice(0, 60) : "Short video";
    const audience = typeof body.audience === "string" ? body.audience.trim().slice(0, 160) : "curious viewers";
    const language = typeof body.language === "string" ? body.language.slice(0, 40) : "English";
    if (!topic) return send(res, 400, { error: "Please enter a topic." });

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
    ].join("\n");

    // Atomically reserve one generation BEFORE calling the paid AI provider.
    const usageResponse = await fetch(SUPABASE_URL + "/rest/v1/rpc/consume_vybora_ai_generation_for_current_user", {
      method: "POST",
      headers: { apikey: SUPABASE_PUBLISHABLE_KEY, Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify({}),
      signal: AbortSignal.timeout(8000)
    });
    const usageRows = await usageResponse.json().catch(() => []);
    if (!usageResponse.ok || !Array.isArray(usageRows) || !usageRows[0]) throw new Error("Could not check your daily AI allowance.");
    const usage = usageRows[0];
    const planKey = usage.plan_key || "free";
    const dailyLimit = usage.daily_limit || 3;
    if (!usage.allowed) {
      return send(res, 429, {
        error: "আজকের " + dailyLimit + "টি AI generation শেষ। আরও ব্যবহার করতে Starter (₹১৯৯/মাস) বা Pro Premium (₹৪৯৯/মাস) নিন।",
        quota: { plan: planKey, used: usage.used, limit: dailyLimit, remaining: 0 }
      });
    }

    let lastError;
    let providerRateLimited = false;
    for (const model of MODELS) {
      try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
          body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: 850 } }),
          // Two bounded model attempts plus auth/quota checks must fit Vercel's 60s function budget.
          signal: AbortSignal.timeout(18000)
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          const providerMessage = String(data?.error?.message || "");
          console.error("[VYBORA Creator] Gemini request failed", { status: response.status, message: providerMessage.slice(0, 220), model });
          if (response.status === 401 || response.status === 403) {
            return send(res, 502, { error: "Gemini API key was rejected. Check the GEMINI_API_KEY configured for this deployment." });
          }
          if (response.status === 429) providerRateLimited = true;
          lastError = new Error("Gemini HTTP " + response.status);
          if ([400, 413].includes(response.status)) {
            return send(res, 502, { error: "Gemini could not process this brief. Please shorten or simplify it." });
          }
          continue;
        }
        const brief = (data?.candidates?.[0]?.content?.parts || []).map(part => typeof part.text === "string" ? part.text : "").join("\n").trim();
        if (!brief) {
          lastError = new Error("Gemini returned an empty brief");
          continue;
        }
        return send(res, 200, { brief, model, quota: { plan: planKey, used: usage.used, limit: dailyLimit, remaining: usage.remaining } });
      } catch (error) {
        lastError = error;
        console.error("[VYBORA Creator] Gemini request error", { errorName: String(error?.name || "Error").slice(0, 80), message: String(error?.message || error).slice(0, 180), model });
      }
    }
    if (providerRateLimited) return send(res, 429, { error: "AI provider is busy or its quota is exhausted. Please try again later." });
    return send(res, 502, { error: lastError?.name === "TimeoutError" ? "Gemini is taking longer than expected. Please try again in a moment." : "Gemini service is temporarily unavailable. Please try again shortly." });
  } catch (error) {
    console.error("[VYBORA Creator] usage check failed", String(error?.message || error).slice(0, 200));
    return send(res, 503, { error: "Could not verify your plan or daily AI allowance. Please try again." });
  }
}
