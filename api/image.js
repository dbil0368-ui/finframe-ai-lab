const SUPABASE_URL = "https://pxgoaygwtxrrqkftluut.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_rmuwOPAIqOWlOC6S-Gpnrg_pNfAxHNh";
// Current Gemini API image-generation model (Nano Banana 2).
const IMAGE_MODEL = process.env.GEMINI_IMAGE_MODEL || "gemini-3.1-flash-image";
export const config = { maxDuration: 60 };

function send(res, status, body) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  return res.status(status).json(body);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return send(res, 405, { error: "Use POST for VYBORA image generation." });
  }

  try {
    const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    if (!token || token.length > 8192) return send(res, 401, { error: "Please sign in to use VYBORA AI Studio." });
    const auth = await fetch(SUPABASE_URL + "/auth/v1/user", {
      headers: { apikey: SUPABASE_PUBLISHABLE_KEY, Authorization: "Bearer " + token },
      signal: AbortSignal.timeout(8000)
    });
    if (!auth.ok) return send(res, 401, { error: "Your session expired. Please sign in again." });
    await auth.json();
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return send(res, 503, { error: "Gemini image generation is not configured on this deployment." });

    const body = req.body || {};
    const prompt = typeof body.prompt === "string" ? body.prompt.trim().slice(0, 1800) : "";
    const imageData = typeof body.imageData === "string" ? body.imageData : "";
    const referenceImages = Array.isArray(body.referenceImages) ? body.referenceImages.slice(0, 2) : [];
    const mode = body.mode === "tryon" ? "tryon" : "image";
    const aspectRatio = ["1:1", "3:2", "2:3", "4:3", "3:4", "9:16", "16:9"].includes(body.aspectRatio) ? body.aspectRatio : "1:1";
    if (!prompt) return send(res, 400, { error: "Please describe the image you want to create." });
    const allImages = [imageData, ...referenceImages].filter(Boolean);
    if (allImages.some(value => typeof value !== "string" || !/^data:image\/(png|jpeg|webp);base64,/i.test(value) || value.length > 4200000) || allImages.length > 2 || allImages.reduce((sum, value) => sum + value.length, 0) > 4200000) {
      return send(res, 413, { error: "Reference images must be PNG, JPEG or WebP and total under 3 MB after resizing." });
    }

    const quotaEndpoint = mode === "tryon"
      ? "consume_vybora_tryon_request_for_current_user"
      : "consume_vybora_ai_generation_for_current_user";
    const quotaResponse = await fetch(SUPABASE_URL + "/rest/v1/rpc/" + quotaEndpoint, {
      method: "POST",
      headers: { apikey: SUPABASE_PUBLISHABLE_KEY, Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify({}),
      signal: AbortSignal.timeout(8000)
    });
    const quotaRows = await quotaResponse.json().catch(() => []);
    if (!quotaResponse.ok || !Array.isArray(quotaRows) || !quotaRows[0]) {
      return send(res, 503, { error: "Could not verify your daily AI allowance." });
    }
    const quota = quotaRows[0];
    const planKey = quota.plan_key || "free";
    const quotaLimit = quota.daily_limit || (mode === "tryon" ? 5 : 3);
    if (!quota.allowed) return send(res, 429, { error: "Today's AI generation limit has been reached.", quota: { plan: planKey, used: quota.used, limit: quota.daily_limit, remaining: 0 } });

    const parts = [{ text: "Create or edit a polished, commercially useful visual for VYBORA. Follow the user's brief closely. Do not add watermarks, fake brand logos, unreadable text, or misleading claims. " + prompt }];
    for (const reference of [imageData, ...referenceImages].filter(Boolean)) {
      const match = reference.match(/^data:(image\/(?:png|jpeg|webp));base64,([\s\S]+)$/i);
      parts.push({ inlineData: { mimeType: match[1], data: match[2] } });
    }
    const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models/" + encodeURIComponent(IMAGE_MODEL) + ":generateContent", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
        generationConfig: { responseModalities: ["TEXT", "IMAGE"], imageConfig: { aspectRatio } }
      }),
      signal: AbortSignal.timeout(40000)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = String(data?.error?.message || "");
      console.error("[VYBORA Image] Gemini failed", { status: response.status, message: message.slice(0, 200) });
      if (response.status === 401 || response.status === 403) return send(res, 502, { error: "Gemini API key was rejected. Check the secure GEMINI_API_KEY setting." });
      if (response.status === 429) return send(res, 429, { error: "Gemini image service is busy or its quota is exhausted. Please try later." });
      return send(res, 502, { error: "Gemini could not generate this image. Please simplify the prompt and try again." });
    }
    const outputParts = data?.candidates?.[0]?.content?.parts || [];
    const imagePart = outputParts.find(part => part?.inlineData?.data && /^image\//i.test(part.inlineData.mimeType || ""));
    if (!imagePart) return send(res, 502, { error: "Gemini returned no image. Please try a different prompt." });
    return send(res, 200, {
      image: "data:" + imagePart.inlineData.mimeType + ";base64," + imagePart.inlineData.data,
      model: IMAGE_MODEL,
      quota: { plan: planKey, used: quota.used, limit: quota.daily_limit || quotaLimit, remaining: quota.remaining }
    });
  } catch (error) {
    console.error("[VYBORA Image] request failed", String(error?.message || error).slice(0, 180));
    return send(res, error?.name === "TimeoutError" ? 504 : 502, { error: "VYBORA image generation is temporarily unavailable. Please try again." });
  }
}
