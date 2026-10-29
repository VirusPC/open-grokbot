import assert from "node:assert/strict";
import test from "node:test";
import {
  acceptModelReply,
  answerWake,
  rulePeerReply,
  selectWakeThread,
  type PeerReplyInput,
} from "./peer-reply";
import type { RoomMessage } from "./peer-types";

const ROOM = [
  { id: "desk", displayName: "Desk" },
  { id: "researcher", displayName: "Researcher" },
  { id: "notetaker", displayName: "NoteTaker" },
];

function input(patch: Partial<PeerReplyInput> & Pick<PeerReplyInput, "id" | "text">): PeerReplyInput {
  return {
    displayName: patch.displayName ?? patch.id,
    tags: patch.tags ?? ["peer"],
    kind: patch.kind ?? "room",
    from: patch.from ?? "you",
    room: patch.room === undefined ? "lobby" : patch.room,
    members: patch.members ?? ROOM,
    thread: patch.thread ?? [],
    id: patch.id,
    text: patch.text,
    delegate: patch.delegate === true,
  };
}

const ESSAY =
  "并列 Desk 收到：「你们叫什么名字」。房间按 id 叫醒了这个 PeerAgent，回复交回房间，不嵌在 Desk 的 Think 回合里。对话页里的 DeskAgent 是另一条绑定。";

test("name question is answered from displayName, not the architecture essay", () => {
  const desk = rulePeerReply(input({ id: "desk", displayName: "Desk", text: "你们叫什么名字" }));
  const researcher = rulePeerReply(
    input({ id: "researcher", displayName: "Researcher", text: "你们叫什么名字" }),
  );
  const notetaker = rulePeerReply(
    input({ id: "notetaker", displayName: "NoteTaker", text: "你们叫什么名字" }),
  );
  assert.equal(desk, "我是 Desk。这间房里还有 Researcher、NoteTaker。");
  assert.equal(researcher, "我是 Researcher。这间房里还有 Desk、NoteTaker。");
  assert.equal(notetaker, "我是 NoteTaker。这间房里还有 Desk、Researcher。");
  for (const reply of [desk, researcher, notetaker]) {
    assert.doesNotMatch(reply, /收到|叫醒|agentTool|PeerAgent|Durable/);
  }
});

test("a direct name question and a mention still answer as that peer", () => {
  assert.equal(
    rulePeerReply(input({ id: "researcher", displayName: "Researcher", text: "@researcher 你叫什么名字" })),
    "我是 Researcher。",
  );
  assert.equal(
    rulePeerReply(
      input({
        id: "notetaker",
        displayName: "NoteTaker",
        kind: "dm",
        members: [],
        room: null,
        text: "你叫什么名字",
      }),
    ),
    "我是 NoteTaker。",
  );
});

test("a squad leader delegates a note with @ and does not answer it alone", () => {
  assert.equal(
    rulePeerReply(input({ id: "desk", displayName: "Desk", delegate: true, text: "帮我记一下：明天评审" })),
    "@notetaker 请记下：明天评审。",
  );
  assert.equal(
    rulePeerReply(input({ id: "desk", displayName: "Desk", text: "帮我记一下：明天评审" })),
    "记下了：明天评审。",
  );
});

test("note, greeting, architecture, and recall stay on the latest line", () => {
  assert.equal(
    rulePeerReply(input({ id: "notetaker", displayName: "NoteTaker", text: "@notetaker 只把这句话记下来" })),
    "好，这句我记下了。",
  );
  assert.equal(
    rulePeerReply(input({ id: "notetaker", displayName: "NoteTaker", text: "记住：明天评审" })),
    "记下了：明天评审。",
  );
  assert.equal(
    rulePeerReply(input({ id: "notetaker", displayName: "NoteTaker", text: "@notetaker 只记这一句" })),
    "好，这句我记下了。",
  );
  assert.equal(
    rulePeerReply(input({ id: "notetaker", displayName: "NoteTaker", text: "帮我记下登录失败的复现步骤" })),
    "记下了：登录失败的复现步骤。",
  );
  assert.equal(
    rulePeerReply(input({ id: "desk", displayName: "Desk", text: "大家好，我是来看并列交接的" })),
    "你好，我是 Desk。",
  );
  const arch = rulePeerReply(
    input({ id: "desk", displayName: "Desk", text: "@desk @researcher 这条不走父回合" }),
  );
  assert.match(arch, /^我是 Desk。/);
  assert.match(arch, /父子回合/);
  assert.doesNotMatch(arch, /叫醒了这个|不嵌在/);
  const recall = rulePeerReply(
    input({
      id: "researcher",
      displayName: "Researcher",
      text: "刚才我说了什么",
      thread: [{ authorId: "you", authorName: "你", text: "明天下雨" }],
    }),
  );
  assert.match(recall, /我是 Researcher/);
  assert.match(recall, /明天下雨/);
  const said = rulePeerReply(
    input({
      id: "desk",
      displayName: "Desk",
      text: "刚才我说了什么",
      thread: [
        { authorId: "you", authorName: "你", text: "你们叫什么名字" },
        { authorId: "desk", authorName: "Desk", text: "我是 Desk。" },
      ],
    }),
  );
  assert.match(said, /你说「你们叫什么名字」/);
  assert.doesNotMatch(said, /我是 Desk。」/);
});

test("model text is kept, and the canned dump falls back to the rule", async () => {
  const named = input({ id: "desk", displayName: "Desk", text: "你们叫什么名字" });
  const used = await answerWake(named, async () => "我是 Desk。");
  assert.equal(used.source, "model");
  assert.equal(used.reply, "我是 Desk。");

  const dumped = await answerWake(named, async () => ESSAY);
  assert.equal(dumped.source, "rule");
  assert.equal(dumped.reason, "canned");
  assert.match(dumped.reply, /我是 Desk/);
  assert.doesNotMatch(dumped.reply, /叫醒|agentTool/);

  const failed = await answerWake(named, async () => {
    throw new Error("binding unavailable");
  });
  assert.equal(failed.source, "rule");
  assert.equal(failed.reason, "threw");
  assert.match(failed.reply, /我是 Desk/);
});

test("acceptModelReply drops empty and think-only essays", () => {
  assert.equal(acceptModelReply("  "), null);
  assert.equal(acceptModelReply(`<think>${ESSAY}</think>`), null);
  assert.equal(acceptModelReply("<think>内部草稿</think>我是 Desk。"), "我是 Desk。");
});

test("wake thread keeps human lines and drops system notices and canned peer lines", () => {
  const messages: RoomMessage[] = [
    {
      id: "1",
      authorId: "room",
      text: "交接是 getAgentByName(PeerAgent, id)，不经过 agentTool。",
      createdAt: "t",
      kind: "system",
      handoff: null,
    },
    {
      id: "2",
      authorId: "you",
      text: "你们叫什么名字",
      createdAt: "t",
      kind: "human",
      handoff: { rule: "broadcast", targets: ["desk"] },
    },
    {
      id: "3",
      authorId: "desk",
      text: ESSAY,
      createdAt: "t",
      kind: "peer",
      handoff: null,
    },
    {
      id: "4",
      authorId: "researcher",
      text: "我是 Researcher。",
      createdAt: "t",
      kind: "peer",
      handoff: null,
    },
  ];
  const names = new Map(ROOM.map((member) => [member.id, member.displayName]));
  assert.deepEqual(selectWakeThread(messages, names), [
    { authorId: "you", authorName: "你", text: "你们叫什么名字" },
    { authorId: "researcher", authorName: "Researcher", text: "我是 Researcher。" },
  ]);
});
