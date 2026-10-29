import { generateText, type LanguageModelUsage } from "ai";
import { Agent } from "agents";
import { describeModel, resolveModel } from "./model";
import {
  answerWake,
  buildPeerPrompt,
  peerReplyInput,
  type PeerReplyInput,
} from "./peer-reply";
import { initialPeerState, type PeerState, type WakeRequest, type WakeResult } from "./peer-types";
import { clipTraceText, parseWakeTrace, traceTags } from "../observe/config";
import {
  openObservation,
  scheduleLangfuseFlush,
  type Observation,
} from "../observe/langfuse";

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
    const parent = parseWakeTrace(input.trace);
    const trace = await openObservation(this.env, {
      name: `peer:${replyInput.id}`,
      asType: "agent",
      parent: parent.parent,
      remoteParent: parent.parent !== null,
      traceName: parent.parent ? undefined : replyInput.kind === "dm" ? "peer.dm" : "peer.wake",
      sessionId: replyInput.room ?? `dm:${replyInput.id}`,
      tags: traceTags({
        mode: parent.mode,
        rule: parent.rule,
        room: replyInput.room,
        peerId: replyInput.id,
      }),
      metadata: {
        "peer.id": replyInput.id,
        kind: replyInput.kind,
        ...(parent.mode ? { "routing.mode": parent.mode } : {}),
        ...(parent.rule ? { "handoff.rule": parent.rule } : {}),
        ...(replyInput.room ? { room: replyInput.room } : {}),
      },
      input: {
        kind: replyInput.kind,
        from: replyInput.from,
        room: replyInput.room,
        text: clipTraceText(replyInput.text),
      },
    });
    let modelError: string | undefined;
    try {
      const answered = await answerWake(replyInput, async (next) => {
        try {
          return await completeWithModel(this.env, next, trace);
        } catch (error) {
          modelError = errorText(error);
          throw error;
        }
      });
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
      trace.annotate({
        output: {
          source: answered.source,
          reason: answered.reason ?? null,
          reply: clipTraceText(answered.reply),
        },
        metadata: {
          "peer.id": replyInput.id,
          "reply.source": answered.source,
          ...(answered.reason ? { "reply.reason": answered.reason } : {}),
          ...(modelError ? { modelError: clipTraceText(modelError, 180) } : {}),
        },
        level: answered.reason === "threw" ? "WARNING" : "DEFAULT",
        statusMessage: modelError ? clipTraceText(modelError, 180) : undefined,
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
    } catch (error) {
      trace.fail(error);
      throw error;
    } finally {
      trace.end();
      scheduleLangfuseFlush(this.ctx);
    }
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

async function completeWithModel(
  env: Env,
  input: PeerReplyInput,
  parent: Observation,
): Promise<string> {
  const described = describeModel(env);
  const generation = parent.child({
    name: "peer.model",
    asType: "generation",
    model: described.id,
    metadata: { provider: described.provider, "peer.id": input.id },
    input: { text: clipTraceText(input.text) },
  });
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
    const text = result.text.trim() || result.reasoningText?.trim() || "";
    generation.annotate({
      model: described.id,
      output: clipTraceText(text),
      usage: usageDetails(result.usage),
    });
    return text;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    generation.fail(error);
    console.log(
      JSON.stringify({
        event: "peer.model_error",
        peerId: input.id,
        name: error instanceof Error ? error.name : "Error",
        detail: detail.replace(/\s+/g, " ").slice(0, 140),
      }),
    );
    throw error;
  } finally {
    generation.end();
  }
}

function usageDetails(usage: LanguageModelUsage | undefined): Record<string, number> | undefined {
  if (!usage) return undefined;
  const details: Record<string, number> = {};
  if (typeof usage.inputTokens === "number") details.input = usage.inputTokens;
  if (typeof usage.outputTokens === "number") details.output = usage.outputTokens;
  if (typeof usage.totalTokens === "number") details.total = usage.totalTokens;
  return Object.keys(details).length > 0 ? details : undefined;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
