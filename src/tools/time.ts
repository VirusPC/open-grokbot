import { tool } from "ai";
import { z } from "zod";

/** Shared by Desk and Researcher so both can answer "what time is it". */
export function createTimeTool() {
  return tool({
    description: "返回当前时间。timezone 为 IANA 时区名，省略时用 UTC。",
    inputSchema: z.object({
      timezone: z
        .string()
        .optional()
        .describe("例如 Asia/Shanghai 或 UTC"),
    }),
    execute: async ({ timezone }) => {
      const zone = timezone?.trim() || "UTC";
      const now = new Date();
      try {
        const formatted = new Intl.DateTimeFormat("zh-CN", {
          timeZone: zone,
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hourCycle: "h23",
        }).format(now);
        return { iso: now.toISOString(), timeZone: zone, formatted };
      } catch {
        return { error: `无法识别时区 ${zone}` };
      }
    },
  });
}
