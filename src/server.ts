import { getAgentByName, routeAgentRequest } from "agents";
import { DeskAgent } from "./agents/desk";
import { ResearcherAgent } from "./agents/researcher";
import { normalizeSessionName, DEFAULT_SESSION } from "./agents/state";

export { DeskAgent, ResearcherAgent };

/**
 * Worker entry. Agent WebSockets go through routeAgentRequest.
 * POST /webhooks/ping is the external-event door: it names a DeskAgent
 * instance and asks that Durable Object to record the ping, then
 * submitMessages() so Think runs a turn without a browser socket.
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return Response.json({
        ok: true,
        agents: ["DeskAgent", "ResearcherAgent"],
      });
    }

    if (url.pathname === "/webhooks/ping") {
      if (request.method !== "POST") {
        return Response.json(
          { ok: false, error: "使用 POST /webhooks/ping" },
          { status: 405, headers: { allow: "POST" } },
        );
      }
      return handlePing(request, env);
    }

    return (
      (await routeAgentRequest(request, env)) ??
      new Response("Not found", { status: 404 })
    );
  },
} satisfies ExportedHandler<Env>;

async function handlePing(request: Request, env: Env): Promise<Response> {
  const payload = await readJson(request);
  if (payload === null) {
    return Response.json({ ok: false, error: "请求体不是 JSON" }, { status: 400 });
  }

  const record = isRecord(payload) ? payload : {};
  const requested = record.name ?? DEFAULT_SESSION;
  const name = normalizeSessionName(requested);
  if (!name) {
    return Response.json(
      {
        ok: false,
        error: "name 需匹配 ^[a-z0-9][a-z0-9-]{0,40}$，默认 lab",
      },
      { status: 400 },
    );
  }

  console.log(
    JSON.stringify({
      event: "webhook.ping",
      instance: name,
      turn: record.turn !== false,
    }),
  );

  const desk = await getAgentByName(env.DeskAgent, name);
  const response = await desk.fetch(
    new Request("https://desk.internal/ping", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        note: typeof record.note === "string" ? record.note : "ping",
        turn: record.turn !== false,
      }),
    }),
  );

  const result = await response.json().catch(() => ({ ok: false }));
  return Response.json(
    { instance: name, ...(isRecord(result) ? result : { ok: false }) },
    { status: response.ok ? 200 : response.status },
  );
}

async function readJson(request: Request): Promise<unknown | null> {
  const text = await request.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
