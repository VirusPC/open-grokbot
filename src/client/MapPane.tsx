import type { SkillCard } from "../agents/state";

const LAYERS = [
  {
    concept: "流式对话",
    where: "Think 跑模型循环，useAgentChat 收 chunk。",
    file: "src/agents/desk.ts · src/client/App.tsx",
  },
  {
    concept: "多 Agent",
    where: "research 工具是 agentTool(ResearcherAgent)，子代理有自己的 Durable Object。",
    file: "src/tools/builtin.ts · src/agents/researcher.ts",
  },
  {
    concept: "Skills",
    where: "skills/*/SKILL.md 经 getSkills() 按需 activate_skill。",
    file: "skills/ · src/skills.ts",
  },
  {
    concept: "Memory",
    where: "configureContext 的 memory 块，外加 memory_write / memory_read。",
    file: "src/memory/ledger.ts",
  },
  {
    concept: "Routines",
    where: "getScheduledTasks 的 heartbeat 每分钟写一次可见状态。",
    file: "src/agents/desk.ts",
  },
  {
    concept: "Tools / MCP",
    where: "get_time 与记忆工具常驻。addMcpServer 只在配置了地址时调用。",
    file: "src/tools/mcp.ts",
  },
  {
    concept: "Channels",
    where: "POST /webhooks/ping 写状态并 submitMessages，不经过浏览器套接字。",
    file: "src/server.ts",
  },
];

export function MapPane({ skills }: { skills: SkillCard[] }) {
  return (
    <section className="pane" aria-label="架构">
      <div className="pane-scroll">
        <p className="eyebrow">Map</p>
        <h2>层，而不是仿品。</h2>
        <p className="lede">
          这张表是教学对照。本仓不实现、也不声称兼容任何专有机器人协议。
        </p>
        <ol className="layer-list">
          {LAYERS.map((layer) => (
            <li key={layer.concept}>
              <h3>{layer.concept}</h3>
              <p>{layer.where}</p>
              <code>{layer.file}</code>
            </li>
          ))}
        </ol>
        <h3>已装载的技能</h3>
        {skills.length === 0 ? (
          <p className="empty-inline">连上 Desk 后，这里列出 getSkills() 读到的目录。</p>
        ) : (
          <ul className="entry-list">
            {skills.map((skill) => (
              <li key={skill.name}>
                <div>
                  <strong>{skill.name}</strong>
                  <p>{skill.description}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
