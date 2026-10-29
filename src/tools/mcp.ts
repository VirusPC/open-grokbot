import type { McpState } from "../agents/state";

type McpHost = {
  env: { MCP_SERVER_URL?: string };
  addMcpServer(
    serverName: string,
    url: string,
    options?: { id?: string },
  ): Promise<unknown>;
};

type McpAttachResult = {
  id?: string;
  state?: string;
  authUrl?: string;
};

/**
 * Opt-in MCP mount. Think merges connected server tools when
 * includeMcpTools is true (the default). No URL means no network call.
 */
export async function attachMcpIfConfigured(agent: McpHost): Promise<McpState> {
  const url = agent.env.MCP_SERVER_URL?.trim();
  if (!url) {
    return {
      attached: false,
      detail:
        "未设置 MCP_SERVER_URL，跳过 addMcpServer。把 Streamable HTTP 地址写进 .dev.vars 后重启，Desk 会在 onStart 里挂上名为 lab-mcp 的服务器。",
    };
  }

  try {
    const result = (await agent.addMcpServer("lab-mcp", url, {
      id: "lab-mcp",
    })) as McpAttachResult;
    if (result.state === "authenticating" && result.authUrl) {
      return {
        attached: true,
        detail: `lab-mcp 正在等待授权：${result.authUrl}`,
      };
    }
    return {
      attached: result.state === "ready",
      detail: `已调用 addMcpServer("lab-mcp")，状态 ${result.state}。后续回合会把该服务器的工具并进模型。`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      attached: false,
      detail: `addMcpServer 失败：${message}`,
    };
  }
}
