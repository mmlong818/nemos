# 小丑鱼（Clownfish）

> 一套本机优先的个人 AI 助理工作台：从交代一件事，到安排执行、处理文件、核验结果和沉淀记忆，都留在同一个工作空间。

**中文** · [English](README.en.md)

[![CI](https://github.com/mmlong818/nemos/actions/workflows/ci.yml/badge.svg)](https://github.com/mmlong818/nemos/actions/workflows/ci.yml)
[![版本](https://img.shields.io/badge/版本-v0.7.6-b33f72)](https://github.com/mmlong818/nemos/tree/v0.7.6)
[![Node](https://img.shields.io/badge/Node-%E2%89%A522.19-brightgreen)](#本机运行)
[![状态](https://img.shields.io/badge/状态-Alpha-orange)](ROADMAP.md)
[![许可](https://img.shields.io/badge/许可-PolyForm%20Noncommercial-blue)](LICENSE)

> [!IMPORTANT]
> 本仓库采用 [PolyForm Noncommercial 1.0.0](LICENSE)，不是 OSI 认证的开源许可证。可非商业地使用、修改和分发；商业用途需要另行取得授权。第三方组件继续适用各自的许可，详见 [LICENSING.md](LICENSING.md) 与 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

![小丑鱼总览](docs/assets/readme/clownfish-overview-current.png)

> 图中界面均从当前本机服务实际截取，不是概念图或旧版原型。

## 产品概览

聊天窗口适合回答一个问题，却不擅长长期推进事情。小丑鱼把个人助理需要的几类对象放到同一个可追踪的工作台里：

- **助理**：和用户沟通、澄清目标、选择工作方式并统一交付；
- **事项**：需要持续跟进的目标、下一步和结果；
- **任务**：进入队列的一次具体执行，保留状态、附件、过程与回执；
- **Bot / 技能**：可复用的角色与工作方法，不是另一个模型，也不是一段可以任意执行的外部脚本；
- **能力 / 工具**：能力负责一条完整流程，工具负责其中一次受权限约束的操作；
- **记忆**：由用户查看、确认、修正和忘记的长期信息。

典型路径是：**告诉助理目标 → 自动选择技能与能力 → 排队或协作执行 → 核验并交付 → 必要内容经确认后进入记忆**。模型不支持并发时，任务队列负责等待与调度；多 Bot 协作只在任务确有需要时启用。

![小丑鱼助理工作区](docs/assets/readme/clownfish-assistant-current.png)

## 当前可以做什么

### 任务与协作

任务页是执行工作的主界面。可以直接输入目标、添加附件、选择模型，也可以让系统自动选择已启用的技能。附件先作为原文件保存，开始处理后才按任务需要读取；不会因为选中文件就自动提取正文。

运行过程保留检查点、取消、失败原因和交付回执。完成、等待用户补充、受阻、取消与“写操作结果不确定”是不同状态；空输出不会被冒充为完成，结果送达也不会仅因刷新页面而被误判。

团队任务可在阶段之间追加说明或调整目标。已经进入最终汇总时，系统会拒绝看似收到但无法纳入的追加要求，避免产生错误承诺。

![小丑鱼任务工作区](docs/assets/readme/clownfish-task-current.png)

### 技能、能力与文件

技能库存放可搜索、可检查来源和边界、可编辑的工作方法。随应用提供的模板用于项目推进、会前准备、文稿润色、方案核验等场景；用户自己的修改与内置模板分别保留版本。

技能市场是后续官方发布入口，**目前没有在线市场条目**。应用不连接 Grok Bot 账号，不同步第三方私人记忆，也不把公开 Bot 的原始提示词、脚本或插件打包进来。

能力中心承接研究、文档、演示、分析、设计和办公文件处理。文件工作台遵循“保留原件、编辑工作副本、导出新文件”：

- 可导入常见 Word、PowerPoint、Excel、PDF、OpenDocument、RTF、EPUB、CSV、TXT 和 Markdown；
- 可导出 DOCX、PDF、PPTX、XLSX、HTML 和 Markdown；
- TXT / Markdown 仅在明确授权并通过冲突检查后可写回；其他格式不覆盖原件；
- 复杂浮动对象、批注、公式、图表、母版和宏仍应由原文件及桌面 Office / WPS 保真承接。

“可安装”不等于“已经可用”。设置页会分别显示插件是否安装、依赖是否齐备、外部服务是否配置及是否经过真实检查：

- 安全 CSV / JSON 分析与 EML / ICS 文件解析在本机运行；后者不连接在线邮箱或日历；
- 浏览器操作需要安装随应用提供的 Playwright MCP，并使用本机已有的 Chrome、Edge 或 Chromium；
- 图像与视频生成需要用户自己的兼容服务地址和密钥；只完成配置时仍标记为“未验证”。

### 记忆

记忆分为已记住内容和待确认的学习提议。待确认内容必须由用户明确同意才进入长期记忆；已经记住的内容可以查看来源、修正或忘记。

普通任务只召回当前目标需要的内容，当前要求始终高于历史偏好。用户事实、助理自身内容与任务上下文分开保存，避免把不同主体混在一起。记忆内核来自独立依赖 [`@nemos/sdk`](https://github.com/mmlong818/nemos-memory)，本仓库不维护另一份复制品。

![小丑鱼记忆管理](docs/assets/readme/clownfish-memory-current.png)

### 模型

可以连接 OpenAI、Anthropic Claude、智谱 GLM、DeepSeek、通义千问、MiniMax，以及自定义 OpenAI / Anthropic 兼容服务。模型目录用于**发现候选**，不代表目录中的型号都能处理任务：

- 任意型号可以登记；只有实际检查通过后才显示相应的文字或工具能力；
- 检查模型可能产生少量模型费用，因此只在用户明确点击时发生；
- 目录数量、型号发布时间或名称都不能代替能力验证；
- 任务可选择模型和思考强度；需要工具的任务不会偷偷降级到仅文字模型。

模型调用账本只记录用途、型号、状态、耗时和服务商实际返回的用量；没有返回用量时显示“未知”，不猜测费用，也不保存完整提示词、回复或密钥。

![小丑鱼模型设置](docs/assets/readme/clownfish-models-current.png)

## 本机运行

需要 **Node.js ≥ 22.19**。当前以 Windows 为主要目标；Linux 和 macOS 可运行网页服务，但模型密钥保存依赖 Windows DPAPI，非 Windows 平台目前不能持久化密钥，详见[已知限制](docs/model-key-storage-non-windows-2026-09-08.md)。

```powershell
git clone https://github.com/mmlong818/nemos.git
cd nemos\sdk\typescript
npm install
npm run companion
```

打开 <http://localhost:8787>，在**设置 → 模型与服务**中保存连接。未配置模型时应用仍可浏览本机数据，但不会发起模型请求。

| 环境变量 | 作用 | 默认值 |
| --- | --- | --- |
| `PORT` | 网页服务端口 | `8787` |
| `CLOWNFISH_HOME` | 用户数据目录 | `~/.clownfish` |
| `CLOWNFISH_SYNC_TOKEN` | 可选自托管同步令牌 | 未设置 |

### Windows 便携客户端

```powershell
cd sdk\typescript
powershell -NoProfile -ExecutionPolicy Bypass -File examples\companion\client\Build-Clownfish.ps1
```

构建产物位于 `examples\companion\client\dist\portable\小丑鱼`。便携包是独立客户端外壳，模型与用户数据仍按本机配置保存。

## 数据与安全边界

- 网页服务默认只监听 `127.0.0.1`，用户数据默认保存在 `~/.clownfish`；
- Windows 下模型密钥使用当前用户的 DPAPI 加密，接口不会回显完整密钥；
- 附件、任务和记忆不会因为浏览页面而发给模型；只有实际执行相关任务时，所选材料才可能发往用户配置的服务；
- 扩展和工具接受权限、网络与运行审计；需要启动本机进程或外部访问时，界面会说明边界；
- 可选同步服务只保存 AES-256-GCM 加密快照，本机继续作为工作副本；远程部署必须使用 HTTPS。

```powershell
$env:CLOWNFISH_SYNC_TOKEN="请替换为至少24位随机令牌"
docker compose up -d --build
```

隐私与删除规则见 [PRIVACY.md](PRIVACY.md)，安全问题请按 [SECURITY.md](SECURITY.md) 私密报告。

## 当前限制

- 产品仍处于 **Alpha**，数据模型与公开 API 可能变化；
- 界面目前主要为中文，桌面能力以 Windows 为主要验证环境；
- 官方技能市场尚未开放；在线邮箱、在线日历、GitHub 和企业文档没有普通用户可直接使用的内置账号连接；
- 不内置动车、航班、酒店、餐馆等实时交易适配器；实时结果只有在可靠来源实际返回时才会标记为已确认；
- 模型、媒体服务和复杂 Office 文件来自外部环境，自动化测试通过不等于每个账号、型号或版式都已人工核验；
- 等待补充或受阻的任务目前通常需要新建任务继续，不能把运行中转向理解为任意阶段的无损恢复。

## 仓库结构

| 目录 | 内容 |
| --- | --- |
| [`sdk/typescript/`](sdk/typescript/) | TypeScript 接入层与可审计 Agent 运行时 |
| [`sdk/typescript/examples/companion/`](sdk/typescript/examples/companion/) | 小丑鱼服务端、网页界面、能力与客户端 |
| [`sync-service/`](sync-service/) | 可选的自托管加密同步服务 |
| [`docs/`](docs/) | 当前架构、设计决策、运维与验证记录 |
| [`bench/`](bench/) | 记忆基准与冻结结果 |
| [`spec/`](spec/) · [`rfcs/`](rfcs/) · [`archive/`](archive/) | 已归档的早期规范、RFC 与过程材料 |

## 验证与开发

当前提交的构建、类型检查与 **841 项自动化测试无失败**；依赖 Blender 或特定平台条件的用例会在环境不满足时明确跳过。这个数字只说明受覆盖的代码路径，不代表所有外部服务均已验收。

```powershell
cd sdk\typescript
npm run check
cd ..\..
node scripts\verify-docs.mjs
```

应用使用与运维见[小丑鱼应用说明](sdk/typescript/examples/companion/README.md)，Agent 与权限设计见[运行时设计](sdk/typescript/examples/companion/docs/agent-runtime-design.md)，公开文档从[文档导航](docs/README.md)进入。

欢迎提交 Bug、测试、文档和设计改进。新增能力必须有真实实现与验证，不能只增加文案或提示词。开始前请阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。
