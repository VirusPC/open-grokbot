# 并列同事

对话页和同事页是两条多 Agent，不要读成一条。

| | 父子（今天的对话页） | 并列（同事页） |
| --- | --- | --- |
| 谁发现谁 | Desk 的 `research` 工具知道 Researcher | `TeammateRegistry` 列出 Desk、Researcher、NoteTaker。Desk 只是一行 |
| 怎么交活 | `agentTool(ResearcherAgent)`，子 Think 嵌在父回合里 | `RoomAgent` 用 `getAgentByName(PeerAgent, id)` 按名字叫醒 |
| 要不要模型 | 要。没登录 Workers AI 时这一步会失败 | 不要。Peer 用规则回复，方便本机看交接 |
| 常驻 | 两个 Think Durable Object，闲时休眠 | 同样是 Durable Object 身份。叫醒会写 `wakeCount`，然后实例可以再休眠。不是一直占着 CPU |

这不是完整的 Grok Bot，也没有给每个同事一套隔离的人格记忆。规则回复只为了把「发现 → 房间 → 按 id 交接」走通。

## 房间规则

`src/agents/peer-types.ts` 的 `planHandoff`：

- 正文里没有 `@`：广播给房间里的每一位成员。
- 有 `@`：只叫醒被点名、并且已经在房间里的人。`@` 要出现在开头或空白后面。匹配 id 或显示名，长的优先。
- 同伴的回复写回同一条线程，不再广播。否则 NoteTaker 的回复会把所有人再叫醒一遍。

`src/agents/room.ts` 让同伴把回复 **返回** 给房间，由房间追加。同伴不回头请求这个房间：Durable Object 在处理请求时再调用自己，会卡在输入门上。

## 本地看

`npm run dev` 之后打开 [http://127.0.0.1:43123](http://127.0.0.1:43123)，点「同事」。

1. 名单里应有 Desk、Researcher、NoteTaker，状态是「可休眠」。
2. 房间名保持 `lobby`，三位都勾着，点「创建房间（3 人）」。线程里有一条房间说明。
3. 点「大家好，我是来看并列交接的」。应出现你的消息，标注「广播」，然后三条 Peer 回复。登记表上的叫醒次数各加一。
4. 点「`@notetaker 只把这句话记下来`」。标注「只叫醒 notetaker」，线程里只多一条 NoteTaker。
5. 在 NoteTaker 上点「私信」，发一句。回复出现在私信框，不进房间。

对比：回到「对话」，发「用研究队友说明 Durable Object 在这里做什么」。那一跳才会出现 `research` 工具卡和 Researcher 子运行，而且需要模型。同事页的叫醒不产生那张卡。

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
