# 已接入机制逐项证据（2026-08-15）

本文把此前筛选出的有效机制逐项映射到当前代码、用户入口和回归检查。它只说明已经接入且有证据的部分，不把接口骨架、未安装连接器或模型生成的自述算作完成。

## 结论

- 29 项机制均已进入产品运行链路，不再只是设计说明。
- 面向普通用户的是 16 项能力；队列、交接、审批、证据、记忆和连接器属于后台基础设施，不额外堆到能力首页。
- “开发项目”由独立开发入口承接，默认使用 Pi Agent；通用重复任务不再创建缺少工作区授权的开发任务。
- 产品设计结果已从静态说明升级为可编辑画布：可改界面文案、状态、内容区、配色和桌面／平板／手机预览，并进入本机版本历史。
- 未安装的外部连接器仍显示为未就绪；复杂 Office 原格式排版仍交给成熟桌面应用，不以结构化副本冒充无损编辑。

## 逐项证据

| 编号 | 用户价值 | 当前真相源与入口 | 正向、失败或恢复证据 | 状态 |
|---|---|---|---|---|
| M01 | 页面只显示真实任务状态 | `agent/job-queue.ts`、`server.ts`、工作页运行投影 | `agent-job-queue.test.ts`、`capability-center.test.ts` 覆盖刷新、重启与无任务状态 | 已验证 |
| M02 | 能力接力无需重复说明 | `capability-handoff.ts`、后台作业入口 | `capability-handoff.test.ts` 覆盖原文、提要、材料、身份、指纹与去重 | 已验证 |
| M03 | 交接有发送、接收、返回、失败回执 | `capability-handoff.ts`、`server.ts` | 同一测试覆盖失败落点、重试性、返回无产物和失败后成功 | 已验证 |
| M04 | 文件变化可以被发现 | `capabilities.ts` 的产物证明、统一文件登记 | `capability-center.test.ts`、`task-files.test.ts` 复算 SHA-256 和字节数 | 已验证 |
| M05 | “生成、校验、核验、确认”不混用 | `professional-artifact-gate.ts`、产物证明 | `professional-artifact-gate.test.ts` 覆盖降级和不能越级确认 | 已验证 |
| M06 | 高风险工具校验失败时关闭 | `agent/tool-scheduler.ts`、`agent/extensions.ts`、凭证代理 | `agent-runtime.test.ts`、`agent-extensions.test.ts` 覆盖校验异常、越权和审批 | 已验证 |
| M07 | 超时但可能已执行的动作不会盲重试 | `agent/job-queue.ts` | `agent-job-queue.test.ts` 覆盖 uncertain、人工对账、已完成但不重放 | 已验证 |
| M08 | 用户、角色和别名不再串线 | `engine.ts`、身份迁移、独立记忆内核 | `companion-memory-integration.test.ts`、`companion-identity.test.ts` 覆盖说话人和稳定主体 | 已验证 |
| M09 | 记忆可追溯、纠正和忘记 | `server.ts` 记忆接口、记忆页 | `companion-memory-integration.test.ts` 覆盖原消息来源、修正版和旧事实替代 | 已验证 |
| M10 | 临时事实不会直接进入长期记忆 | 独立记忆内核的候选晋升，应用召回前过滤 | `memory-promotion-integration.test.ts` 覆盖临时事实、模型推断、独立证据和用户修正 | 已验证 |
| M11 | 能力升级可回滚且不静默覆盖 | `capabilities.ts`、能力历史、扩展生命周期 | `capability-center.test.ts`、`agent-extensions.test.ts` 覆盖版本、摘要、异常停止和回滚 | 已验证 |
| M12 | 能力只能用声明过的文件、网络、工具和模型 | `agent/extensions.ts`、工具审批、凭证代理 | `agent-extensions.test.ts` 覆盖权限扩张重新授权和运行时越权拒绝 | 已验证 |
| M13 | 能力升级必须经过真实夹具 | `capability-admission-probes.ts` | `capability-admission-fixtures.test.ts` 覆盖正常、空、损坏、异常、工具失败和 Windows 路径 | 已验证 |
| M14 | 研究结论可以回到具体证据 | `source-verification.ts`、原生研究合同 | `native-capabilities.test.ts` 覆盖页码／段落、引句哈希、缺锚点降级 | 已验证 |
| M15 | 可编辑正文不会改坏证据包 | `artifact-workspace.ts`、结果工作台 | `artifact-workspace.test.ts` 覆盖正文编辑、证据不可变、版本和交接继承 | 已验证 |
| M16 | 并发写入不会静默覆盖 | 文件工作台会话、工作台修订号 | `artifact-workspace.test.ts`、`office-file-sessions.test.ts`、`office-workbench-state.test.ts` 覆盖旧版本拒绝与外部修改 | 已验证 |
| M17 | 演示文稿有真实 PPTX 和视觉质量门 | `native-capability-renderer.ts`、`presentation-visual-review.ts` | `native-capabilities.test.ts` 覆盖可打开 PPTX、备注、密度、版式变化和独立浏览器复核 | 已验证 |
| M18 | 开发交付是项目修改而非一篇文稿 | `pi-development.ts`、四个外部引擎适配器、开发工作台 | `capability-center.test.ts` 覆盖计划、流式和单次入口均调用真实开发引擎；各引擎有只读实跑 | 已验证 |
| M19 | 代码上下文有边界、位置和截断说明 | `pi-development.ts` 的目录、搜索、行号与上下文回执 | `companion-pi-development.test.ts` 覆盖路径边界、敏感文件、精确行号和会话恢复 | 已验证 |
| M20 | 活动面板不制造“工作中” | 持久作业检查点到工作页的投影 | `capability-center.test.ts`、`companion-development-projects.test.ts` 覆盖无任务与运行中状态 | 已验证 |
| M21 | 真正长内容使用长文页面，普通聊天仍是气泡 | 对话渲染、结果页和文件工作台 | `capability-center.test.ts`、`companion-office-workbench.test.ts` 覆盖长文入口、编辑、复制和普通对话分流 | 已验证 |
| M22 | 专业能力必须经过输入、产物和检查合同 | `professional-artifact-gate.ts`、原生能力合同 | `professional-artifact-gate.test.ts`、`native-capabilities.test.ts` 覆盖缺工具、渲染失败和降级 | 已验证 |
| M23 | 工程和三维文件不能凭“文件存在”算完成 | `three-dimensional-verifier.ts`、专业产物门 | `three-dimensional-verifier.test.ts` 使用 Blender 真实打开并检查场景健康；错误格式被拒绝 | 已验证 |
| M24 | 市场机会结论保留假设、冲突和适用边界 | 市场机会原生合同与交互结果 | `native-capabilities.test.ts`、`domain-capability-fixtures.test.ts` 覆盖模型版本、冲突和越权财务结论拒绝 | 已验证 |
| M25 | 连接器不持有全局明文密钥 | `credential-proxy.ts`、扩展连接器 | `agent-extensions.test.ts`、`product-platform.test.ts` 覆盖任务级租约、撤销和未安装不冒充可用 | 已验证 |
| M26 | 外部结果显示时间、摘要和新鲜度 | `source-verification.ts` 的新鲜度回执 | `source-freshness.test.ts` 区分网络失败、无结果、过期和可用结果 | 已验证 |
| M27 | 开发修改先审阅，再选择写入或放弃 | `development-proposals.ts`、开发项目工作台 | `development-proposals.test.ts`、`development-proposal-apply.test.ts` 和 10 类项目语料覆盖冲突、选择性写入、整体还原和回滚 | 已验证 |
| M28 | 交互结果可保存、恢复并继续交给下一能力 | `artifact-workspace.ts`、结果页脚本 | `artifact-workspace.test.ts`、`native-capabilities.test.ts` 覆盖自动保存、版本恢复、重启和交接上下文 | 已验证 |
| M29 | 演示审阅状态与最后良好版本可恢复 | 演示审阅工作台、视觉复核 | `native-capabilities.test.ts`、`presentation-visual-review.test.ts` 覆盖未过门只标记已生成、审阅保存和恢复 | 已验证 |

## 公开能力与内部机制的边界

1. **公开能力**：用户可直接启动的 16 项结果型能力。
2. **内部辅助能力**：OCR、转换、检索、来源核验、路由和文件结构检查，由公开能力自动调用。
3. **运行基础设施**：队列、审批、交接、版本、交付外发箱、恢复和证据等级，不作为能力卡片展示。
4. **外部连接器**：只有真实安装、授权且连接测试通过才显示就绪；未配置时保留清楚的失败边界。

## 当前仍然保留的诚实边界

- 不提供动车余票、航班库存、酒店房态和餐馆座位的实时适配器。
- 不把 Word、PowerPoint、Excel 或 PDF 的结构化副本宣传成无损原位编辑。
- 复杂浮动对象、批注、公式、图表和演示母版由成熟桌面应用处理。
- 需要账号或第三方服务的连接器，未安装或未授权时不生成模拟结果。
