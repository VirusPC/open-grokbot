/**
 * Shared by the Worker and the H5. No Cloudflare imports.
 *
 * Two multi-agent shapes live in this repo on purpose:
 * - Parent-child: DeskAgent's `research` tool is `agentTool(ResearcherAgent)`.
 *   The child Think runs nested inside the parent's turn.
 * - Peers: TeammateRegistry discovers rows, RoomAgent is the channel, and
 *   PeerAgent instances are addressed by id. Desk is one row, not the parent
 *   of the others. This cut does not give each peer its own persona memory.
 */

import { normalizeSessionName } from "./state";

export const REGISTRY_NAME = "directory";
export const DEFAULT_ROOM = "lobby";
export const MAX_ROOM_MESSAGES = 80;
export const MAX_TEAMMATES = 24;

export type WakeKind = "room" | "dm";
export type TeammateStatus = "hibernating" | "awake";
export type HandoffRule = "broadcast" | "mentions";

/** Registry row. `hibernating` means the named Durable Object may sleep. */
export type Teammate = {
  id: string;
  displayName: string;
  tags: string[];
  status: TeammateStatus;
  wakeCount: number;
  lastWakeAt: string | null;
  lastKind: WakeKind | null;
  note: string;
};

export type RegistryState = {
  teammates: Teammate[];
};

export type HandoffPlan = {
  rule: HandoffRule;
  targets: string[];
  unknown: string[];
  outsideRoom: string[];
};

export type RoomMessage = {
  id: string;
  authorId: string;
  text: string;
  createdAt: string;
  kind: "human" | "peer" | "system";
  /** Set on human messages: who the room addressed, and why. */
  handoff: { rule: HandoffRule; targets: string[] } | null;
};

export type RoomState = {
  room: string;
  opened: boolean;
  memberIds: string[];
  messages: RoomMessage[];
};

export type PeerState = {
  peerId: string;
  wakeCount: number;
  lastWakeAt: string | null;
  lastKind: WakeKind | null;
  lastRoom: string | null;
  lastInbound: string | null;
  lastReply: string | null;
};

export type WakeRequest = {
  kind: WakeKind;
  text: string;
  room: string | null;
  from: string;
};

export type WakeResult = {
  peerId: string;
  reply: string;
  wokeAt: string;
  wakeCount: number;
};

export type WakeReceipt = {
  id: string;
  at: string;
  kind: WakeKind;
};

export type OpenResult =
  | { ok: true; state: RoomState }
  | { ok: false; error: string };

export type PostResult = OpenResult;

export type RegisterResult =
  | { ok: true; teammate: Teammate; teammates: Teammate[] }
  | { ok: false; error: string };

export type DmResult =
  | { ok: true; reply: string; teammate: Teammate }
  | { ok: false; error: string };

export const SEED_TEAMMATES: Teammate[] = [
  {
    id: "desk",
    displayName: "Desk",
    tags: ["desk", "peer"],
    status: "hibernating",
    wakeCount: 0,
    lastWakeAt: null,
    lastKind: null,
    note: "登记表里的一行。对话页的 DeskAgent 是另一条 Think 绑定，不是这个实例的父进程。",
  },
  {
    id: "researcher",
    displayName: "Researcher",
    tags: ["research", "peer"],
    status: "hibernating",
    wakeCount: 0,
    lastWakeAt: null,
    lastKind: null,
    note: "同名的 ResearcherAgent 仍只被 agentTool 嵌进父回合。这里按房间 id 叫醒。",
  },
  {
    id: "notetaker",
    displayName: "NoteTaker",
    tags: ["notes", "peer"],
    status: "hibernating",
    wakeCount: 0,
    lastWakeAt: null,
    lastKind: null,
    note: "多出来的同事，用来看 @ 不会把房间里的每个人都叫醒。",
  },
];

export const initialRegistryState: RegistryState = {
  teammates: SEED_TEAMMATES.map(cloneTeammate),
};

export const initialRoomState: RoomState = {
  room: "",
  opened: false,
  memberIds: [],
  messages: [],
};

export const initialPeerState: PeerState = {
  peerId: "",
  wakeCount: 0,
  lastWakeAt: null,
  lastKind: null,
  lastRoom: null,
  lastInbound: null,
  lastReply: null,
};

export function cloneTeammate(mate: Teammate): Teammate {
  return { ...mate, tags: [...mate.tags] };
}

export function orderTeammates(teammates: Teammate[]): Teammate[] {
  const rank = new Map(SEED_TEAMMATES.map((mate, index) => [mate.id, index]));
  return [...teammates].sort((a, b) => {
    const ra = rank.get(a.id) ?? 100;
    const rb = rank.get(b.id) ?? 100;
    if (ra !== rb) return ra - rb;
    return a.id.localeCompare(b.id);
  });
}

export function normalizeTeammateId(value: unknown): string | null {
  return normalizeSessionName(value);
}

/** Human sender in the room, or another short id. */
export function normalizeAuthorId(value: unknown): string | null {
  if (value === "you") return "you";
  return normalizeSessionName(value);
}

export function normalizeDisplayName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim().replace(/\s+/g, " ");
  if (name.length < 1 || name.length > 40) return null;
  if (/[\u0000-\u001f]/.test(name)) return null;
  return name;
}

export function normalizeTags(value: unknown): string[] | null {
  const raw = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[,，]/)
      : [];
  const tags: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") return null;
    const tag = item.trim().toLowerCase();
    if (!tag) continue;
    if (!/^[a-z0-9][a-z0-9-]{0,23}$/.test(tag)) return null;
    if (!tags.includes(tag)) tags.push(tag);
    if (tags.length >= 8) break;
  }
  return tags.length > 0 ? tags : ["custom"];
}

export function normalizePostText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text || text.length > 1000) return null;
  return text;
}

export function filterTeammates(teammates: Teammate[], query: string): Teammate[] {
  const q = query.trim().toLowerCase();
  if (!q) return teammates;
  return teammates.filter(
    (mate) =>
      mate.id.includes(q) ||
      mate.displayName.toLowerCase().includes(q) ||
      mate.tags.some((tag) => tag.includes(q)) ||
      mate.note.toLowerCase().includes(q),
  );
}

/**
 * Fan-out rule for a room message.
 * No @  → broadcast every member.
 * Any @ → wake only mentioned members. Unknown tokens and people outside
 * the room are reported and not woken. `@` must start a token (after
 * whitespace or the beginning), so `a@b.com` is not a mention.
 * Matching is longest-prefix against id and displayName.
 */
export function planHandoff(
  text: string,
  memberIds: string[],
  teammates: Teammate[],
): HandoffPlan {
  const memberSet = new Set(memberIds);
  const aliases = teammates
    .flatMap((mate) => [
      { token: mate.id.toLowerCase(), id: mate.id },
      { token: mate.displayName.toLowerCase(), id: mate.id },
    ])
    .filter((alias) => alias.token.length > 0)
    .sort((a, b) => b.token.length - a.token.length);

  const targets: string[] = [];
  const unknown: string[] = [];
  const outsideRoom: string[] = [];
  const seen = new Set<string>();
  let sawMention = false;

  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== "@") continue;
    if (!isMentionBoundary(text, index)) continue;
    sawMention = true;
    const rest = text.slice(index + 1);
    const alias = aliases.find((candidate) => rest.toLowerCase().startsWith(candidate.token));
    if (!alias) {
      const raw = /^[^\s@]{1,40}/u.exec(rest)?.[0];
      if (raw && !unknown.includes(raw)) unknown.push(raw);
      index += raw ? raw.length : 0;
      continue;
    }
    index += alias.token.length;
    if (!memberSet.has(alias.id)) {
      if (!outsideRoom.includes(alias.id)) outsideRoom.push(alias.id);
      continue;
    }
    if (!seen.has(alias.id)) {
      seen.add(alias.id);
      targets.push(alias.id);
    }
  }

  if (!sawMention) {
    return {
      rule: "broadcast",
      targets: [...memberIds],
      unknown: [],
      outsideRoom: [],
    };
  }

  return { rule: "mentions", targets, unknown, outsideRoom };
}

function isMentionBoundary(text: string, index: number): boolean {
  if (index === 0) return true;
  return /\s/u.test(text[index - 1] ?? "");
}
