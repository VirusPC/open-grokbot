/** Local lab. Override with OPEN_GROKBOT_URL (any http or https URL). */
export const DEFAULT_URL = "http://127.0.0.1:43123";

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string}
 */
export function resolveStartUrl(env = process.env) {
  const raw = env.OPEN_GROKBOT_URL;
  if (raw == null || String(raw).trim() === "") return DEFAULT_URL;

  const text = String(raw).trim();
  let url;
  try {
    url = new URL(text);
  } catch {
    throw new Error(`OPEN_GROKBOT_URL 不是合法地址：${text}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`OPEN_GROKBOT_URL 只接受 http 或 https：${text}`);
  }
  return url.href;
}

/**
 * @param {string} target
 * @param {string} base
 */
export function isSameOrigin(target, base) {
  try {
    return new URL(target).origin === new URL(base).origin;
  } catch {
    return false;
  }
}

/**
 * @param {string} value
 */
export function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
