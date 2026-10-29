---
name: explain-architecture
description: 当用户问这个实验仓怎样对应流式对话、多 Agent、技能、记忆、例程、工具或外部事件时使用。按固定结构用中文讲解，并指向仓库文件。不要声称兼容任何专有机器人协议。
---

# 讲解本仓架构

用户想理解分层，而不是要一段产品介绍。按下面的顺序说，每一层点名一个文件。

1. 先声明边界：open-grokbot 是教学实验，Desk 的循环是 `@cloudflare/think` 的 Think，不是自造的 agent loop，也不实现任何专有机器人协议。
2. 流式对话：浏览器 `useAgent` + `useAgentChat`，服务端 Think 把回合写进 Durable Object SQLite。入口看 `src/server.ts` 的 `routeAgentRequest`。
3. 多 Agent 有两条，不要合成一条。父子：`research` 是 `agentTool(ResearcherAgent)`，子回合嵌在 Desk 的 Think 里，文件是 `src/agents/researcher.ts`。并列：`TeammateRegistry` 发现同事，`RoomAgent` 按 id 叫醒 `PeerAgent`，不经过 `agentTool`。Peer 按房间线程回答最新一句，不把「怎么被叫醒」当成正文。常驻是 Durable Object 身份，可以休眠。这不是完整的分身记忆隔离，也不要说成专有机器人的协议兼容。
4. 技能：本文件所在的 `skills/*/SKILL.md` 由 `src/skills.ts` 以 `agents:skills/../skills` 打进包，Desk 的 `getSkills()` 返回它。需要时调用 `activate_skill`，不要把技能全文背进每回合。
5. 记忆：`configureContext` 的 `memory` 块，加上 `memory_write` / `memory_read`。账本 SQL 在 `src/memory/ledger.ts`。
6. 例程：Desk 的 `getScheduledTasks()` 声明 `heartbeat`，`every 1 minute`，handler 更新 `state.heartbeat`。
7. 工具与 MCP：内置工具在 `src/tools/`。`src/tools/mcp.ts` 只在设置了 `MCP_SERVER_URL` 时调用 `addMcpServer`。
8. 外部事件：`POST /webhooks/ping` 找到同一个 Desk 实例，写 webhook 状态，并 `submitMessages` 开一个没有浏览器的回合。

如果用户要文件级对照，调用 `read_skill_resource`，资源路径是 `references/file-map.md`。

回答保持能在手机上读完。不要编造本仓没有的模块。
