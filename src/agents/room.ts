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
  type HandoffRule,
  type OpenResult,
  type PostResult,
  type RoomMessage,
  type RoomRouting,
  type RoomState,
  type WakeMember,
  type WakeReceipt,
  type WakeTurn,
} from "./peer-types";
import { effectiveLeader, planLeaderFanout, planRoomRoute, routingHint } from "./routing";

/**
 * Channel / ingress for peer mode. Members and the transcript live here.
 *
 * postMessage does not run inside a Desk Think turn:
 *   1. planRoomRoute picks Teams (addressed only) or Squad (leader, then @)
 *   2. both modes wake targets together with Promise.allSettled
 *   3. getAgentByName(env.PeerAgent, id) — the peer returns a line
 *   4. a Squad leader reply that contains @ wakes those peers; the peer
 *      does not call this room back
 *
 * The browser RPC returns after the human line is stored. Model time runs
 * in ctx.waitUntil, and setState pushes each batch of peer lines. One
 * peer's failure is a system line and does not cancel the others.
 *
 * The peer does not fetch this room back. A Durable Object waiting on its
 * own stub deadlocks the input gate. The room passes a snapshot of earlier
 * human and peer lines instead. Peer replies other than the squad leader's
 * hand-off are not fanned out again.
 */
export class RoomAgent extends Agent<Env, RoomState> {
  initialState: RoomState = {
    ...initialRoomState,
    memberIds: [...initialRoomState.memberIds],
    messages: [...initialRoomState.messages],
  };

  override async onStart(): Promise<void> {
    const routing = this.routingMode();
    const leaderId = this.state.leaderId || "desk";
    if (this.state.room === this.name && this.state.routing === routing && this.state.leaderId === leaderId) {
      return;
    }
    this.setState({ ...this.state, room: this.name, routing, leaderId });
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

    const leaderId = effectiveLeader(this.state.leaderId || "desk", ordered) ?? ordered[0] ?? "desk";
    const notice = this.state.opened
      ? `成员改为：${ordered.join("、")}。${routingHint(this.routingMode(), leaderId)}`
      : `房间已打开，成员：${ordered.join("、")}。${routingHint(this.routingMode(), leaderId)} 交接是 getAgentByName(PeerAgent, id)，不经过 agentTool。`;

    const next = this.commit([
      ...this.state.messages,
      systemMessage(notice),
    ], ordered, true, { leaderId });
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
    const routing = this.routingMode();
    const leaderId = effectiveLeader(this.state.leaderId || "desk", this.state.memberIds) ?? "desk";
    const plan = planRoomRoute({
      mode: routing,
      text,
      memberIds: this.state.memberIds,
      teammates,
      leaderId,
    });
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
    if (plan.rule === "silent") {
      batch.push(systemMessage("Teams：没有 @，也没有单独写出房间里的 id 或显示名，所以没有叫醒。看见线程不等于要回复。"));
    }
    if (plan.rule === "leader" && plan.targets.length === 0) {
      batch.push(systemMessage("Squad：队长不在这个房间，所以没有叫醒。"));
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
      leaderId,
      memberIds: [...this.state.memberIds],
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
          delegate: job.rule === "leader" && id === job.leaderId,
        });
        return { reply: wake.reply, wokeAt: wake.wokeAt };
      });
      const { lines, receipts } = linesFromFanout(job.humanId, settled);
      if (lines.length > 0) this.insertAfter(job.anchorId, lines);
      const moreReceipts = await this.fanOutLeaderReply(job, lines);
      await this.recordReceipts(job.humanId, [...receipts, ...moreReceipts]);
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

  /** Squad only: @ inside the leader reply wakes those peers. They do not call back. */
  private async fanOutLeaderReply(
    job: HandoffJob,
    lines: RoomMessage[],
  ): Promise<WakeReceipt[]> {
    if (job.rule !== "leader") return [];
    const leaderLine = lines.find((line) => line.kind === "peer" && line.authorId === job.leaderId);
    if (!leaderLine) return [];
    const fan = planLeaderFanout(leaderLine.text, job.memberIds, job.mates, job.leaderId);
    const notes: RoomMessage[] = [];
    for (const token of fan.unknown) {
      notes.push(systemMessage(`队长回复里的 @${token} 不在登记表里，没有叫醒。`));
    }
    for (const id of fan.outsideRoom) {
      notes.push(systemMessage(`队长回复里的 @${id} 不在这个房间，没有叫醒。`));
    }
    if (fan.targets.length === 0) {
      if (notes.length > 0) this.appendMessages(notes);
      return [];
    }
    this.addHandoffTargets(job.humanId, fan.targets);
    notes.unshift(systemMessage(`Squad：队长回复里点了 ${fan.targets.join("、")}，再叫醒。同伴不回头调用房间。`));
    const noteAnchor = notes[notes.length - 1]?.id ?? leaderLine.id;
    this.insertAfter(leaderLine.id, notes);
    const names = new Map(job.mates.map((mate) => [mate.id, mate.displayName]));
    const thread = selectWakeThread(
      this.state.messages.filter((message) => message.id !== leaderLine.id),
      names,
    );
    const settled = await settleFanout(fan.targets, async (id) => {
      const peer = await getAgentByName(this.env.PeerAgent, id);
      const mate = job.mates.find((item) => item.id === id);
      const wake = await peer.wake({
        kind: "room",
        text: leaderLine.text,
        room: this.name,
        from: job.leaderId,
        displayName: mate?.displayName ?? id,
        tags: mate ? [...mate.tags] : [],
        members: job.members,
        thread,
      });
      return { reply: wake.reply, wokeAt: wake.wokeAt };
    });
    const second = linesFromFanout(job.humanId, settled);
    if (second.lines.length > 0) this.insertAfter(noteAnchor, second.lines);
    return second.receipts;
  }

  private addHandoffTargets(humanId: string, extra: string[]): void {
    const messages = this.state.messages.map((message) => {
      if (message.id !== humanId || !message.handoff) return message;
      const targets = [...message.handoff.targets];
      for (const id of extra) {
        if (!targets.includes(id)) targets.push(id);
      }
      return { ...message, handoff: { rule: message.handoff.rule, targets } };
    });
    this.commit(messages, this.state.memberIds, this.state.opened);
  }

  private async recordReceipts(humanId: string, receipts: WakeReceipt[]): Promise<void> {
    if (receipts.length === 0) return;
    try {
      const registry = await getAgentByName(this.env.TeammateRegistry, REGISTRY_NAME);
      await registry.recordWakes(receipts);
    } catch (error) {
      this.appendMessages([
        systemMessage(`登记叫醒次数失败：${errorText(error)}`, `registry:${humanId}`),
      ]);
    }
  }

  @callable()
  async setRouting(input?: { routing?: string; leaderId?: string }): Promise<OpenResult> {
    if (!this.state.opened) return { ok: false, error: "这个房间还没打开。" };
    const routing = input?.routing === "squad" ? "squad" : input?.routing === "teams" ? "teams" : null;
    if (!routing) return { ok: false, error: "路由只能是 teams 或 squad。" };
    const requested = input?.leaderId === undefined ? undefined : normalizeTeammateId(input.leaderId);
    if (input?.leaderId !== undefined && (!requested || !this.state.memberIds.includes(requested))) {
      return { ok: false, error: "队长必须是房间里的同事。" };
    }
    const leaderId = requested ?? effectiveLeader(this.state.leaderId || "desk", this.state.memberIds) ?? "desk";
    const current = this.routingMode();
    if (routing === current && leaderId === (this.state.leaderId || "desk")) {
      return { ok: true, state: this.snapshot() };
    }
    const notice = routing === "squad"
      ? `已切换到 Squad，队长是 ${leaderId}。没写 @ 只叫醒队长。队长回复里的 @ 再交给被点名的人。你自己写了 @ 就不会再自动叫醒队长。`
      : "已切换到 Teams。大家都能看见线程。只有 @、@all，或单独写出的 id／显示名才会回复。没有点名就不会叫醒。";
    const next = this.commit(
      [...this.state.messages, systemMessage(notice)],
      this.state.memberIds,
      true,
      { routing, leaderId },
    );
    return { ok: true, state: next };
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
    return this.snapshot();
  }

  private routingMode(): RoomRouting {
    return this.state.routing === "squad" ? "squad" : "teams";
  }

  private snapshot(): RoomState {
    return {
      room: this.state.room || this.name,
      opened: this.state.opened,
      memberIds: [...this.state.memberIds],
      messages: this.state.messages.map((message) => ({ ...message })),
      routing: this.routingMode(),
      leaderId: this.state.leaderId || "desk",
    };
  }

  private commit(
    messages: RoomMessage[],
    memberIds: string[],
    opened: boolean,
    patch?: { routing?: RoomRouting; leaderId?: string },
  ): RoomState {
    const next: RoomState = {
      room: this.name,
      opened,
      memberIds: [...memberIds],
      routing: patch?.routing ?? this.routingMode(),
      leaderId: patch?.leaderId ?? (this.state.leaderId || "desk"),
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
  leaderId: string;
  memberIds: string[];
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
