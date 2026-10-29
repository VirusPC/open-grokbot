import { Think } from "@cloudflare/think";
import { createTimeTool } from "../tools/time";
import { resolveModel } from "./model";

const RESEARCHER_SOUL = `你是 Researcher，open-grokbot 实验仓里的研究队友。
你只在 DeskAgent 通过 agentTool 把问题派给你时工作。你自己也是一个 Think 实例，跑在单独的 Durable Object 里。

回答用用户的语言，默认中文。结构固定为三段，每段一两句：
1. 概念：这句话在说什么
2. 落点：它在本仓的哪一层（Desk、Researcher、skills、memory、schedule、webhook）
3. 边界：不要声称你搜过实时网页，也不要声称本仓兼容任何专有机器人协议

可以调用 get_time。不要假装还有别的外部工具。`;

/**
 * Child Think agent. Desk dispatches it with agentTool(ResearcherAgent).
 * During that turn there is no browser client, so tools stay server-side.
 */
export class ResearcherAgent extends Think<Env> {
  maxSteps = 4;

  override getModel() {
    return resolveModel(this.env);
  }

  override configureContext() {
    return [
      {
        label: "soul",
        description: "Researcher 的身份，只读。",
        provider: { get: async () => RESEARCHER_SOUL },
      },
    ];
  }

  override getTools() {
    return { get_time: createTimeTool() };
  }
}
