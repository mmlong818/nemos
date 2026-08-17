# 小丑鱼本机应用

统一发布版本：**0.2.3**（桌面壳、产品清单和 TypeScript 包一致）

记忆核心：**Nemos Memory 0.7.5-alpha.18**

默认开发引擎：**Pi Agent 0.84.2**

文档复核：**2026-08-17**

小丑鱼是本机优先的任务执行应用。网页、Windows 客户端和后台任务共用同一份本机数据；任务、能力、文件、开发和自动化之间共享上下文与产物编号。

## 启动

在 `sdk/typescript` 目录执行：

```powershell
npm install
npm run companion
```

打开 <http://localhost:8787>。

| 环境变量 | 作用 |
| --- | --- |
| `PORT` | 修改本机服务端口，默认 8787 |
| `CLOWNFISH_HOME` | 修改应用数据目录，默认 `~/.clownfish` |
| `COMPANION_USER` | 指定本机用户命名空间；部署时必须由可信身份映射 |

服务只监听回环地址，并校验 Host、Origin 与同源浏览器请求。

## 页面与用户流程

| 路径 | 页面 | 主要用途 |
| --- | --- | --- |
| `/` | 任务 | 新建、搜索、自动命名、附件、历史和三种任务方式 |
| `/capabilities` | 能力 | 自动选择或直接启动专门能力 |
| `/office` | 文件 | 打开、转换、编辑、版本、垃圾桶和导出 |
| `/develop` | 开发 | 新建或关联项目，选择引擎并执行真实开发 |
| `/develop/archive` | 开发归档 | 恢复项目记录或彻底删除记录/受管目录 |
| `/automations` | 自动化 | 管理重复任务、暂停、编辑和立即运行 |
| `/settings` | 设置 | 模型、开发、连接器、数据保存和隐私 |

`/tasks`、`/spaces`、`/collaboration`、`/resources`、`/artifacts`、`/runs` 和 `/memory` 仍由统一工作视图承接，但不占用一级导航。

首次使用时，先在 **设置 → 模型与服务** 配置并测试模型连接。任务首次发送后自动生成短标题；模型不可用时使用本地规则命名。

## 任务、能力和交接

任务支持直接聊聊、完成任务和学习辅导。小丑鱼是唯一面向用户的统筹入口；专家与教学策略在后台按任务动态选择。

能力页提供 23 项内置能力，覆盖研究、核验、办公文档、OCR、会议纪要、内容润色、演示、产品设计、市场简报、工作流、商务、开发和能力生成。

一次执行同时登记任务、运行和产物。能力交接包包含：

- 用户原始文字和完整对话原文；
- 去重后的上下文提要；
- 附件及统一文件编号；
- 已有决定、上一步产物和内容指纹；
- 来源、接收和结果回执。

失败任务保留原因和重试入口。运行完成与送达确认分开保存，服务重启后仍可继续投递。

## 文件工作台

### 读取和编辑

- 读取 DOCX、PPTX、XLSX、PDF、ODT/ODS/ODP、RTF、EPUB、CSV、TXT 和 Markdown；
- Word 保留可转换的标题、段落、空行、连续空格、缩进、编号、表格和对齐；
- PDF 通过 `@firecrawl/anydoc` 转为 Markdown 工作副本；
- PowerPoint 按页提取文字、表格和讲者备注；
- Excel 按工作表转换为结构化表格；
- TXT 与 Markdown 可在明确授权后冲突安全地写回原文件；
- 其他格式只编辑副本，不改写原件。

### 保存和导出

- 工作副本自动保存并使用版本号防止旧窗口覆盖新内容；
- 支持版本比较、恢复、删除到垃圾桶和恢复；
- 原文件始终可下载或交给系统关联应用打开；
- 导出 DOCX、PDF、PPTX、XLSX、HTML 和 Markdown 时生成新文件；
- 所有导出先经过对应结构检查。

复杂浮动对象、公式、图表、批注、跨节页眉页脚、演示母版和电子表格公式不承诺无损转换。

## 开发工作台

### 项目和上下文

- 新项目自动创建在受管项目根目录，每个项目使用独立目录；
- 用户在任务中提供已有目录时直接关联，不再要求重复选择；
- 有授权工作区时才向模型暴露开发工具；
- 上下文包包含目标、项目概览、自动选择的相关代码、用户指定文件、Git 差异和有效决定；
- 文件树跳过依赖目录、密钥、二进制文件和符号链接。

### 编程引擎

| 引擎 | 包 | 当前接入 |
| --- | --- | --- |
| Pi Agent | `@earendil-works/pi-coding-agent@0.84.2` | 默认；SDK 内嵌、原生事件、精确会话恢复 |
| DeepSeek Harness | `@deepseek-ai/dsh@0.1.0-rc.6` | CLI 插件、隔离工作区和提案 |
| Kilo Code | `@kilocode/cli@7.4.22` | CLI 插件、只读策略和提案 |
| OpenCode | `opencode-ai@1.18.18` | CLI 插件、只读策略和提案 |
| Codex | `@openai/codex@0.147.x` | Responses API 兼容连接、三档权限 |

五个引擎实现统一插件契约，前端只呈现项目、配置、进程和结果；选中的引擎负责真实读取、修改和检查。各引擎不支持的权限、模型协议、实时事件或会话恢复不会在界面中伪装成可用。

### 隔离、提案与回滚

- 干净 Git 项目优先在临时 worktree 中运行；
- 有内容的非 Git 项目不会被擅自初始化；
- “请求批准”只生成待审阅提案；“帮我批准”验证后自动写回；
- Codex“完全控制”由用户明确选择后直接修改当前项目；
- 提案支持逐文件审阅和选择性写入；
- 写入前核对基线，项目发生变化时停止覆盖；
- 部分写入失败会整体恢复；写入后还可按内容指纹安全回滚。

### 依赖安装

只根据项目已声明内容生成安装计划：Node 锁文件、Python 虚拟环境、`.NET restore`、`cargo fetch --locked` 等。不会全局安装，也不会执行模型临时编造的安装命令。

### 引擎升级

服务启动后异步检查五个 npm 包的最新版本，不阻塞主界面。检查结果保存在 `development-engine-updates.json`。

- 同主版本、命令入口和 Node 要求保持兼容时提示普通升级；
- 主版本、0.x 次版本、预发布通道、命令入口、Node 要求或弃用状态变化时显示风险；
- 安装前必须由用户点击确认；风险版本需要二次确认；
- 安装后运行 `npm run build`、插件注册测试和对应引擎测试；
- 验证失败时恢复 `package.json`、`package-lock.json` 和原依赖；
- 升级成功后提示重启，并通过用户操作网关保存审计记录。

## 记忆和数据边界

记忆由外部 `@nemos/sdk` 提供。用户事实、角色自身内容、任务线程和专家执行上下文分别保存。能力可以只召回少量交付偏好，也可以关闭偏好记忆；当前任务要求始终优先。

默认数据目录：

```text
~/.clownfish
```

主要数据包括：

```text
companion.db
llm-key.dpapi.json
tool-settings.dpapi.json
agent-runs.json
agent-jobs.json
agent-approvals.json
development-engine-updates.json
development-project-archive.json
capabilities/
backups/
logs/
```

Windows 模型密钥与同步凭证使用当前用户 DPAPI 加密。日志对常见凭证字段脱敏，但用户仍不应把密钥写入任务正文或项目文件。

## 本地和自托管保存

默认只使用本地数据。需要备份或多设备转移时，可以连接仓库根目录的 Docker 同步服务：

```powershell
$env:CLOWNFISH_SYNC_TOKEN="请替换为至少24位随机令牌"
docker compose up -d --build
```

客户端先使用 AES-256-GCM 加密快照，服务器只保存密文。SQLite 会在快照前完成检查点；DPAPI 文件、日志、缓存和临时文件不会上传。本机可使用 `http://127.0.0.1:8799`，远程地址必须使用 HTTPS。恢复先暂存，重启应用后生效。

## Windows 便携客户端

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File examples\companion\client\Build-Clownfish.ps1
```

输出目录：

```text
examples\companion\client\dist\portable\小丑鱼
```

用户数据默认不进入程序目录。分享便携包前仍应检查是否误带 `~/.clownfish` 或自定义数据目录。

## 验证

```powershell
npm run check
```

2026-08-16 基线：453 项测试，452 项通过；Blender 场景检查因本机没有 Blender 跳过 1 项。

常用只读接口：

```text
GET /api/version
GET /api/runtime
GET /api/llm
GET /api/capabilities
GET /api/agent/jobs
GET /api/development/engine-plugins
GET /api/development/engine-updates
GET /api/memory?who=me
```

引擎检查接口为只读；引擎升级接口属于明确用户操作，必须通过审计网关执行。
