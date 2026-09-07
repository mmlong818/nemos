# 信息架构重整（2026-09-08）

针对「总览 → 创建第一件事项」跳转后主导航高亮"记忆"、事项页筛选栏混入"已记住"链接等问题，对 Web 工作台的顶层信息架构做一次重整。以代码为准；此文说明意图与边界，替代 `docs/interface-inventory-2026-09-07.md` §3 与 §5 第 1、2 条的描述。

## 1. 问题

| 现象 | 根因 |
|---|---|
| 点"创建第一件事项"后左栏高亮"记忆"、标题变"记忆 · 小丑鱼" | `product-structure.js` 的 `area('/matters')` 硬编码返回 `memory`；`/matters` 本身不在主导航，只作为隐藏旧书签存在 |
| 事项页筛选栏"进行中 / 已完成 / 待确认 / 已记住"里最后一项是跳转链接，样式与行为都不同于前三个按钮 | "待确认"（学习提议）被挂在事项页下当筛选器，于是又需要一个反向入口回到记忆 |
| 记忆页顶部页签"待确认"跳回 `/matters?view=learning` | 与上一条互为因果，两页互相嵌套对方入口 |

本质：**事项**没有自己的位置，**学习提议**放错了归属。

## 2. 新结构

主导航（服务端 `workbench-shell.ts` 渲染，客户端 `product-structure.js` 镜像）：

| 顺序 | 入口 | 地址 | 说明 |
|---|---|---|---|
| 1 | 总览 | `/overview` | 首屏：进行中的事项 + 最近成果 |
| 2 | 助理 | `/` | 对话工作台 |
| 3 | **事项** | `/matters` | 新增主入口。个人长期跟进：目标、下一步、提醒 |
| 4 | 任务 | `/bots?view=tasks` | 页内三个页签：进行中 / 项目 `/spaces` / 自动化 `/automations` |
| 5 | 文件 | `/artifacts` | 成果、资料、编辑副本 |
| 6 | 记忆 | `/memory` | 已记住 / 待确认 两个视图 |
| 管理 | 技能库 `/skills` · 工具与连接 | | 折叠组。自动化已移入任务页签；技能库有独立地址 |
| 底部 | 设置 | `/settings` | 不变 |

页面职责：

- **事项 `/matters`**：只有"进行中 / 已完成"两个状态筛选。保留"从这件事提议记住"动作，提交后进入记忆的待确认列表。支持 `?new=1` 直接打开新建弹窗，总览空态的"创建第一件事项"用它。
- **记忆 `/memory`**：页签"已记住"（默认）与"待确认"（`?view=learning`）。待确认视图由 `workbench-memory.js` 渲染学习提议：确认记住 / 不学习 / 撤回，以及手动"提议记住"弹窗；全部走既有 `/api/personal-work/*` 接口，确认动作仍要求二次确认。
- **兼容**：旧地址 `/matters?view=learning` 在客户端 `location.replace` 到 `/memory?view=learning`。`/spaces` 页签与 `/bots` 任务工具栏里的"长期跟进"链接移除（事项已是主入口）。

## 3. 改动清单

| 文件 | 改动 |
|---|---|
| `companion/workbench-shell.ts` | 主入口加"事项"（`railMatters`，`productKey=matters`），从 legacy 容器移除 |
| `companion/app-navigation.ts` | `/matters` 标题改"事项"；`/memory` 的 section 元数据改 `memory` |
| `web/assets/product-structure.js` | items 加 `matters`；`area('/matters')→'matters'`；记忆页签改为 `/memory` / `/memory?view=learning`；任务页签去掉"长期跟进" |
| `web/matters.html` + `assets/personal-work.js` | 删除"待确认"筛选与"已记住"链接及对应渲染/决策代码；`?view=learning` 重定向；`?new=1` 直开弹窗 |
| `web/assets/workbench-memory.js` | 新增待确认视图与"提议记住"弹窗 |
| `web/assets/workbench-ui.css` | `.wb-learning-*` 与 `#wbProposalForm` 样式 |
| `web/bots.html` | 任务工具栏去掉"长期跟进"链接，只留"项目" |
| `web/assets/overview.js` / `overview.html` | 空态链接指向 `/matters?new=1`；小节标题"进行中的事项" |
| `web/assets/work-center.js` | 记忆页描述文案覆盖两个视图 |
| 测试 | `product-structure`、`workbench-shell`、`app-navigation`、`capability-center` 四个单测更新；新增一条钉住新结构的用例 |

## 4. 未动与后续

- 事项、任务、自动化仍是三种不同类型的记录，各自页面不合并；总览是唯一横向汇总处。
- `/tasks`、`/spaces`、`/collaboration` 仍归"任务"区域；`/runs` 仍归"设置"。
- headless Chrome 在本机启动失败，本轮只做代码与测试验证，未做视觉回归截图。

## 5. 第二轮：任务分区（同日）

问题：一个"任务"入口背后是三套壳、五个去向——执行任务在 bots.html，项目在 work.html，自动化挂在"管理"组，技能库与任务共用 bots.html 靠 `?view=` 切换身份，流程协作设置是无入口的孤儿页。

调整：

| 项 | 之前 | 之后 |
|---|---|---|
| 任务页签 | 执行任务 / 项目（跨壳） | 进行中 `/bots?view=tasks` / 项目 `/spaces` / 自动化 `/automations`，三页统一由 `product-structure.js` 的 `TASK_TABS` 提供，样式统一为 `product-section-nav` |
| 自动化 | "管理"组独立入口 | 任务页签之一；`area('/automations')→tasks`，旧书签进隐藏 legacy 容器 |
| 技能库 | `/bots?view=bots`，与任务同页换参数 | 独立地址 `/skills`（同一 bots.html，按路径决定初始视图）；`/bots?view=bots|market` 仍可用 |
| 任务列表筛选 | 文字任务 / 流程与自动化（实现分类） | 单次任务 / 自动化 |
| 总览"能力任务记录" | `/tasks` → 客户端跳转 | 直接 `/bots?view=tasks`，文案"任务记录" |
| 流程协作设置 `/collaboration` | 孤儿页 | 保持既有客户端跳转到任务页；职责已由任务详情承担 |

未做：项目与自动化仍由 work.html 渲染（同一套 rail、同一组页签、同一视觉），未把 work-center.js 的表单逻辑搬进 bots.html；如需真正单文件承载，再做下一轮。
