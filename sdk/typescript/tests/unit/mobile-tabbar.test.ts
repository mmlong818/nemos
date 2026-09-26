import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";

const web = "examples/companion/web/assets/";

// 手机上原来只有 ☰ 能进别的页面，而聊天页会把 ☰ 连同顶栏一起藏起来：进了聊天就出不去。
test("手机底部标签栏：四个常用页都在导航里存在，另有'更多'打开完整导航；只在窄屏显示", () => {
  const window: { ClownfishProductStructure?: { items: Array<{ key: string; href: string; label: string }>; area: (path: string, search?: string) => string } } = {};
  runInNewContext(readFileSync(web + "product-structure.js", "utf8"), { window, URLSearchParams });
  const product = window.ClownfishProductStructure!;
  const ui = readFileSync(web + "workbench-ui.js", "utf8");
  const keys = JSON.parse(/const TABBAR_KEYS=(\[[^\]]*\])/.exec(ui)![1].replace(/'/g, '"')) as string[];
  assert.deepEqual(keys, ["assistant", "overview", "matters", "tasks"]);
  for (const key of keys) {
    const item = product.items.find((entry) => entry.key === key);
    assert.ok(item, `导航里没有 ${key}`);
    assert.equal(product.area(item.href.split("?")[0], item.href.includes("?") ? item.href.slice(item.href.indexOf("?")) : ""), key, `${key} 的链接要高亮自己`);
    assert.match(ui, new RegExp(`\\b${key}:'<`), `${key} 要有内联图标`);
  }
  assert.match(ui, /more\.onclick=event=>\{event\.stopPropagation\(\);menu\.click\(\);\}/, "'更多'复用 ☰ 的开合");
  const css = readFileSync(web + "workbench-ui.css", "utf8");
  assert.match(css, /^\.wb-tabbar\{display:none\}$/m, "默认不显示");
  const narrow = css.split("\n").find((line) => line.startsWith("@media(max-width:700px){.wb-tabbar{"))!;
  assert.ok(narrow, "窄屏规则存在");
  assert.match(narrow, /body\[data-ui=workbench\]\{padding-bottom:calc\(56px/, "页面底部留出标签栏高度");
  assert.match(narrow, /\.home-shell[^{]*\{height:calc\(100dvh - var\(--wb-tools-height,0px\) - var\(--wb-tabbar-height\)\)/, "聊天页高度扣掉标签栏，输入框不被盖住");
});
