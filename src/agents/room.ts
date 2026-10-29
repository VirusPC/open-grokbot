import { Agent, callable, getAgentByName } from "agents";
import { selectWakeThread } from "./peer-reply";
import {
  MAX_ROOM_MESSAGES,
  REGISTRY_NAME,
  SEED_TEAMMATES,
  initialRoomState,
  normalizeAuthorId,
  normalizePostText,
  normalizeTeammateId,
  planHandoff,
  type OpenResult,
  type PostResult,
  type RoomMessage,
  type RoomState,
  type WakeMember,
  type WakeReceipt,
} from "./peer-types";

/**
 * Channel / ingress for peer mode. Members and the transcript live here.
 *
 * postMessage does not run inside a Desk Think turn:
 *   1. planHandoff decides broadcast vs @-only
 *   2. getAgentByName(env.PeerAgent, id) wakes each target
 *   3. the peer returns a line that answers `text`; this room appends it
 *
 * The peer does not fetch this room back. A Durable Object waiting on its
 * own stub deadlocks the input gate. The room passes a snapshot of earlier
 * human and peer lines instead. Peer replies are `kind: "peer"` and are
 * not fanned out again.
 */
export class RoomAgent extends Agent<Env, RoomState> {
  initialState: RoomState = {
    ...initialRoomState,
    memberIds: [...initialRoomState.memberIds],
    messages: [...initialRoomState.messages],
  };

  override async onStart(): Promise<void> {
    if (this.state.room === this.name) return;
    this.setState({ ...this.state, room: this.name });
  }

  @callable()
  async open(input?: { memberIds?: string[] }): Promise<OpenResult> {
    const registry = await getAgentByName(this.env.TeammateRegistry, REGISTRY_NAME);
    const teammates = await registry.list();
    const known = new Set(teammates.map((mate) => mate.id));
    const requested =
      input?.memberIds && input.memberIds.length > 0
        ? input.memberIds
        : SEED_TEAMMATES.map((mate) => mate.id);

    const memberIds: string[] = [];
    for (const raw of requested) {
      const id = normalizeTeammateId(raw);
      if (!id || !known.has(id) || memberIds.includes(id)) continue;
      memberIds.push(id);
    }
    const ordered = orderMembers(memberIds, teammates.map((mate) => mate.id));
    if (ordered.length === 0) {
      return { ok: false, error: "创建房间至少要有一位已登记的同事。" };
    }

    const same =
      this.state.opened &&
      this.state.memberIds.length === ordered.length &&
      this.state.memberIds.every((id, index) => id === ordered[index]);
    if (same) {
      const state = { ...this.state, room: this.name };
      return { ok: true, state };
    }

    const notice = this.state.opened
      ? `成员改为：${ordered.join("、")}。没有 @ 广播给这些同事；写了 @ 就只叫醒房间里被点名的人。`
      : `房间已打开，成员：${ordered.join("、")}。没有 @ 广播给全体成员；写了 @id 或 @显示名，并且对方在房间里，就只叫醒被点名的人。交接是 getAgentByName(PeerAgent, id)，不经过 agentTool。`;

    const next = this.commit([
      ...this.state.messages,
      systemMessage(notice),
    ], ordered, true);
    return { ok: true, state: next };
  }

  @callable()
  async postMessage(input?: { text?: string; authorId?: string }): Promise<PostResult> {
    if (!this.state.opened) {
      return { ok: false, error: "这个房间还没打开。" };
    }
    const text = normalizePostText(input?.text);
    if (!text) return { ok: false, error: "消息不能为空，最多 1000 字。" };
    const authorId =
      input?.authorId === undefined ? "you" : normalizeAuthorId(input.authorId);
    if (!authorId) return { ok: false, error: "authorId 需为 you 或小写 id。" };

    const registry = await getAgentByName(this.env.TeammateRegistry, REGISTRY_NAME);
    const teammates = await registry.list();
    const names = new Map(teammates.map((mate) => [mate.id, mate.displayName]));
    const members: WakeMember[] = this.state.memberIds.map((id) => ({
      id,
      displayName: names.get(id) ?? id,
    }));
    const thread = selectWakeThread(this.state.messages, names);
    const plan = planHandoff(text, this.state.memberIds, teammates);
    const messages: RoomMessage[] = [
      ...this.state.messages,
      {
        id: crypto.randomUUID(),
        authorId,
        text,
        createdAt: new Date().toISOString(),
        kind: "human",
        handoff: { rule: plan.rule, targets: plan.targets },
      },
    ];

    for (const token of plan.unknown) {
      messages.push(systemMessage(`不认识 @${token}，登记表里没有这个同事。`));
    }
    for (const id of plan.outsideRoom) {
      messages.push(systemMessage(`@${id} 在登记表里，但不在这个房间，所以没有叫醒。`));
    }

    const receipts: WakeReceipt[] = [];
    for (const id of plan.targets) {
      try {
        const peer = await getAgentByName(this.env.PeerAgent, id);
        const mate = teammates.find((item) => item.id === id);
        const wake = await peer.wake({
          kind: "room",
          text,
          room: this.name,
          from: authorId,
          displayName: mate?.displayName ?? names.get(id) ?? id,
          tags: mate ? [...mate.tags] : [],
          members,
          thread,
        });
        receipts.push({ id, at: wake.wokeAt, kind: "room" });
        messages.push({
          id: crypto.randomUUID(),
          authorId: id,
          text: wake.reply,
          createdAt: wake.wokeAt,
          kind: "peer",
          handoff: null,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        messages.push(systemMessage(`叫醒 ${id} 失败：${message}`));
      }
    }

    if (receipts.length > 0) {
      await registry.recordWakes(receipts);
    }
    if (
      plan.rule === "mentions" &&
      plan.targets.length === 0 &&
      plan.unknown.length === 0 &&
      plan.outsideRoom.length === 0
    ) {
      messages.push(systemMessage("写了 @，但没有点到房间里的同事。"));
    }

    const next = this.commit(messages, this.state.memberIds, true);
    console.log(
      JSON.stringify({
        event: "room.handoff",
        room: this.name,
        rule: plan.rule,
        targets: plan.targets,
      }),
    );
    return { ok: true, state: next };
  }

  async view(): Promise<RoomState> {
    return {
      ...this.state,
      room: this.state.room || this.name,
      memberIds: [...this.state.memberIds],
      messages: this.state.messages.map((message) => ({ ...message })),
    };
  }

  private commit(messages: RoomMessage[], memberIds: string[], opened: boolean): RoomState {
    const next: RoomState = {
      room: this.name,
      opened,
      memberIds: [...memberIds],
      messages: messages.slice(-MAX_ROOM_MESSAGES).map((message) => ({
        ...message,
        handoff: message.handoff
          ? { rule: message.handoff.rule, targets: [...message.handoff.targets] }
          : null,
      })),
    };
    this.setState(next);
    return next;
  }
}

function systemMessage(text: string): RoomMessage {
  return {
    id: crypto.randomUUID(),
    authorId: "room",
    text,
    createdAt: new Date().toISOString(),
    kind: "system",
    handoff: null,
  };
}

function orderMembers(memberIds: string[], directoryOrder: string[]): string[] {
  const rank = new Map(directoryOrder.map((id, index) => [id, index]));
  return [...memberIds].sort((a, b) => {
    const ra = rank.get(a) ?? 100;
    const rb = rank.get(b) ?? 100;
    if (ra !== rb) return ra - rb;
    return a.localeCompare(b);
  });
}
