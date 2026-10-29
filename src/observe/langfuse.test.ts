import assert from "node:assert/strict";
import test from "node:test";
import {
  clipTraceText,
  parseWakeTrace,
  readLangfuseCredentials,
  traceTags,
} from "./config";
import { flushLangfuse, openObservation, scheduleLangfuseFlush } from "./langfuse";

test("credentials stay empty unless public key, secret, and base URL are all set", () => {
  assert.equal(readLangfuseCredentials({}), null);
  assert.equal(
    readLangfuseCredentials({
      LANGFUSE_PUBLIC_KEY: "pk-lf-test",
      LANGFUSE_SECRET_KEY: "sk-lf-test",
    }),
    null,
  );
  assert.equal(
    readLangfuseCredentials({
      LANGFUSE_PUBLIC_KEY: "  ",
      LANGFUSE_SECRET_KEY: "sk-lf-test",
      LANGFUSE_BASE_URL: "https://langfuse.example",
    }),
    null,
  );
  assert.equal(
    readLangfuseCredentials({
      LANGFUSE_PUBLIC_KEY: "pk-lf-test",
      LANGFUSE_SECRET_KEY: "sk-lf-test",
      LANGFUSE_BASE_URL: "not a url",
    }),
    null,
  );
  assert.deepEqual(
    readLangfuseCredentials({
      LANGFUSE_PUBLIC_KEY: " pk-lf-test ",
      LANGFUSE_SECRET_KEY: "sk-lf-test",
      LANGFUSE_BASEURL: "https://langfuse.viruspc.tech/api/public/otel/v1/traces/",
    }),
    {
      publicKey: "pk-lf-test",
      secretKey: "sk-lf-test",
      baseUrl: "https://langfuse.viruspc.tech",
    },
  );
});

test("worker env is the only credential source", () => {
  const previous = {
    publicKey: process.env.LANGFUSE_PUBLIC_KEY,
    secretKey: process.env.LANGFUSE_SECRET_KEY,
    baseUrl: process.env.LANGFUSE_BASE_URL,
  };
  process.env.LANGFUSE_PUBLIC_KEY = "pk-lf-from-process";
  process.env.LANGFUSE_SECRET_KEY = "sk-lf-from-process";
  process.env.LANGFUSE_BASE_URL = "https://langfuse.example";
  try {
    assert.equal(readLangfuseCredentials({}), null);
  } finally {
    restore("LANGFUSE_PUBLIC_KEY", previous.publicKey);
    restore("LANGFUSE_SECRET_KEY", previous.secretKey);
    restore("LANGFUSE_BASE_URL", previous.baseUrl);
  }
});

test("tags carry routing, handoff, peer, room, and environment", () => {
  assert.deepEqual(traceTags({}), ["environment:open-grokbot"]);
  assert.deepEqual(
    traceTags({ mode: "squad", rule: "leader", room: "lobby", peerId: "desk" }),
    [
      "environment:open-grokbot",
      "routing.mode:squad",
      "handoff.rule:leader",
      "room:lobby",
      "peer.id:desk",
    ],
  );
});

test("trace text drops keys and emails before it would be exported", () => {
  const clipped = clipTraceText("mail me a@b.co and sk-lf-secretvalue please");
  assert.match(clipped, /\[email\]/);
  assert.match(clipped, /\[redacted\]/);
  assert.doesNotMatch(clipped, /sk-lf-secretvalue/);
  assert.equal(clipTraceText("x".repeat(600)).length, 501);
});

test("a bad parent id does not become a span context", () => {
  assert.equal(parseWakeTrace(null).parent, null);
  assert.equal(parseWakeTrace({ traceId: "nope", spanId: "abcd", mode: "teams" }).parent, null);
  assert.deepEqual(
    parseWakeTrace({
      traceId: "AB".repeat(16),
      spanId: "cd".repeat(8),
      mode: "squad",
      rule: "leader",
    }),
    {
      parent: { traceId: "ab".repeat(16), spanId: "cd".repeat(8) },
      mode: "squad",
      rule: "leader",
    },
  );
});

test("missing keys do not throw, do not fetch, and still return the handoff result", async () => {
  const calls: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    calls.push(String(input));
    return new Response("no", { status: 500 });
  }) as typeof fetch;

  const previous = {
    publicKey: process.env.LANGFUSE_PUBLIC_KEY,
    secretKey: process.env.LANGFUSE_SECRET_KEY,
    baseUrl: process.env.LANGFUSE_BASE_URL,
  };
  process.env.LANGFUSE_PUBLIC_KEY = "pk-lf-from-process";
  process.env.LANGFUSE_SECRET_KEY = "sk-lf-from-process";
  process.env.LANGFUSE_BASE_URL = "https://langfuse.example";

  try {
    const trace = await openObservation({}, {
      name: "room.handoff",
      asType: "agent",
      traceName: "room.handoff",
      tags: traceTags({ mode: "teams", rule: "mentions", room: "lobby" }),
      input: { text: "hello" },
    });
    assert.equal(trace.link, null);
    const fan = trace.child({ name: "squad.fanout", asType: "span" });
    fan.annotate({ output: { targets: ["notetaker"] } });
    fan.fail(new Error("model down"));
    fan.end();
    fan.end();
    trace.annotate({ output: { woken: [], failed: ["notetaker"] }, level: "WARNING" });
    trace.end();

    let waited = false;
    scheduleLangfuseFlush({
      waitUntil() {
        waited = true;
      },
    });
    scheduleLangfuseFlush({
      waitUntil() {
        throw new Error("waitUntil unavailable");
      },
    });
    await flushLangfuse();
    assert.equal(waited, false);
    assert.deepEqual(calls, []);

    const outcome = await (async () => {
      const obs = await openObservation(
        { LANGFUSE_PUBLIC_KEY: "pk-only" },
        { name: "peer:desk", asType: "agent" },
      );
      try {
        throw new Error("wake failed");
      } catch (error) {
        obs.fail(error);
        return "kept";
      } finally {
        obs.end();
        await flushLangfuse();
      }
    })();
    assert.equal(outcome, "kept");
    assert.deepEqual(calls, []);
  } finally {
    globalThis.fetch = original;
    restore("LANGFUSE_PUBLIC_KEY", previous.publicKey);
    restore("LANGFUSE_SECRET_KEY", previous.secretKey);
    restore("LANGFUSE_BASE_URL", previous.baseUrl);
  }
});

function restore(name: "LANGFUSE_PUBLIC_KEY" | "LANGFUSE_SECRET_KEY" | "LANGFUSE_BASE_URL", value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
