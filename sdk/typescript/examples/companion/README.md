# Nemos Companion 示例客户端

这是 Nemos 的本机桌面客户端示例，也可以作为独立产品使用。

当前版本：`0.2.19`

## 使用方式

便携版解压后运行：

```text
Nemos Companion.exe
```

或：

```text
Start Nemos Companion.cmd
```

客户端会自动启动本机服务，并打开内置 WebView 界面。默认服务端口是 `8787`。

## 用户只需要配置什么

普通用户只需要在「设置」里填写一个智谱 Key。填写后会加密保存在当前 Windows 用户下，重启后仍然生效。

其他模型、ASR、私域源、X、开发者参数都应放在开发者模式里。

## 主要能力

- 微信式单聊和群聊
- 专家顾问角色：贝索斯、沃纳、诺曼、杜阿尔特、库珀、DHH、巴赫、海托华、汤普森、坎贝尔、高汀、罗斯、保罗·格雷厄姆等，可独立单聊，也会自动进入「Nemos 顾问团」；群聊默认由知微统一承载，@ 某位专家时该专家单独回复
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
- 能力与任务管理
- Skills URL 安装、本机安装与复用
- 预装 Skills 会在新机器首次启动时自动注册到本机能力层
- 已安装 Skill 会参与聊天里的自动能力选择；外部新增 Skills 需要用户手动安装或导入
- Agent 运行中心：查看运行、后台任务、失败原因和扩展状态
- 长任务持久排队、实时进度、可取消和受保护重试，完成后由角色交付
- Skill、MCP 与 Agent App 统一清单、按需加载和权限边界
- 受控多 Agent 编排：独立会话、预算、产物引用和失败隔离
- Markdown、HTML、JSON、文本、文档草稿输出
- 微信私域资料导入和 X 来源连接框架

## 数据目录

默认数据目录：

```text
~/.nemos-companion
```

可用环境变量覆盖：

```powershell
$env:NEMOS_COMPANION_HOME="D:\your-data-dir"
```

关键文件：

```text
companion.db                 本机记忆数据库
llm-key.dpapi.json           加密保存的智谱 Key
tool-settings.dpapi.json     工具配置
capabilities\                能力、任务、Skills 和交付物
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
powershell -NoProfile -ExecutionPolicy Bypass -File examples\companion\client\Build-NemosCompanion.ps1
```

构建输出：

```text
examples\companion\client\dist\portable\Nemos Companion
```

## 打包 zip

可以直接压缩便携目录，也可以从已部署目录打包：

```powershell
Compress-Archive -LiteralPath "examples\companion\client\dist\portable\Nemos Companion" -DestinationPath "Nemos Companion 0.2.19.zip" -Force
```

分享前确认压缩包内不包含 `~/.nemos-companion` 数据目录。

## 验证

```powershell
cd sdk/typescript
npm run build
```

常用接口：

```text
GET http://127.0.0.1:8787/api/version
GET http://127.0.0.1:8787/api/llm
GET http://127.0.0.1:8787/api/capabilities/tools
```

## 更新约定

- 程序版本写在 `examples/companion/client/manifest.json`
- 服务端 fallback 版本在 `examples/companion/server.ts`
- SDK 包版本在 `sdk/typescript/package.json`
- 更新部署版时替换程序目录即可，用户数据默认不在程序目录
- 测试期每次修改后清理本机测试数据，但保留 `llm-key.dpapi.json`、`tool-settings.dpapi.json` 和 `client-preferences.json`
