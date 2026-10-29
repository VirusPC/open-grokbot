import { generateText } from "ai";
import { Agent } from "agents";
import {
  answerWake,
  buildPeerPrompt,
  peerReplyInput,
  type PeerReplyInput,
} from "./peer-reply";
import { initialPeerState, type PeerState, type WakeRequest, type WakeResult } from "./peer-types";
import { resolveModel } from "./model";

/**
 * Addressable peer. Instance name is the registry id (`desk`,
 * `researcher`, `notetaker`, or someone registered later).
 *
 * The room (or a DM) wakes this object with getAgentByName and passes a
 * snapshot of the thread. The reply answers that latest line. This is not
 * a Think turn and not an agentTool child.
 *
 * The model is the same resolver Desk uses (Workers AI, or OpenAI when
 * OPENAI_API_KEY is set). If that call fails or comes back as the old
 * architecture dump, a short rule answers from the display name instead.
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
    const replyInput = peerReplyInput(this.name, input);
    const answered = await answerWake(replyInput, (next) => completeWithModel(this.env, next));
    const wakeCount = this.state.wakeCount + 1;
    this.setState({
      peerId: this.name,
      wakeCount,
      lastWakeAt: wokeAt,
      lastKind: replyInput.kind,
      lastRoom: input.room ?? null,
      lastInbound: replyInput.text.slice(0, 500),
      lastReply: answered.reply,
      lastReplySource: answered.source,
    });
    console.log(
      JSON.stringify({
        event: "peer.reply",
        peerId: this.name,
        source: answered.source,
        kind: replyInput.kind,
        ...(answered.reason ? { fallback: answered.reason } : {}),
      }),
    );
    return { peerId: this.name, reply: answered.reply, wokeAt, wakeCount };
  }

  /** HTTP `GET /api/peers/:id` reads the last wake this instance stored. */
  async view(): Promise<PeerState> {
    return {
      ...this.state,
      peerId: this.state.peerId || this.name,
      lastReplySource: this.state.lastReplySource ?? null,
    };
  }
}

async function completeWithModel(env: Env, input: PeerReplyInput): Promise<string> {
  const { system, prompt } = buildPeerPrompt(input);
  try {
    const result = await generateText({
      model: resolveModel(env),
      system,
      prompt,
      maxOutputTokens: 500,
      maxRetries: 0,
      timeout: 12_000,
    });
    const text = result.text.trim();
    if (text) return text;
    return result.reasoningText?.trim() ?? "";
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.log(
      JSON.stringify({
        event: "peer.model_error",
        peerId: input.id,
        name: error instanceof Error ? error.name : "Error",
        detail: detail.replace(/\s+/g, " ").slice(0, 140),
      }),
    );
    throw error;
  }
}
