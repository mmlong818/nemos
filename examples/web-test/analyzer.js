// analyzer.js — 内容分析器（Mock + Anthropic + OpenAI）
// 输出 nemos schema 结构：1 条 archival + N 条 derived

const CHECK_SYSTEM_PROMPT = `你是 nemos 记忆审查官。

你将收到对**同一份原文**做的两次独立 derived 抽取（A 集合、B 集合）。任务：
1. **去重**：A、B 中表达相同事实的条目合并为一条；保留最清晰、信息密度最高的版本
2. **confidence 评分**：
   - 在 A、B 都出现的事实 → confidence: "high"
   - 仅出现在 A 或 B 之一 → confidence: "medium"
   - 一处明显错抽或粒度过细 → 直接丢弃，不要保留
3. **矛盾检测**：A、B 对同一事实给出冲突描述 → 保留为 1 条，标 confidence: "conflict"，content 用括号注明两种说法
4. **层级一致性**：同一事实在 A 是 episodic、B 是 semantic → 选更准确的那一层，记录 confidence: "medium"
5. **不要新增 A、B 都没有的 derived**——你的任务是审查不是再分析

输出严格 JSON（不要 markdown 围栏）：
{
  "derived": [
    {
      "layer": "episodic" | "semantic" | "personal_semantic" | "procedural",
      "content": "<合并后最清晰的表述>",
      "type": "user" | "feedback" | "project" | "reference",
      "scope": "<scope>",
      "source": {
        "authoritative": false,
        "origin": "llm-merged",
        "chain_depth": 2,
        "pass_count": 1 | 2,
        "confidence": "high" | "medium" | "conflict"
      },
      "arousal": {"value": 0.0-1.0, "signal_sources": [...]},
      "surprise": {"value": 0.0-1.0, "basis": "..."}
    }
  ],
  "stats": {
    "pass_a_count": <int>,
    "pass_b_count": <int>,
    "merged_count": <int>,
    "high_confidence": <int>,
    "medium_confidence": <int>,
    "conflicts": <int>
  }
}

不要输出 JSON 以外的任何内容。`;

const SYSTEM_PROMPT = `你是 nemos 记忆分析器，遵循 nemos schema（个人记忆基础设施）。

任务：把用户上传内容分析成结构化 memory。

规则：
1. 用户原文创建 1 条 archival memory（authoritative=true, layer=archival），content 是完整原文。
2. 从原文中提取 derived facts，分配到 episodic / semantic / personal_semantic / procedural 之一：
   - episodic: 一次性事件、瞬间观察、特定时刻发生的事
   - semantic: 一般事实、跨场景适用的知识
   - personal_semantic: 关于用户自己的事实（偏好/技能/关系/目标）
   - procedural: 行为模式、how-to、流程
3. 所有 derived 必须 authoritative=false, chain_depth=1（你是 LLM，是 AI 推断不是用户陈述）
4. 每条 derived 估算 arousal (0-1, 情绪强度) 和 surprise (0-1, 信息新颖度)

输出严格 JSON（不要 markdown 围栏）：
{
  "archival": {
    // 注意：不要包含 content 字段——客户端会强制用原文覆盖。
    // 你只决定 archival 的元数据：
    "arousal": {"value": 0.0, "signal_sources": []},
    "surprise": {"value": 0.0, "basis": "raw input baseline"}
  },
  "derived": [
    {
      "layer": "episodic" | "semantic" | "personal_semantic" | "procedural",
      "content": "<提取的事实>",
      "type": "project" | "reference" | "user",
      "scope": "<scope>",
      "source": {"authoritative": false, "origin": "llm-extract", "chain_depth": 1},
      "arousal": {"value": 0.0-1.0, "signal_sources": ["punctuation"|"strong_words"|"...其他"]},
      "surprise": {"value": 0.0-1.0, "basis": "<为什么算 surprise>"}
    }
  ]
}

如果原文极短或没有可提取的事实，derived 可以是空数组 []，但 archival 必须存在。
不要输出 JSON 以外的任何内容。`;

/**
 * 主入口
 * @param {string} content - 用户原文
 * @param {string} scope - "global" | "project:xxx" | "task:xxx"
 * @param {object} config - { mode, apiKey }
 * @returns Promise<{archival, derived}>
 */
export async function analyze(content, scope, config) {
  const trimmed = (content || "").trim();
  if (!trimmed) throw new Error("content is empty");

  let result;
  switch (config.mode) {
    case "mock":       result = await mockAnalyze(trimmed, scope); break;
    case "anthropic":  result = await anthropicAnalyze(trimmed, scope, config.apiKey); break;
    case "openai":     result = await openaiAnalyze(trimmed, scope, config.apiKey); break;
    case "claude-cli": result = await claudeCliAnalyze(trimmed, scope); break;
    default: throw new Error("unknown mode: " + config.mode);
  }

  // 强制守住 nemos 原则 4（immutable archive）：
  // archival.content 永远是用户原始输入的字节级副本，LLM 无权改写。
  // LLM 只能决定 archival 的元数据（arousal/surprise/scope）。
  if (!result.archival) result.archival = {};
  result.archival.content = trimmed;
  result.archival.type = "user";
  result.archival.scope = scope;
  result.archival.source = {
    authoritative: true,
    origin: "user-upload",
    chain_depth: 0,
  };
  return result;
}

/**
 * 双 pass + 第三 pass 校验。
 * 抗 LLM 非确定性。Mock 模式下退化为单次（mock 是确定性的）。
 *
 * @returns Promise<{archival, derived, verification_stats}>
 */
export async function analyzeWithVerification(content, scope, config) {
  const trimmed = (content || "").trim();
  if (!trimmed) throw new Error("content is empty");

  // Mock 模式无非确定性，跑一次就行
  if (config.mode === "mock") {
    return analyze(content, scope, config);
  }

  // 并行跑两次独立分析
  const [resultA, resultB] = await Promise.all([
    analyze(content, scope, config),
    analyze(content, scope, config),
  ]);

  // 第三 pass：让 LLM 审查两次结果，合并 + 评 confidence
  const checkInput = JSON.stringify({
    pass_a_derived: resultA.derived || [],
    pass_b_derived: resultB.derived || [],
    scope,
  }, null, 2);

  const checkResult = await runCheckPass(checkInput, config);

  // 组装最终结果
  return {
    archival: resultA.archival,  // 反正客户端会覆盖 content
    derived: checkResult.derived,
    verification_stats: checkResult.stats || null,
  };
}

async function runCheckPass(checkInput, config) {
  const userMessage = `请审查以下两次独立 derived 抽取的结果：\n\n${checkInput}`;
  let text;
  switch (config.mode) {
    case "claude-cli":
      text = await callClaudeCli(CHECK_SYSTEM_PROMPT, userMessage);
      break;
    case "anthropic":
      text = await callAnthropic(CHECK_SYSTEM_PROMPT, userMessage, config.apiKey);
      break;
    case "openai":
      text = await callOpenAI(CHECK_SYSTEM_PROMPT, userMessage, config.apiKey);
      break;
    default:
      throw new Error("check pass 不支持 mode: " + config.mode);
  }
  // check pass 输出只含 derived + stats，不含 archival，不能用 parseJsonResp（那要求 archival）
  let cleaned = (text || "").trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/, "").replace(/```\s*$/, "").trim();
  }
  try {
    const obj = JSON.parse(cleaned);
    if (!Array.isArray(obj.derived)) obj.derived = [];
    return obj;
  } catch (e) {
    throw new Error("Check pass LLM 输出不是合法 JSON: " + e.message + "\n片段: " + cleaned.slice(0, 200));
  }
}

// 提取出 LLM 调用的共用部分，让 check pass 也能用
async function callClaudeCli(systemPrompt, userMessage) {
  const resp = await fetch("http://localhost:3001/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ system: systemPrompt, prompt: userMessage }),
  });
  if (!resp.ok) {
    const errBody = await resp.json().catch(() => ({}));
    throw new Error(`claude-bridge ${resp.status}: ${errBody.error || ""}`);
  }
  const data = await resp.json();
  if (data.error) throw new Error("claude-bridge: " + data.error);
  return data.text || "";
}

async function callAnthropic(systemPrompt, userMessage, apiKey) {
  if (!apiKey) throw new Error("缺 Anthropic API key");
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    }),
  });
  if (!resp.ok) throw new Error(`Anthropic ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  const data = await resp.json();
  return data.content?.[0]?.text || "";
}

async function callOpenAI(systemPrompt, userMessage, apiKey) {
  if (!apiKey) throw new Error("缺 OpenAI API key");
  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
      response_format: { type: "json_object" },
    }),
  });
  if (!resp.ok) throw new Error(`OpenAI ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  const data = await resp.json();
  return data.choices?.[0]?.message?.content || "";
}

// ===== Claude CLI（订阅，经 local bridge）=====
async function claudeCliAnalyze(content, scope) {
  const userMessage = `scope: ${scope}\n\n用户内容：\n${content}`;
  let resp;
  try {
    resp = await fetch("http://localhost:3001/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ system: SYSTEM_PROMPT, prompt: userMessage }),
    });
  } catch (e) {
    throw new Error("无法连接 claude-bridge (http://localhost:3001)。先运行: python claude-bridge.py");
  }
  if (!resp.ok) {
    const errBody = await resp.json().catch(() => ({}));
    throw new Error(`claude-bridge ${resp.status}: ${errBody.error || ""} ${errBody.stderr || ""}`.slice(0, 400));
  }
  const data = await resp.json();
  if (data.error) throw new Error("claude-bridge error: " + data.error);
  return parseJsonResp(data.text || "");
}

// ===== Mock 分析器（启发式，无需 API key）=====
function mockAnalyze(content, scope) {
  const lower = content.toLowerCase();

  const archival = {
    content,
    type: "user",
    scope,
    source: { authoritative: true, origin: "user-upload", chain_depth: 0 },
    arousal: { value: estimateArousal(content), signal_sources: detectArousalSignals(content) },
    surprise: { value: 0.0, basis: "raw input baseline" },
  };

  // 简单启发式拆句分类
  const sentences = content.split(/[\n。.！!？?]+/).map(s => s.trim()).filter(s => s.length > 5);
  const derived = sentences.map(sent => {
    const layer = classifyLayer(sent);
    return {
      layer,
      content: sent,
      type: layer === "personal_semantic" ? "user" : "project",
      scope,
      source: { authoritative: false, origin: "mock-extract", chain_depth: 1 },
      arousal: { value: estimateArousal(sent), signal_sources: detectArousalSignals(sent) },
      surprise: { value: estimateSurprise(sent), basis: "mock heuristic" },
    };
  }).slice(0, 10);  // 限 10 条防爆

  return Promise.resolve({ archival, derived });
}

function classifyLayer(sent) {
  const lower = sent.toLowerCase();
  // personal_semantic: 关于"我"
  if (/(^|[^a-z])(我|i |my |me )/i.test(sent) && /(喜欢|讨厌|偏好|决定|是|不是|擅长|从来|总是|想要|希望|prefer|like|hate|want)/i.test(sent)) {
    return "personal_semantic";
  }
  // procedural: 含"流程/步骤/方式"等
  if (/(每天|每周|每次|流程|步骤|方式|应该|必须|要|always|never|usually|step|procedure|workflow)/.test(sent)) {
    return "procedural";
  }
  // episodic: 含时间/事件
  if (/(今天|昨天|刚才|昨晚|早上|上周|today|yesterday|just|morning|last)/.test(sent)) {
    return "episodic";
  }
  // 兜底：semantic
  return "semantic";
}

function estimateArousal(text) {
  let score = 0;
  if (/[!！]{1,}/.test(text)) score += 0.2;
  if (/[!！]{2,}/.test(text)) score += 0.2;
  if (/[?？]{2,}/.test(text)) score += 0.15;
  if (/(?:崩溃|愤怒|气死|讨厌|开心|激动|兴奋|fuck|damn|amazing|terrible|hate|love)/i.test(text)) score += 0.3;
  if (text.length > 200) score += 0.1;  // 长篇宣泄
  return Math.min(score, 1);
}

function detectArousalSignals(text) {
  const sigs = [];
  if (/[!！]{2,}/.test(text)) sigs.push("multi_exclamation");
  if (/(?:崩溃|愤怒|气死|讨厌|开心|激动|兴奋)/.test(text)) sigs.push("emotion_words_zh");
  if (/(?:fuck|damn|amazing|terrible|hate|love)/i.test(text)) sigs.push("emotion_words_en");
  if (text.length > 200) sigs.push("long_form");
  return sigs;
}

function estimateSurprise(text) {
  // 极简：含"突然""居然""没想到""第一次"等加分
  let score = 0.3;  // baseline
  if (/(突然|居然|没想到|第一次|意外|suddenly|unexpected|first time)/i.test(text)) score += 0.4;
  if (/(?:奇怪|奇特|不一样|different|strange|weird)/i.test(text)) score += 0.2;
  return Math.min(score, 1);
}

// ===== Anthropic API =====
async function anthropicAnalyze(content, scope, apiKey) {
  if (!apiKey) throw new Error("缺 Anthropic API key");
  const userMessage = `scope: ${scope}\n\n用户内容：\n${content}`;
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 4000,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
    }),
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Anthropic API ${resp.status}: ${err.slice(0, 200)}`);
  }
  const data = await resp.json();
  const text = data.content?.[0]?.text || "";
  return parseJsonResp(text);
}

// ===== OpenAI API =====
async function openaiAnalyze(content, scope, apiKey) {
  if (!apiKey) throw new Error("缺 OpenAI API key");
  const userMessage = `scope: ${scope}\n\n用户内容：\n${content}`;
  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userMessage },
      ],
      response_format: { type: "json_object" },
    }),
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`OpenAI API ${resp.status}: ${err.slice(0, 200)}`);
  }
  const data = await resp.json();
  const text = data.choices?.[0]?.message?.content || "";
  return parseJsonResp(text);
}

function parseJsonResp(text) {
  // 容错：去掉 ```json ``` 围栏
  let cleaned = text.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/, "").replace(/```\s*$/, "").trim();
  }
  try {
    const obj = JSON.parse(cleaned);
    if (!obj.archival) throw new Error("response 缺 archival");
    if (!Array.isArray(obj.derived)) obj.derived = [];
    return obj;
  } catch (e) {
    throw new Error("LLM 输出不是合法 JSON: " + e.message + "\n原文片段: " + cleaned.slice(0, 200));
  }
}
