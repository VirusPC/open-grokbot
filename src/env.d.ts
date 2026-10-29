/**
 * Secrets and optional local overrides. Wrangler generates the binding
 * fields into worker-configuration.d.ts; these merge into the same Env.
 */
declare global {
  interface Env {
    OPENAI_API_KEY?: string;
    OPENAI_MODEL?: string;
    MCP_SERVER_URL?: string;
  }
}

export {};
