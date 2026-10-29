import { agentTool } from "agents/agent-tools";
import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { ResearcherAgent } from "../agents/researcher";
import {
  MemoryInputError,
  type MemoryWriteResult,
} from "../memory/ledger";
import type { MemoryEntry } from "../agents/state";
import { clipTraceText, traceTags } from "../observe/config";
import { openObservation, scheduleLangfuseFlush } from "../observe/langfuse";
import { createTimeTool } from "./time";

type MemoryHost = {
  remember(input: { key: string; value: string }): Promise<MemoryWriteResult>;
  recall(key?: string): Promise<MemoryEntry[]>;
};

type TraceRuntime = {
  env: Env;
  ctx: { waitUntil(promise: Promise<unknown>): void };
  /** Desk Durable Object name. Groups research traces in one Langfuse session. */
  name: string;
};

/**
 * Desk's server tools. `research` is the parent-child path: agentTool keeps
 * a child ResearcherAgent, streams events to this Think turn, and returns
 * the child's summary.
 *
 * Peer mode does not add a tool here. TeammateRegistry, RoomAgent, and
 * PeerAgent are addressed by id from the room, outside this turn.
 */
export function createDeskTools(host: MemoryHost, runtime: TraceRuntime): ToolSet {
  return {
    get_time: createTimeTool(),
    memory_write: tool({
      description:
        "把一条短事实写入 Desk 的记忆账本，并投影到 MEMORY 上下文块。用户说「记住」时用它。key 是短标题，value 是事实本身。",
      inputSchema: z.object({
        key: z.string().describe("短标题，例如 称呼 或 note:durable-objects"),
        value: z.string().describe("要记住的事实，一两句话"),
      }),
      execute: async ({ key, value }) => {
        try {
          return await host.remember({ key, value });
        } catch (error) {
          if (error instanceof MemoryInputError) {
            return { ok: false as const, error: error.message };
          }
          throw error;
        }
      },
    }),
    memory_read: tool({
      description:
        "读取记忆账本。省略 key 时返回全部条目；给出 key 时只返回那一条。",
      inputSchema: z.object({
        key: z.string().optional().describe("要读取的标题；省略则列出全部"),
      }),
      execute: async ({ key }) => {
        try {
          const entries = await host.recall(key);
          return { entries };
        } catch (error) {
          if (error instanceof MemoryInputError) {
            return { ok: false as const, error: error.message };
          }
          throw error;
        }
      },
    }),
    research: tracedResearch(runtime),
  };
}

/**
 * One agent span around agentTool(ResearcherAgent). The child Think still
 * runs inside Desk's turn; this only records the dispatch. No keys: the
 * original execute runs unchanged.
 */
function tracedResearch(runtime: TraceRuntime): ToolSet["research"] {
  const research = agentTool(ResearcherAgent, {
    description:
      "把一个概念交给 ResearcherAgent。那是另一个 Think Durable Object，适合解释本实验仓里的架构概念。不要用它查实时网页。",
    displayName: "Researcher",
    inputSchema: z.object({
      query: z.string().min(2).describe("需要研究的问题"),
    }),
  });
  const execute = research.execute?.bind(research);
  if (!execute) return research;
  research.execute = async (input, options) => {
    const span = await openObservation(runtime.env, {
      name: "desk.research",
      asType: "agent",
      traceName: "desk.research",
      sessionId: `desk:${runtime.name || "lab"}`,
      tags: traceTags({}),
      metadata: { tool: "research", feature: "agentTool" },
      input: { query: clipTraceText(input.query) },
    });
    try {
      const result = await execute(input, options);
      const failure = researchFailure(result);
      span.annotate({
        output: typeof result === "string" ? clipTraceText(result) : failure ?? { ok: true },
        level: failure ? "ERROR" : "DEFAULT",
        statusMessage: failure?.error,
      });
      return result;
    } catch (error) {
      span.fail(error);
      throw error;
    } finally {
      span.end();
      scheduleLangfuseFlush(runtime.ctx);
    }
  };
  return research;
}

function researchFailure(result: unknown): { ok: false; error: string } | null {
  if (!result || typeof result !== "object" || !("ok" in result)) return null;
  if ((result as { ok?: unknown }).ok !== false) return null;
  const error = "error" in result && typeof (result as { error?: unknown }).error === "string"
    ? (result as { error: string }).error
    : "agentTool failed";
  return { ok: false, error: clipTraceText(error, 300) };
}
