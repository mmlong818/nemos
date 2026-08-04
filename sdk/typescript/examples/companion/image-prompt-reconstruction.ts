export const IMAGE_PROMPT_CAPABILITY_ID = "image-prompt-reconstruction";

const IMAGE_PROMPT_INTENT_RE = /(反推|逆向|还原|拆解|分析|提取|生成).{0,10}(提示词|prompt)|(?:提示词|prompt).{0,10}(反推|逆向|还原|拆解|分析|提取|生成)|image\s*to\s*prompt|复刻.{0,8}(图片|画面|风格)/i;

const DETAIL_FIELDS = [
  "subject",
  "action_pose",
  "details_appearance",
  "environment_background",
  "lighting_atmosphere",
  "composition_framing",
  "style_camera",
  "colors",
  "materials",
  "aspect_ratio",
  "quality_modifiers",
  "likely_generation_intent",
] as const;

type DetailField = typeof DETAIL_FIELDS[number];

export interface ImagePromptResult {
  prompt: string;
  analysis: string;
  style_tags: [string, string, string, string];
  json_prompt: Record<DetailField, string>;
  recreation_prompt: string;
  prompt_core: string;
  negative_prompt: string;
}

export function hasImagePromptIntent(text: string): boolean {
  return IMAGE_PROMPT_INTENT_RE.test(text);
}

export function imagePromptVisionPrompt(): string {
  return [
    "请只根据图片中可见的证据，制作一份供后续反推生成提示词使用的视觉观察记录。",
    "按以下项目详细描述：",
    "1. 主体：人物或物体、数量、相对位置、显著特征。",
    "2. 动作与姿态：朝向、表情、手势、运动状态、视线。",
    "3. 外观细节：服装、发型、饰品、纹理、形状、可见文字。",
    "4. 环境与背景：地点类型、前中后景、道具、空间关系。",
    "5. 光线与氛围：光源方向、软硬、明暗、时间感、情绪。",
    "6. 构图与视角：景别、机位、透视、主体占比、留白、画面比例。",
    "7. 色彩与材质：主色、辅色、对比关系、表面材质和质感。",
    "8. 视觉风格：写实或插画倾向、媒介特征、后期效果。",
    "9. 不确定项：看不清、被遮挡或只能宽泛判断的内容。",
    "规则：不要猜测图片外的信息；没有明确可见证据时，不要识别真实人物、品牌、地点、艺术家、相机型号或生成引擎。",
  ].join("\n");
}

export function imagePromptCapabilityPrompt(): string {
  return [
    "Reconstruct a reusable image-generation prompt from the supplied visual evidence.",
    "Use only visible evidence from the image observation included in the user request.",
    "Do not invent real people, brands, locations, artists, camera models, or generation engines.",
    "Describe uncertain details broadly but usefully. Prioritize subject, pose, composition, lighting, palette, materials, and visual medium.",
    "Avoid empty quality words unless they describe a visible property.",
    "Write Simplified Chinese, except for concise prompt terms that are clearer in English.",
    "Output one JSON object only. Do not use Markdown fences or add commentary.",
    "Required schema:",
    JSON.stringify(imagePromptSchemaExample(), null, 2),
  ].join("\n");
}

export function parseImagePromptResult(raw: string): { value?: ImagePromptResult; error?: string } {
  const candidate = extractJsonObject(raw);
  if (!candidate) return { error: "没有找到 JSON 对象" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch (error) {
    return { error: `JSON 无法解析：${error instanceof Error ? error.message : String(error)}` };
  }
  if (!isObject(parsed)) return { error: "结果不是 JSON 对象" };

  const topLevel = ["prompt", "analysis", "recreation_prompt", "prompt_core", "negative_prompt"] as const;
  for (const field of topLevel) {
    if (!isNonEmptyString(parsed[field])) return { error: `字段 ${field} 缺失或为空` };
  }
  const styleTags = parsed.style_tags;
  if (!Array.isArray(styleTags) || styleTags.length !== 4 || !styleTags.every(isNonEmptyString)) {
    return { error: "style_tags 必须正好包含 4 个非空标签" };
  }
  const jsonPrompt = parsed.json_prompt;
  if (!isObject(jsonPrompt)) return { error: "json_prompt 缺失或不是对象" };
  for (const field of DETAIL_FIELDS) {
    if (!isNonEmptyString(jsonPrompt[field])) return { error: `json_prompt.${field} 缺失或为空` };
  }

  return {
    value: {
      prompt: (parsed.prompt as string).trim(),
      analysis: (parsed.analysis as string).trim(),
      style_tags: styleTags.map((item) => item.trim()) as ImagePromptResult["style_tags"],
      json_prompt: Object.fromEntries(DETAIL_FIELDS.map((field) => [field, (jsonPrompt[field] as string).trim()])) as ImagePromptResult["json_prompt"],
      recreation_prompt: (parsed.recreation_prompt as string).trim(),
      prompt_core: (parsed.prompt_core as string).trim(),
      negative_prompt: (parsed.negative_prompt as string).trim(),
    },
  };
}

export function renderImagePromptResult(result: ImagePromptResult): string {
  return [
    "# 图片提示词反推",
    "",
    "## 画面判断",
    "",
    result.analysis,
    "",
    `**风格标签：** ${result.style_tags.map((tag) => `\`${tag}\``).join(" · ")}`,
    "",
    "## 完整提示词",
    "",
    result.prompt,
    "",
    "## 复刻提示词",
    "",
    result.recreation_prompt,
    "",
    "## 精简核心",
    "",
    result.prompt_core,
    "",
    "## 负面提示词",
    "",
    result.negative_prompt,
    "",
    "## 结构化拆解",
    "",
    "```json",
    JSON.stringify(result.json_prompt, null, 2),
    "```",
    "",
    "交付完成。",
  ].join("\n");
}

export function buildImagePromptRepairPrompt(taskInstruction: string, raw: string, error: string): string {
  return [
    "图片提示词反推结果校验失败，请修复整个结果。",
    `校验问题：${error}`,
    "只输出一个符合下列结构的 JSON 对象，不要使用 Markdown 代码块，不要解释。",
    "仍然只能依据任务中的图片观察记录，不得添加没有可见证据的身份、品牌、地点、艺术家、设备或引擎。",
    "",
    "原始任务：",
    taskInstruction.slice(0, 6000),
    "",
    "待修复输出：",
    raw.slice(0, 6000),
    "",
    "必须符合的结构：",
    JSON.stringify(imagePromptSchemaExample(), null, 2),
  ].join("\n");
}

function imagePromptSchemaExample(): Record<string, unknown> {
  return {
    prompt: "完整、可直接用于生成图片的提示词",
    analysis: "基于可见证据的画面拆解与判断",
    style_tags: ["标签1", "标签2", "标签3", "标签4"],
    json_prompt: Object.fromEntries(DETAIL_FIELDS.map((field) => [field, `${field} 的具体描述`])),
    recreation_prompt: "强调构图、光线、色彩和材质的复刻提示词",
    prompt_core: "保留主体与关键视觉关系的精简提示词",
    negative_prompt: "与画面目标相冲突的元素和常见缺陷",
  };
}

function extractJsonObject(raw: string): string | null {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "");
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  return start >= 0 && end > start ? trimmed.slice(start, end + 1) : null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
