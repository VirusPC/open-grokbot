import { app, BrowserWindow, Menu, nativeTheme, shell } from "electron";
import { errorPage } from "./error-page.js";
import { menuTemplate } from "./menu.js";
import { isHttpUrl, isSameOrigin, resolveStartUrl } from "./url.js";

nativeTheme.themeSource = "dark";
app.setName("open-grokbot");

const errorLock = new WeakMap();

let startUrl;
try {
  startUrl = resolveStartUrl();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  app.exit(1);
}

if (startUrl) {
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    app.quit();
  } else {
    app.on("second-instance", () => {
      const win = BrowserWindow.getAllWindows()[0];
      if (!win) return;
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    });

    app.whenReady()
      .then(() => {
        Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate({
          platform: process.platform,
          onReload: (_item, win) => reload(win, false),
          onForceReload: (_item, win) => reload(win, true),
        })));
        createWindow();
        app.on("activate", () => {
          if (BrowserWindow.getAllWindows().length === 0) createWindow();
        });
      })
      .catch((error) => {
        console.error(error instanceof Error ? error.message : error);
        app.exit(1);
      });

    app.on("window-all-closed", () => {
      if (process.platform !== "darwin") app.quit();
    });
  }
}

/**
 * @param {import("electron").BrowserWindow | undefined | null} win
 * @param {boolean} ignoreCache
 */
function reload(win, ignoreCache) {
  const target = win && !win.isDestroyed() ? win : BrowserWindow.getAllWindows()[0];
  if (!target || !startUrl) return;
  const current = target.webContents.getURL();
  if (isSameOrigin(current, startUrl)) {
    if (ignoreCache) target.webContents.reloadIgnoringCache();
    else target.webContents.reload();
    return;
  }
  loadApp(target);
}

/** @param {import("electron").BrowserWindow} win */
function loadApp(win) {
  errorLock.set(win, false);
  // did-fail-load renders the fallback. Swallow the rejection so a down
  // network does not surface as an unhandled promise.
  void win.loadURL(startUrl).catch(() => {});
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1120,
    height: 800,
    minWidth: 390,
    minHeight: 640,
    title: "open-grokbot",
    backgroundColor: "#14160f",
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.once("ready-to-show", () => {
    if (!win.isDestroyed()) win.show();
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isHttpUrl(url)) void shell.openExternal(url);
    return { action: "deny" };
  });

  // In-page navigations stay on the configured origin. loadURL from here
  // does not emit will-navigate, so the error page can still be shown.
  win.webContents.on("will-navigate", (event, url) => {
    if (!startUrl || isSameOrigin(url, startUrl)) return;
    event.preventDefault();
    if (isHttpUrl(url)) void shell.openExternal(url);
  });

  win.webContents.on("did-finish-load", () => {
    const current = win.webContents.getURL();
    if (current.startsWith("data:")) {
      console.log("[open-grokbot] loaded error page");
      return;
    }
    // A failed navigation can still emit did-finish-load for the error document.
    if (errorLock.get(win)) return;
    console.log(`[open-grokbot] loaded ${current}`);
  });

  win.webContents.on(
    "did-fail-load",
    (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame || errorCode === -3 || !startUrl) return;
      if (String(validatedURL).startsWith("data:")) return;
      if (errorLock.get(win)) return;
      errorLock.set(win, true);
      console.error(
        `[open-grokbot] ${errorDescription || "load failed"} (${errorCode}) ${validatedURL}`,
      );
      if (!win.isVisible()) win.show();
      const detail = validatedURL && !isSameOrigin(validatedURL, startUrl)
        ? `${errorDescription}（${validatedURL}）`
        : errorDescription;
      void win.loadURL(errorPageUrl(startUrl, detail)).catch(() => {});
    },
  );

  console.log(`[open-grokbot] ${startUrl}`);
  loadApp(win);
}

/**
 * @param {string} url
 * @param {string} [description]
 */
function errorPageUrl(url, description) {
  const html = errorPage({ url, description });
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}
