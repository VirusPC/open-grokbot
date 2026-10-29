/**
 * Shared by the Worker and the browser. Do not import Cloudflare modules here.
 */

export const SESSION_NAME = /^[a-z0-9][a-z0-9-]{0,40}$/;
export const DEFAULT_SESSION = "lab";
export const HEARTBEAT_SCHEDULE = "every 1 minute" as const;
export const DEFAULT_WORKERS_MODEL = "@cf/zai-org/glm-4.7-flash";

export function normalizeSessionName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim().toLowerCase();
  return SESSION_NAME.test(name) ? name : null;
}

export type ModelInfo = {
  provider: "workers-ai" | "openai";
  id: string;
};

export type SkillCard = {
  name: string;
  description: string;
};

export type MemoryEntry = {
  key: string;
  value: string;
  updatedAt: string;
};

export type MemoryView = {
  block: string;
  tokens: number;
  maxTokens: number;
  entries: MemoryEntry[];
};

export type HeartbeatState = {
  count: number;
  lastAt: string | null;
  lastSource: "schedule" | "manual" | null;
  lastOccurrenceKey: string | null;
  schedule: typeof HEARTBEAT_SCHEDULE;
  note: string;
};

export type WebhookState = {
  count: number;
  lastAt: string | null;
  lastNote: string | null;
  lastTurn: "accepted" | "error" | "skipped" | null;
  lastTurnDetail: string | null;
};

export type McpState = {
  attached: boolean;
  detail: string;
};

export type DeskState = {
  agent: "desk";
  model: ModelInfo;
  skills: SkillCard[];
  heartbeat: HeartbeatState;
  webhook: WebhookState;
  mcp: McpState;
  memory: MemoryView;
};

export const initialDeskState: DeskState = {
  agent: "desk",
  model: { provider: "workers-ai", id: DEFAULT_WORKERS_MODEL },
  skills: [],
  heartbeat: {
    count: 0,
    lastAt: null,
    lastSource: null,
    lastOccurrenceKey: null,
    schedule: HEARTBEAT_SCHEDULE,
    note: "Think 在每次唤醒后调和 getScheduledTasks()。heartbeat 为 every 1 minute：到点写一次状态，然后武装下一次，不补跑错过的次数。",
  },
  webhook: {
    count: 0,
    lastAt: null,
    lastNote: null,
    lastTurn: null,
    lastTurnDetail: null,
  },
  mcp: {
    attached: false,
    detail: "尚未检查 MCP_SERVER_URL。",
  },
  memory: {
    block: "",
    tokens: 0,
    maxTokens: 2000,
    entries: [],
  },
};
