import assert from "node:assert/strict";
import test from "node:test";
import { planLeaderFanout, planRoomRoute } from "./routing";
import { SEED_TEAMMATES, type Teammate } from "./peer-types";

const MEMBERS = ["desk", "researcher", "notetaker"];
const TEAM = SEED_TEAMMATES;

function route(mode: "teams" | "squad", text: string, leaderId = "desk", memberIds = MEMBERS) {
  return planRoomRoute({ mode, text, memberIds, teammates: TEAM, leaderId });
}

test("teams wakes only an explicit address, not a bare greeting", () => {
  assert.deepEqual(route("teams", "hello各位").targets, []);
  assert.equal(route("teams", "hello各位").rule, "silent");
  assert.deepEqual(route("teams", "你们叫什么名字").targets, []);
  assert.deepEqual(route("teams", "desk在吗").targets, []);
  assert.deepEqual(route("teams", "大家好，我是来看并列交接的").targets, []);

  assert.deepEqual(route("teams", "desk 在吗").targets, ["desk"]);
  assert.equal(route("teams", "desk 在吗").rule, "addressed");
  assert.deepEqual(route("teams", "Desk，在吗").targets, ["desk"]);
  assert.deepEqual(route("teams", "NoteTaker 你好").targets, ["notetaker"]);

  assert.deepEqual(route("teams", "@notetaker 只把这句话记下来").targets, ["notetaker"]);
  assert.deepEqual(route("teams", "@desk @researcher 这条不走父回合").targets, ["desk", "researcher"]);
  assert.deepEqual(route("teams", "@all 大家打个招呼").targets, MEMBERS);
  assert.equal(route("teams", "@all 大家打个招呼").rule, "broadcast");
  assert.deepEqual(route("teams", "@ghost 在吗").unknown, ["ghost"]);
  assert.deepEqual(route("teams", "@ghost 在吗").targets, []);
});

test("squad wakes the leader unless the human already wrote @", () => {
  assert.deepEqual(route("squad", "hello各位").targets, ["desk"]);
  assert.equal(route("squad", "hello各位").rule, "leader");
  assert.deepEqual(route("squad", "desk在吗").targets, ["desk"]);
  assert.deepEqual(route("squad", "researcher 在吗", "desk").targets, ["desk"]);

  assert.deepEqual(route("squad", "@researcher 你好").targets, ["researcher"]);
  assert.equal(route("squad", "@researcher 你好").rule, "mentions");
  assert.deepEqual(route("squad", "@notetaker 只把这句话记下来").targets, ["notetaker"]);
  assert.ok(!route("squad", "@researcher 你好").targets.includes("desk"));

  assert.deepEqual(route("squad", "@all 大家打个招呼").targets, MEMBERS);
  assert.deepEqual(route("squad", "hello各位", "notetaker").targets, ["notetaker"]);
  assert.deepEqual(route("squad", "hello各位", "missing", ["researcher", "notetaker"]).targets, ["researcher"]);
});

test("a squad leader reply fans out @ mentions and does not wake the leader again", () => {
  const fan = planLeaderFanout("@notetaker 请记下：明天评审。", MEMBERS, TEAM, "desk");
  assert.deepEqual(fan.targets, ["notetaker"]);
  assert.deepEqual(planLeaderFanout("我自己来。", MEMBERS, TEAM, "desk").targets, []);
  assert.deepEqual(planLeaderFanout("@desk 我再看一眼", MEMBERS, TEAM, "desk").targets, []);
  assert.deepEqual(planLeaderFanout("@all 请看一下", MEMBERS, TEAM, "desk").targets, [
    "researcher",
    "notetaker",
  ]);
  assert.deepEqual(planLeaderFanout("@ghost 你来", MEMBERS, TEAM as Teammate[], "desk").unknown, ["ghost"]);
});
