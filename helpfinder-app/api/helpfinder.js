const MODELS = (process.env.GEMINI_MODEL || "gemini-2.5-flash,gemini-2.5-flash-lite")
  .split(",").map(value => value.trim()).filter(Boolean);
const SUPABASE_URL = "https://pxgoaygwtxrrqkftluut.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_rmuwOPAIqOWlOC6S-Gpnrg_pNfAxHNh";
// Best-effort per-instance throttling; durable global quotas require a shared database counter.
const rateBuckets = globalThis.__helpfinderRateBuckets || (globalThis.__helpfinderRateBuckets = new Map());

function send(res, status, body) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  return res.status(status).json(body);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return send(res, 405, { error: "Use POST to search for a solution." });
  }

  const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) return send(res, 401, { error: "Sign in to use HelpFinder AI." });

  try {
    const authResponse = await fetch(SUPABASE_URL + "/auth/v1/user", {
      headers: { apikey: SUPABASE_PUBLISHABLE_KEY, Authorization: "Bearer " + token }
    });
    if (!authResponse.ok) return send(res, 401, { error: "Your session expired. Please sign in again." });
    const user = await authResponse.json();
    const now = Date.now();
    const bucket = (rateBuckets.get(user.id) || []).filter(time => now - time < 60_000);
    if (bucket.length >= 10) return send(res, 429, { error: "Too many requests in a short time. Please wait a minute and try again." });
    bucket.push(now);
    rateBuckets.set(user.id, bucket);
    if (rateBuckets.size > 500) {
      for (const [key, times] of rateBuckets) if (!times.length || now - times[times.length - 1] > 10 * 60_000) rateBuckets.delete(key);
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return send(res, 503, { error: "Web search AI is not configured. Add GEMINI_API_KEY to this standalone HelpFinder Vercel project." });

    const body = req.body || {};
    const question = typeof body.question === "string" ? body.question.trim().slice(0, 1200) : "";
    const history = Array.isArray(body.history) ? body.history.slice(-10).map(item => ({ role: item?.role === "assistant" ? "model" : "user", text: typeof item?.content === "string" ? item.content.slice(0, 3000) : "" })).filter(item => item.text) : [];
    const region = typeof body.region === "string" ? body.region.slice(0, 60) : "Global";
    const language = typeof body.language === "string" ? body.language.slice(0, 40) : "English";
    if (question.length < 8) return send(res, 400, { error: "Please describe the problem in a little more detail." });

    const systemPrompt = [
      "You are HelpFinder AI, a careful and friendly global conversational assistant.",
      "Answer the user's question directly. Continue naturally using recent chat context when provided; do not repeat the whole previous answer unless asked.",
      "Use Google Search grounding when current facts, changing information, or research would improve the answer. Prefer official documentation, government, universities, recognized consumer organizations, and primary sources.",
      "Answer in " + language + ". User region: " + region + ".",
      "For problem-solving, give clear practical steps, free or low-cost options first, and explain what to avoid where relevant.",
      "Do not invent facts, product features, prices, policies, contact details, or URLs. Distinguish verified facts from general suggestions.",
      "If search results do not support a reliable answer, say so and suggest which official source to check next.",
      "For medical, legal, financial, or safety-sensitive questions, provide general information only, prioritize official sources, and recommend an appropriate qualified adult or professional where relevant. For emergencies, advise contacting local emergency services.",
      "Never ask for passwords, one-time codes, payment card details, recovery codes, or other secrets. Do not encourage sharing private personal information.",
      "Keep answers clear and readable with short headings or numbered steps when useful. Do not fabricate citations or write raw URLs; actual source links are provided separately by the application."
    ].join("\n");
    const conversation = history.map(item => ({ role: item.role, parts: [{ text: item.text }] }));
    conversation.push({ role: "user", parts: [{ text: question }] });

    let lastError;
    for (const model of MODELS) {
      try {
        const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models/" + encodeURIComponent(model) + ":generateContent", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: systemPrompt }] },
            contents: conversation,
            tools: [{ googleSearch: {} }],
            generationConfig: { temperature: 1, maxOutputTokens: 1800 }
          }),
          signal: AbortSignal.timeout(75000)
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          const message = String(data?.error?.message || "");
          console.error("[HelpFinder] provider error", { status: response.status, message: message.slice(0, 180) });
          if ([429, 503, 504].includes(response.status)) continue;
          if (response.status === 401 || response.status === 403) return send(res, 502, { error: "The Gemini API key was rejected. Check GEMINI_API_KEY in Vercel." });
          return send(res, 502, { error: "The web research service could not complete this request." });
        }

        const candidate = data?.candidates?.[0];
        const answer = (candidate?.content?.parts || []).map(part => typeof part.text === "string" ? part.text : "").join("\n").trim();
        if (!answer) return send(res, 502, { error: "The research service returned no answer. Please try again." });

        const metadata = candidate?.groundingMetadata || candidate?.grounding_metadata || {};
        const chunks = metadata.groundingChunks || metadata.grounding_chunks || [];
        const sources = [];
        const seen = new Set();
        for (const chunk of chunks) {
          const web = chunk?.web || chunk?.webPage || chunk?.web_page;
          const uri = typeof web?.uri === "string" ? web.uri : "";
          if (!uri || !/^https?:\/\//i.test(uri) || seen.has(uri)) continue;
          seen.add(uri);
          sources.push({
            title: String(web.title || web.domain || "Web source").slice(0, 180),
            url: uri,
            domain: String(web.domain || "").slice(0, 100)
          });
        }
        const queries = metadata.webSearchQueries || metadata.web_search_queries || [];
        const searchWidgetHtml = metadata.searchEntryPoint?.renderedContent || metadata.search_entry_point?.rendered_content || "";
        return send(res, 200, {
          answer,
          sources,
          searchQueries: Array.isArray(queries) ? queries.slice(0, 6) : [],
          searchWidgetHtml: typeof searchWidgetHtml === "string" ? searchWidgetHtml.slice(0, 30000) : "",
          grounded: sources.length > 0
        });
      } catch (error) {
        lastError = error;
        console.error("[HelpFinder] request failed", { name: String(error?.name || "Error"), message: String(error?.message || "").slice(0, 160) });
        if (error?.name === "TimeoutError") break;
      }
    }
    return send(res, 502, { error: lastError?.name === "TimeoutError" ? "The research search took too long. Try a shorter question." : "Web research is temporarily unavailable. Please try again." });
  } catch (error) {
    console.error("[HelpFinder] request error", String(error?.message || error).slice(0, 180));
    return send(res, 503, { error: "Could not verify your account or daily usage. Please try again." });
  }
}
