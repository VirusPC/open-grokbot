import { Agent, callable, getAgentByName } from "agents";
import {
  MAX_TEAMMATES,
  REGISTRY_NAME,
  SEED_TEAMMATES,
  cloneTeammate,
  filterTeammates,
  initialRegistryState,
  normalizeDisplayName,
  normalizePostText,
  normalizeTags,
  normalizeTeammateId,
  orderTeammates,
  type DmResult,
  type RegisterResult,
  type RegistryState,
  type Teammate,
  type WakeReceipt,
} from "./peer-types";

export { REGISTRY_NAME };

/**
 * Discovery for peer mode. One Durable Object (`directory`) holds the rows.
 * Desk is a row in this list. The registry does not own the other agents
 * and does not call `agentTool`.
 *
 * 常驻: each row names a PeerAgent instance that can sleep. `wakeCount` is
 * evidence it was addressed, not evidence a CPU stayed on.
 */
export class TeammateRegistry extends Agent<Env, RegistryState> {
  initialState: RegistryState = {
    teammates: initialRegistryState.teammates.map(cloneTeammate),
  };

  override async onStart(): Promise<void> {
    this.ensureSeed();
  }

  /** Full directory. The H5 also receives this via state sync. */
  @callable()
  async list(): Promise<Teammate[]> {
    this.ensureSeed();
    return this.state.teammates.map(cloneTeammate);
  }

  /** Same match as `GET /api/teammates?q=`. Empty query returns everyone. */
  @callable()
  async search(query?: string): Promise<Teammate[]> {
    this.ensureSeed();
    const q = typeof query === "string" ? query.slice(0, 80) : "";
    return filterTeammates(this.state.teammates, q).map(cloneTeammate);
  }

  @callable()
  async register(input?: {
    id?: string;
    displayName?: string;
    tags?: string[] | string;
  }): Promise<RegisterResult> {
    this.ensureSeed();
    const id = normalizeTeammateId(input?.id);
    const displayName = normalizeDisplayName(input?.displayName);
    const tags = normalizeTags(input?.tags ?? []);
    if (!id) return { ok: false, error: "id 需是小写字母、数字和连字符，例如 notetaker。" };
    if (!displayName) return { ok: false, error: "显示名需要 1 到 40 个字。" };
    if (!tags) return { ok: false, error: "标签用小写字母、数字和连字符，逗号分隔。" };

    const existing = this.state.teammates.find((mate) => mate.id === id);
    if (!existing && this.state.teammates.length >= MAX_TEAMMATES) {
      return { ok: false, error: `登记表最多 ${MAX_TEAMMATES} 人。` };
    }

    const teammate: Teammate = existing
      ? { ...existing, displayName, tags: [...tags] }
      : {
          id,
          displayName,
          tags: [...tags],
          status: "hibernating",
          wakeCount: 0,
          lastWakeAt: null,
          lastKind: null,
          note: "后来登记的同事。创建房间时勾选，才会成为房间成员。",
        };
    const teammates = orderTeammates([
      ...this.state.teammates.filter((mate) => mate.id !== id),
      teammate,
    ]);
    this.setState({ teammates });
    return { ok: true, teammate: cloneTeammate(teammate), teammates: teammates.map(cloneTeammate) };
  }

  /**
   * Direct address, no room. The browser calls this; we wake PeerAgent by
   * id and then record the wake locally. The peer must not call back into
   * this object while `dm` is still running (same-DO re-entry deadlocks).
   */
  @callable()
  async dm(input?: { id?: string; text?: string }): Promise<DmResult> {
    this.ensureSeed();
    const id = normalizeTeammateId(input?.id);
    const text = normalizePostText(input?.text);
    if (!id || !text) return { ok: false, error: "私信需要登记表里的 id，以及一句正文。" };
    const mate = this.state.teammates.find((item) => item.id === id);
    if (!mate) return { ok: false, error: `登记表里没有「${id}」。` };

    const peer = await getAgentByName(this.env.PeerAgent, id);
    const wake = await peer.wake({
      kind: "dm",
      text,
      room: null,
      from: "you",
      displayName: mate.displayName,
      tags: [...mate.tags],
      members: [],
      thread: [],
    });
    const teammate = this.applyWakes([{ id, at: wake.wokeAt, kind: "dm" }]).find(
      (item) => item.id === id,
    );
    return {
      ok: true,
      reply: wake.reply,
      teammate: cloneTeammate(teammate ?? mate),
    };
  }

  /**
   * Room records handoffs here after each PeerAgent.wake returns.
   * Not a browser callable: the websocket RPC allow-list is `@callable`.
   */
  async recordWakes(events: WakeReceipt[]): Promise<Teammate[]> {
    this.ensureSeed();
    return this.applyWakes(events).map(cloneTeammate);
  }

  private ensureSeed(): void {
    const present = new Set(this.state.teammates.map((mate) => mate.id));
    const missing = SEED_TEAMMATES.filter((mate) => !present.has(mate.id)).map(cloneTeammate);
    if (missing.length === 0) return;
    this.setState({ teammates: orderTeammates([...this.state.teammates, ...missing]) });
  }

  private applyWakes(events: WakeReceipt[]): Teammate[] {
    const accepted = events.filter(
      (event) =>
        normalizeTeammateId(event.id) === event.id &&
        (event.kind === "room" || event.kind === "dm") &&
        typeof event.at === "string",
    );
    if (accepted.length === 0) return this.state.teammates;
    const teammates = this.state.teammates.map(cloneTeammate);
    for (const event of accepted) {
      const index = teammates.findIndex((mate) => mate.id === event.id);
      if (index < 0) continue;
      const current = teammates[index];
      if (!current) continue;
      teammates[index] = {
        ...current,
        status: "hibernating",
        wakeCount: current.wakeCount + 1,
        lastWakeAt: event.at,
        lastKind: event.kind,
      };
    }
    const ordered = orderTeammates(teammates);
    this.setState({ teammates: ordered });
    return ordered;
  }
}
