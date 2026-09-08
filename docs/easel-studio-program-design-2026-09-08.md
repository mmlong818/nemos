# 程序设计：自媒体工作室（Easel 连接器）提案，待确认

状态：**提案。尚未实现，尚未批准。** 只到文件位置、类型与签名、调用栈、测试断言；不含实现体。

已定范围：**只接选题发现与脚本两类 skill；用小丑鱼已配置的模型；不接发布。**

选题一侧**只接不抓网的评估类 skill**——理由与最终白名单见第十节。

---

## 一、研究结论（都已核对）

| 事实 | 证据 |
| --- | --- |
| Apache 2.0 | `LICENSE` |
| Python 3.10+，112 个 skill，仓库 745 MB（未含依赖与模型权重） | `pyproject.toml`、`skills/openclaw/`、`du -sh` |
| 自带 FastAPI + uvicorn Web 工作台（对话／素材／账号／画像／内容库／发布），默认 7860 | `easel web` → `web/app.py` |
| **没有 MCP 服务**，`easel/` 下 0 个 HTTP 路由 | 全仓 grep |
| 可编程入口只有 `easel skill <名称> --input <内容> --profile <画像>`，一次一个 skill | `easel/cli.py:150` |
| 跑在外部 `openclaw` CLI 之上 | `setup.sh` |
| 自己一套模型配置：`EASEL_LLM_API_KEY` / `EASEL_LLM_BASE_URL` / `OPENAI_*` / `DASHSCOPE_*` | 全仓 grep |
| 调用的模型端点：`chat/completions`、`images/generations`、`images/edits`、`audio/speech`、`videos` | `scripts/*_maas_adapter.py` |
| 文档未提 GPU/CUDA；权重（faster-whisper、rembg）首次使用时下载 | `docs/`、README |

**结论：Easel 是与小丑鱼同级的完整应用**，重复了 agent 循环、skill 注册表、画像、内容库、Web 工作台、发布链路。因此不作为"能力"移植，而作为**独立服务 + 可安装可删除的连接器**接入。

### 小丑鱼这边的既有条件

| 机制 | 位置 | 本设计如何用 |
| --- | --- | --- |
| 扩展清单 `kind` / `runtime.type` | `src/agent/extensions.ts:8`、`:52` | 用 `kind: "mcp"` + `runtime.type: "mcp"`；Easel 是 CLI，四种 runtime 都不直接匹配，故需薄外壳 |
| 无沙箱可执行扩展的确认与提示 | `bundled-capability-plugins.ts` `spawnsUnsandboxedProcess`、`unsandboxed-notice.js` | 自动命中：安装时显式确认 + 每版本启动提示一次 |
| 就绪检查四种原因 | `capability-tools.ts` `CapabilityToolReadiness` | `easel doctor` / `ping` 映射到 `not-configured` / `missing-dependency` / `probe-failed` |
| 凭证代理（**信封协议**，非透明代理） | `src/agent/credential-proxy.ts:88`、`:150` | 见第三节 |
| 出站网络策略 | `network-policy.ts` | 垫片的上游只允许模型端点 |
| 审批 + 工作准则 | `approval-store.ts`、`work-guidelines.ts` | 写类工具进审批；发布不接（本轮范围外） |

---

## 二、架构：三个进程，各管一段

```
小丑鱼（Node）                    MCP 外壳（Node，被 spawn）        Easel（Python，独立安装）
  扩展注册表 / 审批 / 产物            工具 → easel skill 调用            openclaw + 112 skill
  凭证代理（持有真实密钥）  ←信封→   OpenAI 兼容垫片（回环）   ←HTTP→   自己的 LLM 客户端
```

**边界**：工作室归 Easel（画像、素材、内容库、发布）；任务、产物、审批、回执归小丑鱼。
**不镜像 Easel 的画像和内容库**——两边各存一份必然不一致。

---

## 三、"用我的模型"怎么做到不交出密钥

凭证代理不是透明 HTTP 代理：扩展要 POST 一个信封
`{ credentialId, url, method, headers, body }`（`credential-proxy.ts:150` 起），代理注入真实
`Authorization` 后转发，并按 `allowedUrlPrefixes` / `allowedMethods` 限定范围。Easel 说的是
OpenAI 兼容 HTTP，两者对不上。

因此 MCP 外壳里要起一个**只监听回环的 OpenAI 兼容垫片**：

```
Easel  --POST http://127.0.0.1:<port>/v1/chat/completions-->  垫片
垫片   --信封 POST（带 lease token）-->  小丑鱼凭证代理  --注入密钥-->  真实模型端点
```

- 本轮只需实现 **`/v1/chat/completions`** 一条路由：选题发现与脚本都是纯文本。
  Easel 还会调 `images/*`、`audio/speech`、`videos`，**本轮不实现**，垫片对它们返回 501
  并在错误里说明"该端点未接入，请在 Easel 里自行配置媒体密钥"。
- 密钥**始终不出小丑鱼进程**。Easel 侧配置成 `EASEL_LLM_BASE_URL=http://127.0.0.1:<port>/v1`、
  `EASEL_LLM_API_KEY=<垫片占位符>`。
- 垫片必须绑定 `127.0.0.1`、校验占位符、拒绝跨源，与 `local-http-security.ts`
  的 `isAllowedLocalRequest` 同一套判据。

**这是三个选项里唯一同时满足"用我的模型"和"密钥不外流"的。** 另两个：直接注入密钥到 Easel
环境变量（DPAPI 保护范围破掉，且 Easel 会把它写进自己的配置文件）；Easel 用自己的密钥（已否决）。

---

## 四、文件与改动点

| 文件 | 改动 |
| --- | --- |
| `easel-studio.ts`（新，companion） | 清单、就绪检查解析、skill 白名单、产物导入的纯函数 |
| `easel-bridge/`（新目录，独立 Node 包） | MCP 外壳 + OpenAI 兼容垫片。**不进 companion 主构建** |
| `bundled-capability-plugins.ts` | 追加第 5 个内置插件条目（默认未安装） |
| `server.ts` | 插件安装/卸载走现有路径；无新端点 |
| **不动** | 扩展运行时、审批、能力注册表、界面 |

小丑鱼核心零改动是这个方案的主要卖点：删掉插件即回到现在的状态。

---

## 五、类型与签名（无实现体）

```ts
// easel-studio.ts
export const EASEL_STUDIO_PLUGIN_ID = "studio.easel";

/** 本轮暴露的 skill。只两类，且都是纯文本产出。 */
export interface EaselSkillBinding {
  /** MCP 工具名，进小丑鱼工具面。 */
  tool: string;
  /** Easel 侧的 skill 名称，传给 `easel skill <name>`。 */
  skill: string;
  description: string;
  /** 纯文本产出，故均为 read；不产生外部副作用。 */
  effect: "read";
}

export function easelSkillBindings(): readonly EaselSkillBinding[];

/** 解析 `easel doctor` 输出为就绪状态，映射到 CapabilityToolReadiness 的四种原因。 */
export function parseEaselDoctor(stdout: string, exitCode: number): {
  available: boolean;
  reason: "ready" | "not-configured" | "missing-dependency" | "probe-failed";
  message: string;
};

/** Easel 把产物写在它自己的 outputs/ 下；导入前校验路径没有逃出该目录。 */
export function resolveEaselOutput(easelRoot: string, reported: string): string;

export function easelStudioManifest(input: { easelRoot: string; bridgeEntry: string }): AgentExtensionManifest;
```

```ts
// easel-bridge/（外壳侧，独立包）
/** MCP 工具：调用一个白名单内的 Easel skill，返回文本与产物路径。 */
interface RunSkillArgs { skill: string; input: string; profile?: string }
interface RunSkillResult { text: string; outputs: string[] }

/** 回环 OpenAI 兼容垫片；只实现 chat/completions，其余返回 501。 */
function startModelShim(options: { credentialProxyUrl: string; credentialProxyToken: string; credentialId: string }): Promise<{ baseUrl: string; close: () => void }>;
```

---

## 六、调用栈

```
用户在小丑鱼里说「帮我找这周的选题」
  └─ 能力/助理选中 MCP 工具 easel_discover_topics
       └─ 扩展运行时 spawn MCP 外壳（node-permission 或 AppContainer 沙箱）
            ├─ startModelShim() 起回环垫片，拿到 baseUrl
            └─ spawn `easel skill <选题发现> --input <目标> --profile <画像>`
                 env: EASEL_LLM_BASE_URL=垫片 baseUrl, EASEL_LLM_API_KEY=占位符, EASEL_ROOT=…
                 └─ Easel 调 垫片 /v1/chat/completions
                      └─ 垫片 → 凭证代理（信封）→ 真实模型端点
       └─ RunSkillResult.outputs 里的文件经 resolveEaselOutput 校验后导入小丑鱼文件区
```

---

## 七、测试会断言什么

`tests/unit/easel-studio.test.ts`
- `easelSkillBindings()` 只含选题发现与脚本两类，**全部 `effect: "read"`**，且工具名不与现有工具重名。
- 清单声明 `permissions` 含 `process`；`spawnsUnsandboxedProcess(manifest) === true`——即它必然走安装确认与启动提示，不会绕过。
- `parseEaselDoctor`：缺 Python/openclaw → `missing-dependency`；缺模型配置 → `not-configured`；
  非零退出且输出不可解析 → `probe-failed`；正常 → `ready`。四种都不抛。
- `resolveEaselOutput` 拒绝 `../` 逃出 `easelRoot` 的路径，也拒绝绝对路径与符号链接目标。
- 清单里**不含任何发布类 skill，也不含任何抓取第三方站点的 skill**——本轮范围硬约束，
  用名单取反断言（含 `skill-trending-topics` / `skill-trend-rider` / `skill-ugc-discovery`）。

`tests/unit/easel-model-shim.test.ts`（外壳包内）
- `/v1/chat/completions` 把请求包成信封、带 lease token、上游 URL 落在绑定前缀内。
- 未实现的端点（`images/generations`、`audio/speech`、`videos`）返回 **501 且错误里说明原因**，不是 404 也不是静默空响应。
- 垫片只监听 `127.0.0.1`；非回环来源、占位符不匹配、跨源请求一律拒绝。
- **真实密钥不出现在垫片进程的任何响应、日志或错误里**（用一个哨兵字符串断言）。

`tests/unit/bundled-capability-plugins.test.ts`（扩）
- 内置目录从 4 条变 5 条；新条目默认**未安装**。

---

## 八、我最没把握的几个决定

1. ~~Easel 的 skill 名称我还没核实~~ —— **已查、已定**（见第十节）。白名单四个，均不抓网。

2. **`easel skill` 是否真的能无 Web headless 跑通。** CLI 入口存在，但它依赖 `openclaw` profile
   已初始化（`setup.sh` 做的事）。没有实机验证之前，"能被 MCP 外壳驱动"是推断而非事实。

3. ~~垫片要不要支持流式~~ —— **已查，本轮不需要**。全仓只有一处 `stream=True`，
   且不在 chat/completions 的主路径上。垫片按一次性请求/响应实现即可；若将来接入媒体或长脚本
   的流式输出，再单独处理。

4. **沙箱能不能容纳它。** 外壳要 spawn Python，`node-permission` 默认封子进程；这和 Playwright
   那个问题同源。大概率结论同样是"Windows 走 AppContainer、其他平台无沙箱 + 明确告知"，
   但没验证过。

5. **产物导入的粒度。** Easel 一个 skill 可能产出多个文件（脚本 + 分镜 + 素材）。是全部导入成
   多个产物，还是合成一个带附件的产物？我倾向后者（与现有产物模型一致），但没确认 Easel 的
   实际输出形状。

---

## 九、动手前必须先做的两件事

1. **实机跑通一次**：安装 Python 3.10+、`openclaw`、Easel 依赖，跑 `easel doctor` 与
   `easel skill <选题发现>`，确认 headless 可用、确认 skill 名称、确认输出形状与是否用流式。
   这会实际改动机器环境（数 GB 依赖），需要你同意。
2. **确认许可边界**：本方案**只连接、不分发** Easel，因此不需要在 `THIRD_PARTY_NOTICES.md`
   里加它，也不产生与 PolyForm Noncommercial / 应用目录保留全部权利的交叉。如果将来改成随包
   分发，Apache 2.0 的 NOTICE 归属义务就要落实。


---

## 十、已查实的 skill 白名单（补记）

`skills/openclaw/` 的目录名与 SKILL.md 前置元数据都读过了。候选：

| 类别 | skill | `layer` | 说明 |
| --- | --- | --- | --- |
| 选题 | `skill-trending-topics` | discover | 抓微博/抖音/知乎/头条/B站**实时热搜**，输出二创选题 |
| 选题 | `skill-topic-evaluator` | discover | 评估选题 |
| 选题 | `skill-trend-rider` | discover | 追热点 |
| 选题 | `skill-ugc-discovery` | discover | UGC 发现 |
| 脚本 | `video-script` | produce | 视频脚本，短视频到中长视频全时长 |
| 脚本 | `skill-article-outline` | produce | 文章大纲 |
| 脚本 | `skill-hook-generator` | produce | 开头钩子 |
| 脚本 | `copywriting` | produce | 文案 |

### 一个必须先解决的冲突

`skill-trending-topics` **要抓平台实时热搜**。这与小丑鱼的既有立场直接相撞——
README 与能力提示里都写着：实时价格、余票、房态这类数据**只有可靠实时来源实际返回时才标记为已确认**，
且不内置实时交易适配器。热搜榜是同一类易变数据，而抓取方式（爬取第三方站点）既不稳定也不可核验。

三个选择：

1. **本轮只接不抓网的 skill**：`skill-topic-evaluator`（评估用户自己提供的选题）+
   `video-script` / `skill-hook-generator` / `skill-article-outline`。选题**由用户或小丑鱼已有的
   「深度研究」能力提供**，Easel 只做评估与脚本。**我推荐这个**——小丑鱼已经有联网研究能力，
   没必要引入第二套抓取链路，也不必替 Easel 的爬取结果背书。
2. 接 `skill-trending-topics`，但产出**一律标注「来源为第三方热搜榜、未经核验」**，且工具 `effect`
   仍为 `read`。风险：抓取失效时它会安静地给出空榜或过时榜，而用户看不出区别。
3. 接，且不加标注。**不建议**，与现有产品承诺冲突。

### 决定：方案 1

**本轮白名单只四个，均不抓网：**

| 工具 | Easel skill | 作用 |
| --- | --- | --- |
| `easel_evaluate_topic` | `skill-topic-evaluator` | 评估你或小丑鱼给出的选题 |
| `easel_write_video_script` | `video-script` | 视频脚本 |
| `easel_write_hook` | `skill-hook-generator` | 开头钩子 |
| `easel_write_outline` | `skill-article-outline` | 文章大纲 |

排除 `skill-trending-topics` / `skill-trend-rider` / `skill-ugc-discovery`。

**理由**：小丑鱼已经有联网研究链路，没必要引入第二套抓取，更不必替 Easel 的爬取结果背书。
热搜榜与实时价格、余票、房态同类——抓取失效时它会安静地给出空榜或过时榜，而用户看不出区别，
这正是小丑鱼在事实层一直避免的那种失败形状。**选题从哪来**：由你直接给，或由现有的
「资料研究 / 市场机会」能力产出，再交给 `skill-topic-evaluator` 评估。

方案 2（接但标注"未经核验"）留作后续选项，前置条件是抓取失败必须能与"榜确实是空的"区分开，
并按失败编号上报——在那之前，标注只是把判断责任推给用户。

第七节的断言已按此扩展。
