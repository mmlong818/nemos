# Web 工作台界面地图(2026-09-07)

`sdk/typescript/examples/companion/web/` 的模块级盘点,是 `docs/interface-inventory-2026-09-07.md` 的下钻补充。规模:8 个 HTML(约 8310 行)+ 66 个资产文件(JS/CSS 共 15000+ 行)+ brand/characters/wallpapers 三类静态资源。无框架、无构建(office 编辑器引擎除外),全部 IIFE + `window.ClownfishXxx` 全局通信。

> 2026-09-07 修复轮次:eval 期硬依赖已全部惰性化(§4),index.html 死样式与外部 CSS 死规则已清理(§5),3 个落后于代码的测试断言已更新;随后总览进入主导航、导航合并为服务端单层渲染、capability-center.css 冗余基座清理(§7)。下文为修复后状态。

## 1. JS 模块职责(按服务的页面分组)

### 通用基座(多页共享)
| 模块 | 行 | 全局 | 职责 |
|---|---|---|---|
| product-structure.js | 74 | `ClownfishProductStructure` | 10 项产品导航目录(含总览、事项)与 `area()` 区域映射,供 workbench-ui 做标题/高亮;`organizeNavigation` 是旧缓存 HTML 的兜底,服务端已直接渲染最终形态 |
| app-navigation.js | 17 | `ClownfishNavigation` | 读 `#app-route-manifest`,同步高亮,提供 `workView()`(服务端注入) |
| workbench-ui.js | 140 | 无(副作用) | 主题偏好、抽屉改造、Ctrl+K 跳转(服务端注入) |
| app-icons.js | 71 | `ClownfishIcons` | "Reef" SVG 图标集,填充 `[data-icon]` |
| app-search-overlay.js | 37 | `AppSearchOverlay` | 通用搜索浮层绑定 |
| agent-events.js | 116 | `ClownfishAgentEvents` | SSE 事件流 + 断线重连(改写自 Block Buzz,Apache-2.0) |
| scramble-wallpaper.js | 151 | `WALLPAPERS` 等 | 壁纸系统,URL→localStorage,本机图→IndexedDB |
| scramble-confetti.js | 111 | 无 | 装饰彩纸层(尊重 reduced-motion) |
| artifact-workspace.js | 130 | 无 | 成果工作台自动保存(服务端 native-capability-renderer 动态注入) |

### index.html(助理主页)
model-shortlist.js(54,模型短名单)→ model-picker.js(158,模型+思考档位选择器)→ 内联脚本;assistant-digest.js(24,首页空态"继续工作"摘要,经 MutationObserver 自挂载,拉取 `/api/personal-work`、`/api/assistant-team`、`/api/review-queue` 三个只读接口,**是活代码**,有单测覆盖)。

### bots.html(任务工作区,42 行壳,逻辑全在 JS)
workflow-catalog.js(44,工具/流程 Bot 目录)、assistant-team-results.js(26,交付结果纯文本拼装)、bot-library.js(32)、skill-contracts.js(59,技能五段式契约)、team-materials.js(103,附件校验)、task-detail.js(54)、unified-task-history.js(39)、team-routing.js(38,只读路由预览)、skill-handoff.js(37)、skill-file-transfer.js(43,跨窗口附件转交)、task-skill-suggestions.js(39)→ assistant-team.js(280,页面主控)。

### capabilities.html(工具与执行)
capability-center.js(**1388 行**,页面主控:工具目录/启动表单/草稿/快捷工具/轮询)+ pending-materials.js(21,附件延迟提取)+ skill-*/team-materials/workflow-catalog。

### office.html(文件工作台)
office-workbench.js(**2228 行**,页面主控:文档/编辑器/回收站/版本/AI 面板)+ office-source-preview.js(326,IndexedDB 存原始文件 + File System Access 写回)+ office-editor-engines.js(1124 行压缩 bundle,Milkdown/ProseMirror 系,由 `web/editor-engines/` 经 esbuild 构建)+ office-capabilities.js(服务端动态生成)+ vendor/jszip、docx-preview(服务端从 node_modules 直出)。

### work.html(8 个 workView 的壳)
work-center.js(**1127 行**,主控:tasks/spaces/automations/collaboration/resources/artifacts/runs/memory 共享状态 + 懒加载)+ workbench-memory.js(约 80,记忆视图:已记住 + 待确认学习提议,2026-09-08 起)+ file-library.js(37,统一文件索引)+ task-navigation.js(14,旧地址 302 到 `/bots?view=tasks`)。

### matters / overview / settings
personal-work.js(约 85,matters 页 CRUD/提醒/提议记住;学习确认已于 2026-09-08 迁入记忆页)、overview.js(15,总览页数据加载与渲染;2026-09-07 起不再 302 重定向,总览进入主导航)、settings-center.js(151,6 个设置 tab)+ settings-wallpaper.js(96,依赖服务端注入的 scramble-wallpaper)。

## 2. index.html(7582 行)内部结构

三层:内联 `<style>` ~2546 行 → body ~640 行(大量单行压缩)→ 单个内联 `<script>` **~4368 行**。13 个 `<section>`、1 个原生 `<dialog>`、14 个 `div[role=dialog]` 模态(共 15 个弹层)、调约 50 个 `/api/*` 端点。

实际是一个**对话工作台 + 15 个模态视图**塞在一个文件里:
- 主视图:`#sessionPane`(会话列表/新对话)+ `#msgs`+`#composer`(消息流与输入,含语音/图片/文件/截图)+ `#studio`(本机状态侧栏)
- 模态群:入职、记忆查看/清除、建群、加联系人、设置聚合菜单、模型连接、工具 API key、X/微信数据源、历史、翻译/语音转写/润色三合一工具、人设+头像裁剪(canvas)、港股提醒、代理审批、能力任务
- 内联脚本分段:api() 封装 → localStorage 会话持久化(`clownfish-chat-logs-v20260813b`)→ 自动命名 → 附件 base64 → 备份导出 → 入职 → 消息渲染 → `sendMsg` 流式(`/api/chat/stream`)→ 录音 16k WAV 重采样→ASR → 小工具 → 群/联系人/人设 → 记忆与港股轮询 → 能力任务/审批/扩展 → 技能安装/升级/回滚 → 模型与数据源 → 启动序列 + 60s 轮询

## 3. CSS 分层与冲突点

加载顺序(后者赢):页面自带 link → 服务端 `renderAppPage` 在 `</head>` 最后注入 scramble-wallpaper.css → **app-shell.css**(30 行但全是 `!important`,导航 rail 的强制层)→ **workbench-ui.css**(242 行,178 条 `body[data-ui=workbench]` 选择器,最终视觉统一层)。

- clownfish-theme.css(601):设计令牌 `--cf-*` + 骨架,每页必载
- 页面层:task-workbench(659)、flat-workbench(251,仅 index,覆盖同名类)、work-*.css 六件套(仅 work.html)、capability-center(755)、office-workbench(1824)等
- 冲突/冗余:
  1. ~~index.html 内联 style 的死规则~~(**已清理**,见 §5);
  2. capability-center.css 内嵌了一份 theme 基座拷贝,被后载的 clownfish-theme 影掉,属复制式冗余(未动,删除需视觉回归验证);
  3. scramble-theme(820)与 clownfish-theme 共享约 15 个 `:root`/`body`/`#main` 选择器,纯靠后载取胜,脆弱(未动)。

## 4. 跨模块依赖(修复后)

```
#app-route-manifest → app-navigation.js ─→ work-center.js
model-shortlist ─→ model-picker ─→ index 内联脚本;model-shortlist ─→ settings-center
scramble-wallpaper(服务端注入)─→ settings-wallpaper
team-materials ─┬→ pending-materials └→ skill-file-transfer
skill-handoff + workflow-catalog ─→ task-skill-suggestions
workflow-catalog ─→ capability-center.js
8 个全局 ─→ assistant-team.js
```

**已修复(2026-09-07)**:`work-center.js`、`capability-center.js`、`assistant-team.js`、`task-skill-suggestions.js` 不再在 eval 时读上游全局——改为调用时惰性读取(局部缓存 + 守卫),调整 script 顺序或加 defer 不再抛 TypeError;全局缺失时走既有错误提示/重试路径而非整页崩溃。保留的形状约束:`work-center.js` 的 `const viewFromLocation = () => ...` 是测试切片契约,未改名;`assistant-team.js` 的自由变量名(library/workflows/materialUploads/skills 等)被多个测试的 `runInNewContext` 切片依赖,保留原名。
残余:三个文件仍在 eval 期读 `window.ClownfishIcons`(app-icons.js 始终先行加载,且有测试明确要求该引用存在),属可接受的固定前置。

## 5. 死代码清理记录(2026-09-07 已执行)

- **index.html 内联 style:删除 319 行死规则**(83+ 条选择器、1 条 keyframes、1 个空媒体查询骨架):`#sidebar`、`#topbar`、`#wechatRail`、`.rail-avatar`、`.rail-icon`、`#quickCreateMenu`、`.quick-create-*`、`#chatCapabilityBridge`、`#topActions`、`.avatar-letter`、`.constellation`、`.orbit`、`.empty-prompts`、`.smkey` 等系列——目标元素均不在 DOM 且无任何 JS 引用。
- **app-navigation-labels.css:删除 2 条死规则**(`#sidebar { width: 352px; ... }`、`#wechatRail .rail-label`)。
- 同步更新 3 个钉住死代码的测试断言(system-center-ui、capability-center、companion-icon-system),并修正 3 个落后于 09-06/09-07 导航与文案迁移的测试断言(导航标签列表、`state.models`→`renderModelCatalog`、专家文案)。
- 更正此前判断:`assistant-digest.js` **不是**死代码——它经 MutationObserver 自挂载首页"继续工作"摘要,有 `product-structure.test.ts` 单测覆盖;`task-navigation.js` 的导出虽无人调用,但模块靠副作用做旧地址重定向,也是活的。
- 其余资产无死代码:40 个 JS、21 个 CSS 均有引用路径;office 的 vendor 文件由服务端从 node_modules 提供。

## 6. 维护热点(按体量/风险排序)

| 热点 | 体量 | 问题 |
|---|---|---|
| index.html | 7582 行(含 4368 行内联 JS + 2546 行内联 CSS) | 对话工作台 + 15 个模态,单文件承载过多 |
| office-workbench.js | 2228 行 | 文件工作台全部逻辑单文件 |
| capability-center.js | 1388 行 | 文件内聚度高,改动影响面大 |
| work-center.js | 1127 行 | 8 个 workView 共享一个主控 |
| office-editor-engines.js | 1124 行压缩 bundle | 构建产物,改源码需走 `build:office-editors` |

## 7. 第二轮修复记录(2026-09-07,导航收敛与样式去重)

- **总览进入主导航**:overview.js 移除 302 重定向(原 `?legacy=1` 门控一并去除);product-structure items 扩为 9 项、`area('/overview')→'overview'`;app-navigation.ts 中 /overview 的 section 对齐为 `overview`。
- **两层导航合并为单层**:`workbench-shell.ts` 的 `renderWorkbenchNavigation()` 直接渲染最终形态——主入口 5 个(总览/助理/任务/文件/记忆,带 `data-product-key`)、「管理」折叠组(技能库/自动化/工具与连接,组内当前时自动展开)、底部设置、隐藏 `div[data-legacy-navigation]` 保留 7 个旧书签链接(/matters、/tasks、/spaces、/office、/resources、/collaboration、/runs);aside 带 `data-product-navigation="true"`,客户端 organizeNavigation 守卫跳过。workbench-ui.js 无需改动(标题/高亮/area 逻辑自动兼容)。workbench-shell.test.ts 新增 2 个钉形测试锁定新形态。
- **capability-center.css 去重**:删除 116 行复制的 theme 基座(`:root` 拷贝、`.rail`/`.rail-nav`/`.rail-secondary`/`.topbar` 等死选择器与被 app-shell `!important` 层压制的规则),74 处拷贝独有变量引用改写为 `--cf-*` 等价物(带 fallback);顺带修正 `.primary-button` 背景/hover 不同源的颜色不一致。已知残留的零星死选择器(`.back-chat`、`main > .topbar` 等)留待后续。
- **移动端核实**:窄屏底栏无按条目数的宽度规则,7 项放不下时横向滚动而非破版;仅更新过时注释。
- 全量测试:676 个测试,675 通过、0 失败、1 跳过(`NODE_OPTIONS=--max-old-space-size=8192 npm test`)。

## 8. 信息架构重整(2026-09-08)

「事项」进入主导航第 3 位,学习提议迁入 `/memory?view=learning`,`/matters?view=learning` 客户端重定向。详见 `docs/information-architecture-2026-09-08.md`。
