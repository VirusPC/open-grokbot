# 文件对照

- `src/server.ts`：Worker 入口、`routeAgentRequest`、`POST /webhooks/ping`
- `src/agents/desk.ts`：主 Think、上下文、技能、例程、记忆投影
- `src/agents/researcher.ts`：被 `agentTool` 调起的第二个 Think
- `src/agents/peer-types.ts`：并列同事的类型，以及广播 / @ 的 `planHandoff`
- `src/agents/registry.ts`：`TeammateRegistry`，种子 Desk、Researcher、NoteTaker
- `src/agents/room.ts`：`RoomAgent`，按 id 交接，不嵌进 Think
- `src/agents/peer.ts`：`PeerAgent` 规则回复
- `src/peers/http.ts`：`/api/teammates`、`/api/rooms/*`、`/api/peers/*`
- `src/client/PeersPane.tsx`：同事列表、开房、@
- `src/agents/model.ts`：`createAI({ binding })`，可选 OpenAI
- `src/tools/builtin.ts`：`get_time`、`memory_write`、`memory_read`、`research`
- `src/tools/mcp.ts`：`addMcpServer` 挂载点
- `src/memory/ledger.ts`：记忆账本
- `src/client/`：H5，`useAgent` 与 `useAgentChat`
- `desktop/`：Electron 壳，只加载 H5，不参与 Worker
- `skills/`：技能原文
