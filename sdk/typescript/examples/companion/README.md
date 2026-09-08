# 小丑鱼本机应用

统一发布版本：**0.7.5**（桌面壳、产品清单和 TypeScript 包一致）

记忆核心：**Nemos Memory 0.7.5-alpha.18**

文档复核：**2026-09-07**

小丑鱼是本机优先的任务执行应用。网页、Windows 客户端和后台任务共用同一份本机数据；任务、能力、文件和自动化之间共享上下文与产物编号。

## 启动

当前版本的任务工作区支持自动选择 Bot、手动指定、独立完成和自主组织文字协作。自主协作在任务内生成执行计划，显示每一步状态，并使用 5 或 8 次调用预算统一约束规划、执行和重试；工具与长期记忆默认关闭。

技能库（`/bots?view=bots`）内含 8 个随应用发布的原生适配规则模板：项目推进、会前准备、植物养护记录、文稿润色、通话跟进、方案压力测试、演示稿审阅和 Bot 设计。可查看完整规则与能力边界，修改名称、规则和启用状态；保存规则不调用模型，任务才调用已配置的模型。这些模板是随应用发布的本地目录，不自动下载第三方脚本或同步 Grok 账号。详见[市场适配与验证](../../../../docs/bot-market-adoption-2026-09-06.md)。

`/bots?view=market` 是为将来的官方市场预留的入口，目前为空，不代表已接入任何在线服务。见[官方市场与现有 Bot 分离](../../../../docs/official-market-separation-2026-09-07.md)。

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
| `/automations` | 自动化 | 管理重复任务、暂停、编辑和立即运行 |
| `/settings` | 设置 | 模型、连接器、数据保存和隐私 |

`/tasks`、`/spaces`、`/collaboration`、`/resources`、`/artifacts`、`/runs` 和 `/memory` 仍由统一工作视图承接，但不占用一级导航。

首次使用时，先在 **设置 → 模型与服务** 配置并测试模型连接。任务首次发送后自动生成短标题；模型不可用时使用本地规则命名。

## 任务、能力和交接

任务支持直接聊聊、完成任务和学习辅导。小丑鱼是唯一面向用户的统筹入口；专家与教学策略在后台按任务动态选择。

当前能力页提供 15 项能力，覆盖研究、核验、办公文档、会议纪要、文字润色、演示、产品设计、市场简报、方案比较、商务推进、市场机会和扩展构建；OCR、文档转换、信息源发现等内部辅助能力可被聊天、文件或运行时调用，不单独占据能力首页。

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

发布前已通过 TypeScript 类型检查，以及工作台导航、Bot 市场、模型排队、自主协作、文件和产物流程的单元与隔离集成测试。真实模型账号、外部实时数据和复杂 Office 版式仍需在目标环境中单独验收。

常用只读接口：

```text
GET /api/version
GET /api/runtime
GET /api/llm
GET /api/capabilities
GET /api/agent/jobs
GET /api/memory?who=me
```
