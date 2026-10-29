import { getAgentByName } from "agents";
import { REGISTRY_NAME } from "../agents/registry";
import { normalizeTeammateId } from "../agents/peer-types";
import { normalizeSessionName } from "../agents/state";

/**
 * HTTP ingress beside the websocket the H5 uses.
 * List/search/register hit TeammateRegistry. Room open/post and peer DM
 * use the same methods as the buttons, so curl and the page stay in step.
 * None of these routes call agentTool.
 */
export async function handlePeerRoutes(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const parts = url.pathname.split("/").filter(Boolean);

  try {
    if (parts[0] === "api" && parts[1] === "teammates" && parts.length === 2) {
      return await handleTeammates(request, env, url);
    }
    if (parts[0] === "api" && parts[1] === "rooms" && parts[2]) {
      return await handleRoom(request, env, parts[2], parts[3]);
    }
    if (parts[0] === "api" && parts[1] === "peers" && parts[2]) {
      return await handlePeer(request, env, parts[2], parts[3]);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ ok: false, error: message }, { status: 500 });
  }

  return Response.json(
    { ok: false, error: "没有这条同事接口。试 /api/teammates 、 /api/rooms/lobby 或 /api/peers/notetaker 。" },
    { status: 404 },
  );
}

async function handleTeammates(request: Request, env: Env, url: URL): Promise<Response> {
  const registry = await getAgentByName(env.TeammateRegistry, REGISTRY_NAME);
  if (request.method === "GET") {
    const teammates = await registry.search(url.searchParams.get("q") ?? "");
    return Response.json({ ok: true, teammates });
  }
  if (request.method === "POST") {
    const body = await readJson(request);
    if (body === null || !isRecord(body)) {
      return Response.json({ ok: false, error: "请求体不是 JSON" }, { status: 400 });
    }
    const result = await registry.register({
      id: typeof body.id === "string" ? body.id : undefined,
      displayName: typeof body.displayName === "string" ? body.displayName : undefined,
      tags: Array.isArray(body.tags) || typeof body.tags === "string" ? body.tags : [],
    });
    return Response.json(result, { status: result.ok ? 200 : 400 });
  }
  return methodNotAllowed(["GET", "POST"]);
}

async function handleRoom(
  request: Request,
  env: Env,
  rawName: string,
  action: string | undefined,
): Promise<Response> {
  const name = normalizeSessionName(decodeURIComponent(rawName));
  if (!name) {
    return Response.json(
      { ok: false, error: "房间名需匹配 ^[a-z0-9][a-z0-9-]{0,40}$ ，例如 lobby。" },
      { status: 400 },
    );
  }
  const room = await getAgentByName(env.RoomAgent, name);

  if (!action && request.method === "GET") {
    return Response.json({ ok: true, room: await room.view() });
  }
  if (action === "open" && request.method === "POST") {
    const body = await readJson(request);
    if (body === null || !isRecord(body)) {
      return Response.json({ ok: false, error: "请求体不是 JSON" }, { status: 400 });
    }
    const memberIds = Array.isArray(body.memberIds)
      ? body.memberIds.filter((id): id is string => typeof id === "string")
      : undefined;
    const result = await room.open(memberIds ? { memberIds } : {});
    return Response.json(result, { status: result.ok ? 200 : 400 });
  }
  if (action === "messages" && request.method === "POST") {
    const body = await readJson(request);
    if (body === null || !isRecord(body)) {
      return Response.json({ ok: false, error: "请求体不是 JSON" }, { status: 400 });
    }
    const result = await room.postMessage({
      text: typeof body.text === "string" ? body.text : undefined,
      authorId: typeof body.authorId === "string" ? body.authorId : undefined,
    });
    return Response.json(result, { status: result.ok ? 200 : 400 });
  }
  if (!action) return methodNotAllowed(["GET"]);
  return Response.json({ ok: false, error: "房间动作只有 open 和 messages。" }, { status: 404 });
}

async function handlePeer(
  request: Request,
  env: Env,
  rawId: string,
  action: string | undefined,
): Promise<Response> {
  const id = normalizeTeammateId(decodeURIComponent(rawId));
  if (!id) {
    return Response.json({ ok: false, error: "同事 id 不合法。" }, { status: 400 });
  }
  const registry = await getAgentByName(env.TeammateRegistry, REGISTRY_NAME);
  const known = (await registry.list()).some((mate) => mate.id === id);
  if (!known) {
    return Response.json({ ok: false, error: `登记表里没有「${id}」。` }, { status: 404 });
  }

  if (!action && request.method === "GET") {
    const peer = await getAgentByName(env.PeerAgent, id);
    return Response.json({
      ok: true,
      peer: await peer.view(),
      note: "常驻是这个 id 对应的 Durable Object。wakeCount 表示它被按名字叫醒过，不表示 CPU 一直开着。",
    });
  }
  if (action === "dm" && request.method === "POST") {
    const body = await readJson(request);
    if (body === null || !isRecord(body)) {
      return Response.json({ ok: false, error: "请求体不是 JSON" }, { status: 400 });
    }
    const result = await registry.dm({
      id,
      text: typeof body.text === "string" ? body.text : undefined,
    });
    return Response.json(result, { status: result.ok ? 200 : 400 });
  }
  if (!action) return methodNotAllowed(["GET"]);
  return Response.json({ ok: false, error: "同事动作只有 GET 本体和 POST dm。" }, { status: 404 });
}

function methodNotAllowed(allow: string[]): Response {
  return Response.json(
    { ok: false, error: `允许 ${allow.join("、")}` },
    { status: 405, headers: { allow: allow.join(", ") } },
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
