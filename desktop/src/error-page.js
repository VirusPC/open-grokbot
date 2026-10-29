/**
 * @param {string} value
 */
export function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/**
 * Offline stand-in shown when the configured H5 cannot be loaded.
 * The link points at the shell's start URL so Reload and the anchor
 * both leave this data page.
 *
 * @param {{ url: string, description?: string }} options
 */
export function errorPage({ url, description }) {
  const safeUrl = escapeHtml(url);
  const reason = String(description ?? "").trim() || "网络不可用，或页面没有响应";
  const safeReason = escapeHtml(reason);
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>open-grokbot</title>
  <style>
    :root { color-scheme: dark; }
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      background: #14160f;
      color: #f4f0e4;
      font-family: "Avenir Next", "Segoe UI", sans-serif;
    }
    main { max-width: 34rem; padding: 24px; }
    h1 { font-size: 1.35rem; font-weight: 560; margin: 0 0 12px; }
    p { margin: 0 0 12px; line-height: 1.55; color: #b1ad9a; }
    a { color: #d6f25c; }
  </style>
</head>
<body>
  <main>
    <h1>页面没有打开</h1>
    <p>桌面壳连不上 <a href="${safeUrl}">${safeUrl}</a>。</p>
    <p>${safeReason}</p>
    <p>网络恢复后，点这个地址，或用菜单里的「重新加载」。</p>
  </main>
</body>
</html>`;
}
