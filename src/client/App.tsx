import { useAgentChat } from "@cloudflare/ai-chat/react";
import { useAgent, useAgentToolEvents } from "agents/react";
import { useEffect, useState } from "react";
import type { DeskAgent } from "../agents/desk";
import {
  DEFAULT_SESSION,
  initialDeskState,
  normalizeSessionName,
  type DeskState,
} from "../agents/state";
import { ChatPane } from "./ChatPane";
import { formatStamp, statusLabel } from "./format";
import { MapPane } from "./MapPane";
import { MemoryPane } from "./MemoryPane";
import { PeersPane } from "./PeersPane";
import { RoutinePane } from "./RoutinePane";

type PaneId = "chat" | "memory" | "routine" | "peers" | "map";

const PANES: Array<{ id: PaneId; label: string }> = [
  { id: "chat", label: "对话" },
  { id: "memory", label: "记忆" },
  { id: "routine", label: "例程" },
  { id: "peers", label: "同事" },
  { id: "map", label: "架构" },
];

const SESSION_KEY = "open-grokbot-session";

export function App() {
  const [sessionName, setSessionName] = useState(readStoredSession);
  return (
    <DeskSession
      key={sessionName}
      name={sessionName}
      onRename={(next) => {
        localStorage.setItem(SESSION_KEY, next);
        setSessionName(next);
      }}
    />
  );
}

function DeskSession({
  name,
  onRename,
}: {
  name: string;
  onRename: (next: string) => void;
}) {
  const [pane, setPane] = useState<PaneId>("chat");
  const [ready, setReady] = useState(false);
  const [draftName, setDraftName] = useState(name);
  const [renameError, setRenameError] = useState<string | null>(null);

  const agent = useAgent<DeskAgent, DeskState>({
    agent: "DeskAgent",
    name,
    onOpen: () => setReady(true),
    onClose: () => setReady(false),
    onError: () => setReady(false),
  });

  const {
    messages,
    sendMessage,
    status,
    error,
    stop,
    clearHistory,
    isStreaming,
    isServerStreaming,
  } = useAgentChat({
    agent,
    syncMessagesToServer: false,
  });

  const agentTools = useAgentToolEvents({ agent });
  const state = agent.state ?? initialDeskState;
  const childRuns = Object.values(agentTools.runsById);
  const researcherLive = childRuns.some((run) => run.status === "running");
  const busy = status === "submitted" || status === "streaming" || isStreaming || isServerStreaming;

  useEffect(() => {
    setDraftName(name);
  }, [name]);

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <span className="mark" aria-hidden="true" />
          <div>
            <p className="wordmark">open-grokbot</p>
            <p className="tagline">架构实验桌</p>
          </div>
        </div>
        <div className="top-meta">
          <span className={`dot${ready ? " on" : ""}`} />
          <span>{ready ? "Desk 已连接" : "正在连接"}</span>
          <span className="sep">·</span>
          <span>{statusLabel(status, isServerStreaming)}</span>
        </div>
      </header>

      <div className="context-strip">
        <div>
          <span className="kicker">当前 Agent</span>
          <strong>DeskAgent</strong>
          <em>{state.model.provider === "openai" ? "OpenAI" : "Workers AI"} · {state.model.id}</em>
        </div>
        <div className={researcherLive ? "live" : ""}>
          <span className="kicker">委派</span>
          <strong>{researcherLive ? "Researcher 进行中" : "Researcher 空闲"}</strong>
          <em>
            {childRuns.length === 0
              ? "还没有子运行"
              : `${childRuns.length} 次子运行`}
          </em>
        </div>
        <form
          className="session-form"
          onSubmit={(event) => {
            event.preventDefault();
            const next = normalizeSessionName(draftName);
            if (!next) {
              setRenameError("用小写字母、数字和连字符，例如 lab 或 phone-1。");
              return;
            }
            setRenameError(null);
            if (next !== name) onRename(next);
          }}
        >
          <label>
            实例
            <input
              value={draftName}
              onChange={(event) => setDraftName(event.target.value)}
              spellCheck={false}
              autoCapitalize="none"
            />
          </label>
          <button type="submit" className="text-button">
            切换
          </button>
        </form>
      </div>
      {renameError ? (
        <p className="banner error slim" role="alert">
          {renameError}
        </p>
      ) : null}
      {agent.connectionError ? (
        <p className="banner error slim" role="alert">
          连接中断：{agent.connectionError.message || "WebSocket 已关闭"}
        </p>
      ) : null}

      <main>
        {pane === "chat" ? (
          <ChatPane
            messages={messages}
            status={status}
            errorText={error?.message ?? null}
            busy={busy}
            ready={ready}
            runsByToolCallId={agentTools.runsByToolCallId}
            onSend={(text) => {
              void sendMessage({ text });
            }}
            onStop={() => stop()}
            onClear={() => clearHistory()}
          />
        ) : null}
        {pane === "memory" ? (
          <MemoryPane
            memory={state.memory}
            ready={ready}
            onRemember={async (key, value) => {
              try {
                const result = await agent.stub.remember({ key, value });
                return result.ok ? null : result.error;
              } catch (caught) {
                return caught instanceof Error ? caught.message : "写入失败";
              }
            }}
            onForget={async (key) => {
              try {
                const result = await agent.stub.forget(key);
                return result.ok ? null : result.error;
              } catch (caught) {
                return caught instanceof Error ? caught.message : "删除失败";
              }
            }}
          />
        ) : null}
        {pane === "routine" ? (
          <RoutinePane
            name={name}
            state={state}
            ready={ready}
            onHeartbeat={async () => {
              try {
                await agent.stub.runHeartbeat();
                return null;
              } catch (caught) {
                return caught instanceof Error ? caught.message : "心跳失败";
              }
            }}
            onPing={async (note) => {
              try {
                const response = await fetch("/webhooks/ping", {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({ name, note, turn: true }),
                });
                if (!response.ok) {
                  const body = (await response.json().catch(() => null)) as {
                    error?: string;
                  } | null;
                  return body?.error ?? `Webhook 返回 ${response.status}`;
                }
                return null;
              } catch (caught) {
                return caught instanceof Error ? caught.message : "Webhook 失败";
              }
            }}
          />
        ) : null}
        {pane === "peers" ? <PeersPane /> : null}
        {pane === "map" ? <MapPane skills={state.skills} /> : null}
      </main>

      <nav className="tabbar" aria-label="面板">
        {PANES.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-current={pane === item.id ? "page" : undefined}
            onClick={() => setPane(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>
      <p className="footnote">
        实例 <code>{name}</code>
        {state.heartbeat.lastAt
          ? ` · 心跳 ${formatStamp(state.heartbeat.lastAt)}`
          : " · 心跳尚未跑过"}
      </p>
    </div>
  );
}

function readStoredSession(): string {
  try {
    return normalizeSessionName(localStorage.getItem(SESSION_KEY)) ?? DEFAULT_SESSION;
  } catch {
    return DEFAULT_SESSION;
  }
}
