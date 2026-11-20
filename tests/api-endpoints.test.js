import { test } from "node:test";
import assert from "node:assert/strict";
import imageHandler from "../api/image.js";
import creatorHandler from "../api/creator.js";
import tryonHandler from "../api/tryon.js";

function response() {
  return {
    statusCode: 200, headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

async function call(handler, req) {
  const res = response();
  await handler(req, res);
  return res;
}

test("image API rejects unsupported methods without touching providers", async () => {
  const res = await call(imageHandler, { method: "GET", headers: {} });
  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.Allow, "POST");
});

test("image API requires a signed-in user", async () => {
  const res = await call(imageHandler, { method: "POST", headers: {}, body: { prompt: "test" } });
  assert.equal(res.statusCode, 401);
});

test("creator API rejects unsupported methods", async () => {
  const res = await call(creatorHandler, { method: "GET", headers: {} });
  assert.equal(res.statusCode, 405);
});

test("creator API requires a signed-in user", async () => {
  const res = await call(creatorHandler, { method: "POST", headers: {}, body: { topic: "test" } });
  assert.equal(res.statusCode, 401);
});

test("legacy provider try-on API rejects unsupported methods", async () => {
  const res = await call(tryonHandler, { method: "GET", headers: {} });
  assert.equal(res.statusCode, 405);
});

test("legacy provider try-on API requires a signed-in user", async () => {
  const res = await call(tryonHandler, { method: "POST", headers: {} });
  assert.equal(res.statusCode, 401);
});
