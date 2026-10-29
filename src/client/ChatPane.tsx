import {
  getToolCallId,
  getToolInput,
  getToolOutput,
  getToolPartState,
} from "@cloudflare/ai-chat/react";
import type { AgentToolRunState } from "agents";
import type { UIMessage } from "ai";
import { useState } from "react";

type Part = UIMessage["parts"][number];

type ChatPaneProps = {
  messages: UIMessage[];
  status: string;
  errorText: string | null;
  busy: boolean;
  ready: boolean;
  runsByToolCallId: Record<string, AgentToolRunState[]>;
  onSend: (text: string) => void;
  onStop: () => void;
  onClear: () => void;
};

const SUGGESTIONS = [
  "记住：我在用手机读这个实验仓",
  "用研究队友说明 Durable Object 在这里做什么",
  "现在几点？",
];

export function ChatPane({
  messages,
  errorText,
  busy,
  ready,
  runsByToolCallId,
  onSend,
  onStop,
  onClear,
}: ChatPaneProps) {
  const [draft, setDraft] = useState("");

  function send(text: string) {
    const clean = text.trim();
    if (!clean || busy || !ready) return;
    onSend(clean);
    setDraft("");
  }

  return (
    <section className="pane chat-pane" aria-label="对话">
      <div className="pane-scroll">
        {messages.length === 0 ? (
          <div className="empty">
            <p className="eyebrow">Desk</p>
            <h2>从一句短话开始。</h2>
            <p>
              流式回复走 Think。说「记住」会写记忆账本；让研究队友解释概念时，Desk 会调用 ResearcherAgent。
            </p>
            <div className="chips">
              {SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  className="chip"
                  disabled={!ready || busy}
                  onClick={() => send(suggestion)}
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <ol className="transcript">
            {messages.filter(hasVisibleContent).map((message) => (
              <li key={message.id} className={`bubble bubble-${message.role}`}>
                <span className="who">
                  {message.role === "user" ? "你" : "Desk"}
                </span>
                <MessageBody
                  message={message}
                  runsByToolCallId={runsByToolCallId}
                />
              </li>
            ))}
          </ol>
        )}
        {errorText ? (
          <p className="banner error" role="alert">
            {errorText}
          </p>
        ) : null}
      </div>

      <form
        className="composer"
        onSubmit={(event) => {
          event.preventDefault();
          send(draft);
        }}
      >
        <label className="sr-only" htmlFor="draft">
          发给 Desk
        </label>
        <textarea
          id="draft"
          rows={2}
          value={draft}
          placeholder={ready ? "写给 Desk…" : "正在连接 Desk…"}
          disabled={!ready}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              send(draft);
            }
          }}
        />
        <div className="composer-actions">
          <button type="button" className="text-button" onClick={onClear}>
            清空
          </button>
          {busy ? (
            <button type="button" className="primary" onClick={onStop}>
              停止
            </button>
          ) : (
            <button type="submit" className="primary" disabled={!ready || !draft.trim()}>
              发送
            </button>
          )}
        </div>
      </form>
    </section>
  );
}

function hasVisibleContent(message: UIMessage): boolean {
  return message.parts.some((part) => {
    if (part.type === "text") return part.text.trim().length > 0;
    if (part.type === "reasoning") return part.text.trim().length > 0;
    return part.type === "dynamic-tool" || part.type.startsWith("tool-");
  });
}

function MessageBody({
  message,
  runsByToolCallId,
}: {
  message: UIMessage;
  runsByToolCallId: Record<string, AgentToolRunState[]>;
}) {
  return (
    <div className="parts">
      {message.parts.map((part, index) => (
        <PartView
          key={`${message.id}-${index}`}
          part={part}
          runsByToolCallId={runsByToolCallId}
        />
      ))}
    </div>
  );
}

function PartView({
  part,
  runsByToolCallId,
}: {
  part: Part;
  runsByToolCallId: Record<string, AgentToolRunState[]>;
}) {
  if (part.type === "text") {
    return <p className="text-part">{part.text}</p>;
  }
  if (part.type === "reasoning") {
    return (
      <details className="reasoning">
        <summary>推理过程</summary>
        <p>{part.text}</p>
      </details>
    );
  }
  if (!isToolPart(part)) return null;

  const name = toolName(part);
  const callId = safeToolCallId(part);
  const runs = callId ? (runsByToolCallId[callId] ?? []) : [];
  const state = safeToolState(part);

  return (
    <div className={`tool-card${name === "research" ? " tool-research" : ""}`}>
      <header>
        <strong>{name}</strong>
        <span>{state}</span>
      </header>
      <pre>{preview(safeToolInput(part))}</pre>
      {runs.map((run) => (
        <article key={run.runId} className="child-run">
          <header>
            <span>{run.agentType}</span>
            <span>{run.status}</span>
          </header>
          <p>{childText(run) || "研究员还没有吐出正文。"}</p>
        </article>
      ))}
      <pre className="tool-output">{preview(safeToolOutput(part))}</pre>
    </div>
  );
}

function isToolPart(part: Part): boolean {
  return part.type === "dynamic-tool" || part.type.startsWith("tool-");
}

function toolName(part: Part): string {
  if (part.type === "dynamic-tool") return part.toolName;
  if (part.type.startsWith("tool-")) return part.type.slice("tool-".length);
  return part.type;
}

function safeToolCallId(part: Part): string | null {
  try {
    return getToolCallId(part);
  } catch {
    return null;
  }
}

function safeToolState(part: Part): string {
  try {
    return getToolPartState(part);
  } catch {
    return "working";
  }
}

function safeToolInput(part: Part): unknown {
  try {
    return getToolInput(part);
  } catch {
    return undefined;
  }
}

function safeToolOutput(part: Part): unknown {
  try {
    return getToolOutput(part);
  } catch {
    return undefined;
  }
}

function preview(value: unknown): string {
  if (value === undefined) return "";
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return text.length > 700 ? `${text.slice(0, 700)}…` : text;
}

function childText(run: AgentToolRunState): string {
  const chunks = run.parts
    .map((part) => {
      if (part.type === "text" && "text" in part && typeof part.text === "string") {
        return part.text;
      }
      return "";
    })
    .filter(Boolean);
  return chunks.join("") || run.summary || "";
}
