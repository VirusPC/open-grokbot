import assert from "node:assert/strict";
import test from "node:test";
import { pinRoomScrollTop } from "./room-scroll";

test("pins the thread to the scroller end and pulls back out of the blank region", () => {
  assert.equal(pinRoomScrollTop(0, 100, 200), 0);
  assert.equal(pinRoomScrollTop(0, 800, 200), 600);
  assert.equal(pinRoomScrollTop(600, 800, 200), 600);
  // Enter left the view past the composer. Do not stay there.
  assert.equal(pinRoomScrollTop(900, 800, 200), 600);
});
