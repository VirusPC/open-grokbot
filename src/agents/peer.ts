import { Agent } from "agents";
import {
  initialPeerState,
  type PeerState,
  type WakeRequest,
  type WakeResult,
} from "./peer-types";

/**
 * Addressable peer stub. Instance name is the registry id (`desk`,
 * `researcher`, `notetaker`, or someone registered later).
 *
 * The room (or a DM) wakes this object with getAgentByName. The reply is
 * rule-based so the lab works with no model and no Workers AI login.
 * This is not a Think turn and not an agentTool child.
 *
 * 常驻 is the named Durable Object: wake() writes state, then the isolate
 * may sleep. The name still routes the next wake.
 */
export class PeerAgent extends Agent<Env, PeerState> {
  initialState: PeerState = { ...initialPeerState };

  override async onStart(): Promise<void> {
    if (this.state.peerId === this.name) return;
    this.setState({ ...this.state, peerId: this.name });
  }

  async wake(input: WakeRequest): Promise<WakeResult> {
    const wokeAt = new Date().toISOString();
    const reply = composeReply(this.name, input);
    const wakeCount = this.state.wakeCount + 1;
    this.setState({
      peerId: this.name,
      wakeCount,
      lastWakeAt: wokeAt,
      lastKind: input.kind,
      lastRoom: input.room,
      lastInbound: input.text.slice(0, 500),
      lastReply: reply,
    });
    return { peerId: this.name, reply, wokeAt, wakeCount };
  }

  /** HTTP `GET /api/peers/:id` reads the last wake this instance stored. */
  async view(): Promise<PeerState> {
    return { ...this.state, peerId: this.state.peerId || this.name };
  }
}

function composeReply(id: string, input: WakeRequest): string {
  const clip = clipText(input.text);
  const via =
    input.kind === "dm"
      ? "私信按 id 直接送到这个 PeerAgent，没有进房间，也没有 agentTool。"
      : "房间按 id 叫醒了这个 PeerAgent，回复交回房间，不嵌在 Desk 的 Think 回合里。";

  if (id === "desk") {
    return `并列 Desk 收到：「${clip}」。${via}对话页里的 DeskAgent 是另一条绑定。`;
  }
  if (id === "researcher") {
    return `并列 Researcher 收到：「${clip}」。${via}我不是对话页里那个 agentTool 子回合。`;
  }
  if (id === "notetaker") {
    return `NoteTaker 记下：「${clip}」。${via}`;
  }
  return `${id} 收到：「${clip}」。${via}这是规则回复，不调用模型。`;
}

function clipText(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > 80 ? `${flat.slice(0, 80)}…` : flat;
}
