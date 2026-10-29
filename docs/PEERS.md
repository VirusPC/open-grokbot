# 并列同事

对话页和同事页是两条多 Agent，不要读成一条。

| | 父子（今天的对话页） | 并列（同事页） |
| --- | --- | --- |
| 谁发现谁 | Desk 的 `research` 工具知道 Researcher | `TeammateRegistry` 列出 Desk、Researcher、NoteTaker。Desk 只是一行 |
| 怎么交活 | `agentTool(ResearcherAgent)`，子 Think 嵌在父回合里 | `RoomAgent` 用 `getAgentByName(PeerAgent, id)` 按名字叫醒 |
| 要不要模型 | 要。没登录 Workers AI 时这一步会失败 | 优先用和 Desk 同一套模型（Workers AI，或设了 `OPENAI_API_KEY` 时的 OpenAI）。叫不醒模型时，按显示名和房间线程短答 |
| 常驻 | 两个 Think Durable Object，闲时休眠 | 同样是 Durable Object 身份。叫醒会写 `wakeCount`，然后实例可以再休眠。不是一直占着 CPU |

这不是完整的 Grok Bot，也没有给每个同事一套隔离的人格记忆。房间把更早的对话快照交给被叫醒的人，对方只回答最新一句。模型失败时的短规则也按 id / 显示名回答（例如「你们叫什么名字」），不再把「怎么叫醒、是不是 agentTool」写成正文。那句差别留在本页和气泡下的一行标注里。

## 房间规则

输入框上面有 **Teams / Squad**。选择写在房间状态里，刷新还在。默认 Teams。

两条路由都在 `src/agents/routing.ts`。叫醒仍然是 `Promise.allSettled`：某一位失败只留一条「叫醒失败」，不取消其他人。页面上的 `postMessage` 写下你的那一句就返回，模型放在 `waitUntil` 里，回复靠 `setState` 推上来，所以三次模型不会再撞上浏览器 30 秒的 RPC 超时。`curl` 的 `POST /api/rooms/.../messages` 会等回复齐了再返回。输入框在滚动区域外面。

### Teams（默认，像 Raft 的可见性）

大家都能看见同一条线程。看见不等于要执行。

- `@id` 或 `@显示名`：只叫醒被点到、并且在房间里的人。
- `@all`：故意叫醒当前全体成员。
- 没有 `@`，但 id 或显示名单独成词（`desk 在吗`、`NoteTaker 你好`）：只叫醒这些人。
- `desk在吗`、`hello各位` 这种没有把名字拆成独立词、也没有 `@`：谁也不叫醒。不会把三个 Peer 都丢给模型。

这不是 Multica 那种工单流，只是「看得到」和「被点到才回复」。

### Squad（像 Multica 的队长）

队长默认 Desk，可以在按钮里改。

- 没有 `@`：只叫醒队长。队长回复里如果写了 `@id`，房间再叫醒那些人。同伴不回头调用房间。
- 你自己写了 `@`：只叫醒被点名的人，**不会再自动叫醒队长**。
- `@all`：故意叫醒全体，包括队长。队长不会因为自己是队长而被加叫醒一次。

`src/agents/room.ts` 让同伴把回复 **返回** 给房间，由房间追加。同伴不回头请求这个房间：Durable Object 在处理请求时再调用自己，会卡在输入门上。队长那一跳如果要转交，只是在回复正文里写 `@id`。

## 本地看

`npm run dev` 之后打开 [http://127.0.0.1:43123](http://127.0.0.1:43123)，点「同事」。

1. 名单里应有 Desk、Researcher、NoteTaker，状态是「可休眠」。
2. 房间名保持 `lobby`，三位都勾着，点「创建房间（3 人）」。线程里有一条房间说明。
3. 默认是 Teams。发「hello各位」。只有你的消息和一条「没有叫醒」的说明，不会三条一起回复，也不会出现 `timed out`。
4. 发「desk 在吗」。只多一条 Desk。`desk在吗`（名字粘在句子里）仍然谁也不叫醒。
5. 发「`@notetaker 只把这句话记下来`」。标注「只叫醒 notetaker」，线程里只多一条 NoteTaker。
6. 点 Squad。发「hello各位」。只叫醒队长 Desk。
7. 发「帮我记一下：明天评审」。队长回复里带 `@notetaker`，随后 NoteTaker 记下这句。发「`@researcher 你好`」只叫醒 Researcher，队长不会再被自动叫醒。
8. 在 NoteTaker 上点「私信」，问「你叫什么名字」。回复出现在私信框，不进房间，并且报出 NoteTaker。

对比：回到「对话」，发「用研究队友说明 Durable Object 在这里做什么」。那一跳才会出现 `research` 工具卡和 Researcher 子运行。同事页的叫醒不产生那张卡。气泡下面一行「并列回复 · 非 agentTool」只标注路径，不是回复正文。

`GET /api/peers/notetaker` 的 `lastReply` 是最后一次回答，`lastReplySource` 是 `model` 或 `rule`。没登录 Workers AI 时这里会是 `rule`，名字问题仍然答得出来。

同一套动作可以用 curl，不打开页面：

```bash
curl -s http://127.0.0.1:43123/api/teammates
curl -s http://127.0.0.1:43123/api/teammates?q=note

curl -s -X POST http://127.0.0.1:43123/api/rooms/lobby/open \
  -H 'content-type: application/json' \
  -d '{"memberIds":["desk","researcher","notetaker"]}'

curl -s -X POST http://127.0.0.1:43123/api/rooms/lobby/messages \
  -H 'content-type: application/json' \
  -d '{"text":"@notetaker 只记这一句"}'

curl -s http://127.0.0.1:43123/api/peers/notetaker
```

`GET /api/peers/notetaker` 的 `wakeCount` 是这个 Peer Durable Object 自己记下的，和登记表上的次数应对得上。实例名就是 id。

## Langfuse

房间交接和每次叫醒可以记到自建 Langfuse。没设置 `LANGFUSE_PUBLIC_KEY`、`LANGFUSE_SECRET_KEY`、`LANGFUSE_BASE_URL` 时，上面的 curl 和页面行为不变，也不会发追踪请求。密钥怎么放、trace 长什么样，见 [OBSERVABILITY.md](./OBSERVABILITY.md)。
