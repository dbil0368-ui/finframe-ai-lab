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
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return send(res, 503, { error: "Gemini voice generation is not configured on this deployment." });

    const body = req.body || {};
    const transcript = typeof body.text === "string" ? body.text.trim().slice(0, 6000) : "";
    const voice = VOICES.has(body.voice) ? body.voice : "Kore";
    const style = typeof body.style === "string" ? body.style.trim().slice(0, 180) : "Natural, clear, warm and confident";
    if (!transcript) return send(res, 400, { error: "Enter a script to generate voiceover." });

    const quotaResponse = await fetch(SUPABASE_URL + "/rest/v1/rpc/consume_vybora_ai_generation_for_current_user", {
      method: "POST",
      headers: { apikey: SUPABASE_PUBLISHABLE_KEY, Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify({}),
      signal: AbortSignal.timeout(8000)
    });
    const quotaRows = await quotaResponse.json().catch(() => []);
    if (!quotaResponse.ok || !Array.isArray(quotaRows) || !quotaRows[0]) return send(res, 503, { error: "Could not verify your daily AI allowance." });
    const quota = quotaRows[0];
    const planKey = quota.plan_key || "free";
    const dailyLimit = quota.daily_limit || 3;
    if (!quota.allowed) return send(res, 429, { error: "Today's AI generation limit has been reached.", quota: { plan: planKey, used: quota.used, limit: quota.daily_limit, remaining: 0 } });

    const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models/" + encodeURIComponent(TTS_MODEL) + ":generateContent", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: "Read the following script aloud. Apply this delivery direction naturally, but do not speak the direction itself.\n\nDelivery: " + style + "\n\nScript:\n" + transcript }] }],
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
    const rawAudio = Buffer.from(audioPart.inlineData.data, "base64");
    const sampleRate = Number((String(audioPart.inlineData.mimeType).match(/rate=(\d+)/i) || [])[1]) || 24000;
    const wav = Buffer.alloc(44 + rawAudio.length);
    wav.write("RIFF", 0); wav.writeUInt32LE(36 + rawAudio.length, 4); wav.write("WAVE", 8);
    wav.write("fmt ", 12); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20);
    wav.writeUInt16LE(1, 22); wav.writeUInt32LE(sampleRate, 24);
    wav.writeUInt32LE(sampleRate * 2, 28); wav.writeUInt16LE(2, 32);
    wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(rawAudio.length, 40);
    rawAudio.copy(wav, 44);
    return send(res, 200, {
      audio: "data:audio/wav;base64," + wav.toString("base64"),
      model: TTS_MODEL,
      quota: { plan: planKey, used: quota.used, limit: quota.daily_limit || dailyLimit, remaining: quota.remaining }
    });
  } catch (error) {
    console.error("[VYBORA Voice] request failed", String(error?.message || error).slice(0, 180));
    return send(res, error?.name === "TimeoutError" ? 504 : 502, { error: "VYBORA AI Voiceover is temporarily unavailable. Please try again." });
  }
}
