import type { DeskState } from "../agents/state";
import { formatStamp } from "./format";
import { useState, type FormEvent } from "react";

type RoutinePaneProps = {
  name: string;
  state: DeskState;
  ready: boolean;
  onHeartbeat: () => Promise<string | null>;
  onPing: (note: string) => Promise<string | null>;
};

export function RoutinePane({
  name,
  state,
  ready,
  onHeartbeat,
  onPing,
}: RoutinePaneProps) {
  const [note, setNote] = useState("来自 H5 的手动 ping");
  const [pending, setPending] = useState<"beat" | "ping" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [tone, setTone] = useState<"ok" | "error">("ok");

  async function beat() {
    setPending("beat");
    const failure = await onHeartbeat();
    setPending(null);
    setTone(failure ? "error" : "ok");
    setMessage(failure ?? "手动心跳已写入 Desk 状态。");
  }

  async function ping(event: FormEvent) {
    event.preventDefault();
    setPending("ping");
    const failure = await onPing(note);
    setPending(null);
    setTone(failure ? "error" : "ok");
    setMessage(failure ?? "Webhook 已打到这个实例，并提交了一次 programmatic turn。");
  }

  const heartbeat = state.heartbeat;
  const webhook = state.webhook;

  return (
    <section className="pane" aria-label="例程">
      <div className="pane-scroll">
        <p className="eyebrow">Routines</p>
        <h2>心跳与外部事件</h2>
        <p className="lede">
          调度写在 <code>getScheduledTasks()</code>：<code>{heartbeat.schedule}</code>
          。闹钟响时 handler 增加计数。下面的按钮走同一条状态写入，不必干等一分钟。
        </p>

        <article className="stat-card">
          <p className="stat-kicker">heartbeat</p>
          <p className="stat-value">{heartbeat.count}</p>
          <dl>
            <div>
              <dt>最近一次</dt>
              <dd>{formatStamp(heartbeat.lastAt)}</dd>
            </div>
            <div>
              <dt>来源</dt>
              <dd>{heartbeat.lastSource ?? "尚未运行"}</dd>
            </div>
          </dl>
          <p>{heartbeat.note}</p>
          <button
            type="button"
            className="primary"
            disabled={!ready || pending !== null}
            onClick={() => void beat()}
          >
            {pending === "beat" ? "写入中…" : "立即心跳"}
          </button>
        </article>

        <article className="stat-card">
          <p className="stat-kicker">POST /webhooks/ping</p>
          <p className="stat-value">{webhook.count}</p>
          <dl>
            <div>
              <dt>最近一次</dt>
              <dd>{formatStamp(webhook.lastAt)}</dd>
            </div>
            <div>
              <dt>回合</dt>
              <dd>{webhook.lastTurn ?? "尚未收到"}</dd>
            </div>
          </dl>
          <p>{webhook.lastNote ?? "外部事件会记在这个实例上。"}</p>
          {webhook.lastTurnDetail ? <p className="meta">{webhook.lastTurnDetail}</p> : null}
          <form className="stack-form" onSubmit={(event) => void ping(event)}>
            <label>
              附言
              <input value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} />
            </label>
            <button className="primary" type="submit" disabled={!ready || pending !== null}>
              {pending === "ping" ? "发送中…" : `Ping 实例 ${name}`}
            </button>
          </form>
          <pre className="block-view">{`curl -s -X POST http://127.0.0.1:43123/webhooks/ping \\
  -H 'content-type: application/json' \\
  -d '{"name":"${name}","note":"from curl"}'`}</pre>
        </article>

        <article className="stat-card">
          <p className="stat-kicker">MCP</p>
          <p>{state.mcp.attached ? "已挂载" : "未挂载"}</p>
          <p>{state.mcp.detail}</p>
        </article>

        {message ? (
          <p className={`banner ${tone === "error" ? "error" : "ok"}`} role="status">
            {message}
          </p>
        ) : null}
      </div>
    </section>
  );
}
