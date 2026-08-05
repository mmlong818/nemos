# 小丑鱼桌面客户端

这是小丑鱼的本机桌面客户端，也可以直接作为独立产品使用。

当前版本：`0.2.19`

## 使用方式

便携版解压后运行：

```text
小丑鱼.exe
```

或：

```text
启动小丑鱼.cmd
```

客户端会自动启动本机服务，并打开内置 WebView 界面。默认服务端口是 `8787`。

## 用户只需要配置什么

在「设置 → 模型连接」中选择模型服务商、填写模型名称和 API Key。客户端会先测试连接，再将配置加密保存在当前 Windows 用户下，重启后仍然生效。

界面内置智谱 GLM、OpenAI、Anthropic Claude、DeepSeek、通义千问、MiniMax 与自定义服务预设，并支持 OpenAI 兼容和 Anthropic 兼容协议。识图、联网搜索、语音和记忆向量是否可用，取决于所选服务与模型。

无 Key 时仍可浏览界面和使用本地功能；ASR、私域来源、X 与开发者参数放在对应设置或开发者模式中。

## 主要能力

- 微信式单聊和群聊
- 专家顾问角色：可行性顾问、产品顾问、决策顾问、思考教练、长期战略顾问、系统架构师、用户体验顾问、界面设计师、交互设计师、精简开发顾问、质量测试师、发布运维师、产业分析师、定价财务顾问、品牌定位顾问、销售增长顾问、创业验证顾问等，可独立单聊，也会自动进入「小丑鱼专家组」；群聊默认由小丑鱼统一承载，@ 某位专家时该专家单独回复
- 角色改名、人设修改、头像修改
- 用户自己的头像修改
- 首次启动称呼设置
- 本机长期记忆（开发源码核心 `0.7.5-alpha.17`：事实演化、时间召回、来源证据、长期重要性和可解释召回）
- 图片理解和 OCR
- 图片提示词反推：可见证据拆解、固定结构校验、完整/精简/复刻/负面提示词交付
- 网页链接读取
- 语音输入和语音通话
- 聊天导出 HTML
- 交付物在聊天气泡里查看和下载
- 对话中的目标可直接交给能力页，角色和任务要求会自动带入；运行状态与结果会回到原对话
- 对话树支持独立对话、分支、自动备份回退，以及每段对话单独设置模型、思考深度和工具范围
- 独立「工作」页集中管理任务、结果、运行记录和记忆偏好
- 12 项内置能力与任务管理：PPT、正式文档、深度研究、港股资料简报、复杂问题梳理、产品设计、会议纪要、网页报告、方案比较、商务推进、市场机会模拟和新能力生成
- Skills URL 安装、本机安装与复用
- 预装 Skills 会在新机器首次启动时自动注册到本机能力层
- 已安装 Skill 会参与聊天里的自动能力选择；外部新增 Skills 需要用户手动安装或导入
- Agent 运行中心：查看运行、后台任务、失败原因和扩展状态
- 长任务持久排队、实时进度、可取消和受保护重试，完成后由角色交付
- Skill、MCP 与 Agent App 统一清单、按需加载和权限边界
- 受控多 Agent 编排：独立会话、预算、产物引用和失败隔离
- 办公文件工作台：读取 DOCX、PPTX、XLSX、PDF，保存工作副本、版本比较与恢复，不覆盖原文件
- 真实导出 DOCX、PDF、PPTX、XLSX、HTML 和 Markdown；PPT 内容过密时返回版面复核提示
- 港股资料适配器：本机关注列表、港交所官方公告、带时间戳的第三方行情快照；只读且不执行交易
- 微信私域资料导入和 X 来源连接框架

## 数据目录

默认数据目录：

```text
~/.clownfish
```

可用环境变量覆盖：

```powershell
$env:CLOWNFISH_HOME="D:\your-data-dir"
```

关键文件：

```text
companion.db                 本机记忆数据库
llm-key.dpapi.json           加密保存的模型服务、模型名称和 API Key
tool-settings.dpapi.json     工具配置
capabilities\                能力、任务、Skills、市场关注列表和交付物
agent-runs.json              脱敏后的 Agent 运行与事件记录
agent-jobs.json              可恢复的后台任务队列
agent-extensions.json        Skill、MCP 与 Agent App 扩展注册表
logs\                        本机服务日志
```

## 开发运行

在 `sdk/typescript` 目录执行：

```powershell
npm install
npm run companion
```

然后打开：

```text
http://localhost:8787
```

## 构建便携版

在 `sdk/typescript` 目录执行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File examples\companion\client\Build-Clownfish.ps1
```

构建输出：

```text
examples\companion\client\dist\portable\小丑鱼
```

## 打包 zip

可以直接压缩便携目录，也可以从已部署目录打包：

```powershell
Compress-Archive -LiteralPath "examples\companion\client\dist\portable\小丑鱼" -DestinationPath "小丑鱼 0.2.19.zip" -Force
```

分享前确认压缩包内不包含 `~/.clownfish` 数据目录。旧版数据目录会自动沿用，不会丢失历史数据。

## 验证

```powershell
cd sdk/typescript
npm run build
```

常用接口：

```text
GET http://127.0.0.1:8787/api/version
GET http://127.0.0.1:8787/api/llm
GET http://127.0.0.1:8787/api/llm-config
GET http://127.0.0.1:8787/api/capabilities/tools
GET http://127.0.0.1:8787/api/market/watchlist
POST http://127.0.0.1:8787/api/market/snapshot
```

## 更新约定

- 程序版本写在 `examples/companion/client/manifest.json`
- 服务端 fallback 版本在 `examples/companion/server.ts`
- SDK 包版本在 `sdk/typescript/package.json`
- 更新部署版时替换程序目录即可，用户数据默认不在程序目录
- 测试期每次修改后清理本机测试数据，但保留 `llm-key.dpapi.json`、`tool-settings.dpapi.json` 和 `client-preferences.json`
