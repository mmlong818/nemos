// 针对 CodeQL 报出的四处缺陷的回归测试。
//
// 这四条此前被批量标成 false positive。其中 #42（每进程 HMAC 盐）、#35（对密文做完整性
// 校验、口令走 scrypt）、#44（route.href 来自应用自己注入的全局）确实是误报；下面这四条不是。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";

import { textOf } from "../../examples/companion/ui-evidence.js";
import { readServerRouteSurface } from "../fixtures/server-route-surface.js";

const web = join(__dirname, "..", "..", "examples", "companion", "web", "assets");
const readAsset = (name: string) => readFileSync(join(web, name), "utf8");

// —— #43 连接指纹不再对密钥做摘要 ——

test("连接指纹用 connectionRevision，不碰 apiKey", () => {
  const server = readServerRouteSurface();
  const start = server.indexOf("function teamConnectionFingerprint()");
  assert.notEqual(start, -1, "找不到连接指纹函数");
  const fn = server.slice(start, server.indexOf("function hasActiveModelJobs()", start));
  assert.match(fn, /connectionRevision/);
  // 原先是 sha256({provider, protocol, baseUrl, apiKey}) 并落盘进任务 payload——
  // 四个字段里三个公开可知，等于给 apiKey 留了个可离线验证的摘要。
  assert.doesNotMatch(fn, /apiKey/, "指纹不该再包含密钥");
  assert.doesNotMatch(fn, /createHash/, "不该再对密钥做摘要");
});

// —— #38 壁纸地址的 CSS 转义 ——

function applyWallpaper(url: string): string {
  const source = readAsset("scramble-wallpaper.js");
  const fn = source.slice(source.indexOf("function apply("), source.indexOf("function openDatabase("));
  let written = "";
  runInNewContext(fn + "\napply(INPUT);", {
    INPUT: url,
    DEFAULT_WALLPAPER: "/assets/wallpapers/default.svg",
    document: { documentElement: { style: { setProperty: (_k: string, v: string) => { written = v; } } } },
  });
  return written;
}

test("壁纸地址以反斜杠结尾时不能逃出 url()", () => {
  // 只转义引号、不转义反斜杠时，结尾的反斜杠会把闭合引号吃掉，后面的内容就成了 CSS。
  const written = applyWallpaper("/a.svg" + "\\");
  assert.equal(written, 'url("/a.svg' + "\\" + "\\" + '")');
  const payload = written.slice('url("'.length, -2);
  assert.equal(payload.endsWith("\\" + "\\"), true, "结尾反斜杠必须成对，否则闭合引号被转义");
});

test("壁纸地址里的引号仍被转义，控制字符被丢弃", () => {
  assert.equal(applyWallpaper('/a.svg" ); body{x:y}'), 'url("/a.svg' + "\\" + '" ); body{x:y}")');
  assert.equal(applyWallpaper("/a" + "\n" + "\u0007" + ".svg"), 'url("/a.svg")');
  assert.equal(applyWallpaper(""), 'url("/assets/wallpapers/default.svg")');
});

// —— #34 段落过滤不再用嵌套量词 ——

const wordParagraphs = (() => {
  const source = readAsset("office-workbench.js");
  const fn = source.slice(source.indexOf("function wordParagraphs("), source.indexOf("function applyWordAlignment("));
  // VM 里造出来的数组原型属于另一个 realm，deepEqual 会连原型一起比，
  // 所以在边界上就展开成本地数组。
  const inVm = runInNewContext(fn + "\nwordParagraphs;", {}) as (text: string) => string[];
  return (text: string) => [...inVm(text)];
})();

test("空标题段落照旧被过滤，正文照旧保留", () => {
  assert.deepEqual(wordParagraphs("正文一" + "\n\n" + "##" + "\n\n" + "正文二"), ["正文一", "正文二"]);
  assert.deepEqual(wordParagraphs("#" + "\n\n" + " # #  " + "\n\n" + "有内容"), ["有内容"]);
  assert.deepEqual(wordParagraphs("# 真标题" + "\n\n" + "正文"), ["# 真标题", "正文"]);
  assert.deepEqual(wordParagraphs(""), []);
});

test("段落过滤的正则不含嵌套量词", () => {
  // 实测过：旧的 /^(\\s*#\\s*)+$/ 遇到 " # ".repeat(24) + "!" 时超过 199 秒没有返回
  // （每段里的空格既可归上一轮的尾也可归下一轮的头，末尾的 ! 逼它穷举全部切分）。
  // 所以这里不执行那个输入——回归时它会把整个测试进程挂死，而不是快速失败。
  // 断言正则形状即可：线性的字符类替掉了会指数回溯的嵌套量词。
  const source = readAsset("office-workbench.js");
  const fn = source.slice(source.indexOf("function wordParagraphs("), source.indexOf("function applyWordAlignment("));
  // 只看真正做过滤的那一行：函数上方的注释里引用了旧正则，整段搜会命中注释。
  const filterLine = fn.split("\n").find((line) => line.includes(".filter(")) ?? "";
  assert.notEqual(filterLine, "", "找不到段落过滤那一行");
  assert.equal(filterLine.includes("(\\s*#\\s*)+"), false, "不得再出现会指数回溯的嵌套量词");
  assert.equal(filterLine.includes("[#\\s]+"), true, "应当用线性的字符类");
});

// —— #32/#33 剥标签与实体解码 ——

test("实体解码顺序：&amp; 最后解，避免二次解码出真的尖括号", () => {
  // &amp;lt; 的原意是字面量 "&lt;"。若先把 &amp; 解成 &，就会再被解成 <。
  assert.equal(textOf("&amp;lt;script&amp;gt;"), "&lt;script&gt;");
  assert.equal(textOf("a &amp;amp; b"), "a &amp; b");
  assert.equal(textOf("&lt;p&gt; &amp; &quot;x&quot; &#39;y&#39;"), '<p> & "x" ' + "\'" + 'y' + "\'");
});

test("闭合标签带空白也要剥掉，脚本正文不能留在证据里", () => {
  assert.equal(textOf("前<script >alert(1)</script >后"), "前 后");
  assert.equal(textOf("前<style" + "\n" + ">.a{}</style" + "\t" + ">后"), "前 后");
  assert.equal(textOf("前<script>alert(1)</script>后"), "前 后");
  assert.equal(textOf("<p>正文</p>"), "正文");
});
