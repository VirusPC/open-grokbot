import type { RoomMessage, WakeReceipt } from "./peer-types";

export type FanoutSettled<T> =
  | { id: string; ok: true; value: T }
  | { id: string; ok: false; error: string };

export type WakeLine = { reply: string; wokeAt: string };

/**
 * Wake every id together. `Promise.allSettled` keeps one rejection from
 * cancelling the rest. Result order matches `ids`, not completion order.
 *
 * The room uses this for both handoff rules (broadcast to every member,
 * and @-mentions of a subset). There is no sequential for-await path.
 */
export async function settleFanout<T>(
  ids: readonly string[],
  wake: (id: string) => Promise<T>,
): Promise<FanoutSettled<T>[]> {
  const settled = await Promise.allSettled(ids.map((id) => wake(id)));
  return settled.map((result, index) => {
    const id = ids[index] ?? "";
    if (result.status === "fulfilled") return { id, ok: true, value: result.value };
    return { id, ok: false, error: errorText(result.reason) };
  });
}

export function linesFromFanout(
  humanId: string,
  settled: readonly FanoutSettled<WakeLine>[],
): { lines: RoomMessage[]; receipts: WakeReceipt[] } {
  const lines: RoomMessage[] = [];
  const receipts: WakeReceipt[] = [];
  for (const item of settled) {
    if (item.ok) {
      receipts.push({ id: item.id, at: item.value.wokeAt, kind: "room" });
      lines.push({
        id: replyMessageId(humanId, item.id),
        authorId: item.id,
        text: item.value.reply,
        createdAt: item.value.wokeAt,
        kind: "peer",
        handoff: null,
      });
      continue;
    }
    lines.push({
      id: failMessageId(humanId, item.id),
      authorId: "room",
      text: `叫醒 ${item.id} 失败：${item.error}`,
      createdAt: new Date().toISOString(),
      kind: "system",
      handoff: null,
    });
  }
  return { lines, receipts };
}

export function replyMessageId(humanId: string, peerId: string): string {
  return `reply:${humanId}:${peerId}`;
}

export function failMessageId(humanId: string, peerId: string): string {
  return `fail:${humanId}:${peerId}`;
}

/** True while some human line still has a target with no peer line and no failure line. */
export function handoffStillOpen(messages: readonly RoomMessage[]): boolean {
  return messages.some((message) => {
    if (message.kind !== "human" || !message.handoff || message.handoff.targets.length === 0) {
      return false;
    }
    return message.handoff.targets.some(
      (id) =>
        !messages.some(
          (item) => item.id === replyMessageId(message.id, id) || item.id === failMessageId(message.id, id),
        ),
    );
  });
}

function errorText(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}
