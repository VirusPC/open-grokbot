import { Agent, callable, getAgentByName } from "agents";
import { linesFromFanout, settleFanout } from "./fanout";
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
  type HandoffRule,
  type OpenResult,
  type PostResult,
  type RoomMessage,
  type RoomState,
  type WakeMember,
  type WakeTurn,
} from "./peer-types";

/**
 * Channel / ingress for peer mode. Members and the transcript live here.
 *
 * postMessage does not run inside a Desk Think turn:
 *   1. planHandoff decides broadcast (every member) vs @-only (named subset)
 *   2. both rules call the same Promise.allSettled fan-out
 *   3. getAgentByName(env.PeerAgent, id) wakes each target together
 *   4. the peer returns a line that answers `text`; this room appends it
 *
 * The browser RPC returns after the human line is stored. Model time runs
 * in ctx.waitUntil, and setState pushes each batch of peer lines. One
 * peer's failure is a system line and does not cancel the others.
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
  async postMessage(input?: {
    text?: string;
    authorId?: string;
    /** HTTP curl waits for peer lines. The browser RPC must not. */
    waitForPeers?: boolean;
  }): Promise<PostResult> {
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
    const humanId = crypto.randomUUID();
    const batch: RoomMessage[] = [
      {
        id: humanId,
        authorId,
        text,
        createdAt: new Date().toISOString(),
        kind: "human",
        handoff: { rule: plan.rule, targets: [...plan.targets] },
      },
    ];

    for (const token of plan.unknown) {
      batch.push(systemMessage(`不认识 @${token}，登记表里没有这个同事。`));
    }
    for (const id of plan.outsideRoom) {
      batch.push(systemMessage(`@${id} 在登记表里，但不在这个房间，所以没有叫醒。`));
    }
    if (
      plan.rule === "mentions" &&
      plan.targets.length === 0 &&
      plan.unknown.length === 0 &&
      plan.outsideRoom.length === 0
    ) {
      batch.push(systemMessage("写了 @，但没有点到房间里的同事。"));
    }

    const anchorId = batch[batch.length - 1]?.id ?? humanId;
    const next = this.appendMessages(batch);
    if (plan.targets.length === 0) return { ok: true, state: next };

    const job = this.finishHandoff({
      humanId,
      anchorId,
      text,
      authorId,
      rule: plan.rule,
      targets: [...plan.targets],
      members,
      thread,
      mates: teammates.map((mate) => ({
        id: mate.id,
        displayName: mate.displayName,
        tags: [...mate.tags],
      })),
    });
    if (input?.waitForPeers === true) {
      await job;
      return { ok: true, state: await this.view() };
    }
    // Client RPC default timeout is 30s. Three sequential model wakes blow
    // past it; the late setState still paints replies and the banner stays.
    this.ctx.waitUntil(job);
    return { ok: true, state: next };
  }

  /**
   * Broadcast and @-mentions both land here. Targets wake in parallel;
   * allSettled isolates a failed peer from the others.
   */
  private finishHandoff(job: HandoffJob): Promise<void> {
    const run = (async () => {
      const settled = await settleFanout(job.targets, async (id) => {
        const peer = await getAgentByName(this.env.PeerAgent, id);
        const mate = job.mates.find((item) => item.id === id);
        const wake = await peer.wake({
          kind: "room",
          text: job.text,
          room: this.name,
          from: job.authorId,
          displayName: mate?.displayName ?? id,
          tags: mate ? [...mate.tags] : [],
          members: job.members,
          thread: job.thread,
        });
        return { reply: wake.reply, wokeAt: wake.wokeAt };
      });
      const { lines, receipts } = linesFromFanout(job.humanId, settled);
      if (lines.length > 0) this.insertAfter(job.anchorId, lines);
      if (receipts.length > 0) {
        try {
          const registry = await getAgentByName(this.env.TeammateRegistry, REGISTRY_NAME);
          await registry.recordWakes(receipts);
        } catch (error) {
          this.appendMessages([
            systemMessage(`登记叫醒次数失败：${errorText(error)}`, `registry:${job.humanId}`),
          ]);
        }
      }
      console.log(
        JSON.stringify({
          event: "room.handoff",
          room: this.name,
          rule: job.rule,
          targets: job.targets,
          failed: settled.filter((item) => !item.ok).map((item) => item.id),
        }),
      );
    })();
    return run.catch((error) => {
      this.appendMessages([
        systemMessage(`交接中断：${errorText(error)}`, `handoff:${job.humanId}:crash`),
      ]);
    });
  }

  private appendMessages(extra: RoomMessage[]): RoomState {
    return this.insertAfter(null, extra);
  }

  private insertAfter(anchorId: string | null, extra: RoomMessage[]): RoomState {
    const seen = new Set(this.state.messages.map((message) => message.id));
    const fresh = extra.filter((message) => !seen.has(message.id));
    const messages = [...this.state.messages];
    const index = anchorId === null ? -1 : messages.findIndex((message) => message.id === anchorId);
    const at = index < 0 ? messages.length : index + 1;
    messages.splice(at, 0, ...fresh);
    return this.commit(messages, this.state.memberIds, this.state.opened);
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

function systemMessage(text: string, id?: string): RoomMessage {
  return {
    id: id ?? crypto.randomUUID(),
    authorId: "room",
    text,
    createdAt: new Date().toISOString(),
    kind: "system",
    handoff: null,
  };
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

type HandoffJob = {
  humanId: string;
  anchorId: string;
  text: string;
  authorId: string;
  rule: HandoffRule;
  targets: string[];
  members: WakeMember[];
  thread: WakeTurn[];
  mates: Array<{ id: string; displayName: string; tags: string[] }>;
};

function orderMembers(memberIds: string[], directoryOrder: string[]): string[] {
  const rank = new Map(directoryOrder.map((id, index) => [id, index]));
  return [...memberIds].sort((a, b) => {
    const ra = rank.get(a) ?? 100;
    const rb = rank.get(b) ?? 100;
    if (ra !== rb) return ra - rb;
    return a.localeCompare(b);
  });
}
