# 建议阅读顺序

目标是看清一层落在哪个文件，而不是把 Think 的源码读完。每一站只回答一个问题。

## 1. 这仓在声称什么

读 [README](../README.md) 的对照表，再读 [ARCHITECTURE.md](./ARCHITECTURE.md) 的分层图。记住两句话：循环是 Think 的；本仓不兼容任何专有机器人协议。

## 2. 请求从哪进

`src/server.ts`

- `/agents/...` 交给 `routeAgentRequest`
- `POST /webhooks/ping` 用 `getAgentByName` 找到 Desk，再 `fetch` 进那个 Durable Object
- 两个类都必须从这里 `export`，Wrangler 才把它们绑成 Durable Object

配合看 `wrangler.jsonc`：`nodejs_compat`、`ai` 绑定、两个 SQLite 类、`/agents/*` 与 `/webhooks/*` 先走 Worker。

## 3. 主助手声明了什么

`src/agents/desk.ts`

按方法往下读，不要跳：

1. `getModel` → `src/agents/model.ts`（`createAI({ binding: this.env.AI })`）
2. `configureContext`：只读 `soul`，可写 `memory`
3. `getSkills` → `src/skills.ts` → 仓库根目录 `skills/`
4. `getTools` → `src/tools/builtin.ts`
5. `getScheduledTasks`：唯一的心跳
6. `onStart`：装技能目录、按需挂 MCP、把账本读进 state
7. `remember` / `recall` / `forget` / `runHeartbeat`：给 H5 的 `@callable`
8. `onRequest`：webhook 落进 DO 之后的那一跳

Think 在构造时会包一层 `onStart`：先建好 session 和 context，再调用这里的 `onStart`，然后才调和定时任务。所以这里不要再 `super.onStart()`。

## 4. 队友是真的另一个 Agent

`src/tools/builtin.ts` 里的 `research`，然后 `src/agents/researcher.ts`。

`agentTool(ResearcherAgent, …)` 会在调用时创建子 Durable Object，而不是把「你现在扮演研究员」写进同一条提示词。Researcher 自己的 `getModel` 和 `configureContext` 都在，工具只有 `get_time`，避免子代理再去调父代理。

## 5. 技能原文

`skills/explain-architecture/SKILL.md`  
`skills/study-note/SKILL.md`

目录名下面必须有 `SKILL.md`，frontmatter 里要有 `name` 和 `description`。这是 Agents 的技能格式，不是把任意 markdown 丢进提示词。`explain-architecture/references/file-map.md` 是给 `read_skill_resource` 读的附属文件。

`src/skills.ts` 的导入说明为什么路径是 `agents:skills/../skills`：插件相对**导入文件**解析目录。

## 6. 记忆怎么变成面板上的一行

`src/memory/ledger.ts` 管 SQL。  
回到 `desk.ts` 的 `projectLedger`：写入后 `context.setBlock("memory")`，再 `refreshSystemPrompt()`，然后 `setState`。

面板在 `src/client/MemoryPane.tsx`。它不解析聊天文本，只渲染 `DeskState.memory`。

## 7. 浏览器怎么接上

`src/client/App.tsx`

- `useAgent` 订阅状态，并调用 `stub.remember` / `stub.runHeartbeat`
- `useAgentChat` 负责气泡和流
- `useAgentToolEvents` 把 Researcher 的子运行贴到 `research` 工具卡上

然后按需看 `ChatPane.tsx`、`MemoryPane.tsx`、`RoutinePane.tsx`。`MapPane.tsx` 是同一张对照表的手机版，没有第二套逻辑。

`src/agents/state.ts` 是两边共用的状态形状。改字段时 Worker 和 H5 一起改。

## 8. 可以先不读的东西

Think 的工作区文件工具、压缩、恢复纤维。它们是框架自带的。Desk 的系统说明要求模型讲架构时不要去改工作区文件。等你把上面 7 站走完，再翻 Think 文档里的 Tools 和 Recovery。

MCP 也先当钩子看：`src/tools/mcp.ts` 很短。接上真实服务器是 README 里的可选步骤，不是主路径。
