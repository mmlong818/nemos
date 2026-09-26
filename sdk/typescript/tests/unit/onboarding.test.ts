import assert from "node:assert/strict";
import test from "node:test";

import { ONBOARDING_STARTERS, onboardingMessages } from "../../examples/companion/onboarding.js";
import { extractQuickReplies } from "../../examples/companion/quick-replies.js";
import { hasWidgetIntent } from "../../examples/companion/widgets.js";

test("首次见面：先说清能做什么，最后一条给三件今天就能开始的事，做成快捷回复", () => {
  const messages = onboardingMessages("小林");
  assert.match(messages[0], /^小林，你好，我是小丑鱼。$/);
  const body = messages.join("\n");
  for (const thing of ["目标", "小工具", "跟进", "动态", "点子", "提醒与后台", "这台电脑上"]) assert.ok(body.includes(thing), thing);
  const last = extractQuickReplies(messages[messages.length - 1]);
  assert.deepEqual(last.options, [...ONBOARDING_STARTERS]);
  assert.ok(last.text.length > 0, "选项前面要有一句话");
  // 只有最后一条带选项，前面的不能被误当按钮。
  for (const message of messages.slice(0, -1)) assert.deepEqual(extractQuickReplies(message).options, []);
});

// 快捷回复点下去就是以用户的口吻发给模型：每一件都必须是聊天里真能办到的，不然模型只能假装办好。
test("三件起手的事都能在聊天里真的办：触发目标、构件、事项各自的工具", () => {
  const [goal, widget, matter] = ONBOARDING_STARTERS;
  assert.match(goal, /目标/, "目标工具靠'目标'这类词才会带上");
  assert.equal(hasWidgetIntent(widget), true, "要被认成构件请求");
  assert.match(matter, /跟进/, "事项工具靠'跟进'这类词才会带上");
  // "帮我盯着"没有聊天里的工具，只能在设置里配：不能当成起手选项。
  assert.ok(!ONBOARDING_STARTERS.some((item) => /盯/.test(item)));
});
