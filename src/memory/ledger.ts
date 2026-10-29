import type { MemoryEntry } from "../agents/state";

const KEY_MAX = 48;
const VALUE_MAX = 800;
const ENTRY_CAP = 40;

export class MemoryInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MemoryInputError";
  }
}

type SqlHost = {
  sql<T = Record<string, string | number | boolean | null>>(
    strings: TemplateStringsArray,
    ...values: (string | number | boolean | null)[]
  ): T[];
};

type MemoryRow = {
  key: string;
  value: string;
  updated_at: string;
};

export type MemoryWriteResult =
  | { ok: true; entry: MemoryEntry; entries: MemoryEntry[] }
  | { ok: false; error: string };

export function ensureMemoryTable(host: SqlHost): void {
  host.sql`
    CREATE TABLE IF NOT EXISTS lab_memory (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;
}

export function listMemoryEntries(host: SqlHost): MemoryEntry[] {
  ensureMemoryTable(host);
  const rows = host.sql<MemoryRow>`
    SELECT key, value, updated_at
    FROM lab_memory
    ORDER BY updated_at DESC
  `;
  return rows.map((row) => ({
    key: row.key,
    value: row.value,
    updatedAt: row.updated_at,
  }));
}

export function writeMemoryEntry(
  host: SqlHost,
  key: string,
  value: string,
): MemoryEntry {
  const cleanKey = cleanMemoryKey(key);
  const cleanValue = cleanMemoryValue(value);
  ensureMemoryTable(host);
  const existing = listMemoryEntries(host);
  const updating = existing.some((entry) => entry.key === cleanKey);
  if (!updating && existing.length >= ENTRY_CAP) {
    throw new MemoryInputError(
      `记忆账本已有 ${ENTRY_CAP} 条。先忘掉一条，再写入。`,
    );
  }
  const updatedAt = new Date().toISOString();
  host.sql`
    INSERT INTO lab_memory (key, value, updated_at)
    VALUES (${cleanKey}, ${cleanValue}, ${updatedAt})
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = excluded.updated_at
  `;
  return { key: cleanKey, value: cleanValue, updatedAt };
}

export function deleteMemoryEntry(host: SqlHost, key: string): boolean {
  const cleanKey = cleanMemoryKey(key);
  ensureMemoryTable(host);
  const before = listMemoryEntries(host).length;
  host.sql`DELETE FROM lab_memory WHERE key = ${cleanKey}`;
  return listMemoryEntries(host).length < before;
}

export function renderMemoryBlock(entries: MemoryEntry[]): string {
  if (entries.length === 0) return "";
  return entries.map((entry) => `- ${entry.key}: ${entry.value}`).join("\n");
}

function cleanMemoryKey(key: string): string {
  const clean = key.trim().replace(/\s+/g, " ");
  if (!clean) throw new MemoryInputError("key 不能为空。");
  if (clean.length > KEY_MAX) {
    throw new MemoryInputError(`key 最长 ${KEY_MAX} 个字符。`);
  }
  if (/[\r\n]/.test(clean)) throw new MemoryInputError("key 不能换行。");
  return clean;
}

function cleanMemoryValue(value: string): string {
  const clean = value.trim();
  if (!clean) throw new MemoryInputError("value 不能为空。");
  if (clean.length > VALUE_MAX) {
    throw new MemoryInputError(`value 最长 ${VALUE_MAX} 个字符。`);
  }
  return clean;
}
