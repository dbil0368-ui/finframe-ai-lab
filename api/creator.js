const MODEL = process.env.AI_GATEWAY_MODEL || "openai/gpt-5-mini";
const GATEWAY_URL = "https://ai-gateway.vercel.sh/v1/chat/completions";

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Use POST for Creator Studio." });
  }

  const token = process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN;
  if (!token) {
    return res.status(503).json({
      error: "AI is not connected yet. Add AI_GATEWAY_API_KEY in Vercel Project Settings → Environment Variables, then redeploy."
    });
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
    const upstream = await fetch(GATEWAY_URL, {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + token,
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
    const data = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      const status = upstream.status === 401 || upstream.status === 403 ? 502 : upstream.status;
      return res.status(status).json({
        error: upstream.status === 401 || upstream.status === 403
          ? "AI Gateway authentication failed. Check the Vercel AI Gateway connection or API key."
          : upstream.status === 429
            ? "AI usage limit reached. Please try again later."
            : "AI service is temporarily unavailable. Please try again."
      });
    }
    const result = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (typeof result !== "string" || !result.trim()) {
      return res.status(502).json({ error: "AI returned an empty brief. Please try again." });
    }
    return res.status(200).json({ brief: result.trim(), model: data.model || MODEL });
  } catch (error) {
    return res.status(504).json({ error: "AI request timed out or could not connect. Please try again." });
  }
};
