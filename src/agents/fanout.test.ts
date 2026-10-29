import assert from "node:assert/strict";
import test from "node:test";
import { handoffStillOpen, linesFromFanout, settleFanout, type WakeLine } from "./fanout";
import type { RoomMessage } from "./peer-types";

const IDS = ["desk", "researcher", "notetaker"] as const;

test("broadcast and mention targets settle together, failures stay isolated", async () => {
  const startedAt: number[] = [];
  const origin = Date.now();
  const delays: Record<string, number> = { desk: 50, researcher: 10, notetaker: 30 };
  const settled = await settleFanout([...IDS], async (id) => {
    startedAt.push(Date.now());
    await new Promise((resolve) => setTimeout(resolve, delays[id] ?? 0));
    if (id === "researcher") throw new Error("model down");
    return { reply: id, wokeAt: "t" } satisfies WakeLine;
  });
  const elapsed = Date.now() - origin;
  assert.ok(elapsed < 120, `parallel wall clock ${elapsed}ms stacked the delays`);
  assert.ok(Math.max(...startedAt) - Math.min(...startedAt) < 25, "wakes did not start together");
  assert.deepEqual(
    settled.map((item) => (item.ok ? item.id : `${item.id}:${item.error}`)),
    ["desk", "researcher:model down", "notetaker"],
  );
  const { lines, receipts } = linesFromFanout("human-1", settled);
  assert.deepEqual(
    lines.map((line) => line.id),
    ["reply:human-1:desk", "fail:human-1:researcher", "reply:human-1:notetaker"],
  );
  assert.equal(lines[1]?.text, "叫醒 researcher 失败：model down");
  assert.deepEqual(
    receipts.map((receipt) => receipt.id),
    ["desk", "notetaker"],
  );
});

test("a handoff stays open until every target has a reply or a failure line", () => {
  const human: RoomMessage = {
    id: "human-1",
    authorId: "you",
    text: "hello各位",
    createdAt: "t",
    kind: "human",
    handoff: { rule: "broadcast", targets: ["desk", "notetaker"] },
  };
  assert.equal(handoffStillOpen([human]), true);
  assert.equal(
    handoffStillOpen([
      human,
      {
        id: "reply:human-1:desk",
        authorId: "desk",
        text: "你好",
        createdAt: "t",
        kind: "peer",
        handoff: null,
      },
    ]),
    true,
  );
  assert.equal(
    handoffStillOpen([
      human,
      {
        id: "reply:human-1:desk",
        authorId: "desk",
        text: "你好",
        createdAt: "t",
        kind: "peer",
        handoff: null,
      },
      {
        id: "fail:human-1:notetaker",
        authorId: "room",
        text: "叫醒 notetaker 失败：down",
        createdAt: "t",
        kind: "system",
        handoff: null,
      },
    ]),
    false,
  );
});
