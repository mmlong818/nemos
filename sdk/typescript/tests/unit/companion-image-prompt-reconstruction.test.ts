import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CapabilityRuntime } from "../../examples/companion/capabilities.js";
import {
  hasImagePromptIntent,
  imagePromptVisionPrompt,
  parseImagePromptResult,
  renderImagePromptResult,
} from "../../examples/companion/image-prompt-reconstruction.js";

const validResult = {
  prompt: "一位短发人物站在窗边，柔和侧光，低饱和蓝灰色调",
  analysis: "主体位于画面右侧，侧光勾勒轮廓，背景保持浅景深。",
  style_tags: ["写实人像", "柔和侧光", "低饱和", "浅景深"],
  json_prompt: {
    subject: "一位短发人物",
    action_pose: "站在窗边并看向画外",
    details_appearance: "深色上衣，发丝边缘清晰",
    environment_background: "室内窗边，背景虚化",
    lighting_atmosphere: "柔和自然侧光，安静氛围",
    composition_framing: "半身近景，主体偏右",
    style_camera: "写实人像，浅景深观感",
    colors: "低饱和蓝灰色，肤色作为暖色点",
    materials: "布料、玻璃和皮肤质感",
    aspect_ratio: "接近 4:5 竖幅",
    quality_modifiers: "自然细节，轮廓清楚，背景柔和",
    likely_generation_intent: "安静、克制的编辑人像",
  },
  recreation_prompt: "复刻半身近景和右侧构图，使用柔和窗边侧光与低饱和蓝灰色调。",
  prompt_core: "窗边短发人物，半身近景，柔和侧光，蓝灰低饱和，浅景深",
  negative_prompt: "过度磨皮，强硬顶光，背景杂乱，肢体错误，文字水印",
};

test("图片提示词反推能识别中英文意图并排除普通 OCR", () => {
  assert.equal(hasImagePromptIntent("帮我反推这张图的提示词"), true);
  assert.equal(hasImagePromptIntent("image to prompt"), true);
  assert.equal(hasImagePromptIntent("帮我识别图片里的文字"), false);
});

test("视觉观察阶段只使用图片可见证据", () => {
  const prompt = imagePromptVisionPrompt();
  assert.match(prompt, /可见的证据/);
  assert.match(prompt, /不要识别真实人物、品牌、地点、艺术家、相机型号或生成引擎/);
});

test("结构化结果可校验并渲染为可读交付物", () => {
  const parsed = parseImagePromptResult(`\`\`\`json\n${JSON.stringify(validResult)}\n\`\`\``);
  assert.equal(parsed.error, undefined);
  assert.equal(parsed.value?.style_tags.length, 4);
  const markdown = renderImagePromptResult(parsed.value!);
  assert.match(markdown, /## 完整提示词/);
  assert.match(markdown, /## 结构化拆解/);
  assert.match(markdown, /交付完成。\s*$/);
});

test("缺少固定字段时拒收并交给运行时修复", () => {
  const invalid = { ...validResult, style_tags: ["只有一个"] };
  const parsed = parseImagePromptResult(JSON.stringify(invalid));
  assert.equal(parsed.value, undefined);
  assert.match(parsed.error || "", /正好包含 4 个/);
});

test("运行时自动修复不合格结果并保存 Markdown 产物", async (t) => {
  const dataDir = mkdtempSync(join(tmpdir(), "nemos-image-prompt-"));
  t.after(() => rmSync(dataDir, { recursive: true, force: true }));
  let calls = 0;
  const runtime = new CapabilityRuntime({
    dataDir,
    personas: () => [{ id: "zhiwei", name: "知微" }],
    notify: async () => {
      calls += 1;
      return {
        reply: calls === 1 ? JSON.stringify({ prompt: "字段不完整" }) : JSON.stringify(validResult),
        facts: [],
      };
    },
  });

  const notification = await runtime.runAdHocTask({
    title: "图片提示词反推",
    personaId: "zhiwei",
    capabilityId: "image-prompt-reconstruction",
    instruction: "反推提示词。图片观察：一位短发人物站在窗边，柔和侧光。",
    format: "md",
  });

  assert.equal(calls, 2);
  assert.equal(notification.artifact.capabilityId, "image-prompt-reconstruction");
  assert.match(readFileSync(notification.artifact.file, "utf8"), /## 复刻提示词/);
});