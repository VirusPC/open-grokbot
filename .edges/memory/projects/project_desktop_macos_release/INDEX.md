---
name: project_desktop_macos_release
description: >-
  要给 desktop/ 的 Electron 应用发版、改打包工作流或排查 Release 产物时读：改版本号合入 main 后推 v*
  标签，未签名，--publish never 的原因。
metadata:
  edges-title: macOS 桌面应用发版流程
  edges-type: project
  edges-origin-session-id: ac913463-5bf6-4c16-adc0-900c61a8692d
  edges-agent-client: cursor
  edges-updated-at: '2026-11-19T15:10:30+08:00'
---

macOS 桌面应用靠 GitHub Actions 发版：先把 `desktop/package.json` 的 `version` 改成新版本并合入 `main`，再在这个 `main` 提交上推 `v*` 标签（例如 `git tag v0.1.0 && git push origin v0.1.0`），工作流 `.github/workflows/desktop-macos.yml` 会在 macOS runner 上打包，把 `.dmg` 和 `.app` 压缩包传到这个标签对应的 GitHub Release。只想打包不发版时，在 Actions 里手动运行 Desktop macOS。

**Why:** 在 Linux CI 上打 `.dmg` 会失败（需要 macOS 的 `sips`），所以必须用 macOS runner；安装包文件名取自 `desktop/package.json` 的 `version`，不先改版本号，产物名字会和标签对不上。仓库里没有签名和公证用的密钥，所以包是未签名的。Actions 会注入 `GITHUB_TOKEN`，electron-builder 26 看到它会尝试自己发布，所以 `dist:mac` 固定带 `--publish never`，上传 Release 这一步交给工作流自己用 token 完成。新工作流要先进入 `main`，GitHub 才会显示手动运行的入口；PR 阶段验证时只能推测试标签（`v0.1.0` 发版前用的是 `v0.0.0-desktop-ci-test`，用完连同 Release 一起删掉了）。2026-11-19 由 PR #6 引入，`v0.1.0` 是第一次正式发版。

**How to apply:**
- 发版前确认 `desktop/package.json` 的 `version` 和要推的标签一致，标签打在已合入的 `main` 提交上。
- 不要去掉 `dist:mac` 里的 `--publish never`，也不要让 electron-builder 自己发布。
- 目前只打 arm64；要加 x64 或通用包、签名公证、自动更新时，改工作流并同步更新 `desktop/README.md`。
- 用户第一次打开未签名应用：按住 Control 点应用选「打开」，还被拦就执行 `xattr -cr`，步骤写在 `desktop/README.md`。
