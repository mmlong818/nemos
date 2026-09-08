/**
 * Bot 配方：市场模板除了工作规则之外还能携带什么，以及用户同意之前什么都不落地。
 *
 * 上一轮把市场做成了纯文字模板（`tools: "off"`、`memory: "task-only"`、不带定时任务），
 * 锁得很死所以安全，代价是模板只能给一段规则。配方补上「可复用流程」和「定时任务」
 * 两类内容，同时把同意门做成结构上无法绕过的两步。
 *
 * ## 配方里没有「记忆」
 *
 * 参考实现的模板会携带记忆条目，导入时以低可信层写进去。小丑鱼不这么做，原因不是
 * 谨慎而是模型不对：市场 Bot 以 `memory: "task-only"` 运行，本来就读不到用户记忆；
 * 模板作者预填的「记忆」实际上是他对用户的断言，写进用户事实层就是身份污染——
 * 这正是产品承诺里「不携带外部 Bot 的私人记忆」要挡的东西。用户自己的偏好由记忆页
 * 的显式录入路径负责，不经由模板。
 *
 * ## 同意门为什么是两次请求
 *
 * 参考实现靠提示词约束模型「先弹问询卡、且不能同一轮安装」。那是软约束：模型不听话
 * 就失效。这里改成硬约束——预览接口才发放同意令牌，导入接口没有匹配的令牌就拒绝。
 * 用户必须先看过配方内容才可能拿到令牌，确认与落地必然分属两次请求，而模板本身
 * 从头到尾没有任何工具权限，也就没有「从正文读到指令就去安装」这条路可走。
 */

import { createHash } from "node:crypto";

import type { ArtifactFormat, CapabilitySchedule, CapabilityTask, Capability } from "./capabilities.js";

export interface BotRecipeSkill {
  /** 稳定标识：同意勾选、幂等落地和收据都按它对齐，不用名称（名称会被改）。 */
  key: string;
  name: string;
  /** 什么时候该用这个流程。空的技能描述会让它永远不被选中，所以必填。 */
  description: string;
  /** Markdown 流程正文，走与其它安装技能相同的准入检查。 */
  content: string;
  defaultFormat: ArtifactFormat;
}

export interface BotRecipeRoutine {
  key: string;
  title: string;
  /** 必须指向宿主真实存在的能力；配方不能凭空引入执行器。 */
  capabilityId: string;
  instruction: string;
  format: ArtifactFormat;
  /** 只允许会自己跑的两种。手动任务不需要同意门，放进配方只是混淆视听。 */
  schedule:
    | { mode: "daily"; time: string; timezone: string; days: number[] }
    | { mode: "turns"; everyTurns: number };
}

export interface BotRecipe {
  skills: BotRecipeSkill[];
  routines: BotRecipeRoutine[];
}

export const RECIPE_LIMITS = {
  maxSkills: 8,
  maxRoutines: 8,
  maxNameLength: 40,
  maxDescriptionLength: 320,
  maxContentLength: 12_000,
  maxInstructionLength: 4_000,
  maxTitleLength: 60,
} as const;

export class BotRecipeError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = "BotRecipeError";
  }
}

/** 配方为空与没有配方是同一件事：都不需要同意门。 */
export function isEmptyRecipe(recipe: BotRecipe | undefined): boolean {
  return !recipe || (recipe.skills.length === 0 && recipe.routines.length === 0);
}

/**
 * 归一化并校验一份配方。
 *
 * 打包时就该跑一次（模板目录的守卫测试），导入前再跑一次：模板目录是随应用发布的
 * 常量，但导入路径的输入来自请求体，两边都不能假设对方已经查过。
 */
export function normalizeBotRecipe(value: unknown, knownCapabilityIds: readonly string[]): BotRecipe {
  if (value === undefined || value === null) return { skills: [], routines: [] };
  if (typeof value !== "object") throw new BotRecipeError("配方格式不正确");
  const raw = value as { skills?: unknown; routines?: unknown };
  const skills = arrayOf(raw.skills, RECIPE_LIMITS.maxSkills, "配方技能").map(normalizeSkill);
  const capabilities = new Set(knownCapabilityIds);
  const routines = arrayOf(raw.routines, RECIPE_LIMITS.maxRoutines, "配方定时任务")
    .map((item) => normalizeRoutine(item, capabilities));
  assertUniqueKeys(skills.map((item) => item.key), "配方技能");
  assertUniqueKeys(routines.map((item) => item.key), "配方定时任务");
  return { skills, routines };
}

/**
 * 同意令牌：绑定模板身份与配方内容。
 *
 * 绑内容而不只绑版本号，是为了让「模板在用户预览之后被改过」也变成不匹配——
 * 只绑版本号的话，同一版本内容被换掉就能拿旧令牌落地新内容。
 */
export function recipeConsentToken(input: { templateId: string; templateVersion: number; recipe: BotRecipe }): string {
  const canonical = JSON.stringify({
    id: input.templateId,
    version: input.templateVersion,
    skills: input.recipe.skills.map((item) => [item.key, item.name, item.description, item.content, item.defaultFormat]),
    routines: input.recipe.routines.map((item) => [item.key, item.title, item.capabilityId, item.instruction, item.format, item.schedule]),
  });
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

export interface RecipeConsent {
  token: string;
  skills: string[];
  routines: string[];
}

export interface RecipeImportPlan {
  skills: BotRecipeSkill[];
  routines: BotRecipeRoutine[];
  /** 用户看过但没有勾选的条目。收据里要说明「哪些没装」，否则用户无法确认自己的选择生效了。 */
  declined: { skills: string[]; routines: string[] };
}

/**
 * 把用户的勾选折算成落地计划。
 *
 * 没有同意信息时返回「一项都不装」而不是报错：同意门守的是配方，不是添加 Bot 本身。
 * 一个不带令牌的普通添加应当照样拿到 Bot，只是配方一项都不落地——默认结果是最保守的
 * 那个，而不是一条错误。把它做成报错会逼所有入口都先走预览，而真正需要守的只有
 * 「装东西」这一步。
 *
 * 三条拒绝都发生在「用户想装点什么」的路径上：
 * - 有勾选却没有令牌：说明没经过预览就想装，428；
 * - 令牌不匹配：模板内容在预览之后变过，409；
 * - 勾选了配方里没有的标识：客户端自己塞了没展示过的条目，400。
 */
export function planRecipeImport(
  input: { templateId: string; templateVersion: number; recipe: BotRecipe },
  consent: Partial<RecipeConsent> | undefined,
): RecipeImportPlan {
  if (isEmptyRecipe(input.recipe)) return { skills: [], routines: [], declined: { skills: [], routines: [] } };
  const wanted = (consent?.skills?.length ?? 0) + (consent?.routines?.length ?? 0);
  if (wanted === 0) {
    return {
      skills: [],
      routines: [],
      declined: {
        skills: input.recipe.skills.map((item) => item.key),
        routines: input.recipe.routines.map((item) => item.key),
      },
    };
  }
  if (!consent?.token) throw new BotRecipeError("请先查看这个 Bot 携带的内容，再决定要添加哪些", 428);
  if (consent.token !== recipeConsentToken(input)) {
    throw new BotRecipeError("这个 Bot 携带的内容已经变化，请重新查看后再添加", 409);
  }

  const skillKeys = new Set(input.recipe.skills.map((item) => item.key));
  const routineKeys = new Set(input.recipe.routines.map((item) => item.key));
  const acceptedSkills = uniqueSelection(consent.skills, skillKeys, "技能");
  const acceptedRoutines = uniqueSelection(consent.routines, routineKeys, "定时任务");
  return {
    skills: input.recipe.skills.filter((item) => acceptedSkills.has(item.key)),
    routines: input.recipe.routines.filter((item) => acceptedRoutines.has(item.key)),
    declined: {
      skills: input.recipe.skills.filter((item) => !acceptedSkills.has(item.key)).map((item) => item.key),
      routines: input.recipe.routines.filter((item) => !acceptedRoutines.has(item.key)).map((item) => item.key),
    },
  };
}

/** 落地所需的宿主能力。用接口而不是整个 CapabilityRuntime，配方逻辑才能单独测。 */
export interface RecipeHost {
  /**
   * 宿主真实存在的能力编号。
   *
   * 归一化需要它，而同意令牌必须算在归一化之后的配方上：预览端点归一化、导入路径
   * 不归一化的话，两边算出的令牌永远不相等，装配方会稳定失败。所以能力清单必须由
   * 宿主提供，而不是让调用方各自去凑。
   */
  capabilityIds(): readonly string[];
  installSkill(input: {
    personaId: string;
    name: string;
    description: string;
    sourceText: string;
    defaultFormat: ArtifactFormat;
  }): Capability;
  createTask(input: {
    title: string;
    personaId: string;
    capabilityId: string;
    instruction: string;
    format: ArtifactFormat;
    schedule: Partial<CapabilitySchedule>;
    enabled: boolean;
  }): CapabilityTask;
}

export interface RecipeReceiptItem {
  key: string;
  kind: "skill" | "routine";
  /** 落地后的本机编号，供用户在技能库或计划面板里找到它。 */
  localId: string;
  name: string;
  /** 定时任务一律建成暂停；这里记下来，收据上要说清。 */
  enabled?: false;
  error?: string;
}

export interface RecipeReceipt {
  templateId: string;
  templateVersion: number;
  /** 配方内容来自模板作者，不是用户自己的判断，落地后仍按未经核实处理。 */
  trust: "untrusted";
  appliedAt: string;
  items: RecipeReceiptItem[];
  declined: { skills: string[]; routines: string[] };
}

/**
 * 应用落地计划。
 *
 * 逐条独立处理：一条技能没过准入检查不该让其余条目连带失败，也不该让整次导入回滚成
 * 「什么都没有」——用户已经明确同意的其它条目应当生效，失败的那条在收据里说明原因。
 */
export function applyRecipe(
  input: { templateId: string; templateVersion: number; personaId: string; plan: RecipeImportPlan },
  host: RecipeHost,
): RecipeReceipt {
  const items: RecipeReceiptItem[] = [];
  for (const skill of input.plan.skills) {
    try {
      const installed = host.installSkill({
        personaId: input.personaId,
        name: skill.name,
        description: skill.description,
        sourceText: skill.content,
        defaultFormat: skill.defaultFormat,
      });
      items.push({ key: skill.key, kind: "skill", localId: installed.id, name: installed.name });
    } catch (error) {
      items.push({ key: skill.key, kind: "skill", localId: "", name: skill.name, error: reason(error) });
    }
  }
  for (const routine of input.plan.routines) {
    try {
      // enabled 恒为 false，不看配方怎么写：新装的定时任务先摆在那里让用户看清楚，
      // 由用户在计划面板里显式打开。配方能自带一个会自己跑起来的任务是不可接受的。
      const task = host.createTask({
        title: routine.title,
        personaId: input.personaId,
        capabilityId: routine.capabilityId,
        instruction: routine.instruction,
        format: routine.format,
        schedule: routine.schedule,
        enabled: false,
      });
      items.push({ key: routine.key, kind: "routine", localId: task.id, name: task.title, enabled: false });
    } catch (error) {
      items.push({ key: routine.key, kind: "routine", localId: "", name: routine.title, error: reason(error) });
    }
  }
  return {
    templateId: input.templateId,
    templateVersion: input.templateVersion,
    trust: "untrusted",
    appliedAt: new Date().toISOString(),
    items,
    declined: input.plan.declined,
  };
}

function normalizeSkill(value: unknown): BotRecipeSkill {
  const raw = object(value, "配方技能");
  const content = str(raw.content, "技能正文", RECIPE_LIMITS.maxContentLength, true);
  return {
    key: key(raw.key, "技能"),
    name: str(raw.name, "技能名称", RECIPE_LIMITS.maxNameLength, true),
    description: str(raw.description, "技能用途说明", RECIPE_LIMITS.maxDescriptionLength, true),
    content,
    defaultFormat: format(raw.defaultFormat),
  };
}

function normalizeRoutine(value: unknown, knownCapabilityIds: ReadonlySet<string>): BotRecipeRoutine {
  const raw = object(value, "配方定时任务");
  const capabilityId = str(raw.capabilityId, "定时任务能力编号", 80, true);
  if (!knownCapabilityIds.has(capabilityId)) {
    throw new BotRecipeError(`配方定时任务指向不存在的能力：${capabilityId}`);
  }
  return {
    key: key(raw.key, "定时任务"),
    title: str(raw.title, "定时任务名称", RECIPE_LIMITS.maxTitleLength, true),
    capabilityId,
    instruction: str(raw.instruction, "定时任务说明", RECIPE_LIMITS.maxInstructionLength, true),
    format: format(raw.format),
    schedule: normalizeRecipeSchedule(raw.schedule),
  };
}

function normalizeRecipeSchedule(value: unknown): BotRecipeRoutine["schedule"] {
  const raw = object(value, "定时任务计划");
  if (raw.mode === "turns") {
    const everyTurns = Math.floor(Number(raw.everyTurns));
    if (!Number.isFinite(everyTurns) || everyTurns < 1 || everyTurns > 100) {
      throw new BotRecipeError("按轮次触发的间隔需在 1 至 100 轮之间");
    }
    return { mode: "turns", everyTurns };
  }
  if (raw.mode !== "daily") throw new BotRecipeError("配方定时任务只能按天或按轮次触发");
  const time = str(raw.time, "触发时间", 5, true);
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new BotRecipeError("触发时间需为 HH:MM");
  const timezone = str(raw.timezone, "时区", 64, true);
  const days = arrayOf(raw.days, 7, "触发星期").map((day) => {
    const parsed = Math.floor(Number(day));
    if (!Number.isFinite(parsed) || parsed < 1 || parsed > 7) throw new BotRecipeError("触发星期需为 1 至 7");
    return parsed;
  });
  if (days.length === 0) throw new BotRecipeError("按天触发至少要选一个星期");
  return { mode: "daily", time, timezone, days: [...new Set(days)].sort((a, b) => a - b) };
}

function uniqueSelection(
  selected: readonly string[] | undefined,
  known: ReadonlySet<string>,
  label: string,
): Set<string> {
  const result = new Set<string>();
  for (const item of Array.isArray(selected) ? selected : []) {
    const value = String(item ?? "").trim();
    if (!known.has(value)) throw new BotRecipeError(`勾选了配方里没有的${label}：${value.slice(0, 40)}`);
    result.add(value);
  }
  return result;
}

function arrayOf(value: unknown, max: number, label: string): unknown[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new BotRecipeError(`${label}必须是数组`);
  if (value.length > max) throw new BotRecipeError(`${label}最多 ${max} 项`);
  return value;
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new BotRecipeError(`${label}格式不正确`);
  return value as Record<string, unknown>;
}

function assertUniqueKeys(keys: readonly string[], label: string): void {
  if (new Set(keys).size !== keys.length) throw new BotRecipeError(`${label}的标识不能重复`);
}

function key(value: unknown, label: string): string {
  const result = str(value, `${label}标识`, 60, true);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(result)) throw new BotRecipeError(`${label}标识只能使用小写字母、数字和连字符`);
  return result;
}

function str(value: unknown, label: string, max: number, required = false): string {
  if (value !== undefined && typeof value !== "string") throw new BotRecipeError(`${label}必须是文字`);
  const result = (value as string | undefined)?.trim() ?? "";
  if (required && !result) throw new BotRecipeError(`${label}不能为空`);
  if (result.length > max) throw new BotRecipeError(`${label}不能超过 ${max} 字符`);
  return result;
}

function format(value: unknown): ArtifactFormat {
  const allowed: ArtifactFormat[] = ["md", "html", "txt", "json", "doc", "pptx", "pdf", "xlsx"];
  if (value === undefined) return "md";
  if (typeof value !== "string" || !allowed.includes(value as ArtifactFormat)) {
    throw new BotRecipeError("配方交付格式不受支持");
  }
  return value as ArtifactFormat;
}

function reason(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 300);
}
