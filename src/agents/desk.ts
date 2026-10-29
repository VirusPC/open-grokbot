import { callable } from "agents";
import { Think, type ChatResponseResult } from "@cloudflare/think";
import type { UIMessage } from "ai";
import {
  deleteMemoryEntry,
  listMemoryEntries,
  MemoryInputError,
  renderMemoryBlock,
  writeMemoryEntry,
  type MemoryWriteResult,
} from "../memory/ledger";
import { labSkills } from "../skills";
import { createDeskTools } from "../tools/builtin";
import { attachMcpIfConfigured } from "../tools/mcp";
import { describeModel, resolveModel } from "./model";
import {
  HEARTBEAT_SCHEDULE,
  initialDeskState,
  type DeskState,
  type MemoryEntry,
  type MemoryView,
} from "./state";

const DESK_SOUL = `你是 Desk，open-grokbot 的主助手。这是一个用来学习智能体分层的实验仓，不是任何专有产品的客户端，也不实现其私有协议。

用用户的语言回答，默认中文。手机屏幕优先：先给结论，再给文件落点，避免长清单。

工具：
- get_time：现在几点
- memory_write / memory_read：用户说「记住」或索要学习笔记时，写入或读出记忆账本
- research：需要把一个架构概念讲清楚时，委派给 ResearcherAgent
- activate_skill：用户问「这个仓怎么对应某层能力」时用 explain-architecture；用户要整理成笔记时用 study-note
- Think 还会提供 workspace 文件工具和 set_context。讲架构时优先用上面的实验工具，不要为了演示去改工作区文件

MEMORY 上下文块是账本的投影。memory_write 会整段重写它。`;

/**
 * Primary Think agent. The browser talks to this Durable Object.
 * Think owns the model loop; this class only declares model, context,
 * skills, tools, the heartbeat, and the webhook entry.
 */
export class DeskAgent extends Think<Env, DeskState> {
  maxSteps = 8;
  initialState: DeskState = initialDeskState;

  override getModel() {
    return resolveModel(this.env);
  }

  override configureContext() {
    return [
      {
        label: "soul",
        description: "Desk 的身份，只读。",
        provider: { get: async () => DESK_SOUL },
      },
      {
        label: "memory",
        description:
          "用户要求记住的短事实。每一行是 `- key: value`。优先用 memory_write 维护。",
        maxTokens: 2000,
        whenChanged: "remind" as const,
      },
    ];
  }

  override getSkills() {
    return [labSkills];
  }

  override getTools() {
    return createDeskTools(this);
  }

  override getScheduledTasks() {
    return {
      heartbeat: {
        schedule: HEARTBEAT_SCHEDULE,
        handler: async (ctx: { occurrenceKey: string }) => {
          await this.applyHeartbeat("schedule", ctx.occurrenceKey);
        },
      },
    };
  }

  /**
   * Think calls this override after context and skills are ready, then
   * reconciles getScheduledTasks(). Do not call super.onStart(): the
   * framework already wrapped startup.
   */
  override async onStart(): Promise<void> {
    const listed = await labSkills.list();
    const mcp = await attachMcpIfConfigured({
      env: this.env,
      addMcpServer: (serverName, url, options) =>
        this.addMcpServer(serverName, url, options),
    });
    const heartbeat = {
      ...this.state.heartbeat,
      schedule: HEARTBEAT_SCHEDULE,
    };
    if (heartbeat.count === 0) {
      heartbeat.note = initialDeskState.heartbeat.note;
    }
    this.setState({
      ...this.state,
      model: describeModel(this.env),
      skills: listed.map((skill) => ({
        name: skill.name,
        description: skill.description,
      })),
      mcp,
      memory: this.readMemoryView(),
      heartbeat,
    });
  }

  override async onChatResponse(_result: ChatResponseResult): Promise<void> {
    this.syncBlockIntoState();
  }

  override async onRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/ping") {
      const body = (await request.json().catch(() => ({}))) as {
        note?: unknown;
        turn?: unknown;
      };
      const note = typeof body.note === "string" ? body.note : "ping";
      const turn = body.turn !== false;
      const result = await this.receiveExternalPing(note, turn);
      return Response.json(result);
    }
    return new Response("DeskAgent 只接受 POST /ping", { status: 404 });
  }

  @callable()
  async remember(input: { key: string; value: string }): Promise<MemoryWriteResult> {
    try {
      const entry = writeMemoryEntry(this, input.key, input.value);
      const memory = await this.projectLedger();
      return { ok: true, entry, entries: memory.entries };
    } catch (error) {
      if (error instanceof MemoryInputError) {
        return { ok: false, error: error.message };
      }
      throw error;
    }
  }

  @callable()
  async recall(key?: string): Promise<MemoryEntry[]> {
    const entries = listMemoryEntries(this);
    if (!key?.trim()) return entries;
    const wanted = key.trim();
    return entries.filter((entry) => entry.key === wanted);
  }

  @callable()
  async forget(key: string): Promise<MemoryWriteResult> {
    try {
      const removed = deleteMemoryEntry(this, key);
      if (!removed) return { ok: false, error: `没有名为「${key.trim()}」的条目。` };
      const memory = await this.projectLedger();
      return {
        ok: true,
        entry: {
          key: key.trim(),
          value: "",
          updatedAt: new Date().toISOString(),
        },
        entries: memory.entries,
      };
    } catch (error) {
      if (error instanceof MemoryInputError) {
        return { ok: false, error: error.message };
      }
      throw error;
    }
  }

  @callable()
  async runHeartbeat(): Promise<DeskState["heartbeat"]> {
    return this.applyHeartbeat("manual");
  }

  private async applyHeartbeat(
    source: "schedule" | "manual",
    occurrenceKey?: string,
  ): Promise<DeskState["heartbeat"]> {
    if (
      source === "schedule" &&
      occurrenceKey &&
      this.state.heartbeat.lastOccurrenceKey === occurrenceKey
    ) {
      return this.state.heartbeat;
    }
    const heartbeat: DeskState["heartbeat"] = {
      count: this.state.heartbeat.count + 1,
      lastAt: new Date().toISOString(),
      lastSource: source,
      lastOccurrenceKey: occurrenceKey ?? this.state.heartbeat.lastOccurrenceKey,
      schedule: HEARTBEAT_SCHEDULE,
      note:
        source === "schedule"
          ? "定时 handler 已写入状态。Think 会为下一次 every 1 minute 重新武装闹钟。"
          : "这是面板上的手动心跳，和定时任务走同一个 applyHeartbeat。",
    };
    this.setState({ ...this.state, heartbeat });
    return heartbeat;
  }

  private async receiveExternalPing(note: string, turn: boolean) {
    const cleanNote = note.trim().slice(0, 500) || "ping";
    const webhook: DeskState["webhook"] = {
      count: this.state.webhook.count + 1,
      lastAt: new Date().toISOString(),
      lastNote: cleanNote,
      lastTurn: turn ? "accepted" : "skipped",
      lastTurnDetail: turn ? "正在提交 programmatic turn" : "只写了状态，没有提交回合",
    };
    this.setState({ ...this.state, webhook });

    if (!turn) {
      return { ok: true, webhook: this.state.webhook, submission: null };
    }

    const message: UIMessage = {
      id: crypto.randomUUID(),
      role: "user",
      parts: [
        {
          type: "text",
          text: `外部事件 POST /webhooks/ping：${cleanNote}。用一两句话确认收到。不要调用 research。`,
        },
      ],
    };

    try {
      const submission = await this.submitMessages([message], {
        idempotencyKey: `ping:${message.id}`,
      });
      const nextWebhook: DeskState["webhook"] = {
        ...this.state.webhook,
        lastTurn: "accepted",
        lastTurnDetail: `submitMessages 已接受（${submission.status}）`,
      };
      this.setState({ ...this.state, webhook: nextWebhook });
      return { ok: true, webhook: nextWebhook, submission };
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      const nextWebhook: DeskState["webhook"] = {
        ...this.state.webhook,
        lastTurn: "error",
        lastTurnDetail: messageText,
      };
      this.setState({ ...this.state, webhook: nextWebhook });
      return { ok: true, webhook: nextWebhook, submission: null, error: messageText };
    }
  }

  /** Rewrite the MEMORY context block from the SQL ledger. */
  private async projectLedger(): Promise<MemoryView> {
    const entries = listMemoryEntries(this);
    await this.context.setBlock("memory", renderMemoryBlock(entries));
    await this.context.refreshSystemPrompt();
    const memory = this.readMemoryView();
    this.setState({ ...this.state, memory });
    return memory;
  }

  private readMemoryView(): MemoryView {
    const entries = listMemoryEntries(this);
    const block = this.context.getBlock("memory");
    return {
      block: block?.content ?? "",
      tokens: block?.tokens ?? 0,
      maxTokens: block?.maxTokens ?? 2000,
      entries,
    };
  }

  /** Pick up set_context edits that did not go through the ledger. */
  private syncBlockIntoState(): void {
    const block = this.context.getBlock("memory");
    this.setState({
      ...this.state,
      memory: {
        ...this.state.memory,
        block: block?.content ?? "",
        tokens: block?.tokens ?? 0,
        maxTokens: block?.maxTokens ?? 2000,
      },
    });
  }
}
