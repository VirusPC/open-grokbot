/**
 * Application menu. macOS Quit lives in the standard app menu.
 * Edit roles stay unlabeled so the OS can localize cut / copy / paste.
 *
 * @param {{
 *   platform: string,
 *   onReload: (item: unknown, win: unknown) => void,
 *   onForceReload: (item: unknown, win: unknown) => void,
 * }} options
 */
export function menuTemplate({ platform, onReload, onForceReload }) {
  const editMenu = {
    label: "编辑",
    submenu: [
      { role: "undo" },
      { role: "redo" },
      { type: "separator" },
      { role: "cut" },
      { role: "copy" },
      { role: "paste" },
      { role: "selectAll" },
    ],
  };
  const viewMenu = {
    label: "视图",
    submenu: [
      {
        label: "重新加载",
        accelerator: "CmdOrCtrl+R",
        click: onReload,
      },
      {
        label: "强制重新加载",
        accelerator: "CmdOrCtrl+Shift+R",
        click: onForceReload,
      },
    ],
  };

  if (platform === "darwin") {
    return [{ role: "appMenu" }, editMenu, viewMenu];
  }

  return [
    {
      label: "文件",
      submenu: [{ role: "quit", label: "退出" }],
    },
    editMenu,
    viewMenu,
  ];
}
