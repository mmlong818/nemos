# CLAUDE.md

小丑鱼（Clownfish）：本机优先的个人 AI 工作应用 + 可审计 Agent 运行时。

本文件每轮进上下文，只写"不看就会踩坑"的内容。开发命令见 [CONTRIBUTING.md](CONTRIBUTING.md)，
产品与架构见 [README.md](README.md)，各机制的设计理由见对应的 `docs/*.md`。

## 定位

- 应用代码在 `sdk/typescript/examples/companion/`；仓库根目录没有应用源码。
- 记忆内核不在本仓库：外部依赖 `@nemos/sdk`，正本在
  [nemos-memory](https://github.com/mmlong818/nemos-memory)，由 `sdk/typescript/memory-core.version.json`
  锁 commit。要改内核就做补丁给那个仓库（样例 `docs/nemos-memory-reflect-dropped.patch`），
  这里的 `node_modules` 只有编译产物。

## 提交前必须全绿

```powershell
cd sdk\typescript; npm run check   # build + typecheck + licenses + release:check + test
cd ..\..; node scripts\verify-docs.mjs
```

后两项不在 `npm test` 里，且最容易被文档改动打破：改过任何 `.md`、README 或版本号（散落十余处）
之后必须补跑。CI 在 Linux 与 Windows 双平台跑 build / typecheck / test。

## 陷阱

- **行尾**：`.gitattributes` 里 `* text=auto eol=lf` 已把规则钉死，不再依赖各机器的
  `core.autocrlf`（`*.bat`/`*.cmd` 例外，保持 CRLF）。脚本写文件仍要显式 `newline="\n"`。
  收尾用 `git diff --stat <file>` 判断：只该有你改的那几行，整文件重写一眼可见。
  **不要用 `grep -qU $'\r'`**——Bash 工具里这段转义会被吃掉，退化成匹配字母 r，于是永远"命中"。
  历史教训：本仓库曾在系统级 `autocrlf=true` 下检出，462 个文件在工作区是 CRLF、仓库是 LF，
  而 `git status` 因 stat 缓存一直报告干净，改到哪个哪个就整文件 diff。已于 2026-09-09 规范化。
- **heredoc**：bash heredoc 吃反斜杠，正则与转义序列被静默写坏。写脚本请用 Write 工具落文件。
- **加一项能力要同步八处**：能力表、工作流目录、服务端 `ROUTES`、前端 `MATCH_RULES`、
  `EXAMPLE_PROMPTS`、`ICON_TONES`、Bot 页图标表、`skill-handoff` 建议。漏登记不会让测试变红，
  只会图标落兜底、占位文案为空、目标被路到别的能力。`tests/unit/catalog-registration.test.ts`
  现在逐张表钉住全部目录项——**加能力时先跑它**。
- **整合测试别用请求总数断言**：`assert.equal(h.requests.length, before)` 会被后台活动
  （人格简介预热、例行任务调度、记忆整合）挟持，表现为偶发失败。判据要落到"这条内容有没有
  到过模型"。`model-reasoning` 与 `buzz-adoption` 已改；`app-navigation`、`assistant-team`、
  `autonomous-team`、`bot-market` 里还有同类写法未改。
- **测试里切源码**：泛型函数名让字面量匹配失败（`readJsonFile<T>(` ≠ `"function readJsonFile("`），
  切片静默返回半个文件、断言**偶然通过**。

## 硬约束（改动前先读）

- **`/bots?view=market` 故意是空的**（[决策](docs/official-market-separation-2026-09-07.md)）：卡片渲染、
  搜索筛选、导入按钮都是按要求删掉的，8 个模板在技能库使用。README 曾因此长期写错。
- **判断"会不会无沙箱启动本机进程"用 `spawnsUnsandboxedProcess`**，不要用 SDK 的
  `requiresUnsandboxedExecutionApproval`：后者带 `source.type !== "builtin"` 总闸，对内置插件
  一律返回 `false`，拿它把门等于门永不关。
- **`COMPANION_MEMORY_SCOPE` 必须与 `makeMem()` 传的 tenantId / defaultScope 一致**，否则整合状态
  读到不存在的行：返回空状态、**永远报「没有失败」**。
- **`failure-registry.ts` 的 `seededFrom` 必须指向真实抛出点**（有测试校验文件与标识符），
  不要为"将来会实现"的东西预留编号。
- **提示指令预算上限 85 条**（当前实测 20–25）：越线时要决定新指令比现有哪条更重要，
  **调高上限是这个守卫唯一的失效方式**。

## 工作方式

**写实现之前先交程序设计**：文件放哪、类型与方法签名（不写实现体）、主流程调用栈、测试会断言
什么、自己最没把握的几个决定。等确认再写实现体。理由见
[docs/agentic-workflow-2026-09-08.md](docs/agentic-workflow-2026-09-08.md)。

- 垂直切片，不要横着建：先端到端打通一个几乎什么都不做的版本，再逐片加逻辑。
- 断言先于实现。
- 下结论前先读代码——"某能力缺失"在本仓库错判过两次。
- 量真实产物，不要静态 grep 全部源码：那会把永不同时出现的分支算进来。
- 需要人工核验的事实（界面实际长什么样、外部账号是否可用）不要从代码推断后当成已验证。
