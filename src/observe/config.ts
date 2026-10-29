/**
 * Pure Langfuse config. No SDK import: missing keys stay a local no-op,
 * and tests can run without constructing an exporter.
 *
 * The JS SDK reads the same names from the environment
 * (`LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_BASE_URL`,
 * and the legacy `LANGFUSE_BASEURL`). This worker passes the values
 * explicitly from `env`, because Workers secrets live on the binding,
 * not on `process.env`.
 */

export const TRACE_ENVIRONMENT = "open-grokbot";

export type LangfuseEnv = {
  LANGFUSE_PUBLIC_KEY?: string;
  LANGFUSE_SECRET_KEY?: string;
  LANGFUSE_BASE_URL?: string;
  /** Legacy JS SDK alias. Prefer `LANGFUSE_BASE_URL`. */
  LANGFUSE_BASEURL?: string;
};

export type LangfuseCredentials = {
  publicKey: string;
  secretKey: string;
  baseUrl: string;
};

export type TraceLink = {
  traceId: string;
  spanId: string;
};

const OTLP_SUFFIX = "/api/public/otel/v1/traces";

export function readLangfuseCredentials(env: LangfuseEnv): LangfuseCredentials | null {
  const publicKey = clean(env.LANGFUSE_PUBLIC_KEY);
  const secretKey = clean(env.LANGFUSE_SECRET_KEY);
  const baseUrl = normalizeBaseUrl(env.LANGFUSE_BASE_URL ?? env.LANGFUSE_BASEURL);
  if (!publicKey || !secretKey || !baseUrl) return null;
  return { publicKey, secretKey, baseUrl };
}

export function traceTags(fields: {
  mode?: string | null;
  rule?: string | null;
  room?: string | null;
  peerId?: string | null;
}): string[] {
  const tags = [`environment:${TRACE_ENVIRONMENT}`];
  pushTag(tags, "routing.mode", fields.mode);
  pushTag(tags, "handoff.rule", fields.rule);
  pushTag(tags, "room", fields.room);
  pushTag(tags, "peer.id", fields.peerId);
  return tags;
}

export function parseTraceLink(value: unknown): TraceLink | null {
  if (!value || typeof value !== "object") return null;
  const record = value as { traceId?: unknown; spanId?: unknown };
  const traceId = typeof record.traceId === "string" ? record.traceId.toLowerCase() : "";
  const spanId = typeof record.spanId === "string" ? record.spanId.toLowerCase() : "";
  if (!/^[0-9a-f]{32}$/.test(traceId) || !/^[0-9a-f]{16}$/.test(spanId)) return null;
  return { traceId, spanId };
}

const HANDOFF_RULES = new Set(["broadcast", "mentions", "addressed", "leader", "silent"]);

export function parseWakeTrace(value: unknown): {
  parent: TraceLink | null;
  mode?: "teams" | "squad";
  rule?: string;
} {
  if (!value || typeof value !== "object") return { parent: null };
  const record = value as { mode?: unknown; rule?: unknown };
  const mode = record.mode === "teams" || record.mode === "squad" ? record.mode : undefined;
  const rule = typeof record.rule === "string" && HANDOFF_RULES.has(record.rule) ? record.rule : undefined;
  return { parent: parseTraceLink(value), mode, rule };
}

/** Clip chat text before it is copied onto a span. Masks keys and emails. */
export function clipTraceText(value: string, max = 500): string {
  const masked = value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .replace(/\b(?:pk|sk)-lf-[a-z0-9_-]+\b/gi, "[redacted]")
    .replace(/\bsk-[a-zA-Z0-9]{10,}\b/g, "[redacted]");
  const trimmed = masked.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max)}…`;
}

function pushTag(tags: string[], key: string, value: string | null | undefined): void {
  const cleanValue = value?.trim();
  if (!cleanValue) return;
  const tag = `${key}:${cleanValue}`;
  if (tag.length > 200) return;
  tags.push(tag);
}

function clean(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function normalizeBaseUrl(value: string | undefined): string | null {
  const raw = clean(value);
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username || url.password) return null;
  let path = url.pathname.replace(/\/+$/, "");
  if (path.endsWith(OTLP_SUFFIX)) path = path.slice(0, -OTLP_SUFFIX.length);
  return `${url.origin}${path}`;
}
