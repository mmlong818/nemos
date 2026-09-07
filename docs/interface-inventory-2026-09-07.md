# 界面梳理(2026-09-07)

对"小丑鱼"应用当前全部界面资产的一次性盘点:页面、路由、导航结构、资产依赖、已知不一致。以代码为准,文档与截图仅作历史参考。Web 工作台的模块级下钻见 `docs/web-interface-map-2026-09-07.md`。

> 2026-09-07 修复轮次:死样式清理、eval 期硬依赖惰性化、总览进入主导航、导航合并为服务端单层渲染、capability-center.css 冗余基座清理均已完成(见 §6)。下文为修复后状态。
>
> **2026-09-08 信息架构重整**:「事项」成为第 3 个主入口,学习提议(待确认)迁入记忆页,`/matters` 不再映射到 `memory` 区域。§3 与 §5 第 1、2 条已被 `docs/information-architecture-2026-09-08.md` 取代,下文保留为历史记录。

## 1. 界面形态总览

| 形态 | 位置 | 说明 |
|---|---|---|
| Web 工作台(主界面) | `sdk/typescript/examples/companion/web/` | 8 个 HTML + 40+ 个无框架手写 JS/CSS 资产;由 `companion/server.ts` 在 :8787 提供 |
| Office 编辑器引擎 | `web/editor-engines/`(TS 源码) | esbuild 打包为 `assets/office-editor-engines.js`(`npm run build:office-editors`) |
| Windows 桌面壳 | `companion/client/` | C# WinForms + WebView2,承载 Web 工作台;`Build-Clownfish.ps1` 打便携包 |
| 桌面小工具 | `companion/client/desktop-helper/renderer/` | 独立界面(翻译/语音/设置页签) |
| 无界面的后端 | `sync-service/`、`bench/` | 纯 JSON API / 纯脚本;`spec/` 中的 user dashboard 是归档愿景,从未实现 |

## 2. 路由契约(单一事实源:`companion/app-navigation.ts` 的 `APP_ROUTES`)

| 路径 | 文件 | section | workView | 标题 |
|---|---|---|---|---|
| `/` | index.html | assistant | — | 助理 |
| `/overview` | overview.html | overview | — | 总览 |
| `/matters` | matters.html | matters | — | 事项 |
| `/bots` | bots.html | bots | — | 任务工作区 |
| `/capabilities` | capabilities.html | capabilities | — | 工具与执行 |
| `/office` | office.html | files | — | 文件工作台 |
| `/settings` | settings.html | settings | — | 设置 |
| `/tasks` | work.html | matters | tasks | 流程管理 |
| `/spaces` | work.html | matters | spaces | 项目 |
| `/automations` | work.html | automations | automations | 自动化 |
| `/collaboration` | work.html | bots | collaboration | 流程协作设置 |
| `/resources` | work.html | files | resources | 参考资料 |
| `/artifacts` | work.html | files | artifacts | 生成成果 |
| `/runs` | work.html | settings | runs | 运行日志 |
| `/memory` | work.html | memory | memory | 记忆 |

要点:15 条路由、8 个 HTML 文件。work.html 是承载 8 个 workView 的"壳页面";`/work` 规范化为 `/tasks`,`/index` 规范化为 `/`(见 `canonicalAppPath`)。`section` 字段目前无消费者,纯元数据。

## 3. 导航结构(2026-09-07 已合并为单层)

**服务端 `workbench-shell.ts` 的 `renderWorkbenchNavigation()` 直接渲染最终形态**(aside 带 `data-product-navigation="true"`):

- 主入口 5 个:总览 /overview、助理 /、任务 /bots?view=tasks、文件 /artifacts、记忆 /memory(各带 `data-product-key`)
- 「管理」折叠组(`.wb-tools`):技能库 /bots?view=bots、自动化 /automations、工具与连接 /capabilities(当前路径在组内时自动展开)
- 底部:设置 /settings
- 隐藏 legacy 容器(`div[data-legacy-navigation]`):/matters、/tasks、/spaces、/office、/resources、/collaboration、/runs 七个旧书签链接,保持可达与测试契约

客户端 `product-structure.js` 保留 `items`(9 项)/`area()`/`organizeNavigation()` 导出:items/area 供 `workbench-ui.js` 做标题、`body[data-product-area]` 与高亮;organizeNavigation 因服务端标记自动跳过,仅作旧缓存 HTML 的兜底。`app-navigation.js` 仍按 `#app-route-manifest` 同步高亮。页内二级页签(任务视图/文件视图/记忆视图)由 product-structure 的 `mount()` 在 `/spaces`、`/resources`、`/memory` 注入。

## 4. 页面 → 资产依赖

| 页面 | 行数 | 专属 JS | 专属 CSS | 备注 |
|---|---|---|---|---|
| index.html | **7582** | agent-events, assistant-digest, model-picker, model-shortlist, app-search-overlay | flat-workbench, model-picker, task-workbench | 助理主页,最大单点,内联大量视图与逻辑 |
| work.html | 221 | work-center, task-navigation, file-library, workbench-memory | work-center, work-platform, work-shell, work-stability, work-storyline | 8 个 workView 的壳 |
| bots.html | 42 | assistant-team(+results), bot-library, task-detail, skill-*, team-*, unified-task-history, workflow-catalog | assistant-team, bot-library, personal-work | 任务工作区 / 技能库 |
| capabilities.html | 203 | capability-center, skill-handoff, skill-file-transfer, team-materials, pending-materials, workflow-catalog | capability-center | 工具与执行 |
| office.html | 210 | office-workbench, office-source-preview, office-capabilities(动态), office-editor-engines(构建产物), vendor/jszip + docx-preview(node_modules) | office-workbench, office-editor-engines | 文件工作台 |
| matters.html | 29 | personal-work, agent-events | personal-work | 进行中的事(含新建/编辑、学习提议两个 dialog) |
| settings.html | 20 | settings-center, settings-wallpaper, model-shortlist | system-center, retained-output | 设置 |
| overview.html | 3 | overview | personal-work | 总览页(紧凑单文件,2026-09-07 起进入主导航,不再重定向) |

全页面共享:clownfish-theme.css、app-navigation-labels.css、app-icons.js、product-structure.js;多数页面另有 scramble 壁纸/彩带与 app-search-overlay。

服务端特殊资源(文件系统里不存在,但**不是死链**):
- `/assets/office-capabilities.js` — 由 `server.ts:3644` 动态生成(`officeCapabilityBrowserScript`)。
- `/assets/vendor/jszip.min.js`、`/assets/vendor/docx-preview.min.js` — 由 `server.ts:155-156` 映射到 node_modules。

## 5. 仍开放的不一致与风险

1. **`/matters` 归属**(有意为之,保留):`product-structure.js` 的 `area('/matters')` 返回 `memory`(主轨高亮"记忆"),代码注释说明意图(状态筛选不应让主轨跳到任务);同时"长期跟进"页签在任务视图组。语义摇摆但非缺陷。
2. **`/memory` 的 section 是 `settings`**(`APP_ROUTES`),与"记忆"作为主入口不符;该字段无消费者,无运行影响的元数据瑕疵。
3. **文档跨代并存**:`docs/application-navigation-2026-09-06.md` 已加 superseded 标注;`docs/assets/readme/` 与 `outputs/` 截图仍跨 2026-08 ~ 09-07 多版本并存。
4. **复审未决项**(见 `outputs/product-ui-reaudit-20260907/report.md`):任务草稿切页丢失(high)、统一任务入口未覆盖专业执行技能(high)、成果后续使用路径(high)等 8 项仍开放。
5. **index.html 7582 行**:仍是最大维护风险点(对话工作台 + 15 个模态 + 4368 行内联脚本)。

## 6. 修复记录(2026-09-07)

全量测试最终状态:**676 个测试,675 通过、0 失败、1 跳过**(`NODE_OPTIONS=--max-old-space-size=8192 npm test`;默认堆单进程跑全量会 OOM,是已知环境限制)。

**第一轮(健壮性与死代码)**:
- eval 期硬依赖惰性化:`work-center.js`、`capability-center.js`、`assistant-team.js`、`task-skill-suggestions.js` 改为调用时读取上游全局,调 script 顺序或加 defer 不再抛 TypeError。
- 死样式清理:index.html 内联 style 删 319 行死规则(`#sidebar`、`#topbar`、`#topActions` 等 83+ 条选择器);app-navigation-labels.css 删 2 条。
- 过时测试断言更新 6 处(导航标签、模型目录、专家文案、3 处钉死 CSS 的断言)。

**第二轮(导航收敛与样式去重)**:
- 总览进入主导航:overview.js 移除 302 重定向,/overview 成为产品导航第一个主入口;product-structure items 扩为 9 项,area('/overview')→'overview'。
- 两层导航合并为单层:renderWorkbenchNavigation 直接渲染最终形态(5 主入口 + 管理组 + 设置 + 隐藏 legacy 容器),客户端 organizeNavigation 变为守卫跳过;新增 2 个钉形测试锁定新形态。
- capability-center.css 删除 116 行复制的 theme 基座(死选择器与被 !important 层压制的规则),74 处拷贝独有变量引用改写为 --cf-* 等价物(带 fallback);顺带修正 .primary-button 背景/hover 不同源的颜色不一致。
- `docs/application-navigation-2026-09-06.md` 加 superseded 标注。

**核实后未改**:assistant-digest.js(活代码,自挂载首页摘要,有单测);`/matters` 的 area 映射(代码注释表明有意);office 的 vendor 引用(服务端映射,非死链)。

## 7. 建议下一步

- 排期复审报告的 3 个 high 项(任务草稿切页丢失、统一任务入口覆盖、成果续用路径)。
- 长期:拆分 index.html(7582 行,对话工作台 + 15 个模态)。
- 顺手可做:`/memory` 的 section 元数据对齐;清理 capability-center.css 拷贝区之外的零星死选择器(`.back-chat`、`main > .topbar` 等,已在 web-interface-map 记录)。
