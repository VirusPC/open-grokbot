import assert from "node:assert/strict";
import test from "node:test";
import { errorPage, escapeHtml } from "./error-page.js";

test("escapes the URL and the error text", () => {
  const html = errorPage({
    url: `https://lab.example/?q="1"&x=<script>`,
    description: `失败 <img alt="x">`,
  });
  assert.equal(html.includes("<script>"), false);
  assert.equal(html.includes("<img"), false);
  assert.match(html, /https:\/\/lab\.example\/\?q=&quot;1&quot;&amp;x=&lt;script&gt;/);
  assert.match(html, /失败 &lt;img alt=&quot;x&quot;&gt;/);
  assert.match(html, /重新加载/);
});

test("uses a fallback reason when the description is blank", () => {
  const html = errorPage({ url: "http://127.0.0.1:43123", description: "  " });
  assert.match(html, /网络不可用/);
  assert.equal(escapeHtml(`a&b`), "a&amp;b");
});
