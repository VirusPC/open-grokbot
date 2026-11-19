---
metadata:
  edges-type: task
  edges-updated-at: '2026-11-19T06:26:23.812Z'
  edges-title: 用 GitHub Actions 自动打包并发布 macOS 桌面应用
  edges-tasks-status: backlog
  edges-task-priority: none
name: 用_github_actions_自动打包并发布_macos_桌面应用
description: >-
  在 macOS runner 上自动打包 desktop/ 的 Electron 应用，打 tag 时把 .dmg 发到 GitHub
  Release，不再手动本机打包。
---
**背景：**
2026-11-19 和 Coding Agent 专家聊 open-grokbot 时，问到 Electron 桌面应用会不会自动打包发布。核对后发现不会：`desktop/` 只有本地打包脚本，要在 Mac 上手动跑 `npm run dist:mac`，在 `desktop/release/` 里得到没签名的 `.app` 和 `.dmg`。当时做桌面壳时刻意没做 CI 发布、签名公证和自动更新；在 Linux CI 上打 `.dmg` 会失败，因为要调用 macOS 的 `sips`。于是决定先给本仓初始化 Edges，再记下这张卡。
- 现状：仓库里没有 `.github/workflows/`，没有任何自动打包或发布流程。
- 预期收益：打 tag 就能拿到可下载的 macOS 安装包，不用每次在本机手动打包。
- 非目标：本卡不改 Worker、Think 和 Agent 运行时；签名公证与 `electron-updater` 自动更新可以作为后续，不强求在本卡做完。
- 关联：桌面壳任务卡 [edges-brain-viruspc#406](https://github.com/VirusPC/edges-brain-viruspc/pull/406)。

**目标：**
用 GitHub Actions 在 macOS 机器上自动打包 `desktop/` 的 Electron 应用，并把产物发到 GitHub Release。

**动作：**
- 新增工作流，在 macOS runner 上进入 `desktop/` 安装依赖并执行 `npm run dist:mac`。
- 推送版本 tag 时触发，把 `.dmg`（以及需要的话 `.app` 压缩包）上传到对应的 GitHub Release。

**完成标准：**
- [ ] 仓库里有 `.github/workflows/` 下的打包发布工作流，并已合入 `main`。
- [ ] 推一个测试 tag 后工作流跑通，对应的 GitHub Release 里能下载到 `.dmg`。
- [ ] 在 Mac 上下载这个 `.dmg`，能装上并打开应用（未签名时按 README 说明放行）。
