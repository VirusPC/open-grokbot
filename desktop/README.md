# macOS 桌面壳

一个 Electron 窗口，打开已经在跑的 H5。这里没有 Worker，也没有 Think。

默认加载本机实验桌 [http://127.0.0.1:43123](http://127.0.0.1:43123)。要改地址，设置 `OPEN_GROKBOT_URL`，只接受带 `http:` 或 `https:` 的完整 URL。

窗口标题是 open-grokbot。菜单有「退出」、编辑（复制 / 粘贴）和「重新加载」。页面里的新窗口会交给系统浏览器。壳只跟随启动地址的源，别的 http(s) 链接也在系统浏览器里打开。

## 在 macOS 上运行

需要 Node.js 22 或更新，以及 npm。桌面依赖单独放在这个目录，仓库根的 `npm install` 不会下载 Electron。

```bash
cd desktop
npm install
npm run dev
```

`npm start` 和 `npm run dev` 是同一条命令。窗口默认打开本机实验桌。先在仓库根目录执行 `npm run dev`（端口 43123），再在这个目录执行上面的 `npm run dev`。

要连别的 http(s) 地址，设置 `OPEN_GROKBOT_URL`：

```bash
OPEN_GROKBOT_URL=https://lab.example npm run dev
```

macOS 上关掉窗口不会退出进程。用菜单「退出」，或按 Command+Q。

地址和菜单的单测：`npm test`。

网络不通时，窗口里会留下失败说明。恢复之后用「重新加载」。

Windows 和 Linux 也可以用 `npm run dev` 打开窗口。安装包只做了 macOS。

## 在 Mac 上打出 .app 和 .dmg

必须在 macOS 上执行。在 `desktop/` 目录：

```bash
npm install
npm run dist:mac
```

`dist:mac` 会设置 `CSC_IDENTITY_AUTO_DISCOVERY=false`，配置里 `mac.identity` 是 `null`，并带上 `--publish never`。`build.publish` 也是 `null`。因此不做代码签名，也不做公证，electron-builder 不会自己上传。当前锁定的 electron-builder 26 在 CI 里看到 `GITHUB_TOKEN` 或 tag 时会隐式发布；这里关掉这条路径，发布交给 GitHub Actions。

electron-builder 按这台 Mac 的架构打包，产物在 `desktop/release/`：

- Apple 芯片：`mac-arm64/open-grokbot.app`，以及 `open-grokbot-<版本>-arm64.dmg`
- Intel：`mac/open-grokbot.app`，以及 `open-grokbot-<版本>.dmg`（x64 的默认文件名不带架构后缀）

## 用 GitHub Actions 打包和发布

工作流是 [`.github/workflows/desktop-macos.yml`](../.github/workflows/desktop-macos.yml)。它在 macOS runner（Apple 芯片）上进入 `desktop/`，执行 `npm ci`，再执行 `npm run dist:mac -- --arm64`。没有签名证书，产物未签名。只打 arm64，不打 Intel 或 universal。

发版：

1. 把 `desktop/package.json` 的 `version` 改成要发布的版本，合入 `main`。安装包文件名里的版本号来自这个字段，发版前把它写成和 tag 同一个号。
2. 在包含该版本的 `main` 上打 `v` 开头的 tag 并推送：

```bash
git checkout main
git pull
git tag v0.1.0
git push origin v0.1.0
```

推送 tag 后工作流开始跑。成功后，这个 tag 对应的 GitHub Release 里有 `.dmg`，以及用 `ditto` 打包、保留 `.app` 结构的 zip。tag 上如果已经有 Release，工作流把这两个文件补到同一个 Release。

只打包、不发 Release：仓库 Actions 里选择「Desktop macOS」，用 Run workflow 手动跑。安装包在该次运行的 Artifacts 里。这个入口在工作流进入默认分支 `main` 之后出现。

可分发的 `.dmg` 要调用 macOS 的 `sips`，所以这条工作流跑在 macOS runner 上。在 Linux 上执行 `npm run dist:mac` 会失败，即使中途出现未签名的 `.app` 目录，那个目录也不是发布物。这个壳没有自动更新，也没有菜单栏图标。

## 打开未签名的应用

从 Release 或 Artifacts 下载 `.dmg`，打开后把 open-grokbot 拖进「应用程序」。第一次打开时 macOS 会拦住未签名应用。在访达里对应用按住 Control 再点（或右键），选择「打开」，在对话框里确认打开。

若系统仍拒绝，到「系统设置 → 隐私与安全性」点「仍要打开」。也可以先去掉隔离属性，再按上面的方式打开：

```bash
xattr -cr /Applications/open-grokbot.app
```

本地 `npm run dist:mac` 的 `.app` 同样未签名。Apple 芯片用 `desktop/release/mac-arm64/open-grokbot.app`，Intel 用 `desktop/release/mac/open-grokbot.app`：

```bash
xattr -cr release/mac-arm64/open-grokbot.app
```
