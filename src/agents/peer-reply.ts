/**
 * What a woken peer says. The Durable Object calls the model; these
 * functions stay pure so a missing Workers AI binding still answers.
 * Thread context is a snapshot from the room. The peer does not fetch
 * the room back (that deadlocks the input gate).
 */

import type { RoomMessage, WakeKind, WakeMember, WakeRequest, WakeTurn } from "./peer-types";

export const MAX_WAKE_THREAD = 8;
const TURN_CHARS = 180;
const REPLY_CHARS = 360;

const CANNED_REPLY =
  /收到[了：「]|叫醒了这个|不嵌在|规则回复|不调用模型|另一条绑定|我不是对话页|PeerAgent/;

const NAME_QUESTION =
  /(你们|你|大家|各位|本人).{0,12}(名字|是谁|叫啥|叫什么|怎么称呼)|叫什么名字|什么名字|你是谁|who are you|your name|怎么称呼|如何称呼|介绍一下(你|自己|各位|大家)/iu;

const ROSTER_QUESTION = /(房间|这里|这儿).{0,8}(有谁|有哪些|几位|几个人)|有哪些人|都有谁|成员有谁|还有谁/u;

const NOTE_QUESTION = /记住|记下|记下来|记一下|备忘|只记/u;

const RECALL_QUESTION = /刚才|之前|上面|前面|谁说|总结一下|说过什么|说了什么/u;

const TIME_QUESTION = /几点|什么时间|what time|当前时间/iu;

const CAPABILITY_QUESTION = /你能做什么|你会什么|干什么|做什么的|你是干什么/u;

const ARCH_QUESTION = /agentTool|父回合|父子|durable object|架构|怎么叫醒|getAgentByName/iu;

const GREETING = /^(?:大家好|各位好|你们好|你好|您好|嗨|hi|hello|hey)[！!。,，\s]*/iu;

const DEFAULT_NAMES: Record<string, string> = {
  desk: "Desk",
  researcher: "Researcher",
  notetaker: "NoteTaker",
};

export type PeerReplyInput = {
  id: string;
  displayName: string;
  tags: string[];
  kind: WakeKind;
  text: string;
  from: string;
  room: string | null;
  members: WakeMember[];
  thread: WakeTurn[];
};

export type PeerAnswer = {
  reply: string;
  source: "model" | "rule";
  /** Why the model text was not used. Omitted when source is model. */
  reason?: "empty" | "canned" | "threw";
};

export function peerReplyInput(id: string, request: WakeRequest): PeerReplyInput {
  return {
    id,
    displayName: cleanName(request.displayName, id),
    tags: cleanTags(request.tags),
    kind: request.kind === "dm" ? "dm" : "room",
    text: typeof request.text === "string" ? request.text : "",
    from: typeof request.from === "string" && request.from.trim() ? request.from.trim() : "you",
    room: typeof request.room === "string" ? request.room : null,
    members: cleanMembers(request.members),
    thread: cleanThread(request.thread),
  };
}

export function selectWakeThread(
  messages: RoomMessage[],
  names: ReadonlyMap<string, string>,
): WakeTurn[] {
  const turns: WakeTurn[] = [];
  for (const message of messages) {
    if (message.kind !== "human" && message.kind !== "peer") continue;
    if (message.kind === "peer" && isCannedPeerLine(message.text)) continue;
    const text = clip(message.text, TURN_CHARS);
    if (!text) continue;
    turns.push({
      authorId: message.authorId,
      authorName:
        message.authorId === "you" ? "你" : names.get(message.authorId) ?? message.authorId,
      text,
    });
  }
  return turns.slice(-MAX_WAKE_THREAD);
}

export function isCannedPeerLine(text: string): boolean {
  return CANNED_REPLY.test(text);
}

export function buildPeerPrompt(input: PeerReplyInput): { system: string; prompt: string } {
  const roster = input.members.map((member) => `${member.displayName}（${member.id}）`).join("、");
  const system = [
    `你是「${input.displayName}」，id 是 ${input.id}。${personaLine(input)}`,
    "用用户的语言回答，默认中文。只写 1 到 3 句，先回答最新一条。不要写标题、列表或引号。",
    "只代表自己，用第一人称。可以提到同房其他人的名字，不要替他们发言。",
    "更早的对话如果在讲「怎么被叫醒、agentTool、Durable Object」，不要照着学。除非对方这句明确在问架构，否则不要解释这些，也不要以「收到了」开头。",
    roster ? `同房的人：${roster}。` : "这是私信，没有房间名单。",
    input.tags.length > 0 ? `标签：${input.tags.join("、")}。` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const history = input.thread.length
    ? input.thread.map((turn) => `${turn.authorName}：${turn.text}`).join("\n")
    : "（没有更早的对话）";
  const speaker = speakerName(input.from, input.members);
  const prompt = [
    input.kind === "dm" ? "这是私信。" : `房间：${input.room ?? "lobby"}。`,
    "更早的对话：",
    history,
    "",
    `请回答${speaker}的最新一句：`,
    input.text.trim(),
  ].join("\n");
  return { system, prompt };
}

/**
 * Keep a model line only when it answers. The old 「收到了…agentTool」
 * dump is rejected even if the user asked about architecture; the rule
 * then answers that ask in one line.
 */
export function acceptModelReply(raw: string): string | null {
  const text = clip(stripThink(raw), REPLY_CHARS);
  if (!text || isCannedPeerLine(text)) return null;
  return text;
}

export async function answerWake(
  input: PeerReplyInput,
  complete: (input: PeerReplyInput) => Promise<string>,
): Promise<PeerAnswer> {
  try {
    const raw = await complete(input);
    const accepted = acceptModelReply(raw);
    if (accepted) return { reply: accepted, source: "model" };
    return {
      reply: rulePeerReply(input),
      source: "rule",
      reason: isCannedPeerLine(raw) ? "canned" : "empty",
    };
  } catch {
    return { reply: rulePeerReply(input), source: "rule", reason: "threw" };
  }
}

export function rulePeerReply(input: PeerReplyInput): string {
  const name = input.displayName || defaultDisplayName(input.id);
  const body = spokenText(input.text);
  const rest = otherNames(input);

  if (!body) return `我是 ${name}。`;

  if (NAME_QUESTION.test(body)) {
    if (/你们|大家|各位/.test(body) && rest.length > 0) {
      return `我是 ${name}。这间房里还有 ${rest.join("、")}。`;
    }
    return `我是 ${name}。`;
  }

  if (ROSTER_QUESTION.test(body)) {
    const all = input.members.map((member) => member.displayName);
    if (all.length === 0) return `我是 ${name}。`;
    return `这间房里有 ${all.join("、")}。我是 ${name}。`;
  }

  if (NOTE_QUESTION.test(body)) {
    const noted = noteBody(body);
    return noted ? `记下了：${clip(noted, 80)}。` : "好，这句我记下了。";
  }

  if (RECALL_QUESTION.test(body)) {
    const aboutUser = /我说|我讲|我问/.test(body);
    const pool = aboutUser
      ? input.thread.filter((turn) => turn.authorId === input.from)
      : input.thread;
    const chosen = (pool.length > 0 ? pool : input.thread).slice(-3);
    if (chosen.length === 0) return `我是 ${name}。前面还没有对话。`;
    const lines = chosen.map((turn) => {
      const who = turn.authorId === input.id ? "我" : turn.authorName;
      return `${who}说「${clip(turn.text, 48)}」`;
    });
    return `我是 ${name}。${lines.join("；")}。`;
  }

  if (TIME_QUESTION.test(body)) {
    return `现在是 ${shanghaiClock()}（上海）。我是 ${name}。`;
  }

  if (CAPABILITY_QUESTION.test(body)) {
    if (input.id === "desk") return "我是 Desk。你在房间里问我，我就直接短答。";
    if (input.id === "researcher") return "我是 Researcher。你问概念，我用一两句说明。";
    if (input.id === "notetaker" || input.tags.includes("notes")) {
      return "我是 NoteTaker。你让我记的话，我会复述下来。";
    }
    return `我是 ${name}。你问什么，我按这个身份短答。`;
  }

  if (asksArchitecture(body)) {
    const where = input.kind === "dm" ? "这是私信" : "这句在房间里直接回你";
    return `我是 ${name}。${where}，不走对话页的父子回合。`;
  }

  if (GREETING.test(body)) return `你好，我是 ${name}。`;

  const where = input.kind === "dm" ? "我直接答你" : "我在这个房间里直接答你";
  return `我是 ${name}。关于「${clip(body, 48)}」，${where}。`;
}

function personaLine(input: PeerReplyInput): string {
  if (input.id === "desk") return "你把话接住，回答要短，先给结论。";
  if (input.id === "researcher") return "你把概念讲清楚，但只写一两句，不要写成教程。";
  if (input.id === "notetaker" || input.tags.includes("notes")) {
    return "对方要你记的内容，用一句话确认记下了什么。其他问题也直接回答。";
  }
  return "按你的显示名，用短句回答。";
}

function asksArchitecture(text: string): boolean {
  return ARCH_QUESTION.test(text);
}

function speakerName(from: string, members: WakeMember[]): string {
  if (from === "you") return "你";
  return members.find((member) => member.id === from)?.displayName ?? from;
}

function otherNames(input: PeerReplyInput): string[] {
  return input.members
    .filter((member) => member.id !== input.id)
    .map((member) => member.displayName);
}

function spokenText(text: string): string {
  return text.replace(/@[^\s@]+/gu, " ").replace(/\s+/g, " ").trim();
}

function noteBody(text: string): string {
  const stripped = spokenText(text)
    .replace(/^(请|帮我|麻烦你?)/u, "")
    .replace(/(记下来|记一下|记住|记下|备忘|只记)/gu, " ")
    .replace(/只把|把|将/gu, " ")
    .replace(/这句话|这一句|这句|这条|那句|那条/gu, " ")
    .replace(/^[:：，,\s]+|[:：，,\s]+$/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!stripped || /^(一下|只|话)$/u.test(stripped)) return "";
  return stripped;
}

function shanghaiClock(): string {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date());
}

function stripThink(raw: string): string {
  return raw.replace(/<think>[\s\S]*?<\/think>/gi, " ").trim();
}

function cleanName(value: unknown, id: string): string {
  if (typeof value !== "string") return defaultDisplayName(id);
  const name = value.trim().replace(/\s+/g, " ");
  return name ? name.slice(0, 40) : defaultDisplayName(id);
}

function defaultDisplayName(id: string): string {
  return DEFAULT_NAMES[id] ?? id;
}

function cleanTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const tags: string[] = [];
  for (const tag of value) {
    if (typeof tag !== "string") continue;
    const clean = tag.trim();
    if (!clean || tags.includes(clean)) continue;
    tags.push(clean);
    if (tags.length >= 8) break;
  }
  return tags;
}

function cleanMembers(value: unknown): WakeMember[] {
  if (!Array.isArray(value)) return [];
  const members: WakeMember[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const record = item as { id?: unknown; displayName?: unknown };
    if (typeof record.id !== "string" || !record.id.trim()) continue;
    const id = record.id.trim();
    const displayName =
      typeof record.displayName === "string" && record.displayName.trim()
        ? record.displayName.trim().slice(0, 40)
        : defaultDisplayName(id);
    if (members.some((member) => member.id === id)) continue;
    members.push({ id, displayName });
  }
  return members;
}

function cleanThread(value: unknown): WakeTurn[] {
  if (!Array.isArray(value)) return [];
  const turns: WakeTurn[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const record = item as { authorId?: unknown; authorName?: unknown; text?: unknown };
    if (typeof record.text !== "string") continue;
    const text = clip(record.text, TURN_CHARS);
    if (!text || isCannedPeerLine(text)) continue;
    const authorId = typeof record.authorId === "string" ? record.authorId : "you";
    const authorName =
      typeof record.authorName === "string" && record.authorName.trim()
        ? record.authorName.trim().slice(0, 40)
        : authorId === "you"
          ? "你"
          : authorId;
    turns.push({ authorId, authorName, text });
  }
  return turns.slice(-MAX_WAKE_THREAD);
}

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (!flat) return "";
  if (flat.length <= max) return flat;
  return `${flat.slice(0, max)}…`;
}
