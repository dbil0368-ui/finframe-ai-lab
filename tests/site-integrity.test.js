import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

async function checkInlineScripts(path) {
  const html = await readFile(new URL(path, import.meta.url), "utf8");
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)];
  let checked = 0;
  for (const match of scripts) {
    const attrs = match[1] || "";
    const source = match[2] || "";
    if (/\bsrc\s*=/.test(attrs) || /application\/ld\+json/i.test(attrs)) continue;
    checked += 1;
    try {
      new vm.Script(source, { filename: path + "#inline-script-" + checked });
    } catch (error) {
      throw new Error(path + " inline script " + checked + " failed to parse:\\n" + error.stack);
    }
  }
  return { html, checked };
}
  assert.match(html, /@media\s*\(max-width:\s*900px\)/i);
  assert.match(html, /@media\s*\(max-width:\s*520px\)/i);
  const { html, checked } = await checkInlineScripts("../index.html");
  assert.ok(checked >= 5, "expected to validate the inline application scripts");
  assert.match(html, /name="viewport"/i);
  assert.match(html, /@media\\s*\\(max-width:\\s*900px\\)/i);
  assert.match(html, /@media\\s*\\(max-width:\\s*520px\\)/i);
  for (const section of ["photo", "product", "poster", "tryon", "voice", "builder", "caption"]) {
    assert.ok(html.includes('id="' + section + '"') || html.includes("id='" + section + "'"), "missing section " + section);
  }
  assert.match(html, /\/api\/image/);
  assert.match(html, /\/api\/voice/);
  assert.match(html, /\/api\/creator/);
});

test("Trend Hub inline scripts parse and mobile breakpoints exist", async () => {
  const { html, checked } = await checkInlineScripts("../trend-hub.html");
  assert.ok(checked >= 1);
  assert.match(html, /name="viewport"/i);
  assert.match(html, /@media\s*\(max-width:\s*850px\)/i);
  assert.match(html, /id=["']billing["']/i);
});
