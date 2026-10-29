import assert from "node:assert/strict";
import test from "node:test";
import { menuTemplate } from "./menu.js";

const handlers = {
  onReload() {},
  onForceReload() {},
};

function items(template) {
  return template.flatMap((menu) => menu.submenu ?? []);
}

test("macOS menu quits from the app menu and can reload", () => {
  const template = menuTemplate({ platform: "darwin", ...handlers });
  assert.equal(template[0].role, "appMenu");
  const reload = items(template).find((item) => item.label === "重新加载");
  assert.ok(reload);
  assert.equal(reload.accelerator, "CmdOrCtrl+R");
  assert.equal(typeof reload.click, "function");
  assert.ok(items(template).some((item) => item.role === "paste"));
});

test("other platforms expose Quit and Reload", () => {
  for (const platform of ["linux", "win32"]) {
    const template = menuTemplate({ platform, ...handlers });
    assert.ok(items(template).some((item) => item.role === "quit" && item.label === "退出"));
    assert.ok(items(template).some((item) => item.label === "重新加载"));
    assert.ok(items(template).some((item) => item.label === "强制重新加载"));
  }
});
