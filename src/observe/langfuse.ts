/**
 * Langfuse traces for the peer room. Workers-safe on purpose:
 *
 * - `@langfuse/otel` 6.x `LangfuseSpanProcessor` plus `BasicTracerProvider`
 *   from `@opentelemetry/sdk-trace-base`. Not `NodeSDK` / `NodeTracerProvider`:
 *   those pull Node APIs and are the known Workers failure mode.
 * - Wrangler resolves the OTLP HTTP exporter with the `workerd` / `browser`
 *   conditions, so export uses `fetch`, not `node:http`.
 * - `exportMode: "immediate"` plus `flushAt: 1` and `flushInterval: 0`, then
 *   `forceFlush()` inside Durable Object `waitUntil`, so the isolate is not
 *   frozen with a batch still in memory.
 * - `compression: "none"` and `mediaUploadEnabled: false` avoid gzip / media
 *   paths that assume Node.
 *
 * All three of `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, and
 * `LANGFUSE_BASE_URL` must be set. Otherwise every helper returns without
 * loading the SDK and without logging.
 */

import {
  clipTraceText,
  parseTraceLink,
  readLangfuseCredentials,
  TRACE_ENVIRONMENT,
  type LangfuseEnv,
  type TraceLink,
} from "./config";

export type { LangfuseEnv, TraceLink };
export { clipTraceText, parseTraceLink, parseWakeTrace, readLangfuseCredentials, traceTags, TRACE_ENVIRONMENT } from "./config";

export type ObservationLevel = "DEBUG" | "DEFAULT" | "WARNING" | "ERROR";

export type ObservationSpec = {
  name: string;
  asType?: "span" | "agent" | "generation";
  input?: unknown;
  metadata?: Record<string, string | number | boolean | null>;
  tags?: string[];
  /** Trace name. Set on the root span only. */
  traceName?: string;
  sessionId?: string;
  model?: string;
  parent?: TraceLink | null;
  /** True when `parent` was handed across a Durable Object RPC. */
  remoteParent?: boolean;
};

export type ObservationUpdate = {
  output?: unknown;
  metadata?: Record<string, string | number | boolean | null>;
  level?: ObservationLevel;
  statusMessage?: string;
  model?: string;
  usage?: Record<string, number>;
};

export type Observation = {
  readonly link: TraceLink | null;
  annotate(update: ObservationUpdate): void;
  child(spec: ObservationSpec): Observation;
  fail(error: unknown): void;
  end(): void;
};

const NOOP: Observation = {
  link: null,
  annotate() {},
  child() {
    return NOOP;
  },
  fail() {},
  end() {},
};

type MutableSpan = {
  id: string;
  traceId: string;
  end: () => void;
  update: (attributes: {
    output?: unknown;
    metadata?: Record<string, unknown>;
    level?: ObservationLevel;
    statusMessage?: string;
    model?: string;
    usageDetails?: Record<string, number>;
    environment?: string;
    input?: unknown;
  }) => unknown;
  otelSpan: { setAttribute(key: string, value: string | string[]): void };
};

type TracingApi = typeof import("@langfuse/tracing");

let tracing: TracingApi | null = null;
let processor: { forceFlush: () => Promise<void> } | null = null;
let starting: Promise<boolean> | null = null;
let disabled = false;

export async function openObservation(env: LangfuseEnv, spec: ObservationSpec): Promise<Observation> {
  try {
    if (!(await ensureLangfuse(env))) return NOOP;
    return begin(spec);
  } catch (error) {
    logFailure("langfuse.open_error", error);
    return NOOP;
  }
}

export async function flushLangfuse(): Promise<void> {
  if (!processor) return;
  try {
    await processor.forceFlush();
  } catch (error) {
    logFailure("langfuse.flush_error", error);
  }
}

/** Keep the Durable Object alive until the exporter finishes. No-op without a processor. */
export function scheduleLangfuseFlush(ctx: { waitUntil?: (promise: Promise<unknown>) => void } | null | undefined): void {
  if (!processor) return;
  try {
    const pending = flushLangfuse();
    if (ctx && typeof ctx.waitUntil === "function") {
      try {
        ctx.waitUntil(pending);
        return;
      } catch (error) {
        logFailure("langfuse.wait_until_error", error);
      }
    }
    void pending;
  } catch (error) {
    logFailure("langfuse.wait_until_error", error);
  }
}

async function ensureLangfuse(env: LangfuseEnv): Promise<boolean> {
  if (disabled) return false;
  if (processor && tracing) return true;
  if (!readLangfuseCredentials(env)) return false;
  if (!starting) {
    starting = (async () => {
      const credentials = readLangfuseCredentials(env);
      if (!credentials) return false;
      try {
        const [otel, traceBase, traceApi] = await Promise.all([
          import("@langfuse/otel"),
          import("@opentelemetry/sdk-trace-base"),
          import("@langfuse/tracing"),
        ]);
        const spanProcessor = new otel.LangfuseSpanProcessor({
          publicKey: credentials.publicKey,
          secretKey: credentials.secretKey,
          baseUrl: credentials.baseUrl,
          environment: TRACE_ENVIRONMENT,
          exportMode: "immediate",
          flushAt: 1,
          flushInterval: 0,
          compression: "none",
          mediaUploadEnabled: false,
        });
        const provider = new traceBase.BasicTracerProvider({
          sampler: new traceBase.AlwaysOnSampler(),
          spanProcessors: [spanProcessor],
        });
        traceApi.setLangfuseTracerProvider(provider);
        tracing = traceApi;
        processor = spanProcessor;
        return true;
      } catch (error) {
        disabled = true;
        starting = null;
        logFailure("langfuse.init_error", error);
        return false;
      }
    })();
  }
  return starting;
}

function begin(spec: ObservationSpec): Observation {
  if (!tracing) return NOOP;
  try {
    const span = startSpan(tracing, spec);
    applyTraceAttributes(span, spec);
    return new LiveObservation(span);
  } catch (error) {
    logFailure("langfuse.span_error", error);
    return NOOP;
  }
}

function startSpan(api: TracingApi, spec: ObservationSpec): MutableSpan {
  const parent = spec.parent ? parseTraceLink(spec.parent) : null;
  const parentSpanContext = parent
    ? {
        traceId: parent.traceId,
        spanId: parent.spanId,
        traceFlags: 1,
        isRemote: spec.remoteParent === true,
      }
    : undefined;
  const attributes = {
    input: spec.input,
    metadata: spec.metadata,
    environment: TRACE_ENVIRONMENT,
  };
  if (spec.asType === "agent") {
    return api.startObservation(spec.name, attributes, {
      asType: "agent",
      parentSpanContext,
    });
  }
  if (spec.asType === "generation") {
    return api.startObservation(
      spec.name,
      { ...attributes, model: spec.model },
      { asType: "generation", parentSpanContext },
    );
  }
  return api.startObservation(spec.name, attributes, {
    asType: "span",
    parentSpanContext,
  });
}

function applyTraceAttributes(span: MutableSpan, spec: ObservationSpec): void {
  const otel = span.otelSpan;
  otel.setAttribute("langfuse.environment", TRACE_ENVIRONMENT);
  if (spec.traceName) otel.setAttribute("langfuse.trace.name", spec.traceName);
  if (spec.sessionId) otel.setAttribute("session.id", spec.sessionId);
  if (spec.tags && spec.tags.length > 0) otel.setAttribute("langfuse.trace.tags", spec.tags);
}

class LiveObservation implements Observation {
  private ended = false;

  constructor(private readonly span: MutableSpan) {}

  get link(): TraceLink | null {
    return parseTraceLink({ traceId: this.span.traceId, spanId: this.span.id });
  }

  annotate(update: ObservationUpdate): void {
    if (this.ended) return;
    try {
      this.span.update({
        output: update.output,
        metadata: update.metadata,
        level: update.level,
        statusMessage: update.statusMessage,
        model: update.model,
        usageDetails: update.usage,
      });
    } catch (error) {
      logFailure("langfuse.update_error", error);
    }
  }

  child(spec: ObservationSpec): Observation {
    if (this.ended) return NOOP;
    return begin({
      ...spec,
      parent: this.link,
      remoteParent: spec.remoteParent ?? false,
    });
  }

  fail(error: unknown): void {
    const message = errorText(error);
    this.annotate({
      level: "ERROR",
      statusMessage: clipTraceText(message, 200),
      output: { error: clipTraceText(message, 500) },
    });
  }

  end(): void {
    if (this.ended) return;
    this.ended = true;
    try {
      this.span.end();
    } catch (error) {
      logFailure("langfuse.end_error", error);
    }
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function logFailure(event: string, error: unknown): void {
  const detail = errorText(error).replace(/\s+/g, " ").slice(0, 180);
  console.log(JSON.stringify({ event, detail }));
}
