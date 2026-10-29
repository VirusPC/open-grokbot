import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_URL, isHttpUrl, isSameOrigin, resolveStartUrl } from "./url.js";

test("defaults to the local lab", () => {
  assert.equal(resolveStartUrl({}), DEFAULT_URL);
  assert.equal(resolveStartUrl({ OPEN_GROKBOT_URL: "   " }), DEFAULT_URL);
  assert.equal(DEFAULT_URL, "http://127.0.0.1:43123");
});

test("accepts an http or https override", () => {
  assert.equal(
    resolveStartUrl({ OPEN_GROKBOT_URL: "http://127.0.0.1:43123" }),
    "http://127.0.0.1:43123/",
  );
  assert.equal(
    resolveStartUrl({ OPEN_GROKBOT_URL: "  https://lab.example/desk?x=1  " }),
    "https://lab.example/desk?x=1",
  );
});

test("rejects non-http URLs", () => {
  assert.throws(
    () => resolveStartUrl({ OPEN_GROKBOT_URL: "ftp://files.example/a" }),
    /http 或 https/,
  );
  assert.throws(
    () => resolveStartUrl({ OPEN_GROKBOT_URL: "not a url" }),
    /不是合法地址/,
  );
  assert.equal(isHttpUrl("javascript:alert(1)"), false);
  assert.equal(isHttpUrl("https://lab.example"), true);
  assert.equal(isHttpUrl(DEFAULT_URL), true);
});

test("compares origins", () => {
  assert.equal(
    isSameOrigin("http://127.0.0.1:43123/agents/desk", DEFAULT_URL),
    true,
  );
  assert.equal(isSameOrigin("https://example.com", DEFAULT_URL), false);
  assert.equal(isSameOrigin("data:text/html,hi", DEFAULT_URL), false);
  assert.equal(isSameOrigin("::::", DEFAULT_URL), false);
});
