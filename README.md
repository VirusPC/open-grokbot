# open-grokbot

一个用来学习的智能体实验桌：流式对话、一个会把活派给队友的主助手、按需加载的技能、可写的记忆、每分钟心跳，以及一个能从外面敲进来的 webhook。界面是手机优先的 H5。

主循环用 Cloudflare 的 [`@cloudflare/think`](https://developers.cloudflare.com/agents/harnesses/think/)。Worker 上的 `DeskAgent` 只声明模型、上下文、技能、工具和定时任务；浏览器用 `useAgent` 看状态，用 `useAgentChat` 收流。本仓**不**自造 agent loop，也**不**实现、不声称兼容任何专有机器人的协议。

## 对照

| 概念 | 在本仓 |
| --- | --- |
| 流式对话 | Think + `useAgentChat` |
| 父子委派 | `DeskAgent` 用 `agentTool(ResearcherAgent)`，子回合嵌在 Think 里 |
| 并列同事 | `TeammateRegistry` 发现，`RoomAgent` 按 id 叫醒 `PeerAgent`。不是 `agentTool`，也不是完整的分身记忆 |
| Skills | `skills/*/SKILL.md`，`getSkills()` |
| Memory | `configureContext` 的 memory 块 + `memory_write` / `memory_read` |
| Routines | `getScheduledTasks()` 的 `heartbeat`（`every 1 minute`） |
| Tools / MCP | `get_time`、记忆读写；`addMcpServer` 挂载点 |
| 外部事件 | `POST /webhooks/ping` |

更细的请求路径在 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。并列同事和 `agentTool` 的差别在 [docs/PEERS.md](docs/PEERS.md)。建议的阅读顺序在 [docs/LEARNING.md](docs/LEARNING.md)。

## 本地运行

需要 Node.js 22 或更新，以及 npm。

```bash
npm install
npm run dev
```

开发服务器在 [http://127.0.0.1:43123](http://127.0.0.1:43123)。`npm run dev` 就是带 Cloudflare Vite 插件的 `vite dev`，Worker 和 H5 在同一个端口。

Workers AI 在当前 Wrangler 里没有本地模拟器，绑定一打开就会去连远端并要求登录。`vite.config.ts` 因此默认关闭插件的 `remoteBindings`，让 `npm run dev` 不必先 `wrangler login`。记忆、心跳和 webhook 的状态写入都在本地 Durable Object 里完成。

类型检查：

```bash
npm run check
```

### 不登录也能看的部分

Durable Object、状态同步、记忆账本、手动心跳、`POST /webhooks/ping` 的状态写入都在本地模拟里完成。打开页面后：

1. **记忆**：切到「记忆」，写一条标题和内容。列表应立刻多出一行。
2. **心跳**：切到「例程」，点「立即心跳」。计数加一。真正的闹钟是每分钟一次，实例需要处于唤醒状态。
3. **Webhook**（另一个终端）：

```bash
curl -s -X POST http://127.0.0.1:43123/webhooks/ping \
  -H 'content-type: application/json' \
  -d '{"name":"lab","note":"from curl"}'
```

`name` 要和页面上的实例名一致，默认 `lab`。响应里能看到 webhook 计数。`"turn": false` 时只写状态，不提交模型回合。

4. **同事**（不需要模型）：切到「同事」。名单里有 Desk、Researcher、NoteTaker。点「开房」，再点「大家好，我是来看并列交接的」。三条回复都回来，并且标着广播。再点「`@notetaker` …」，这次只多一条 NoteTaker。这是按 id 叫醒，不是对话页里的 `agentTool`。步骤和 curl 在 [docs/PEERS.md](docs/PEERS.md)。

健康检查：`GET /api/health`。

### 需要模型的部分

对话、技能触发、`research` 委派和 webhook 的 programmatic turn 会调用模型。默认是 Workers AI：

```ts
createAI({ binding: this.env.AI })("@cf/zai-org/glm-4.7-flash")
```

这个 id 写在 `wrangler.jsonc` 的 `WORKERS_AI_MODEL` 里，选它是因为它在当前 Workers AI 目录中支持工具调用，并且免费计划可以用。账户若在 Workers Paid，可以改成 `@cf/moonshotai/kimi-k2.6` 或 `@cf/moonshotai/kimi-k2.7-code`。

本地要打到真实 Workers AI：

```bash
npx wrangler login
CLOUDFLARE_REMOTE_BINDINGS=true npm run dev
```

没有这一步时，页面仍能打开。发消息或带 `"turn": true` 的 webhook 会在模型调用处失败，对话区或 webhook 的 `lastTurn` 会记下错误。记忆面板和「立即心跳」不依赖模型。

可选：把 `.dev.vars.example` 复制为 `.dev.vars`，填上 `OPENAI_API_KEY`。Desk 和 Researcher 会改用 OpenAI，Think 的循环不变。`.dev.vars` 已被 git 忽略，不要把密钥写进仓库。

试三句话：

- `记住：我在用手机读这个实验仓` → 应调用 `memory_write`，记忆面板出现条目
- `用研究队友说明 Durable Object 在这里做什么` → 应出现 `research` 工具卡，以及 Researcher 的子运行。这和「同事」页的房间不是同一条路
- `按技能讲一下这个仓怎么对应记忆和例程` → Desk 应 `activate_skill`（`explain-architecture`）

## 接一个真实 MCP

本仓不带远端 MCP。Think 在 `includeMcpTools` 为真（默认）时，会把已连接服务器的工具并进回合。

1. 准备一个 Streamable HTTP 的 MCP 地址。
2. 在 `.dev.vars` 里写 `MCP_SERVER_URL=https://your-server.example/mcp`。
3. 重启 `npm run dev`，打开同一个实例。

`DeskAgent.onStart` 会调用 `src/tools/mcp.ts` 里的 `attachMcpIfConfigured`，也就是：

```ts
await this.addMcpServer("lab-mcp", url, { id: "lab-mcp" });
```

没写地址时这里直接返回，不会发请求。挂载结果出现在「例程」页的 MCP 一栏。需要 OAuth 的服务器会停在授权 URL，本仓没有内置授权页。

## macOS 桌面壳

`desktop/` 是一个 Electron 窗口，用来在 Mac 上打开同一份 H5。默认地址是本机实验桌 [http://127.0.0.1:43123](http://127.0.0.1:43123)。先在仓库根目录跑 `npm run dev`，再启动桌面窗口。它不打包 Worker，也不改 Think。依赖单独安装，避免根目录的 `npm install` 下载 Electron。要连别的 http(s) 地址，设置 `OPEN_GROKBOT_URL`。

```bash
cd desktop
npm install
npm run dev
```

在一台 Mac 上打出未签名的 `.app` 和 `.dmg`：

```bash
cd desktop
npm run dist:mac
```

云端 Linux CI 跑 `npm run dist:mac` 会失败（制作 `.dmg` 需要 macOS 的 `sips`，签名也做不了）。在本机 Mac 上构建。运行、换地址和打开未签名应用的步骤在 [desktop/README.md](desktop/README.md)。

## 目录

```text
docs/ARCHITECTURE.md    分层、对照、请求生命周期
docs/LEARNING.md        阅读顺序
skills/                 两个技能，每个目录一份 SKILL.md
src/server.ts           routeAgentRequest、webhook、同事 HTTP
src/agents/desk.ts      主 Think
src/agents/researcher.ts
src/agents/registry.ts  并列同事登记表
src/agents/room.ts      房间频道
src/agents/peer.ts      按 id 叫醒的规则回复
src/peers/http.ts       /api/teammates、/api/rooms、/api/peers
src/tools/              get_time、记忆、agentTool、MCP 钩子
src/memory/ledger.ts    记忆账本
src/client/             H5，含同事页
desktop/                Electron 壳，只加载 H5
wrangler.jsonc
```

## 明确不做

不做电脑操控集群，不做保险库或支付，不做完整的双向 Slack。定时任务只有一条教学心跳。Webhook 没有签名，只适合本机。并列同事不做每人一套记忆隔离，也不声称对齐任何专有机器人的多 Agent 协议。
