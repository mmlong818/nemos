# GPT-6 Astra 工具调用兼容修复

日期：2026-09-06。构建：`responses-fix-20260906-03`，仍为 v0.2.3 本地候选版，未提交或推送远端。

## 原因与真实验证

旧适配器对 OpenAI 模型统一使用 `/chat/completions`。当前配置的 `gpt-6-astra` 可以文字对话，但工具调用需要 Responses API。[OpenAI 模型说明](https://developers.openai.com/api/docs/guides/latest-model?model=gpt-6-astra)

本机使用同一保存连接的合成测试复现旧请求 HTTP 400，安全摘录只保留状态、参数名（`reasoning_effort`）与错误是否提及 Responses，没有记录原始服务错误或 Key。改用新适配器后，6 次 Responses 请求全部 HTTP 200：文字检查、流式检查、模拟工具调用及回执往返，再加一次真实 AgentRuntime 工具循环（2 轮）。运行引擎实际执行只读合成工具 1 次，准确返回随机回执，正常结束。

总计 7 次请求尝试，成功请求报告 607 tokens。旧接口失败没有用量回执，不能保证该次绝对未计费。没有更换用户模型，没有读取私人会话、记忆或其它产品凭据，没有执行外部工具操作。用户加密连接文件在测试前后哈希一致。

## 实现范围

- OpenAI 提供方的 `gpt-6-astra` 及其 `-` 后缀型号，所有 Agent 调用统一路由 Responses，包括没有工具定义的结果回传轮；其它模型、Anthropic 和自定义兼容提供方不改路由。
- Responses 原生函数定义、调用标识、参数、工具回执与 token 用量映射；保留原有可选参数语义，明确 `strict: false`，运行时仍执行本地参数验证与写操作审批。
- 请求 `store: false`；保存必要的模型返回项供工具往返与本地检查点恢复，包含加密推理项和消息 phase。只向相同模型及端点回传，不展示为助理正文；落盘副本同样脱敏，嵌套 JSON 字符串工具参数先解码再脱敏。
- SSE 以终态响应为准，支持分块 UTF-8/CRLF 和最后一行无换行；断流、incomplete、failed、无效 JSON、无效参数和重复工具标识均失败，不放行本轮工具。错误信息不包含服务原文；不自动改模型或反复重试。
- 模型检查使用同一生产适配器；Astra 每次检查输出上限 1,024 tokens、整项超时 60 秒。仅在完整往返后标记工具通过，HTTP 失败保留安全状态码。

协议依据：[函数调用](https://developers.openai.com/api/docs/guides/function-calling)、[无服务端存储的推理上下文](https://developers.openai.com/api/docs/guides/reasoning)、[流式事件](https://developers.openai.com/api/docs/guides/streaming-responses)。OpenAI Docs 的接口要求决定了本次路由、上下文回传与终态校验设计。

## 验证

- 全量 472 项测试：471 通过、0 失败、1 跳过（Blender）；类型、编辑器类型、许可证和发布元数据检查通过。
- 新增 13 项 Responses 单元测试和 1 项完整服务集成测试，涵盖保存、重启、工具回传、断流、错误、隔离、预算、脱敏和本地恢复。既有模型筛选、其它提供方和写操作授权测试继续通过。
- 新包原生客户端隔离空白启动；主页、事项、能力、设置、记忆页面可访问；所属后端崩溃恢复、客户端重开、事项保存和提醒去重通过。隐藏窗口测试采用限定所属进程树的强制退出，不等于关闭按钮/托盘人工验收。
- 新包代码与已测试源码逐文件 SHA-256 核对，ZIP 做完整 CRC、中文 UTF-8 文件名和私有状态文件检查。

工作区证据：`outputs/responses-fix-2026-09-06/` 下 `live-result.json`、`validation.json`、`full-test.log`、`native-smoke.json`、`package-verification.json`、`SHA256SUMS.txt`。

## 使用与未覆盖项

旧程序和旧 ZIP 未覆盖，用户配置也未偷偷改为“通过”。需退出旧客户端，解压并启动新包的 exe。设置 → 模型中改为“手动指定，不自动更换”，保留 `gpt-6-astra`，Key 留空，点击“获取模型并保存”重检，刷新旧失败记录；这会产生少量额外模型调用费用。

尚未验证另一台干净 Windows、物理休眠唤醒、完整托盘/通知交互或真实邮件/日历服务写入。一个只读测试工具通过，不等于所有插件和自动化能力均完成实机认证。
