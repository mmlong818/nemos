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
  for (const label of ["任务", "能力", "文件", "工作", "设置"]) {
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

test("角色使用功能徽记，右上角只保留对话操作", () => {
  const page = readFileSync(join(webRoot, "index.html"), "utf8");
  const experts = readFileSync(join(process.cwd(), "examples", "companion", "experts.ts"), "utf8");

  assert.match(page, /const ROLE_BADGES =/);
  assert.match(page, /className: "role-glyph"/);
  assert.match(page, /grid-template-columns:repeat\(2,32px\)/);
  assert.doesNotMatch(page, /id="callbtn"/);
  assert.doesNotMatch(page, /id="callbar"/);
  assert.doesNotMatch(page, /id="topMore"/);
  for (const name of ["可行性顾问", "产品顾问", "决策顾问", "思考教练"]) {
    assert.match(experts, new RegExp(`name: "${name}"`));
  }
});

test("后台角色能力保留，专家配置不再占用主界面", () => {
  const page = readFileSync(join(webRoot, "index.html"), "utf8");

  for (const roleId of ["clownfish", "feifei", "teacher_lin", "azhe", "lingling"]) {
    assert.match(page, new RegExp(`${roleId}: \\{`));
  }
  assert.match(page, /专业判断与能力会在后台按需加入/);
  assert.match(page, /不用先选专家/);
  assert.doesNotMatch(page, /id="sm-persona"/);
  assert.doesNotMatch(page, />专家与角色</);
  assert.match(page, /let onboardingBusy = false/);
  assert.match(page, /dedupeAppOnboarding\(\);\s*renderLog\(\)/);
});

test("新对话直接创建并在空白页选择工作方式", () => {
  const page = readFileSync(join(webRoot, "index.html"), "utf8");

  assert.match(page, /id="quickGroup"[^>]*>[\s\S]*新对话/);
  assert.match(page, /class="rail-brand-label">小丑鱼</);
  assert.match(page, /id="sidebarSearchToggle"[^>]*aria-expanded="false"/);
  assert.match(page, /function setConversationSearchOpen\(open\)/);
  assert.match(page, /#wechatSearch\.search-open \.thread-search/);
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
  const page = readFileSync(join(webRoot, "index.html"), "utf8");

  assert.doesNotMatch(page, /title: "主对话"/);
  assert.match(page, /function makeConversationNode/);
  assert.match(page, /class="contact-delete"/);
  assert.match(page, /function deleteConversation\(id\)/);
  assert.match(page, /不会删除长期记忆或已经生成的文件/);
  assert.match(page, /if \(!remaining\.length\)[\s\S]*makeConversationNode\(\)/);
});
