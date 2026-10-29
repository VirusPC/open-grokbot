import type { HandoffPlan, RoomRouting } from "./peer-types";

type NamedMate = { id: string; displayName: string };

/**
 * Who a room line wakes.
 *
 * Teams (default, Raft-like visibility): every member can read the thread.
 * A peer is woken only by @id, @displayName, @all, or their id/display name
 * as its own token. "desk在吗" does not wake anyone. This is not an issue workflow.
 *
 * Squad (Multica-like): no @ wakes only the leader. Explicit @ wakes those
 * people and does not also wake the leader. @all wakes every member on purpose.
 * The leader's reply is scanned again with planLeaderFanout; other peer
 * replies are not.
 *
 * `@` must start a token (after whitespace or the beginning), so `a@b.com`
 * is not a mention. Matching is longest-prefix against id and displayName.
 */

export function planRoomRoute(input: {
  mode: RoomRouting;
  text: string;
  memberIds: readonly string[];
  teammates: readonly NamedMate[];
  leaderId: string;
}): HandoffPlan {
  const scan = scanMentions(input.text, input.memberIds, input.teammates);
  if (scan.sawAll) {
    return {
      rule: "broadcast",
      targets: [...input.memberIds],
      unknown: scan.unknown,
      outsideRoom: scan.outsideRoom,
    };
  }
  if (scan.sawMention) {
    return {
      rule: "mentions",
      targets: scan.targets,
      unknown: scan.unknown,
      outsideRoom: scan.outsideRoom,
    };
  }
  if (input.mode === "squad") {
    const leader = effectiveLeader(input.leaderId, input.memberIds);
    return {
      rule: "leader",
      targets: leader ? [leader] : [],
      unknown: [],
      outsideRoom: [],
    };
  }
  const addressed = standaloneAddressed(input.text, input.memberIds, input.teammates);
  if (addressed.length > 0) {
    return { rule: "addressed", targets: addressed, unknown: [], outsideRoom: [] };
  }
  return { rule: "silent", targets: [], unknown: [], outsideRoom: [] };
}

/** Mentions inside the leader's reply. The leader is not woken again. */
export function planLeaderFanout(
  reply: string,
  memberIds: readonly string[],
  teammates: readonly NamedMate[],
  leaderId: string,
): HandoffPlan {
  const scan = scanMentions(reply, memberIds, teammates);
  if (!scan.sawMention && !scan.sawAll) {
    return { rule: "silent", targets: [], unknown: [], outsideRoom: [] };
  }
  const targets = (scan.sawAll ? [...memberIds] : scan.targets).filter((id) => id !== leaderId);
  return {
    rule: scan.sawAll ? "broadcast" : "mentions",
    targets,
    unknown: scan.unknown,
    outsideRoom: scan.outsideRoom,
  };
}

export function effectiveLeader(leaderId: string, memberIds: readonly string[]): string | null {
  if (memberIds.includes(leaderId)) return leaderId;
  if (memberIds.includes("desk")) return "desk";
  return memberIds[0] ?? null;
}

export function routingHint(mode: RoomRouting, leaderId: string): string {
  if (mode === "squad") {
    return `Squad：没写 @ 只叫醒队长 ${leaderId}。队长回复里的 @ 再叫醒别人。你自己写了 @，就不会再自动叫醒队长。@all 会故意叫醒全体。`;
  }
  return "Teams：线程大家都看得见。只有 @、@all，或单独写出的 id／显示名才会回复。没有点名就不会叫醒。这不是工单流。";
}

type MentionScan = {
  sawMention: boolean;
  sawAll: boolean;
  targets: string[];
  unknown: string[];
  outsideRoom: string[];
};

function scanMentions(
  text: string,
  memberIds: readonly string[],
  teammates: readonly NamedMate[],
): MentionScan {
  const memberSet = new Set(memberIds);
  const aliases = aliasList(teammates);
  const targets: string[] = [];
  const unknown: string[] = [];
  const outsideRoom: string[] = [];
  const seen = new Set<string>();
  let sawMention = false;
  let sawAll = false;

  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== "@") continue;
    if (!isMentionBoundary(text, index)) continue;
    sawMention = true;
    const rest = text.slice(index + 1);
    if (/^all(?![a-z0-9-])/i.test(rest)) {
      sawAll = true;
      index += "all".length;
      continue;
    }
    const alias = aliases.find((candidate) => rest.toLowerCase().startsWith(candidate.token));
    if (!alias) {
      const raw = /^[^\s@]{1,40}/u.exec(rest)?.[0];
      if (raw && !unknown.includes(raw)) unknown.push(raw);
      index += raw ? raw.length : 0;
      continue;
    }
    index += alias.token.length;
    if (!memberSet.has(alias.id)) {
      if (!outsideRoom.includes(alias.id)) outsideRoom.push(alias.id);
      continue;
    }
    if (!seen.has(alias.id)) {
      seen.add(alias.id);
      targets.push(alias.id);
    }
  }

  return { sawMention, sawAll, targets, unknown, outsideRoom };
}

function standaloneAddressed(
  text: string,
  memberIds: readonly string[],
  teammates: readonly NamedMate[],
): string[] {
  const memberSet = new Set(memberIds);
  const aliases = aliasList(teammates);
  const tokens = text.match(/[\p{L}\p{N}_-]+/gu) ?? [];
  const targets: string[] = [];
  for (const token of tokens) {
    const alias = aliases.find((candidate) => candidate.token === token.toLowerCase());
    if (!alias || !memberSet.has(alias.id) || targets.includes(alias.id)) continue;
    targets.push(alias.id);
  }
  return targets;
}

function aliasList(teammates: readonly NamedMate[]): Array<{ token: string; id: string }> {
  return teammates
    .flatMap((mate) => [
      { token: mate.id.toLowerCase(), id: mate.id },
      { token: mate.displayName.toLowerCase(), id: mate.id },
    ])
    .filter((alias) => alias.token.length > 0)
    .sort((a, b) => b.token.length - a.token.length);
}

function isMentionBoundary(text: string, index: number): boolean {
  if (index === 0) return true;
  return /\s/u.test(text[index - 1] ?? "");
}
