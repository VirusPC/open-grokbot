# Langfuse（同事页）

房间交接、并列叫醒、Squad 队长 `@` 转交，以及 Desk 的 `research`（`agentTool`）会在配了密钥时写成 Langfuse trace。没配密钥时这些函数直接返回，不加载 SDK，不打日志，也不改变聊天。

自建实例是 [https://langfuse.viruspc.tech](https://langfuse.viruspc.tech)（Langfuse v4）。给 open-grokbot **新建一个项目**，只用那个项目的 key。不要把 key 写进仓库，也不要复用别的项目。

JS SDK 是 `@langfuse/tracing` 与 `@langfuse/otel` 6.x（OpenTelemetry，导出到 `/api/public/otel/v1/traces`）。自建服务需要 **≥ v4.59.0**。更早的 v4 收不到这套 span。

## 为什么是这条路径

Cloudflare Workers 上不要用 `NodeSDK` / `NodeTracerProvider`。它们依赖 Node API，span 会静默丢掉或把 isolate 撑满。这里用 `LangfuseSpanProcessor` + `BasicTracerProvider`（`@opentelemetry/sdk-trace-base`）：

- `exportMode: "immediate"`，同时 `flushAt: 1`、`flushInterval: 0`，不在内存里攒批。
- `compression: "none"`，`mediaUploadEnabled: false`。Wrangler 按 `workerd` / `browser` 条件打包 OTLP exporter，走 `fetch`，不走 `node:http`。
- Durable Object 里用 `ctx.waitUntil(forceFlush())`。浏览器的 `postMessage` 仍然先返回；curl 的 `waitForPeers` 会等叫醒和 flush 一起结束。
- 房间 span 和 Peer span 不在同一个 isolate。房间把 W3C `traceId` / `spanId` 放进 `wake()` 的参数，Peer 用 `parentSpanContext`（`isRemote: true`）接上。Peer 不把这段写进模型 prompt。

密钥只从 Worker 的 `env` 读，不从 `process.env` 读。三个都有才启用：

| Wrangler / `.dev.vars` | SDK 字段 |
| --- | --- |
| `LANGFUSE_PUBLIC_KEY` | `publicKey` |
| `LANGFUSE_SECRET_KEY` | `secretKey` |
| `LANGFUSE_BASE_URL` | `baseUrl` |

`LANGFUSE_BASEURL` 是 JS SDK 的旧别名，代码也认。请用 `LANGFUSE_BASE_URL`。值是站点根，例如 `https://langfuse.viruspc.tech`，不要带 `/api/public/otel/v1/traces`（带了也会被剥掉）。

环境固定写成 `open-grokbot`（Langfuse 的 environment，也是 tag `environment:open-grokbot`）。

## 密钥

IT 在 Langfuse 里建好项目、生成 API key 之后再放进 Worker。这个 PR 不部署。

```bash
npx wrangler secret put LANGFUSE_PUBLIC_KEY
npx wrangler secret put LANGFUSE_SECRET_KEY
npx wrangler secret put LANGFUSE_BASE_URL
```

`LANGFUSE_BASE_URL` 填 `https://langfuse.viruspc.tech`。

本地是同一组名字，写在 `.dev.vars`（git 忽略），然后重启 `npm run dev`：

```bash
LANGFUSE_PUBLIC_KEY=pk-lf-...
LANGFUSE_SECRET_KEY=sk-lf-...
LANGFUSE_BASE_URL=https://langfuse.viruspc.tech
```

## Trace 里有什么

| 观察 | 名字 | 类型 | 何时 |
| --- | --- | --- | --- |
| 房间交接 | `room.handoff` | agent | 每次 `postMessage`，包括没有叫醒 |
| 一位同事 | `peer:<id>` | agent | 每次 `wake`，含私信。挂在房间 span 下；私信自己是根 |
| 模型 | `peer.model` | generation | 这次叫醒真的去调了模型 |
| Squad 队长 `@` | `squad.fanout` | span | 队长回复里点到了房间里的人。下面再挂 `peer:<id>` |
| Desk `research` | `desk.research` | agent | `agentTool(ResearcherAgent)` 那一次委派 |

标签（trace tags）：

- `environment:open-grokbot`
- `routing.mode:teams` 或 `routing.mode:squad`
- `handoff.rule:` + `broadcast` / `mentions` / `addressed` / `leader` / `silent`
- `room:<房间名>`
- `peer.id:<id>`（在那位同事的 span 上）

同一房间的交接共用 session id（房间名），所以 Sessions 视图能把一个房间收成一串。输入输出只留截断后的正文；邮箱和 `sk-lf-` / `pk-lf-` / `sk-` 样子的密钥会先打成 `[email]` / `[redacted]`。

房间 span 的 output 有 `woken`、`failed`。某一位模型失败但规则兜住了：那一位是 WARNING，`reply.source` 为 `rule`，`modelError` 在 metadata 里，generation 为 ERROR。叫醒 RPC 本身失败则进 `failed`。

## 怎么确认

1. 三个密钥都空着。打开同事页，创建 `lobby`，发「`@notetaker 你好`」。页面照常多一条 NoteTaker，没有报错。Langfuse 项目里没有新 trace。
2. 填上密钥并重启 `npm run dev`（或等 `wrangler secret put` 之后的下一次部署）。再发同一句。
3. 在该项目的 Traces 里按 environment `open-grokbot` 或 tag `room:lobby` 过滤。应看到 `room.handoff`，子节点 `peer:notetaker`。没模型时 generation 失败、回复 source 为 `rule`。有模型时 `peer.model` 上有 model id 和 token。
4. 切到 Squad，发一句不带 `@` 的话。若队长回复里写了 `@notetaker`，同一条 trace 下多一个 `squad.fanout`，下面是被点到的 `peer:<id>`。
5. 回到对话页，发「用研究队友说明 Durable Object 在这里做什么」。另有一条 `desk.research`。这不是房间那条 trace。

延迟就是 span 的起止时间：房间 span 盖住并行叫醒，每位同事的 span 盖住自己的 `wake()`。
