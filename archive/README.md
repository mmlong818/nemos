# 归档目录

更新：2026-09-09

这里放**已完成或已被取代**的过程记录与一次性脚本。它们保留下来是为了能回答「当时为什么这么改」，
不代表当前的界面、接口或做法。

**判断当前行为请不要看这里**，看这些：代码与测试是唯一权威；产品与架构见
[README](../README.md)；当前有效的设计说明见[文档导航](../docs/README.md)；发布记录见
[CHANGELOG](../sdk/typescript/CHANGELOG.md)。

## 收录标准

一份文件进归档目录，需要同时满足两条：

1. **不再指导当前工作**。它描述的改动已经落地、已被后续决定取代，或那条路线已经放弃；
2. **删掉会丢信息**。里面有当时的取舍理由、验收证据或失败教训，而这些没有被别处记录。

只满足第二条的不进来，留在 `docs/`。两条都不满足的直接删，不进来占位。
构建产物（渲染出的 PDF、打包产物、截图）既不归档也不入库，由 `.gitignore` 挡住。

## docs/：过程记录

17 份带日期的设计与验收记录。它们的共同特征是：写作时是当轮的工作依据，完成后没有任何
文档再链接到它们，因此从文档导航已经走不到。

| 主题 | 文件 |
| --- | --- |
| 模型选择与调度 | `model-scheduler-2026-09-07.md`、`model-shortlist-2026-09-07.md`、`model-picker-reasoning-2026-09-07.md`、`model-queue-visibility-2026-09-07.md`、`model-cross-entry-2026-09-07.md` |
| 团队与执行编排 | `team-planner-2026-09-07.md`、`team-candidates-2026-09-07.md`、`execution-plan-contract-2026-09-07.md`、`autonomous-bot-coordination-2026-09-07.md`、`queue-browser-acceptance-2026-09-07.md` |
| Bot 与技能库 | `bot-library-ui-2026-09-07.md`、`bot-market-expansion-2026-09-06.md`、`bot-tools-unification-2026-09-07.md`、`skills-first-migration-2026-09-07.md` |
| 能力与发布验收 | `media-capabilities-program-design-2026-09-08.md`、`personal-assistant-matters-release-2026-09-06.md`、`product-capability-acceptance-2026-08-13.md` |

其中 `media-capabilities-program-design-2026-09-08.md` 是**提案**，不是已实现的行为；
`product-capability-acceptance-2026-08-13.md` 的能力数量与当时的界面对应，与现在的 17 项不同。

## scripts/：一次性脚本

10 个页面重构与主题迁移时用过的脚本，全部只跑过一次，仓库里没有任何地方引用它们。
它们记录的是「当时怎么把页面批量改成那个结构」，对照现在的页面能看出改了什么。

`restructure-home-page.mjs`、`restructure-office-page.mjs`、`restructure-work-page.mjs`、
`rebuild-home-shell.mjs`、`convert-to-page-accent.mjs`、`add-page-attributes.mjs`、
`wire-wallpaper.mjs`、`test-wallpaper.mjs`、`test-flat-layout.mjs`、`screenshot-pages.mjs`

**这些脚本不保证还能跑**，也不在 `npm run check` 的覆盖范围内。已知
`screenshot-pages.mjs` 引入 `playwright`，而它不在依赖声明里，直接运行会失败。
要重跑其中任何一个，先读代码确认它改的路径和选择器是否还存在。

## 授权

本目录随仓库根 `LICENSE`（PolyForm Noncommercial 1.0.0）授权。其中涉及
`sdk/typescript/examples/companion/` 的过程记录只是描述性文字，不改变该应用目录
另行授权的事实，见 [LICENSING.md](../LICENSING.md)。
