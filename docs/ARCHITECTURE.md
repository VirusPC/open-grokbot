# 架构

open-grokbot 是一个用来读代码的实验仓。对话页只跟 **DeskAgent** 说话。DeskAgent 是 `@cloudflare/think` 的 `Think` 子类，模型循环、流式协议、消息树和工具合并都由 Think 完成，本仓不另写 agent loop。同事页另外连接登记表和房间，那是第二条多 Agent 路径，见 [PEERS.md](./PEERS.md)。

它不是任何专有机器人的客户端，也不实现其私有协议。下面的对照只说明「这类系统里常见的一层，在本仓落在哪个文件」。

## 分层

```text
浏览器 H5
  useAgent ───────────── WebSocket 状态 + @callable
  useAgentChat ───────── 同一条套接字上的流式对话
        │
        ▼
Worker  src/server.ts
  routeAgentRequest      /agents/{agent}/{instance}
  POST /webhooks/ping    外部事件，不走浏览器
        │
        ▼
DeskAgent  Durable Object（SQLite）
  Think 回合
    ├─ configureContext   soul + memory 上下文块
    ├─ getSkills          skills/*/SKILL.md
    ├─ getTools           get_time、memory_*、research
    ├─ getScheduledTasks  每分钟 heartbeat
    └─ MCP                仅当 MCP_SERVER_URL 存在时 addMcpServer
        │
        │  agentTool(ResearcherAgent)
        ▼
ResearcherAgent  另一个 Think Durable Object

并列（同事页，不进上面的 Think 回合）
  TeammateRegistry     发现。Desk 只是其中一行
  RoomAgent            频道。广播，或只叫醒 @
  PeerAgent            按 id 唤醒，规则回复写回房间
```

`desktop/` 是可选的 Electron 窗口，在 macOS 上打开同一份 H5，默认指向本机实验桌 `http://127.0.0.1:43123`。`OPEN_GROKBOT_URL` 可以改成任意 http(s) 地址。它不在这条请求路径里，也不改 Think。

每个会话名（默认 `lab`）是一个 Desk Durable Object。Researcher 不是第二个聊天窗口，而是 Desk 在回合中用工具拉起的子实例，有自己的 SQLite 和消息。并列路径里的同名 `PeerAgent` 是另一组实例，不是这个子回合。

## 对照

| 概念 | 本仓 |
| --- | --- |
| 流式对话 | Think 内建回合 + 浏览器 `useAgent` / `useAgentChat`（`syncMessagesToServer: false`，因为 Think 的会话树才是原文） |
| 父子委派 | `src/tools/builtin.ts` 里的 `agentTool(ResearcherAgent)`；子类在 `src/agents/researcher.ts` |
| 并列同事 | `TeammateRegistry` + `RoomAgent` + `PeerAgent`。按 id 交接，不嵌在 Think 里。不是完整的分身记忆。见 [PEERS.md](./PEERS.md) |
| Skills | `skills/<name>/SKILL.md`。`src/skills.ts` 用 Vite 插件的 `agents:skills/../skills` 打包，Desk `getSkills()` 返回这一份。模型用 `activate_skill` 按需加载 |
| Memory | `configureContext()` 的可写 `memory` 块；`memory_write` / `memory_read` 以及面板的 `@callable remember` 写入 `lab_memory`，再投影回该块 |
| Routines | `getScheduledTasks()` 声明 `heartbeat`，调度字符串是 `every 1 minute`（数量为 1 时用单数，解析器不接受 `minutes`）。handler 调用 `applyHeartbeat`，`setState` 后 H5 跟着变 |
| Tools / MCP | 常驻工具：`get_time`、`memory_write`、`memory_read`。`src/tools/mcp.ts` 在 `onStart` 里、且只在配置了 `MCP_SERVER_URL` 时调用 `addMcpServer`。Think 默认 `includeMcpTools` |
| 外部事件 | `POST /webhooks/ping` → `getAgentByName` → Desk `onRequest` 写 `state.webhook`，再 `submitMessages()` 提交一次不依赖浏览器的回合 |

本仓锁定的包是 `@cloudflare/think@0.22`。这一版的 `getScheduledTasks()` 直接返回任务表；文档站上的 `defineScheduledTasks()` 辅助函数没有从该版本导出，所以代码里不用它。上下文块用 `configureContext()`。`ThinkSession.withContext()` 仍在，但类型上已标成旧接口。

## 一次对话怎么走

1. H5 `useAgent({ agent: "DeskAgent", name })` 打开 `/agents/desk-agent/{name}`。
2. `useAgentChat` 把用户消息送进 Think 的聊天协议。
3. Think 在这一回合合并工具，顺序大致是：工作区文件工具、`getTools()`、扩展、会话的 `set_context`、技能工具、已连接的 MCP、浏览器客户端工具。
4. 模型来自 `createAI({ binding: this.env.AI })`。默认模型 id 是 `@cf/zai-org/glm-4.7-flash`（当前目录里支持工具调用、且免费计划可用）。若 `.dev.vars` 里有 `OPENAI_API_KEY`，Desk 和 Researcher 改走 OpenAI，循环不变。本地 `vite dev` 默认关掉远端绑定，因为 Workers AI 没有本地模拟器，一打开就会卡在登录。要打到真实模型，先 `npx wrangler login`，再用 `CLOUDFLARE_REMOTE_BINDINGS=true npm run dev`。
5. 若模型调用 `research`，`agentTool` 启动 `ResearcherAgent`，把子运行的 chunk 以 `agent-tool-event` 推回父连接。H5 用 `useAgentToolEvents` 画在对应工具卡下面。
6. 回合结束时 `onChatResponse` 把 MEMORY 块的当前原文抄进 `state.memory.block`，面板能看见 `set_context` 的改动。
7. 流式 chunk 写回浏览器。刷新页面会从 Durable Object 里把未完成的流接上，这是 Think / 聊天协议自带的，不是本仓另做的。

## 心跳

Desk 每次唤醒，Think 在用户的 `onStart` **之后**调和 `getScheduledTasks()`。`heartbeat` 的 handler 收到 `occurrenceKey`。同一 key 再投递不会把计数加两次。

间隔任务不会补跑错过的分钟。面板上的「立即心跳」调用同一个 `applyHeartbeat("manual")`，所以不必等闹钟也能看见状态变化。真正的闹钟仍然要等实例醒着、并且到了下一分钟。

## Webhook

`src/server.ts` 在 `routeAgentRequest` 之前接住 `POST /webhooks/ping`。

```text
POST /webhooks/ping { "name": "lab", "note": "hello" }
  → getAgentByName(env.DeskAgent, "lab")
  → DO fetch POST /ping
  → setState(webhook)
  → submitMessages(一条用户消息)   // turn:false 时跳过
```

`name` 必须和 H5 左上角的实例名一致，默认都是 `lab`。`submitMessages` 只负责接受回合，HTTP 响应不等模型说完。模型失败时，状态里的 `lastTurn` 会记成 `error`，对话区也会出现错误。

这个入口没有签名校验，只适合本机教学。不要把它当成可以暴露到公网的频道。

## 记忆的两层

| 层 | 谁写 | 存在哪 | 面板 |
| --- | --- | --- | --- |
| 账本 | `memory_write`、`remember`、`forget` | DO SQLite 表 `lab_memory` | 「条目」 |
| 上下文块 | 账本投影，或模型的 `set_context` | Think context block `memory` | 「MEMORY 块」 |

`memory_write` / `remember` 会用账本**整段覆盖** MEMORY 块。若模型刚用 `set_context` 写过、还没进账本的句子，下一次账本写入会替换掉它们。面板把两份都列出来，就是为了让这个差别看得见。

## MCP

Think 会把已经连上的 MCP 工具并进回合。本仓不内置一台远端服务器。挂载点是：

```ts
await this.addMcpServer("lab-mcp", url, { id: "lab-mcp" });
```

见 `src/tools/mcp.ts`。没配 `MCP_SERVER_URL` 时 `onStart` 直接跳过，避免一个坏地址把 Durable Object 的启动打挂（`onStart` 里抛错会让实例起不来）。

## 状态

H5 能看见的心跳、webhook、记忆、技能目录和模型 id 都在 `DeskState`（`src/agents/state.ts`）。服务端 `setState` 后，`useAgent` 会把同一份状态推到浏览器。这个文件同时被 Worker 和 H5 引用，所以里面不能 import Cloudflare 的运行时。
