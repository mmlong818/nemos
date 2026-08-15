import assert from "node:assert/strict";
import test from "node:test";

import { presentationBrowserArguments } from "../../examples/companion/presentation-visual-review.js";

test("演示文稿视觉复核使用临时浏览器身份，不读取用户配置", () => {
  const args = presentationBrowserArguments("C:\\Temp\\isolated-profile", "C:\\Temp\\slide.png", "file:///C:/Temp/preview.html");
  assert.ok(args.includes("--user-data-dir=C:\\Temp\\isolated-profile"));
  assert.ok(args.includes("--incognito"));
  assert.ok(args.includes("--disable-sync"));
  assert.ok(args.includes("--disable-extensions"));
  assert.equal(args.at(-1), "file:///C:/Temp/preview.html");
});
