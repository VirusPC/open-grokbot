import { createOpenAI } from "@ai-sdk/openai";
import { createAI, type CloudflareLanguageModelId } from "agents/models/ai-sdk";
import type { LanguageModel } from "ai";
import { DEFAULT_WORKERS_MODEL, type ModelInfo } from "./state";

/**
 * Workers AI is the default. OPENAI_API_KEY in .dev.vars switches both
 * agents to OpenAI without changing the Think loop.
 */
export function describeModel(env: Env): ModelInfo {
  const key = env.OPENAI_API_KEY?.trim();
  if (key) {
    return {
      provider: "openai",
      id: env.OPENAI_MODEL?.trim() || "gpt-4o-mini",
    };
  }
  return {
    provider: "workers-ai",
    id: env.WORKERS_AI_MODEL?.trim() || DEFAULT_WORKERS_MODEL,
  };
}

export function resolveModel(env: Env): LanguageModel {
  const described = describeModel(env);
  if (described.provider === "openai") {
    const key = env.OPENAI_API_KEY?.trim();
    if (!key) {
      throw new Error("OPENAI_API_KEY disappeared between describe and resolve");
    }
    return createOpenAI({ apiKey: key }).chat(described.id);
  }
  return createAI({ binding: env.AI })(described.id as CloudflareLanguageModelId);
}
