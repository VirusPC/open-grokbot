/**
 * Secrets and optional local overrides. Wrangler generates the binding
 * fields into worker-configuration.d.ts; these merge into the same Env.
 */
declare global {
  interface Env {
    OPENAI_API_KEY?: string;
    OPENAI_MODEL?: string;
    MCP_SERVER_URL?: string;
    /**
     * Langfuse project keys for peer/room traces. All three must be set
     * or tracing is a no-op. Put them with `wrangler secret put` (and
     * `.dev.vars` locally). Do not commit values.
     */
    LANGFUSE_PUBLIC_KEY?: string;
    LANGFUSE_SECRET_KEY?: string;
    LANGFUSE_BASE_URL?: string;
    /** Legacy JS SDK alias of LANGFUSE_BASE_URL. */
    LANGFUSE_BASEURL?: string;
  }
}

export {};
