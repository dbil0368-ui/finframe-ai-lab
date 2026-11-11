const MODEL = process.env.GEMINI_MODEL || "gemini-3.8-flash";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Use POST for Creator Studio." });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(503).json({
      error: "Gemini is not configured yet. Add GEMINI_API_KEY to the Vercel Preview environment."
    });
  }

  const body = req.body || {};
  const topic = typeof body.topic === "string" ? body.topic.trim().slice(0, 240) : "";
  const format = typeof body.format === "string" ? body.format.slice(0, 60) : "Short video";
  const audience = typeof body.audience === "string" ? body.audience.trim().slice(0, 160) : "curious viewers";
  const language = typeof body.language === "string" ? body.language.slice(0, 40) : "Bengali";

  if (!topic) return res.status(400).json({ error: "Please enter a topic." });

  const prompt = [
    "You are VYBORA Creator Studio, an ethical creator strategist. Create a practical, original creative brief. Be specific, fresh, safe, and concise.",
    "Do not invent facts, statistics, quotes, or current events. If the topic needs verification, clearly mark claims to verify.",
    "Write in " + language + ".",
    "Audience: " + audience,
    "Format: " + format,
    "Topic: " + topic,
    "Return concise plain text with these sections: BIG IDEA, 3 HOOK OPTIONS, CONTENT STRUCTURE (4-6 beats), CAPTION, CTA, HASHTAGS (5-8 relevant tags), FACT-CHECK NOTES."
  ].join("\n");

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODEL)}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey
        },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: 1100 }
        }),
        signal: AbortSignal.timeout(45000)
      }
    );

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const providerMessage = String(data?.error?.message || "");
      console.error("[VYBORA Creator] Gemini request failed", {
        status: response.status,
        message: providerMessage.slice(0, 220)
      });
      if (response.status === 401 || response.status === 403) {
        return res.status(502).json({ error: "Gemini API key was rejected. Check the GEMINI_API_KEY configured for this Preview deployment." });
      }
      if (response.status === 429) {
        return res.status(429).json({ error: "Gemini free-tier usage limit reached. Please wait and try again." });
      }
      return res.status(502).json({ error: "Gemini could not generate the brief. Please try again." });
    }

    const brief = (data?.candidates?.[0]?.content?.parts || [])
      .map(part => typeof part.text === "string" ? part.text : "")
      .join("\n")
      .trim();

    if (!brief) {
      return res.status(502).json({ error: "Gemini returned an empty brief. Please try again." });
    }

    return res.status(200).json({ brief, model: MODEL });
  } catch (error) {
    console.error("[VYBORA Creator] Gemini request error", {
      errorName: String(error?.name || "Error").slice(0, 80),
      message: String(error?.message || "").slice(0, 180)
    });
    return res.status(502).json({ error: "Gemini service is temporarily unavailable. Please try again." });
  }
}
