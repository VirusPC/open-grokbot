export function formatStamp(iso: string | null): string {
  if (!iso) return "还没有";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const clock = new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    timeZone: "UTC",
  }).format(date);
  return `${clock} UTC`;
}

export function statusLabel(status: string, serverStreaming: boolean): string {
  if (serverStreaming) return "正在回复";
  switch (status) {
    case "ready":
      return "待命";
    case "submitted":
      return "已发送";
    case "streaming":
      return "正在回复";
    case "error":
      return "出错";
    default:
      return status;
  }
}
