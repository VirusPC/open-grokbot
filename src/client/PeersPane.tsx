import { useAgent } from "agents/react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { RoomAgent } from "../agents/room";
import type { TeammateRegistry } from "../agents/registry";
import {
  DEFAULT_ROOM,
  REGISTRY_NAME,
  SEED_TEAMMATES,
  filterTeammates,
  initialRegistryState,
  initialRoomState,
  type RegistryState,
  type RoomMessage,
  type RoomState,
  type Teammate,
} from "../agents/peer-types";
import { normalizeSessionName } from "../agents/state";
import { formatStamp } from "./format";

const SUGGESTIONS = [
  "你们叫什么名字",
  "大家好，我是来看并列交接的",
  "@notetaker 只把这句话记下来",
  "@desk @researcher 这条不走父回合",
];

export function PeersPane() {
  const [ready, setReady] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string[]>(SEED_TEAMMATES.map((mate) => mate.id));
  const [roomDraft, setRoomDraft] = useState(DEFAULT_ROOM);
  const [joined, setJoined] = useState<{ name: string; memberIds: string[] } | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [dmId, setDmId] = useState<string | null>(null);
  const [dmText, setDmText] = useState("");
  const [dmReply, setDmReply] = useState<string | null>(null);
  const [dmError, setDmError] = useState<string | null>(null);
  const [dmPending, setDmPending] = useState(false);
  const [registerId, setRegisterId] = useState("");
  const [registerName, setRegisterName] = useState("");
  const [registerTags, setRegisterTags] = useState("");
  const [registerError, setRegisterError] = useState<string | null>(null);
  const [registerPending, setRegisterPending] = useState(false);

  const registry = useAgent<TeammateRegistry, RegistryState>({
    agent: "TeammateRegistry",
    name: REGISTRY_NAME,
    onOpen: () => setReady(true),
    onClose: () => setReady(false),
    onError: () => setReady(false),
  });

  const teammates = registry.state?.teammates ?? initialRegistryState.teammates;
  const shown = filterTeammates(teammates, query);

  function toggle(id: string) {
    setSelected((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  }

  async function sendDm(event: FormEvent) {
    event.preventDefault();
    if (!dmId || !ready || dmPending) return;
    setDmPending(true);
    setDmError(null);
    setDmReply(null);
    try {
      const result = await registry.stub.dm({ id: dmId, text: dmText });
      if (!result.ok) {
        setDmError(result.error);
        return;
      }
      setDmReply(result.reply);
      setDmText("");
    } catch (caught) {
      setDmError(caught instanceof Error ? caught.message : "私信失败");
    } finally {
      setDmPending(false);
    }
  }

  async function register(event: FormEvent) {
    event.preventDefault();
    if (!ready || registerPending) return;
    setRegisterPending(true);
    setRegisterError(null);
    try {
      const result = await registry.stub.register({
        id: registerId,
        displayName: registerName,
        tags: registerTags,
      });
      if (!result.ok) {
        setRegisterError(result.error);
        return;
      }
      setRegisterId("");
      setRegisterName("");
      setRegisterTags("");
    } catch (caught) {
      setRegisterError(caught instanceof Error ? caught.message : "登记失败");
    } finally {
      setRegisterPending(false);
    }
  }

  return (
    <section className="pane" aria-label="同事">
      <div className="pane-scroll">
        <p className="eyebrow">Peers</p>
        <h2>并列，不是父子。</h2>
        <p className="lede">
          对话页里 Desk 用 <code>agentTool</code> 把 Researcher 嵌进自己的 Think 回合。这一页的 Desk
          只是登记表上的一行：<code>TeammateRegistry</code> 负责发现，房间是频道，
          <code>PeerAgent</code> 按 id 被叫醒。
        </p>
        <p className="lede">
          常驻是 Durable Object 的身份，可以休眠后再按名字唤醒，不是一直占着 CPU。叫醒之后，对方按房间里的对话回答，而不是复述这套结构。这里没有做完整的分身记忆隔离。
        </p>

        <h3>
          同事列表
          <span className="peer-meta">{ready ? "登记表已连接" : "正在连接登记表"}</span>
        </h3>
        <form
          className="stack-form"
          onSubmit={(event) => {
            event.preventDefault();
          }}
        >
          <label>
            查询
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="id、名字或标签，例如 note"
              spellCheck={false}
            />
          </label>
        </form>
        <p className="empty-inline">
          名单来自 TeammateRegistry 的状态。查询和 <code>GET /api/teammates?q=</code> 用同一套匹配。
        </p>
        {shown.length === 0 ? (
          <p className="empty-inline">没有匹配的同事。</p>
        ) : (
          <ul className="entry-list">
            {shown.map((mate) => (
              <li key={mate.id} className={dmId === mate.id ? "picked" : undefined} data-peer-id={mate.id}>
                <div>
                  <strong>
                    {mate.displayName} <code>{mate.id}</code>
                  </strong>
                  <p className="tag-row">
                    {mate.tags.map((tag) => (
                      <span key={tag} className="tag">
                        {tag}
                      </span>
                    ))}
                  </p>
                  <p>{mate.note}</p>
                  <p className="peer-meta">{statusLine(mate)}</p>
                </div>
                <button
                  type="button"
                  className="text-button"
                  disabled={!ready}
                  onClick={() => {
                    setDmId(mate.id);
                    setDmReply(null);
                    setDmError(null);
                  }}
                >
                  私信
                </button>
              </li>
            ))}
          </ul>
        )}

        {dmId ? (
          <form className="stack-form dm-form" onSubmit={(event) => void sendDm(event)}>
            <label>
              私信 {dmId}
              <input
                value={dmText}
                onChange={(event) => setDmText(event.target.value)}
                placeholder="直接按 id 送达，不进房间"
              />
            </label>
            <button type="submit" className="primary" disabled={!ready || dmPending || !dmText.trim()}>
              {dmPending ? "送达中" : "发送私信"}
            </button>
            <p className="empty-inline">私信不进房间，也不走 agentTool。</p>
            {dmError ? (
              <p className="banner error" role="alert">
                {dmError}
              </p>
            ) : null}
            {dmReply ? <p className="banner ok">{dmReply}</p> : null}
          </form>
        ) : null}

        <details className="fold">
          <summary>登记一位同事</summary>
          <form className="stack-form" onSubmit={(event) => void register(event)}>
            <label>
              id
              <input
                value={registerId}
                onChange={(event) => setRegisterId(event.target.value)}
                placeholder="scribe"
                spellCheck={false}
                autoCapitalize="none"
              />
            </label>
            <label>
              显示名
              <input
                value={registerName}
                onChange={(event) => setRegisterName(event.target.value)}
                placeholder="Scribe"
              />
            </label>
            <label>
              标签
              <input
                value={registerTags}
                onChange={(event) => setRegisterTags(event.target.value)}
                placeholder="notes, custom"
                spellCheck={false}
              />
            </label>
            <button type="submit" className="primary" disabled={!ready || registerPending}>
              {registerPending ? "登记中" : "登记"}
            </button>
            {registerError ? (
              <p className="banner error" role="alert">
                {registerError}
              </p>
            ) : null}
            <p className="empty-inline">登记不会自动进房间。勾选后再创建房间。@ 匹配 id 或显示名。</p>
          </form>
        </details>

        <h3>创建房间</h3>
        <form
          className="stack-form"
          onSubmit={(event) => {
            event.preventDefault();
            const name = normalizeSessionName(roomDraft);
            if (!name) {
              setFormError("房间名用小写字母、数字和连字符，例如 lobby。");
              return;
            }
            const memberIds = teammates
              .map((mate) => mate.id)
              .filter((id) => selected.includes(id));
            if (memberIds.length === 0) {
              setFormError("至少勾选一位同事。");
              return;
            }
            setFormError(null);
            setJoined({ name, memberIds });
          }}
        >
          <label>
            房间
            <input
              value={roomDraft}
              onChange={(event) => setRoomDraft(event.target.value)}
              spellCheck={false}
              autoCapitalize="none"
            />
          </label>
          <fieldset className="check-row">
            <legend>成员</legend>
            {teammates.map((mate) => (
              <label key={mate.id} className="check">
                <input
                  type="checkbox"
                  checked={selected.includes(mate.id)}
                  onChange={() => toggle(mate.id)}
                />
                <span>
                  {mate.displayName}
                  <code> @{mate.id}</code>
                </span>
              </label>
            ))}
          </fieldset>
          <button type="submit" className="primary" disabled={!ready || selected.length === 0}>
            创建房间（{selected.filter((id) => teammates.some((mate) => mate.id === id)).length} 人）
          </button>
          {formError ? (
            <p className="banner error" role="alert">
              {formError}
            </p>
          ) : null}
          <p className="empty-inline">
            没有 @ 广播给成员。点下面的 @ 或自己写 <code>@notetaker</code>，就只叫醒被点名的人。
          </p>
        </form>

        {joined ? (
          <RoomSession key={`${joined.name}:${joined.memberIds.join(",")}`} name={joined.name} memberIds={joined.memberIds} teammates={teammates} />
        ) : (
          <p className="empty-inline">还没有创建房间。默认 lobby，三位种子同事都在里面。</p>
        )}
      </div>
    </section>
  );
}

function RoomSession({
  name,
  memberIds,
  teammates,
}: {
  name: string;
  memberIds: string[];
  teammates: Teammate[];
}) {
  const [ready, setReady] = useState(false);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLLIElement>(null);
  const memberKey = memberIds.join(",");

  const room = useAgent<RoomAgent, RoomState>({
    agent: "RoomAgent",
    name,
    onOpen: () => setReady(true),
    onClose: () => setReady(false),
    onError: () => setReady(false),
  });

  const stubRef = useRef(room.stub);
  stubRef.current = room.stub;

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    void stubRef.current
      .open({ memberIds: memberKey.split(",").filter(Boolean) })
      .then((result) => {
        if (cancelled) return;
        if (!result.ok) setError(result.error);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : "创建房间失败");
      });
    return () => {
      cancelled = true;
    };
  }, [ready, memberKey]);

  const state = room.state ?? initialRoomState;
  const names = new Map(teammates.map((mate) => [mate.id, mate.displayName]));
  const mentionIds = state.opened && state.memberIds.length > 0 ? state.memberIds : memberIds;
  const roomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    roomRef.current?.scrollIntoView({ block: "nearest" });
  }, [name]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [state.messages.length]);

  async function send(text: string) {
    const clean = text.trim();
    if (!clean || pending || !ready) return;
    setPending(true);
    setError(null);
    try {
      const result = await room.stub.postMessage({ text: clean, authorId: "you" });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setDraft("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "发送失败");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="room-block" ref={roomRef}>
      <h3>
        房间 {name}
        <span className="peer-meta">{state.opened ? "已进入" : ready ? "正在创建" : "正在连接"}</span>
      </h3>
      {state.messages.length === 0 ? (
        <p className="empty-inline">房间线程还是空的。创建成功后，这里会出现一条说明。</p>
      ) : (
        <ol className="transcript" aria-live="polite">
          {state.messages.map((message) => (
            <li key={message.id} className={`bubble bubble-${bubbleClass(message)}`}>
              <span className="who">{whoLabel(message, names)}</span>
              <p className="text-part">{message.text}</p>
              {message.handoff ? <span className="handoff">{handoffLabel(message)}</span> : null}
              {message.kind === "peer" ? (
                <span className="handoff">并列回复 · 非 agentTool</span>
              ) : null}
            </li>
          ))}
          <li ref={endRef} className="sr-only" />
        </ol>
      )}
      {error ? (
        <p className="banner error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="chip-row">
        {mentionIds.map((id) => (
          <button
            key={id}
            type="button"
            className="chip"
            disabled={!ready || pending || !state.opened}
            onClick={() =>
              setDraft((current) => {
                const prefix = current.length > 0 && !/\s$/u.test(current) ? `${current} ` : current;
                return `${prefix}@${id} `;
              })
            }
          >
            @{id}
          </button>
        ))}
      </div>
      <form
        className="composer sticky"
        onSubmit={(event) => {
          event.preventDefault();
          void send(draft);
        }}
      >
        <textarea
          rows={2}
          value={draft}
          placeholder={state.opened ? "写给房间。@id 只叫醒那一位。" : "等房间打开"}
          disabled={!ready || !state.opened}
          onChange={(event) => setDraft(event.target.value)}
        />
        <div className="composer-actions">
          <span className="peer-meta">{pending ? "正在交接" : "不经过 Think"}</span>
          <button type="submit" className="primary" disabled={!ready || pending || !state.opened || !draft.trim()}>
            发送
          </button>
        </div>
        <div className="chip-row">
          {SUGGESTIONS.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              className="chip"
              disabled={!ready || pending || !state.opened}
              onClick={() => void send(suggestion)}
            >
              {suggestion}
            </button>
          ))}
        </div>
      </form>
    </div>
  );
}

function bubbleClass(message: RoomMessage): string {
  if (message.kind === "human") return "user";
  if (message.kind === "system") return "system";
  return "peer";
}

function whoLabel(message: RoomMessage, names: Map<string, string>): string {
  if (message.authorId === "you") return "你";
  if (message.authorId === "room") return "房间";
  return names.get(message.authorId) ?? message.authorId;
}

function handoffLabel(message: RoomMessage): string {
  const handoff = message.handoff;
  if (!handoff) return "";
  if (handoff.rule === "broadcast") {
    return `广播给 ${handoff.targets.join("、") || "（没有成员）"}`;
  }
  if (handoff.targets.length === 0) return "点名，但没有叫醒任何人";
  return `只叫醒 ${handoff.targets.join("、")}`;
}

function statusLine(mate: Teammate): string {
  const presence = mate.status === "awake" ? "唤醒处理中" : "可休眠";
  if (mate.wakeCount === 0) return `${presence} · 还没被叫醒`;
  const kind = mate.lastKind === "dm" ? "私信" : "房间";
  return `${presence} · 叫醒 ${mate.wakeCount} 次 · 上次${kind} ${formatStamp(mate.lastWakeAt)}`;
}
