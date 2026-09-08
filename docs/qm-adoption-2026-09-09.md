# QM 参考设计的个人应用采用记录（2026-09-09）

参考：[QM](https://github.com/yc-software/qm) 的已核验提交
[`c0f8c97`](https://github.com/yc-software/qm/tree/c0f8c97f9f94dc7541db729aa6696d8a4e32e1c6)，特别是其
[`resolution-service`](https://github.com/yc-software/qm/blob/c0f8c97f9f94dc7541db729aa6696d8a4e32e1c6/src/resolution/resolution-service.ts)、
[`scheduler`](https://github.com/yc-software/qm/blob/c0f8c97f9f94dc7541db729aa6696d8a4e32e1c6/src/cron/scheduler.ts)、
[`monitor-poller`](https://github.com/yc-software/qm/blob/c0f8c97f9f94dc7541db729aa6696d8a4e32e1c6/src/monitors/monitor-poller.ts) 与
[`skill-store`](https://github.com/yc-software/qm/blob/c0f8c97f9f94dc7541db729aa6696d8a4e32e1c6/src/skills/skill-store.ts)。本轮只借鉴其“状态有来源、版本可追溯、调度与交接显式化”的产品问题拆分；实现完全基于小丑鱼既有 TypeScript、本机 SQLite 和任务队列，未复制 QM 代码。

## 本轮实际行为

1. **统一上下文**：普通聊天、后台任务和能力执行都使用同一份受限上下文快照；只列明任务、同空间资料和已解析的记忆/工具边界，不把资料正文或别的空间猜入当前任务。
2. **交接与恢复**：每个计划任务只保存最新一条交班记录，最多保留 200 个任务；摘要最多 800 字，产物引用与显式未解决项各最多 5 条。续跑仍受原先持久化的工具模式与记忆 scope 限制，不能由新的请求或快照扩大到写工具。已有 `AgentOrchestrator` DAG 继续负责依赖完成后的自动推进、失败依赖跳过、直接依赖 `artifactRefs` 交接及最终摘要/质量汇总；本次队列事件唤醒只缩短已授权 orchestration job 的入队启动延迟，没有另建通用事件编排器。
3. **计划任务**：调度后的任务沿用显式交接上下文；没有新材料时不虚构输入，也不把一次性任务配置升级成自动化授权。
4. **技能规则**：导入的模板保存模板来源版本和独立的本地派生规则版本。编辑规则只递增本地规则版本；再次导入同一模板或未来目录更新都不会覆盖用户当前规则。详情明确显示来源、两个版本和“仅本机私有”。

## 可见性与版本边界

`placement: "market"` 仍仅是本机技能库中的归类，官方市场接口继续返回未开放状态。规则记录固定为 `private`；不新增组织、团队、公开发布或跨账户同步概念。客户端提交的模板来源、规则版本和可见性不是权威输入：来源保留已有记录，规则版本由本机保存逻辑计算，非私有可见性被拒绝。

## 验收证据与限制

- 隔离服务中导入“项目推进助理”后，详情实际显示“模板 v1 / Projects Manager / 本机派生规则 v1 / 仅本机私有”，并提示模板更新不会自动覆盖规则；测试数据位于临时目录，未读取或修改用户数据库。
- 技能定点单元测试 22 项、路由测试 8 项和 Bot 市场 HTTP 集成测试 1 项均通过；构建通过。最终 `npm run check` 通过：812 项测试中 811 项通过、0 项失败、1 项跳过（Blender 环境验证）。根目录 `node scripts/verify-docs.mjs` 也通过。
- 本轮未验证官方在线市场、多人协作、跨设备同步或外部模板升级迁移，因为个人应用目前没有这些产品能力。规则版本只记录本地规则世代，不是模板差异合并或自动升级机制。DAG 子节点进度仅保存在父 job handler 内存：进程崩溃不支持逐子节点恢复；父 job 因 `sideEffectRisk` 进入 `uncertain` 后必须人工对账；队列事件也不是跨进程事件平台。
