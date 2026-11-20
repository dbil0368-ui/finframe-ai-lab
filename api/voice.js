const SUPABASE_URL = "https://pxgoaygwtxrrqkftluut.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_rmuwOPAIqOWlOC6S-Gpnrg_pNfAxHNh";
const TTS_MODEL = process.env.GEMINI_TTS_MODEL || "gemini-3.8-flash-tts";
const VOICES = new Set(["Zephyr","Puck","Charon","Kore","Fenrir","Leda","Orus","Aoede","Callirrhoe","Autonoe","Enceladus","Iapetus","Umbriel","Algieba","Despina","Erinome","Algenib","Rasalgethi","Laomedeia","Achernar","Alnilam","Schedar","Gacrux","Pulcherrima","Achird","Zubenelgenubi","Vindemiatrix","Sadachbia","Sadaltager","Sulafat"]);
export const config = { maxDuration: 60 };

function send(res, status, body) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  return res.status(status).json(body);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return send(res, 405, { error: "Use POST for VYBORA Voice Studio." });
  }
  try {
    const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    if (!token || token.length > 8192) return send(res, 401, { error: "Please sign in to use AI Voiceover." });
    const auth = await fetch(SUPABASE_URL + "/auth/v1/user", {
      headers: { apikey: SUPABASE_PUBLISHABLE_KEY, Authorization: "Bearer " + token },
      signal: AbortSignal.timeout(8000)
    });
    if (!auth.ok) return send(res, 401, { error: "Your session expired. Please sign in again." });
    const user = await auth.json();
    const serviceKey = process.env.SUPABASE_SECRET_KEY;
    const apiKey = process.env.GEMINI_API_KEY;
    if (!serviceKey) return send(res, 503, { error: "AI usage protection is not configured on the secure backend." });
    if (!apiKey) return send(res, 503, { error: "Gemini voice generation is not configured on this deployment." });

    const body = req.body || {};
    const transcript = typeof body.text === "string" ? body.text.trim().slice(0, 6000) : "";
    const voice = VOICES.has(body.voice) ? body.voice : "Kore";
    const style = typeof body.style === "string" ? body.style.trim().slice(0, 180) : "Natural, clear, warm and confident";
    if (!transcript) return send(res, 400, { error: "Enter a script to generate voiceover." });

    const subResponse = await fetch(SUPABASE_URL + "/rest/v1/billing_subscriptions?select=plan_key&user_id=eq." + encodeURIComponent(user.id) + "&status=eq.active&limit=1", {
      headers: { apikey: serviceKey, Authorization: "Bearer " + serviceKey },
      signal: AbortSignal.timeout(8000)
    });
    if (!subResponse.ok) return send(res, 503, { error: "Could not verify your VYBORA plan." });
    const subscriptions = await subResponse.json();
    let planKey = subscriptions[0]?.plan_key || "free";
    const rewardResponse = await fetch(SUPABASE_URL + "/rest/v1/vybora_referral_rewards?select=id&referrer_user_id=eq." + encodeURIComponent(user.id) + "&starts_at=lte." + encodeURIComponent(new Date().toISOString()) + "&expires_at=gt." + encodeURIComponent(new Date().toISOString()) + "&limit=1", {
      headers: { apikey: serviceKey, Authorization: "Bearer " + serviceKey },
      signal: AbortSignal.timeout(8000)
    });
    if (!rewardResponse.ok) return send(res, 503, { error: "Could not verify your Premium reward." });
    const rewards = await rewardResponse.json();
    if (rewards.length && planKey !== "pro") planKey = "pro";
    const dailyLimit = planKey === "pro" ? 50 : planKey === "starter" ? 15 : 3;

    const quotaResponse = await fetch(SUPABASE_URL + "/rest/v1/rpc/consume_vybora_ai_generation", {
      method: "POST",
      headers: { apikey: serviceKey, Authorization: "Bearer " + serviceKey, "Content-Type": "application/json" },
      body: JSON.stringify({ p_user_id: user.id, p_daily_limit: dailyLimit }),
      signal: AbortSignal.timeout(8000)
    });
    const quotaRows = await quotaResponse.json().catch(() => []);
    if (!quotaResponse.ok || !Array.isArray(quotaRows) || !quotaRows[0]) return send(res, 503, { error: "Could not verify your daily AI allowance." });
    const quota = quotaRows[0];
    if (!quota.allowed) return send(res, 429, { error: "Today's AI generation limit has been reached.", quota: { plan: planKey, used: quota.used, limit: quota.daily_limit, remaining: 0 } });

    const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models/" + encodeURIComponent(TTS_MODEL) + ":generateContent", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: transcript, speechMetadata: { style } }] }],
        generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } }
      }),
      signal: AbortSignal.timeout(55000)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = String(data?.error?.message || "");
      console.error("[VYBORA Voice] Gemini failed", { status: response.status, message: message.slice(0, 200) });
      if (response.status === 401 || response.status === 403) return send(res, 502, { error: "Gemini API key was rejected. Check the secure GEMINI_API_KEY setting." });
      if (response.status === 429) return send(res, 429, { error: "Gemini voice service is busy or its quota is exhausted. Please try later." });
      return send(res, 502, { error: "Gemini could not generate this voiceover. Please try again." });
    }
    const audioPart = (data?.candidates?.[0]?.content?.parts || []).find(part => part?.inlineData?.data && /^audio\//i.test(part.inlineData.mimeType || ""));
    if (!audioPart) return send(res, 502, { error: "Gemini returned no audio. Please try another script." });
    return send(res, 200, {
      audio: "data:" + audioPart.inlineData.mimeType + ";base64," + audioPart.inlineData.data,
      model: TTS_MODEL,
      quota: { plan: planKey, used: quota.used, limit: quota.daily_limit || dailyLimit, remaining: quota.remaining }
    });
  } catch (error) {
    console.error("[VYBORA Voice] request failed", String(error?.message || error).slice(0, 180));
    return send(res, error?.name === "TimeoutError" ? 504 : 502, { error: "VYBORA AI Voiceover is temporarily unavailable. Please try again." });
  }
}
