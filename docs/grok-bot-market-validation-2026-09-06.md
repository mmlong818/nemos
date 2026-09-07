# Grok Bot 实际市场使用与设计取舍

日期：2026-09-06。研究目标：识别能让 nemos 成为更好的个人助理的具体设计，不追求市场条目数量，不恢复开发引擎。

## 做了什么、没做什么

用户授权重启本机 Grok Bot 后，用 agent-browser 的 Electron 操作流程进入真实市场，打开插件和 Bot 详情；不是只看安装包字符串。市场可正常列出插件、Bot、技能、记忆、例行任务和集成；侧栏持续显示本机重新连接，尚未验证 Bot 的真实任务执行。

从 Docs Canvas 的「查看源码」实际链接下载 `https://github.com/cursor/plugins`，固定 commit `93b00b89ef425a9c1bac0d0b317dfc49c930ac99`。静态核验 Docs Canvas、Teaching、Continual Learning、Todoist，未运行任何脚本或安装依赖。

另外通过客户端现有、已核实无创建副作用的公开模板读取方法，保存 Flora、Projects Manager、Executive Assistant 三个预览响应；该流程正常检查权限、公开状态和活动版本，不提取凭据，不绕过访问限制。它不是完整原始 recipe 导出，但足以阅读技能正文、记忆、例行任务和插件引用。没有导入 Bot、接入第三方账号、修改账号插件清单或执行模板任务。

## 实物和结论

| 样本 | 实际取得 | 对 nemos 的决定 |
| --- | --- | --- |
| Flora v2 | 10 记忆、4 技能，无预置 routine/plugin；技能含本地日志、首轮初始化和展示步骤 | 优先借鉴空白个人档案、来源顺序、演练后开提醒、只分享模板不分享私有记录；实际预算与权限必须后端执行 |
| Projects Manager v1 | 1 份操作技能，Notion + Slack 两个依赖 | 借鉴任务状态、明确负责人、阻塞问题和只通知需决策内容；其查空闲后再写领取者不是原子锁，不能当并发调度引擎 |
| Executive Assistant v2 | 14 记忆、4 routine、5 依赖；配方名 frank | 可取“先查限制条件→证据比对→草稿→用户批准”；不导入作者职业/时区/偏好；替换必填变量后再启用任务 |
| Teaching | MIT；两份短技能，无 MCP/hook | 最适合改写成原生的目标分阶段计划与阶段复盘，映射已有事项/结果证据 |
| Continual Learning | MIT；Bun stop hook + transcript 增量状态 + AGENTS.md 更新 agent | 只取增量、去重、节流；拒绝直接改主记忆或把用户事实写成执行指令；证据不能丢弃 |
| Docs Canvas | MIT；明确标注 scaffold/placeholder，依赖 Cursor Canvas SDK | 仅取章节导航与引用的组织方式；不能称为已取得完整画布引擎 |
| Todoist | MIT 配置，HTTP 远程 MCP 地址 | 是连接配置，不是本地任务引擎；没有 OAuth/工具执行验收就不能声称已经可用 |

## 关键设计，不是营销描述

### 1. 模板知识和个人记忆要分库、分来源

Flora 明确要求首次建立空日志、私人植物记录不随模板发布，这个产品契约值得采用。反例是 Executive Assistant 的公开记忆直接假定用户职业和 PT/PST 时区。模板公开不代表其内容适用于当前用户。

nemos 应将模板知识标成 `template-knowledge`，默认不进入个人事实；候选偏好必须经过当前用户确认，保留模板版本和来源，支持撤回。现有本批确认学习流程是基础，不等于已经实现模板导入隔离。

### 2. 导入前展示组成和副作用

技能、routine、plugin 引用、必填变量、账号权限和可能产生的外部写操作分开展示。Executive Assistant 的例行任务把 cron 写在正文，并有多个尚待填写的日历/房间/人员标识；其默认时区记忆与导入问时区可能冲突。应将时区、调度表达式、目标账号等结构化验证，不让模型从长提示词里猜。

Grok 插件的“添加”会修改账号安装状态并 reloadServers，并非单纯下载。nemos 的查看、下载、安装、授权、启用应是不同动作，不能拿一个绿色“已安装”代替实际可用性检查。

### 3. 先人工触发的只读演练，再开周期任务

Flora 要求至少录入一个对象、看过一次演练后才创建提醒，比导入后立即自动运行稳妥。nemos 可做“演练报告→用户确认时间与范围→启用”的流程。演练必须证明取到哪些来源、缺少哪些权限、会生成什么结果；不能只回一句成功。

### 4. 用后端保证领取、恢复和预算

Projects Manager 的文本是“查询无人领取→写负责人→执行”，没有原子领取、租约或重复执行保护。nemos 应使用数据库条件更新/事务领取、运行 ID、租约、幂等副作用和恢复回执，并在交付证据满足后完成。模板要求不重复并不能替代这些保障。

Flora 的费用/搜索次数上限主要在技能文本中；应由 nemos 工具层统计调用和输出预算，超限停止或请求确认，不能仅靠模型记住上限。

### 5. 增量学习必须保留证据与处理回执

公开 Continual Learning hook 的 mtime、完成回合和时间节流值得参考，但其更新 agent 明确丢弃 evidence/confidence，并通过 AGENTS.md 改变后续执行上下文。nemos 应继续采用候选—确认—来源—撤回；学习成功后才推进增量游标，失败可重试。不能以发出 followup 代替完成学习。

## 当前建议顺序

1. 原生个人事项计划/复盘模板：先用现有任务与结果证据，不依赖外部账号。
2. 模板预检与只读演练：来源隔离、必填值、时区、权限、版本和可执行副作用。
3. 增量学习候选与可靠调度保障：完成回执、幂等和预算由后端落实。

本轮是验证与取舍，没有直接合并这些市场样本。公开插件可依据各自 MIT LICENSE 使用并保留许可；Bot 模板未确认可再分发授权，只抽取通用设计，不能据此复制其全文进产品。

## 证据位置

工作区 `outputs/grok-market-2026-09-06/`：市场截图、三个公开预览 JSON、固定提交源码、`cursor-plugins-source-review.md`、`bot-template-source-review.md`。

分享页：

- https://x.ai/bot/dGYdqS9vLSXpxoNCPBHys
- https://x.ai/bot/AZKaQOsjrAa51Nb4xvTur
- https://x.ai/bot/_DnP777DCicZpaTtm9_h5

静态客户端实现核对位置：`resources/app.asar` 内 `dist/electron-preload/preload.cjs` 的 `desktop.agent.getPublicBotTemplate`，`dist/electron-main/main-app.cjs` 的模板下载/解析、安装后 reloadServers、账号与机器作用域检查。安装包未确认上层源码许可，未将其中代码并入 nemos。
