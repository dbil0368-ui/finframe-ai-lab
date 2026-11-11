import { getVercelOidcToken } from "@vercel/oidc";

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
    "You are VYBORA Creator Studio, an ethical creator strategist.",
    "Create a practical, original creative brief. Do not invent facts, statistics, quotes, or current events. If the topic needs verification, clearly mark claims to verify.",
    "Write in " + language + ".",
    "Audience: " + audience,
    "Format: " + format,
    "Topic: " + topic,
    "Return concise plain text with these sections: BIG IDEA, 3 HOOK OPTIONS, CONTENT STRUCTURE (4-6 beats), CAPTION, CTA, HASHTAGS (5-8 relevant tags), FACT-CHECK NOTES."
  ].join("\n");

  try {
    // Try Vercel OIDC first. A configured but invalid API key must not block OIDC.
    // Fall back to the Preview API key only if OIDC is unavailable or rejected.
    const credentials = [];
    try {
      const oidcToken = await getVercelOidcToken();
      if (oidcToken) credentials.push({ apiKey: oidcToken, source: "oidc" });
    } catch {
      // OIDC may be unavailable outside a Vercel deployment.
    }
    if (process.env.AI_GATEWAY_API_KEY) {
      credentials.push({ apiKey: process.env.AI_GATEWAY_API_KEY, source: "api-key" });
    }

    if (!credentials.length) {
      throw new Error("No AI Gateway authentication is configured.");
    }

    const credential = credentials[0];
    const gatewayResponse = await fetch("https://ai-gateway.vercel.sh/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + credential.apiKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: "You are a helpful creative strategist. Be specific, fresh, safe, and concise." },
          { role: "user", content: prompt }
        ],
        temperature: 0.7,
        max_tokens: 1100
      }),
      signal: AbortSignal.timeout(45000)
    });

    const gatewayData = await gatewayResponse.json().catch(() => ({}));
    if (!gatewayResponse.ok) {
      const error = new Error(gatewayData?.error?.message || "AI Gateway request failed.");
      error.status = gatewayResponse.status;
      throw error;
    }

    const brief = gatewayData?.choices?.[0]?.message?.content;
    if (typeof brief !== "string" || !brief.trim()) {
      return res.status(502).json({ error: "AI returned an empty brief. Please try again." });
    }

    return res.status(200).json({
      brief: brief.trim(),
      model: gatewayData?.model || MODEL
    });
  } catch (error) {
    const message = String(error?.message || "");
    const status = Number(error?.statusCode || error?.status || 0);
    if (status === 401 || status === 403 || /unauthori[sz]ed|forbidden|authentication/i.test(message)) {
      return res.status(502).json({ error: "AI Gateway authentication failed. Check Preview OIDC access and the AI_GATEWAY_API_KEY." });
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
