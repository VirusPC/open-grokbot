/**
 * Shared by the Worker and the H5. No Cloudflare imports.
 *
 * Two multi-agent shapes live in this repo on purpose:
 * - Parent-child: DeskAgent's `research` tool is `agentTool(ResearcherAgent)`.
 *   The child Think runs nested inside the parent's turn.
 * - Peers: TeammateRegistry discovers rows, RoomAgent is the channel, and
 *   PeerAgent instances are addressed by id. Desk is one row, not the parent
 *   of the others. A wake carries the room thread for that reply only.
 *   This cut does not give each peer its own persona memory.
 */

import { normalizeSessionName } from "./state";

export const REGISTRY_NAME = "directory";
export const DEFAULT_ROOM = "lobby";
export const MAX_ROOM_MESSAGES = 80;
export const MAX_TEAMMATES = 24;

export type WakeKind = "room" | "dm";
export type TeammateStatus = "hibernating" | "awake";
/**
 * teams: everyone can read the thread; only an explicit address wakes peers.
 * squad: no @ wakes the leader only; the leader's own @ fans out. Not an issue tracker.
 */
export type RoomRouting = "teams" | "squad";
export type HandoffRule = "broadcast" | "mentions" | "addressed" | "leader" | "silent";

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
  /** Missing on rooms opened before the toggle existed. Treat as teams. */
  routing?: RoomRouting;
  /** Squad leader. Missing means desk, then the first member. */
  leaderId?: string;
};

export type PeerState = {
  peerId: string;
  wakeCount: number;
  lastWakeAt: string | null;
  lastKind: WakeKind | null;
  lastRoom: string | null;
  lastInbound: string | null;
  lastReply: string | null;
  /** Where the last reply came from. Missing on instances woken before this field existed. */
  lastReplySource: "model" | "rule" | null;
};

/** Someone in the room, passed into a wake so the peer does not call the room back. */
export type WakeMember = {
  id: string;
  displayName: string;
};

/** One earlier human or peer line. System notices are not included. */
export type WakeTurn = {
  authorId: string;
  authorName: string;
  text: string;
};

export type WakeRequest = {
  kind: WakeKind;
  text: string;
  room: string | null;
  from: string;
  displayName: string;
  tags: string[];
  /** Room roster including this peer. Empty for a DM. */
  members: WakeMember[];
  /** Earlier conversation, oldest first. Does not include `text`. */
  thread: WakeTurn[];
  /**
   * Squad leader may hand work onward by writing @id in the reply.
   * The room parses that text. This peer does not call the room back.
   */
  delegate?: boolean;
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
  routing: "teams",
  leaderId: "desk",
};

export const initialPeerState: PeerState = {
  peerId: "",
  wakeCount: 0,
  lastWakeAt: null,
  lastKind: null,
  lastRoom: null,
  lastInbound: null,
  lastReply: null,
  lastReplySource: null,
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

