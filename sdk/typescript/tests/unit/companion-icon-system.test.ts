import { readAppHtml } from "../fixtures/render-app-page.js";
import {
  navigationIconNames,
  navigationIconPath,
  renderNavigationIcon,
} from "../../examples/companion/navigation-icons.js";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const webRoot = join(process.cwd(), "examples", "companion", "web");

function pngDimensions(image: Buffer): { width: number; height: number; colorType: number } {
  assert.equal(image.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  return {
    width: image.readUInt32BE(16),
    height: image.readUInt32BE(20),
    colorType: image.readUInt8(25),
  };
}

test("聊天、能力、办公文件和工作页共用同一套主导航图标", () => {
  const icons = readFileSync(join(webRoot, "assets", "app-icons.js"), "utf8");
  const pages = ["index.html", "capabilities.html", "office.html", "work.html"]
    .map((file) => readAppHtml(file));
  const scripts = ["capability-center.js", "office-workbench.js", "work-center.js"]
    .map((file) => readFileSync(join(webRoot, "assets", file), "utf8"));

  for (const page of pages) assert.match(page, /\/assets\/app-icons\.js/);
  for (const name of ["message", "boxes", "file", "work", "settings"]) {
    assert.match(icons, new RegExp(`\\b${name}:`));
  }
  assert.match(icons, /stroke-width="2"/);
  assert.doesNotMatch(icons, /hydrateDevelopmentUpdateBadge|\/api\/development\/engine-updates|rail-update-badge/);
  assert.match(icons, /role-engineer/);
  assert.match(icons, /role-product/);
  assert.match(pages[3], /data-wb-path="\/automations"[^>]+aria-current="page"/);
  assert.match(pages[3], /id="settingsbtn"[^>]+data-wb-path="\/settings"/);
  for (const script of scripts) assert.match(script, /window\.ClownfishIcons/);
  assert.doesNotMatch(scripts[2], /const icons\s*=/);
});

test("桌面左侧主导航同时显示图标和中文名称", () => {
  const pages = ["index.html", "capabilities.html", "office.html", "work.html"]
    .map((file) => readAppHtml(file));
  const navigation = readFileSync(join(webRoot, "assets", "app-navigation-labels.css"), "utf8");
  const brandMark = readFileSync(join(webRoot, "assets", "brand", "clownfish-mark.png"));
  const faviconPages = ["bots.html", "capabilities.html", "index.html", "matters.html", "office.html", "overview.html", "settings.html", "work.html"]
    .map((file) => readAppHtml(file));

  for (const page of pages) {
    assert.match(page, /\/assets\/app-navigation-labels\.css/);
  }
  for (const label of ["总览", "助理", "任务", "文件", "记忆", "技能库", "自动化", "工具与连接", "设置"]) {
    assert.ok(pages.every((page) => page.includes(`</span>${label}</a>`)));
  }
  assert.match(pages[0], /class="rail-label"/);
  assert.match(pages[0], /<aside class="rail app-nav" aria-label="主导航" id="wbNavigation" data-product-navigation="true">/);
  assert.match(navigation, /@media \(min-width: 721px\)/);
  assert.match(navigation, /\.rail nav small,[\s\S]+display: block/);
  assert.match(navigation, /--app-rail-reserved: calc\(var\(--app-rail-left\) \+ var\(--app-rail-shell\) \+ 14px\)/);
  assert.match(navigation, /#sessionPane \{[\s\S]+width: 252px/);
  assert.match(navigation, /--app-nav-width: 60px/);
  assert.match(navigation, /--app-nav-gap: 4px/);
  assert.match(navigation, /--app-icon-size: 20px/);
  assert.ok(faviconPages.every((page) => page.includes('<link rel="icon" href="/assets/brand/clownfish-mark.png"')));
  assert.ok(pages.every((page) => page.includes('/assets/brand/clownfish-mark.png')));
  assert.deepEqual(pngDimensions(brandMark), { width: 512, height: 512, colorType: 6 });
});

test("图标生成器只接受透明方形 PNG 并产出 Web、客户端 PNG 与多尺寸 ICO", () => {
  const clientRoot = join(process.cwd(), "examples", "companion", "client");
  const iconGenerator = readFileSync(join(clientRoot, "Update-Clownfish-Icons.ps1"), "utf8");
  const clientPng = readFileSync(join(clientRoot, "assets", "clownfish-icon.png"));
  const clientIco = readFileSync(join(clientRoot, "assets", "clownfish.ico"));

  assert.match(iconGenerator, /GetExtension\(\$source\) -ne "\.png"/);
  assert.match(iconGenerator, /\$parts\[0\] -ne "PNG"/);
  assert.match(iconGenerator, /\$width -ne \$height/);
  assert.match(iconGenerator, /必须包含实际透明像素/);
  assert.match(iconGenerator, /clownfish-mark\.png/);
  assert.match(iconGenerator, /clownfish-icon\.png/);
  assert.match(iconGenerator, /clownfish\.ico/);
  assert.match(iconGenerator, /\@\(16, 24, 32, 48, 64, 128, 256\)/);
  assert.match(iconGenerator, /Assert-TransparentPng/);
  assert.match(iconGenerator, /Assert-MultiSizeIco/);
  assert.match(iconGenerator, /\.backup/);

  assert.deepEqual(pngDimensions(clientPng), { width: 256, height: 256, colorType: 6 });
  assert.equal(clientIco.readUInt16LE(0), 0);
  assert.equal(clientIco.readUInt16LE(2), 1);
  const frameCount = clientIco.readUInt16LE(4);
  const frameSizes = Array.from({ length: frameCount }, (_, index) => {
    const encodedWidth = clientIco.readUInt8(6 + index * 16);
    return encodedWidth === 0 ? 256 : encodedWidth;
  }).sort((a, b) => a - b);
  assert.deepEqual(frameSizes, [16, 24, 32, 48, 64, 128, 256]);
});

test("角色使用功能徽记，右上角只保留对话操作", () => {
  const page = readAppHtml("index.html");
  const experts = readFileSync(join(process.cwd(), "examples", "companion", "experts.ts"), "utf8");

  assert.match(page, /const ROLE_BADGES =/);
  assert.match(page, /className: "role-glyph"/);
  assert.doesNotMatch(page, /id="callbtn"/);
  assert.doesNotMatch(page, /id="callbar"/);
  assert.doesNotMatch(page, /id="topMore"/);
  for (const name of ["可行性顾问", "产品顾问", "决策顾问", "思考教练"]) {
    assert.match(experts, new RegExp(`name: "${name}"`));
  }
});

test("后台角色能力保留，专家配置不再占用主界面", () => {
  const page = readAppHtml("index.html");

  for (const roleId of ["clownfish", "feifei", "teacher_lin", "azhe", "lingling"]) {
    assert.match(page, new RegExp(`${roleId}: \\{`));
  }
  assert.match(page, /功能型专家；他们不会默认占据你的首页/);
  assert.doesNotMatch(page, /starter-prompts|starter-help-close|clownfishStarterHelpClosed/);
  assert.doesNotMatch(page, /id="sm-persona"/);
  assert.doesNotMatch(page, />专家与角色</);
  assert.match(page, /let onboardingBusy = false/);
  assert.match(page, /dedupeAppOnboarding\(\);\s*renderLog\(\)/);
});

test("新对话直接创建并在空白页选择工作方式", () => {
  const page = readAppHtml("index.html");

  assert.match(page, /id="quickGroup"[^>]*>[\s\S]*新对话/);
  assert.match(page, /<a class="brand wb-brand" href="\/overview"/);
  assert.match(page, /id="sidebarSearchToggle"[^>]*aria-expanded="false"/);
  assert.match(page, /id="sidebarSearchToggle"[\s\S]*id="quickGroup"/);
  assert.match(page, /id="conversationSearchDialog"[^>]*aria-labelledby="conversationSearchTitle"/);
  assert.match(page, /AppSearchOverlay\.bind\(\{[\s\S]*dialog: "#conversationSearchDialog"/);
  assert.match(page, /data-work-mode=/);
  assert.match(page, /Object\.entries\(WORK_MODES\)[\s\S]*aria-pressed/);
  assert.match(page, /chat: \{ label: "直接聊聊"/);
  assert.match(page, /task: \{ label: "完成任务"/);
  assert.match(page, /study: \{ label: "学习辅导"/);
  assert.match(page, /quickGroup"\)\.onclick = \(\) => createConversation\("chat"\)/);
  assert.match(page, /function autoNameConversation\(key, conversationId, text\)/);
  assert.match(page, /api\("\/api\/conversation\/title", \{ text \}\)/);
  assert.match(page, /shouldAutoName[\s\S]*autoNameConversation/);
  assert.doesNotMatch(page, /id="newconversationmodal"/);
  assert.doesNotMatch(page, /data-conversation-mode=/);
  assert.match(page, /mode === "study"[\s\S]*id: "teacher_lin", anonymous: true/);
  assert.match(page, /mode === "task"[\s\S]*id: ADVISORY_GROUP_ID, anonymous: true/);
  assert.match(page, /showContributors: false/);
  assert.doesNotMatch(page, /data-work-mode[\s\S]{0,400}林老师/);
});

test("对话没有主对话特例并支持确认删除", () => {
  const page = readAppHtml("index.html");

  assert.doesNotMatch(page, /title: "主对话"/);
  assert.match(page, /function makeConversationNode/);
  assert.match(page, /class="contact-delete"/);
  assert.match(page, /function deleteConversation\(id\)/);
  assert.match(page, /不会删除长期记忆或已经生成的文件/);
  assert.match(page, /if \(!remaining\.length\)[\s\S]*makeConversationNode\(\)/);
});

test("左栏图标全部来自图标系统，不用 Unicode 字符，且与浏览器那套逐字节一致", () => {
  const pages = ["index.html", "capabilities.html", "office.html", "work.html", "overview.html"]
    .map((file) => readAppHtml(file));
  const icons = readFileSync(join(webRoot, "assets", "app-icons.js"), "utf8");

  // 曾经用过的几何字符与占位点：它们来自三个不同形状家族，⌘ 还是 Mac 的 Command 键，
  // 而界面字体栈根本不含这些字符，每个都由未声明的回退字体供给，粗细与基线各不相同。
  for (const page of pages) {
    for (const glyph of ["◫", "◌", "◉", "▦", "▧", "▤", "◇", "⌘", "⚙"]) {
      assert.ok(!page.includes(glyph), `导航里不应再出现 ${glyph}`);
    }
    assert.ok(!page.includes('aria-hidden="true">·<'), "占位点不是图标");
    // 每个导航项的图标都必须是图标系统直出的内联 SVG，服务端渲染，不依赖页面脚本。
    assert.ok(!/<span aria-hidden="true">(?!<svg class="app-icon")/.test(page),
      "导航图标必须是 app-icon 内联 SVG");
  }

  // 服务端那份与浏览器那份同名图标的路径数据必须完全相同，否则同一个名字会画出两个样子。
  for (const name of navigationIconNames()) {
    const key = name.includes("-") ? `"${name}"` : name;
    const match = new RegExp(`${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}: '((?:[^'\\\\]|\\\\.)*)'`).exec(icons);
    assert.ok(match, `app-icons.js 缺少导航图标 ${name}`);
    assert.equal(navigationIconPath(name), match![1], `${name} 的路径数据两处不一致`);
  }

  // 未登记的名字必须报错，不能静默兜底成通用图形：那会让写错的入口"看起来有图标"。
  assert.throws(() => renderNavigationIcon("not-registered" as never), /未登记的导航图标/);

  const rendered = renderNavigationIcon("settings");
  assert.match(rendered, /viewBox="0 0 24 24"/);
  assert.match(rendered, /stroke-width="2"/);
  assert.match(rendered, /aria-hidden="true"/);
  assert.match(rendered, /width="18" height="18"/);
});
