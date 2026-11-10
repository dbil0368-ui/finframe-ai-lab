// Vercel serverless proxy for a compatible virtual try-on provider.
// Keep TRYON_API_KEY on the server. Never put it in index.html.
export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed." });
  }

  const providerUrl = process.env.TRYON_PROVIDER_URL;
  const apiKey = process.env.TRYON_API_KEY;
  if (!providerUrl || !apiKey) {
    return res.status(503).json({
      error: "AI Virtual Try-On is not connected yet. Add TRYON_PROVIDER_URL and TRYON_API_KEY to the server environment."
    });
  }

  const contentType = req.headers["content-type"] || "";
  if (!contentType.toLowerCase().includes("multipart/form-data")) {
    return res.status(400).json({ error: "Expected multipart form data with person and garment images." });
  }

  const length = Number(req.headers["content-length"] || 0);
  if (length > 21 * 1024 * 1024) {
    return res.status(413).json({ error: "Please keep both images under 10 MB each." });
  }

  try {
    const upstream = await fetch(providerUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": contentType
      },
      body: req,
      duplex: "half"
    });

    const text = await upstream.text();
    let data;
    try { data = JSON.parse(text); }
    catch { data = { error: text || "The AI provider returned an unreadable response." }; }

    if (!upstream.ok) {
      return res.status(upstream.status >= 400 && upstream.status < 600 ? upstream.status : 502)
        .json({ error: data.error || data.detail || "The AI provider could not process these images." });
    }
    return res.status(200).json(data);
  } catch (error) {
    return res.status(502).json({ error: "Could not reach the configured AI provider. Check the backend settings." });
  }
}
