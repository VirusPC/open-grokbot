import type { MemoryView } from "../agents/state";
import { formatStamp } from "./format";
import { useState, type FormEvent } from "react";

type MemoryPaneProps = {
  memory: MemoryView;
  ready: boolean;
  onRemember: (key: string, value: string) => Promise<string | null>;
  onForget: (key: string) => Promise<string | null>;
};

export function MemoryPane({ memory, ready, onRemember, onForget }: MemoryPaneProps) {
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remember(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const failure = await onRemember(key, value);
    setPending(false);
    if (failure) {
      setError(failure);
      return;
    }
    setKey("");
    setValue("");
  }

  return (
    <section className="pane" aria-label="记忆">
      <div className="pane-scroll">
        <p className="eyebrow">Memory</p>
        <h2>账本与上下文块</h2>
        <p className="lede">
          面板写入走 <code>@callable remember()</code>，不经过模型。对话里说「记住」会走
          <code> memory_write</code>。两者都进 SQLite 账本，再投影到 Think 的 MEMORY 块。
          模型若直接用 <code>set_context</code>，原文会出现在下面的上下文块里。
        </p>

        <form className="stack-form" onSubmit={(event) => void remember(event)}>
          <label>
            标题
            <input
              value={key}
              onChange={(event) => setKey(event.target.value)}
              placeholder="例如 称呼"
              maxLength={48}
              required
            />
          </label>
          <label>
            内容
            <textarea
              value={value}
              onChange={(event) => setValue(event.target.value)}
              placeholder="一句要记住的事实"
              rows={3}
              maxLength={800}
              required
            />
          </label>
          {error ? (
            <p className="banner error" role="alert">
              {error}
            </p>
          ) : null}
          <button className="primary" type="submit" disabled={!ready || pending}>
            {pending ? "写入中…" : "写入账本"}
          </button>
        </form>

        <h3>条目 · {memory.entries.length}</h3>
        {memory.entries.length === 0 ? (
          <p className="empty-inline">还没有账本条目。写一条，或在对话里说「记住」。</p>
        ) : (
          <ul className="entry-list">
            {memory.entries.map((entry) => (
              <li key={entry.key}>
                <div>
                  <strong>{entry.key}</strong>
                  <p>{entry.value}</p>
                  <time dateTime={entry.updatedAt}>{formatStamp(entry.updatedAt)}</time>
                </div>
                <button
                  type="button"
                  className="text-button"
                  disabled={!ready}
                  onClick={() => {
                    setError(null);
                    void onForget(entry.key).then((failure) => {
                      if (failure) setError(failure);
                    });
                  }}
                >
                  忘掉
                </button>
              </li>
            ))}
          </ul>
        )}

        <h3>
          MEMORY 块
          <span className="meta">
            {memory.tokens}/{memory.maxTokens} tokens
          </span>
        </h3>
        <pre className="block-view">{memory.block || "（空）"}</pre>
      </div>
    </section>
  );
}
