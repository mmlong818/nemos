import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const webRoot = join(process.cwd(), "examples", "companion", "web");

test("聊天、能力、办公文件和工作页共用同一套主导航图标", () => {
  const icons = readFileSync(join(webRoot, "assets", "app-icons.js"), "utf8");
  const pages = ["index.html", "capabilities.html", "office.html", "work.html"]
    .map((file) => readFileSync(join(webRoot, file), "utf8"));
  const scripts = ["capability-center.js", "office-workbench.js", "work-center.js"]
    .map((file) => readFileSync(join(webRoot, "assets", file), "utf8"));

  for (const page of pages) assert.match(page, /\/assets\/app-icons\.js/);
  for (const name of ["message", "boxes", "file", "work", "settings"]) {
    assert.match(icons, new RegExp(`\\b${name}:`));
  }
  assert.match(icons, /stroke-width="2"/);
  assert.match(icons, /role-engineer/);
  assert.match(icons, /role-product/);
  assert.match(pages[3], /aria-label="工作"[^>]+aria-current="page"[^>]+data-app-icon="work"/);
  assert.match(pages[3], /aria-label="设置"[^>]+data-app-icon="settings"/);
  for (const script of scripts) assert.match(script, /window\.ClownfishIcons/);
  assert.doesNotMatch(scripts[2], /const icons\s*=/);
});

test("桌面左侧主导航同时显示图标和中文名称", () => {
  const pages = ["index.html", "capabilities.html", "office.html", "work.html"]
    .map((file) => readFileSync(join(webRoot, file), "utf8"));
  const navigation = readFileSync(join(webRoot, "assets", "app-navigation-labels.css"), "utf8");
  const brandMark = readFileSync(join(webRoot, "assets", "brand", "clownfish-mark.svg"), "utf8");

  for (const page of pages) {
    assert.match(page, /\/assets\/app-navigation-labels\.css/);
  }
  for (const label of ["聊天", "能力", "文件", "工作", "设置"]) {
    assert.match(pages[0], new RegExp(`data-rail-label="${label}"`));
    assert.ok(pages.slice(1).every((page) => page.includes(`<small>${label}</small>`)));
  }
  assert.match(pages[0], /class="rail-label"/);
  assert.match(pages[0], /<nav class="rail-main-nav" aria-label="主导航">/);
  assert.match(navigation, /@media \(min-width: 721px\)/);
  assert.match(navigation, /\.rail nav small,[\s\S]+display: block/);
  assert.match(navigation, /#wechatRail \{\s*width: 76px;\s*flex-basis: 76px;/);
  assert.match(navigation, /#sidebar \{\s*width: 271px;/);
  assert.match(navigation, /\.rail-icon,[\s\S]+width: 60px;/);
  assert.match(navigation, /#wechatRail \.rail-main-nav \{[\s\S]+gap: 2px;/);
  assert.match(navigation, /\.rail nav svg,[\s\S]+width: 22px;[\s\S]+height: 22px;/);
  assert.match(brandMark, /<rect width="64" height="64" rx="15"/);
  assert.doesNotMatch(brandMark, /\sstroke=/);
});

test("角色使用功能徽记，右侧操作始终保留固定槽位", () => {
  const page = readFileSync(join(webRoot, "index.html"), "utf8");
  const experts = readFileSync(join(process.cwd(), "examples", "companion", "experts.ts"), "utf8");

  assert.match(page, /const ROLE_BADGES =/);
  assert.match(page, /className: "role-glyph"/);
  assert.match(page, /grid-template-columns:repeat\(4,32px\)/);
  assert.match(page, /function setTopActionAvailability/);
  assert.match(page, /btn\.classList\.toggle\("is-reserved", !available\)/);
  assert.doesNotMatch(page, /btn\.hidden = !!isApp/);
  assert.doesNotMatch(page, /btn\.hidden = !canCall/);
  for (const name of ["可行性顾问", "产品顾问", "决策顾问", "思考教练"]) {
    assert.match(experts, new RegExp(`name: "${name}"`));
  }
});

test("首次角色对话说明用途，专家配置不再占用全局设置", () => {
  const page = readFileSync(join(webRoot, "index.html"), "utf8");

  for (const roleId of ["clownfish", "feifei", "teacher_lin", "azhe", "lingling"]) {
    assert.match(page, new RegExp(`${roleId}: \\{`));
  }
  assert.match(page, /每轮按当前问题动态邀请专家/);
  assert.match(page, /连续追问同一问题时，优先延续上一轮专家/);
  assert.doesNotMatch(page, /id="sm-persona"/);
  assert.doesNotMatch(page, />专家与角色</);
  assert.match(page, /"角色设置"/);
  assert.match(page, /let onboardingBusy = false/);
  assert.match(page, /dedupeAppOnboarding\(\);\s*renderLog\(\)/);
});
