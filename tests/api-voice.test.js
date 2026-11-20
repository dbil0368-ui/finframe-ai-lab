import { test } from "node:test";
import assert from "node:assert/strict";
import voiceHandler from "../api/voice.js";

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

async function invoke(req, fetchMock, apiKey = "test-gemini-key") {
  const previousFetch = globalThis.fetch;
  const previousKey = process.env.GEMINI_API_KEY;
  globalThis.fetch = fetchMock;
  process.env.GEMINI_API_KEY = apiKey;
  const res = {
    statusCode: 200,
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
  try {
    await voiceHandler(req, res);
    return res;
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousKey;
  }
}

function successfulFetch(audioMimeType, audioBytes) {
  return async (url) => {
    if (String(url).endsWith("/auth/v1/user")) return jsonResponse(200, { id: "user-test" });
    if (String(url).includes("/rpc/consume_vybora_ai_generation_for_current_user")) {
      return jsonResponse(200, [{ allowed: true, used: 1, daily_limit: 3, remaining: 2, plan_key: "free" }]);
    }
    if (String(url).includes(":generateContent")) {
      return jsonResponse(200, {
        candidates: [{ content: { parts: [{ inlineData: { mimeType: audioMimeType, data: audioBytes.toString("base64") } }] } }]
      });
    }
    throw new Error("Unexpected fetch URL: " + url);
  };
}

test("rejects non-POST requests", async () => {
  const res = await invoke({ method: "GET", headers: {} }, async () => {
    throw new Error("fetch should not be called");
  });
  assert.equal(res.statusCode, 405);
});

test("requires an authenticated Supabase session", async () => {
  const res = await invoke({ method: "POST", headers: {}, body: { text: "Hello" } }, async () => {
    throw new Error("fetch should not be called");
  });
  assert.equal(res.statusCode, 401);
});

test("passes through a complete WAV response without nesting another WAV header", async () => {
  const wavBytes = Buffer.alloc(48);
  wavBytes.write("RIFF", 0);
  wavBytes.writeUInt32LE(40, 4);
  wavBytes.write("WAVE", 8);
  wavBytes.write("fmt ", 12);
  wavBytes.write("data", 36);
  const res = await invoke({
    method: "POST",
    headers: { authorization: "Bearer valid-session" },
    body: { text: "Hello", voice: "Kore" }
  }, successfulFetch("audio/wav", wavBytes));

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.audio, "data:audio/wav;base64," + wavBytes.toString("base64"));
});

test("wraps headerless PCM audio in a valid WAV container", async () => {
  const pcm = Buffer.from([1, 0, 2, 0, 3, 0, 4, 0]);
  const res = await invoke({
    method: "POST",
    headers: { authorization: "Bearer valid-session" },
    body: { text: "Hello", voice: "Kore" }
  }, successfulFetch("audio/pcm;rate=16000", pcm));

  assert.equal(res.statusCode, 200);
  const output = Buffer.from(res.body.audio.split(",")[1], "base64");
  assert.equal(output.subarray(0, 4).toString("ascii"), "RIFF");
  assert.equal(output.subarray(8, 12).toString("ascii"), "WAVE");
  assert.equal(output.readUInt32LE(24), 16000);
  assert.deepEqual(output.subarray(44), pcm);
});
