import { generateText } from "ai";

const MODEL = process.env.AI_GATEWAY_MODEL || "openai/gpt-5-mini";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Use POST for Creator Studio." });
  }

  const body = req.body || {};
  const topic = typeof body.topic === "string" ? body.topic.trim().slice(0, 240) : "";
  const format = typeof body.format === "string" ? body.format.slice(0, 60) : "Short video";
  const audience = typeof body.audience === "string" ? body.audience.trim().slice(0, 160) : "curious viewers";
  const language = typeof body.language === "string" ? body.language.slice(0, 40) : "Bengali";

  if (!topic) return res.status(400).json({ error: "Please enter a topic." });

  const prompt = [
    "Create a practical, original creative brief. Do not invent facts, statistics, quotes, or current events. If the topic needs verification, clearly mark claims to verify.",
    "Write in " + language + ".",
    "Audience: " + audience,
    "Format: " + format,
    "Topic: " + topic,
    "Return concise plain text with these sections: BIG IDEA, 3 HOOK OPTIONS, CONTENT STRUCTURE (4-6 beats), CAPTION, CTA, HASHTAGS (5-8 relevant tags), FACT-CHECK NOTES."
  ].join("\n");

  try {
    // The AI SDK's default Gateway provider automatically uses Vercel OIDC
    // on Preview/Production deployments, without manually forwarding tokens.
    const result = await generateText({
      model: MODEL,
      system: "You are VYBORA Creator Studio, an ethical creator strategist. Be specific, fresh, safe, and concise.",
      prompt,
      maxOutputTokens: 1100,
      timeout: 45000,
      maxRetries: 0
    });

    if (typeof result.text !== "string" || !result.text.trim()) {
      return res.status(502).json({ error: "AI returned an empty brief. Please try again." });
    }

    return res.status(200).json({
      brief: result.text.trim(),
      model: result.response?.modelId || MODEL
    });
  } catch (error) {
    const message = String(error?.message || "");
    const status = Number(error?.statusCode || error?.status || error?.response?.status || 0);
    console.error("[VYBORA Creator] AI generation failed", {
      status: status || null,
      errorName: String(error?.name || "Error").slice(0, 80),
      message: message.replace(/Bearer\s+\S+/gi, "Bearer [redacted]").slice(0, 240),
      oidcAvailable: Boolean(process.env.VERCEL_OIDC_TOKEN),
      apiKeyAvailable: Boolean(process.env.AI_GATEWAY_API_KEY)
    });

    if (status === 401 || status === 403 || /unauthori[sz]ed|forbidden|authentication/i.test(message)) {
      return res.status(502).json({ error: "AI Gateway authentication failed. Preview OIDC access needs attention." });
    }
    if (status === 402 || /insufficient_funds|customer_verification_required|quota_for_entity_exceeded/i.test(message)) {
      return res.status(402).json({ error: "AI Gateway needs billing verification or available credits. Check Vercel AI Gateway billing." });
    }
    if (status === 429) {
      return res.status(429).json({ error: "AI usage limit reached. Please try again later." });
    }
    return res.status(502).json({ error: "AI service is temporarily unavailable. Please try again." });
  }
}
