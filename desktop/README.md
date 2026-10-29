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

`dist:mac` 会设置 `CSC_IDENTITY_AUTO_DISCOVERY=false`，配置里 `mac.identity` 是 `null`，因此不做代码签名，也不做公证。electron-builder 按这台 Mac 的架构打包，产物在 `desktop/release/`：

- Apple 芯片：`mac-arm64/open-grokbot.app`
- Intel：`mac/open-grokbot.app`
- `.dmg`，文件名类似 `open-grokbot-0.1.0.dmg`

未签名应用第一次打开：在访达中右键 `.app`，选择「打开」。若系统仍拒绝，去掉隔离属性后再右键打开（路径按实际架构改）：

```bash
xattr -cr release/mac-arm64/open-grokbot.app
```

## Linux CI 打不出可分发的 Mac 应用

`npm run dist:mac` 在 Linux 上会失败。打包 `.dmg` 要调用 macOS 的 `sips`，签名和公证也只能在 Mac 上做。Linux 上即使先出现一个未签名的 `.app` 目录，命令仍会以失败结束，那个目录不是发布物。要能在 macOS 上打开的 `.app` 和 `.dmg`，在自己的 Mac 上构建。这个壳没有自动更新，也没有菜单栏图标。
