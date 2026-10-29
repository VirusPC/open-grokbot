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

`src/agents/peer-types.ts` 的 `planHandoff`：

- 正文里没有 `@`：广播给房间里的每一位成员。
- 有 `@`：只叫醒被点名、并且已经在房间里的人。`@` 要出现在开头或空白后面。匹配 id 或显示名，长的优先。
- 同伴的回复写回同一条线程，不再广播。否则 NoteTaker 的回复会把所有人再叫醒一遍。

`src/agents/room.ts` 让同伴把回复 **返回** 给房间，由房间追加。同伴不回头请求这个房间：Durable Object 在处理请求时再调用自己，会卡在输入门上。

广播（全员）和 `@`（点名）走同一次并行叫醒：`Promise.allSettled`，不是一个等一个。某一位失败只留一条「叫醒失败」，其他人照常回复。页面上的 `postMessage` 在写下你的那一句后就返回，模型调用放在 `waitUntil` 里，再用 `setState` 把回复推上来。浏览器对这条 RPC 的默认超时是 30 秒，三次模型串行经常超。`curl` 的 `POST /api/rooms/.../messages` 会等回复齐了再返回。输入框在滚动区域外面，避免 Enter 把视口推进线程下面的空白。

## 本地看

`npm run dev` 之后打开 [http://127.0.0.1:43123](http://127.0.0.1:43123)，点「同事」。

1. 名单里应有 Desk、Researcher、NoteTaker，状态是「可休眠」。
2. 房间名保持 `lobby`，三位都勾着，点「创建房间（3 人）」。线程里有一条房间说明。
3. 点「你们叫什么名字」。应出现你的消息，标注「广播」，然后三条回复：各自报出自己的名字（Desk、Researcher、NoteTaker），而不是「收到了…agentTool」的长说明。登记表上的叫醒次数各加一。
4. 点「大家好，我是来看并列交接的」。还是广播，三条回复是招呼，正文不再讲解 Durable Object。
5. 点「`@notetaker 只把这句话记下来`」。标注「只叫醒 notetaker」，线程里只多一条 NoteTaker，内容是记下了这句。
6. 在 NoteTaker 上点「私信」，问「你叫什么名字」。回复出现在私信框，不进房间，并且报出 NoteTaker。

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
