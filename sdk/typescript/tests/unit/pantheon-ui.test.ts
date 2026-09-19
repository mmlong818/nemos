import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { appRoute, renderAppPage } from "../../examples/companion/app-navigation.js";

const webRoot = join(process.cwd(), "examples", "companion", "web");

test("万神殿是统一工作区而非人物卡市场或普通群聊", () => {
  const route = appRoute("/pantheon");
  assert.ok(route);
  const source = readFileSync(join(webRoot, "pantheon.html"), "utf8");
  const html = renderAppPage(source, "/pantheon");
  assert.match(html, /id="pantheonIssue"/);
  assert.match(html, /id="seatRationale"/);
  assert.match(html, /id="debateStage"/);
  assert.match(html, /id="phaseStatus"/);
  assert.match(html, /id="interjectionForm"/);
  assert.match(html, /id="continueRound"/);
  assert.match(html, /id="convergeDebate"/);
  assert.match(html, /id="thoughtLibraryPanel"/);
  assert.match(html, /公开思想与材料的结构化蒸馏/);
  assert.doesNotMatch(html, /人物市场|加入群聊|模拟真人/);
});

test("万神殿前端包含空、加载、错误与阶段反馈，并从同源API读写", () => {
  const script = readFileSync(join(webRoot, "assets", "pantheon.js"), "utf8");
  const css = readFileSync(join(webRoot, "assets", "pantheon.css"), "utf8");
  for (const marker of ["data-empty", "aria-busy", "setAttribute(\"role\", \"alert\")", "phaseStatus", "remaining"])
    assert.ok(script.includes(marker), marker);
  for (const endpoint of ["/api/pantheon/session", "/api/pantheon/session/advance", "/api/pantheon/session/interject", "/api/pantheon/thoughts", "/api/pantheon/distill"])
    assert.ok(script.includes(endpoint), endpoint);
  assert.match(css, /:focus-visible/);
  assert.match(css, /@media \(max-width:/);
  assert.match(script, /if \(state\.session && state\.catalog\.length\) renderSeats\(\)/);
  assert.match(script, /const form = event\.currentTarget;[\s\S]*form\.reset\(\);[\s\S]*await loadThoughts\(\)/);
  assert.match(script, /session\.phase === "complete" \|\| state\.busy/);
  assert.match(script, /localStorage\.setItem\(SESSION_KEY, state\.session\.id\)/);
  assert.match(script, /\/api\/pantheon\/session\?id=/);
  assert.match(script, /localStorage\.removeItem\(SESSION_KEY\)/);
});
