import { agentTool } from "agents/agent-tools";
import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { ResearcherAgent } from "../agents/researcher";
import {
  MemoryInputError,
  type MemoryWriteResult,
} from "../memory/ledger";
import type { MemoryEntry } from "../agents/state";
import { createTimeTool } from "./time";

type MemoryHost = {
  remember(input: { key: string; value: string }): Promise<MemoryWriteResult>;
  recall(key?: string): Promise<MemoryEntry[]>;
};

/**
 * Desk's server tools. `research` is a real child Think agent, not a
 * prompt-only role play: agentTool keeps the child Durable Object, streams
 * events to the parent, and returns the child's summary.
 */
export function createDeskTools(host: MemoryHost): ToolSet {
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
    research: agentTool(ResearcherAgent, {
      description:
        "把一个概念交给 ResearcherAgent。那是另一个 Think Durable Object，适合解释本实验仓里的架构概念。不要用它查实时网页。",
      displayName: "Researcher",
      inputSchema: z.object({
        query: z.string().min(2).describe("需要研究的问题"),
      }),
    }),
  };
}
