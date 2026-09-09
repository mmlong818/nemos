# 小丑鱼（Clownfish）

> 本机优先、带长期记忆、能真实执行任务的 AI 工作应用。你描述目标，它选择能力、调用执行单元、处理文件，并把过程和结果留在同一个任务里。

**中文** · [English](README.en.md)

[![CI](https://github.com/mmlong818/nemos/actions/workflows/ci.yml/badge.svg)](https://github.com/mmlong818/nemos/actions/workflows/ci.yml)
[![版本](https://img.shields.io/badge/版本-v0.7.6-b33f72)](https://github.com/mmlong818/nemos/tree/v0.7.6)
[![License](https://img.shields.io/badge/本仓库代码-PolyForm%20Noncommercial%201.0.0-blue)](LICENSE)
[![Node](https://img.shields.io/badge/Node-%E2%89%A522.19-brightgreen)](#快速开始)
[![状态](https://img.shields.io/badge/状态-Alpha-orange)](ROADMAP.md)

> [!IMPORTANT]
> **本仓库不是 OSI 认证的开源项目。** 自有代码统一按 PolyForm Noncommercial 1.0.0 授权，包括小丑鱼应用：可非商业地使用、修改和分发，**商业用途需另行取得授权**。随包分发的第三方组件保留各自条款。商业使用前请先读 [LICENSING.md](LICENSING.md)。

![小丑鱼任务工作台](docs/assets/readme/clownfish-task-current.png)

## 这是什么

小丑鱼把任务、Bot、能力、文件、记忆和模型设置放进同一个工作台。核心路径是：**助理接收目标 → 自动分派到合适的 Bot/能力 → 进入任务队列 → 返回可追溯的结果**。所有页面共用同一套工作区结构，状态切换不会把用户带离主上下文。

![小丑鱼助理首页](docs/assets/readme/clownfish-assistant-current.png)

数据默认只留在本机（`~/.clownfish`），HTTP 服务只监听 `127.0.0.1`。模型调用需要你自己的 API 密钥；不配置密钥时应用仍可启动，但不会产生模型请求。

## 快速开始

需要 **Node.js ≥ 22.19**。Windows 优先支持（本机 Edge 渲染、文件关联、盘符/UNC 路径）。
Linux 与 macOS 可运行网页界面，但**保存不了模型密钥**——落盘加密用的是 Windows DPAPI，见[已知限制](docs/model-key-storage-non-windows-2026-09-08.md)。

```powershell
git clone https://github.com/mmlong818/nemos.git
cd nemos\sdk\typescript
npm install
npm run companion
```

打开 <http://localhost:8787>，在**设置 → 模型与服务**里填入任一模型服务的 API 密钥即可开始。

| 环境变量 | 作用 | 默认值 |
| --- | --- | --- |
| `PORT` | 网页服务端口 | `8787` |
| `CLOWNFISH_HOME` | 数据目录 | `~/.clownfish` |
| `CLOWNFISH_SYNC_TOKEN` | 自托管同步服务令牌 | 未设置（纯本地） |

### Windows 便携客户端

```powershell
cd sdk\typescript
powershell -NoProfile -ExecutionPolicy Bypass -File examples\companion\client\Build-Clownfish.ps1
```

输出目录：`examples\companion\client\dist\portable\小丑鱼`。

### 开发常用命令

```powershell
cd sdk\typescript
npm run build       # 构建（含 Office 编辑器打包）
npm run typecheck   # 类型检查
npm test            # 全部自动化测试
```

## 功能

| 入口 | 用户操作 | 交付结果 |
| --- | --- | --- |
| **任务** | 直接说明想完成的事情，可附加图片和文件 | 可继续的任务记录、自动标题、执行进度与结果 |
| **能力** | 自动选择或直接启动专门能力 | 研究、文档、演示、分析、设计等结构化成果 |
| **文件** | 打开常见办公文件，转换后编辑、处理和导出 | 原文件、可编辑副本、版本记录与新导出文件 |
| **自动化** | 管理需要重复执行的任务 | 可暂停、编辑、立即执行的计划任务 |
| **设置** | 配置模型、连接器和数据保存 | 加密配置、连接状态与本地/自托管保存方式 |

这些入口共享任务、附件、决定和产物编号。任务转交给能力时携带完整原文、提炼后的上下文、附件和已有决定，不会只传最后一句话。

### 任务与协作

四个概念分工明确：

- **助理**是唯一面向用户的统筹入口，负责理解目标、安排任务和交付结果；
- **Bot** 是可复用的工作角色和工作规则（如项目推进、会前准备、植物养护记录）；
- **能力**是可执行的完整流程（如文档转换、研究、演示生成、文件分析）；
- **工具**是一次具体操作（如读取文件、调用模型、运行连接器）。

专家不是需要单独配置或一对一聊天的角色，而是按本轮任务动态选择的内部执行单元；任务变化时参与的专业判断会重新选择，最终结果始终由小丑鱼整合交付。

任务运行保留检查点、取消、失败原因、重试入口和交付回执。**运行完成与结果送达分开记录**，刷新或重启不会把未送达结果误标为完成。

### 技能库与模板

技能库（`/bots?view=bots`）里有 8 个随应用发布的原生适配规则模板：项目推进、会前准备、植物养护记录、文稿润色、通话跟进、方案压力测试、演示稿审阅、Bot 设计。可搜索、筛选、查看来源与边界、编辑自己的版本。

这些模板**不同步 Grok 账号、不下载第三方脚本、不携带外部 Bot 的私人记忆**；仅借鉴公开模板的工作流程，不打包其原提示词、脚本或插件——不是 Grok 市场镜像。详见[市场适配与验证](docs/bot-market-adoption-2026-09-06.md)。

`/bots?view=market` 是为将来的官方市场预留的入口，**目前是空的**，不代表已经接入任何在线服务；你的规则、对话和任务记录不会被上传。见[官方市场与现有 Bot 分离](docs/official-market-separation-2026-09-07.md)。

模板可以携带**配方**（可复用流程与定时任务）。配方内容必须经过两步同意才落地，定时任务一律先建成暂停，详见[配方与同意门](docs/bot-recipe-2026-09-08.md)。

### 能力

能力页默认展示全部常用能力，也可以先输入目标让系统自动选择。能力之间可连续流转，仍沿用原任务及其完整上下文。覆盖范围：

- **研究与核验**：深度研究、信息源发现、决策辅助、市场资料简报；
- **办公与内容**：文档稿、文档转换、OCR、会议纪要、文章润色、HTML 报告；
- **演示与设计**：演示文稿、产品设计、图片提示词反推；
- **工作与商业**：任务工作台、群聊进展、流程搭建、商务推进、市场机会模拟；
- **能力扩展**：生成新能力。

底层是统一能力注册表：**工具**负责一次真实操作，**能力**负责完整做事流程，**服务提供方**负责模型、搜索、语音和图像等外部连接。界面会直接说明某项能力是否可用、缺少什么配置，并区分"可直接调用"与"由产品流程承接"——不会把只有提示词的能力冒充成独立工具。

设置中心提供四组按需安装的插件：官方 Playwright MCP 浏览器、安全 CSV/JSON 分析、EML/ICS 文件整理，以及通过你自有的 OpenAI 兼容端点生成图像和视频。数据分析与文件整理完全在本机运行；浏览器需要本机 Chrome；媒体生成需要你自己的 API，密钥只从本机环境变量读取。

> 实时价格、余票、房态和订座只有在可靠实时来源实际返回时才标记为已确认。**目前不内置动车、航班、酒店和餐馆的实时交易适配器。**

### 文件工作台

支持 Word、PowerPoint、Excel、PDF、OpenDocument、RTF、EPUB、CSV、TXT 和 Markdown。边界很清楚：**原文件保留，转换成可编辑副本，导出时生成新文件。**

- Word 保留标题、段落、空行、连续空格、缩进、编号、表格和段落对齐等可转换结构；
- PDF 通过 AnyDoc 转换为可编辑 Markdown 副本，扫描版仍需要 OCR；
- PowerPoint 按页保留文字、表格和讲者备注；Excel 按工作表保留表格；
- TXT 与 Markdown 可在明确授权且通过冲突检查后写回原文件；其他格式不覆盖原件，并显示转换变化与已知限制；
- 支持自动保存、版本比较、恢复、垃圾桶和独立导出；可导出 DOCX、PDF、PPTX、XLSX、HTML 和 Markdown。

复杂浮动对象、批注、跨节页眉页脚、公式、图表、演示母版和电子表格公式仍由原文件或桌面 Office/WPS 保真承接。

### 记忆、模型与数据

![小丑鱼记忆工作区](docs/assets/readme/clownfish-memory-current.png)

记忆分为已记住内容和待确认内容。**待确认内容必须经过用户明确确认才会进入长期记忆**，也可以随时撤回。

- 用户事实、角色自身内容和任务上下文分开保存，避免身份互换；
- 普通任务只召回当前问题需要的内容；
- 能力可以只采用文笔、排版、格式等少量交付习惯，也可单次关闭；
- 当前任务的明确要求始终高于历史偏好；
- 记忆页只展示用户可理解的分类内容，不暴露内部原始归档。

记忆内核来自独立依赖 [`@nemos/sdk`](https://github.com/mmlong818/nemos-memory)，本仓库不保留重复副本。

模型设置支持智谱 GLM、OpenAI、Anthropic Claude、DeepSeek、通义千问、MiniMax 和自定义 OpenAI/Anthropic 兼容服务。日常请求可使用轻量模型，复杂任务使用主任务模型。Windows 下密钥使用当前用户的 DPAPI 加密，接口不会回显完整密钥。

数据默认纯本地保存。也可以连接仓库自带的 Docker 同步服务：客户端使用 AES-256-GCM 加密快照，服务器只保存密文，本机仍是工作副本。

```powershell
$env:CLOWNFISH_SYNC_TOKEN="请替换为至少24位随机令牌"
docker compose up -d --build
```

本机服务可使用 `http://127.0.0.1:8799`；**远程部署必须使用 HTTPS。**

## 架构与仓库结构

| 目录 | 内容 |
| --- | --- |
| [`sdk/typescript/`](sdk/typescript/) | TypeScript 接入层与 Agent 运行时（模型循环、工具调度、审批、凭证代理） |
| [`sdk/typescript/examples/companion/`](sdk/typescript/examples/companion/) | 小丑鱼应用本体：服务端、网页界面、能力实现、Office 引擎 |
| [`sync-service/`](sync-service/) | 可选的自托管加密同步服务（Docker） |
| [`docs/`](docs/) | 公开文档：架构、设计评审、验证记录 |
| [`spec/`](spec/) | 记忆系统规范（数据模型、REST、MCP、SDK 契约） |
| [`rfcs/`](rfcs/) | 历史 RFC |
| [`bench/`](bench/) | 记忆基准与冻结结果 |
| [`paper/`](paper/) | 公开研究资料 |

记忆内核不在本仓库：正本在 [nemos-memory](https://github.com/mmlong818/nemos-memory)，按固定 tag 作为 `@nemos/sdk` 依赖引入。

## 项目状态

**Alpha。** 数据模型与公开 API 仍可能变化，升级前请看 [ROADMAP.md](ROADMAP.md)。

截至 2026-09-08：

- 构建和类型检查通过，772 项自动化测试无失败（CI 在 Linux 与 Windows 双平台运行；依赖 Blender 或 Windows DPAPI 的少数用例在缺少这些条件时按平台跳过）；
- 核心工作台、模型调度、Bot 市场、自主协作和文件流程均有单元及隔离集成测试；
- 官方 Playwright MCP 已完成真实进程发现；媒体连接器完成本机模拟 API 的生成、查询和下载闭环；
- 文档转换、Office 导出、任务恢复和加密同步均有自动化验证。

> 测试证明具体代码路径工作，**不等于**所有外部模型账号、实时数据源或复杂 Office 版式都已人工核验。

## 文档

| 文档 | 用途 |
| --- | --- |
| [文档导航](docs/README.md) | 全部公开文档入口 |
| [应用使用与运维说明](sdk/typescript/examples/companion/README.md) | 页面、数据、接口与桌面构建 |
| [TypeScript 接入层](sdk/typescript/README.md) | Agent 运行时导出与记忆 API |
| [记忆架构](docs/architecture-overview.md) | 当前实现结构和边界 |
| [Agent 运行架构](sdk/typescript/examples/companion/docs/agent-runtime-design.md) | 任务、工具、权限与恢复 |
| [失败注册表与工作准则](docs/failure-registry-2026-09-08.md) | 失败编号、权限规则层、在场契约 |
| [网络策略与沙箱现状](docs/network-policy-2026-09-08.md) | 出站允许名单、扩展沙箱的实际强制范围 |
| [四道门与提示指令预算](docs/agentic-workflow-2026-09-08.md) | 写代码前的对齐门、提示指令预算守卫 |
| [显式完成、调用账本与运行中转向](docs/cumora-adoption-2026-09-09.md) | 回合完成语义、目的级模型调用账本、阶段边界 merge/redirect |
| [统一上下文、交接与技能规则版本](docs/qm-adoption-2026-09-09.md) | 受限上下文快照、计划任务交接、模板与本地规则双版本 |
| [模型目录与资格检查](docs/model-catalog-adoption-2026-09-09.md) | 连接 revision、目录 stale、显式单型号检查与过期 |
| [出站代理](docs/outbound-proxy-2026-09-09.md) | 三种模式、覆盖范围、回环直连与凭据边界 |
| [出站代理](docs/outbound-proxy-2026-09-09.md) | 三种模式、覆盖范围、回环直连与凭据边界 |

## 参与贡献

欢迎代码、测试、文档、设计改进和问题报告。**新增能力必须有真实实现和测试，不能只添加文案或提示词。**

| 类型 | 路径 |
| --- | --- |
| Bug、文档勘误、小改进 | Issue 或直接 PR |
| 新公开 API、数据结构、破坏性变化 | 先开 Issue，必要时提 RFC |
| 安全问题 | 按 [SECURITY.md](SECURITY.md) **私密**报告，不要开公开 Issue |

先读 [贡献指南](CONTRIBUTING.md)，其余约定见 [行为准则](CODE_OF_CONDUCT.md) 与 [治理说明](GOVERNANCE.md)。提交前请确保 `npm run build`、`npm run typecheck`、`npm test` 全部通过。

## 安全与隐私

- 漏洞报告方式见 [SECURITY.md](SECURITY.md)；
- 本机数据、外部服务、同步、导出与删除边界见 [隐私协议](PRIVACY.md)。

## 授权

以 [LICENSING.md](LICENSING.md) 为准：

| 部分 | 许可 |
| --- | --- |
| TypeScript 接入层、Agent 运行时、公开研究资料 | [PolyForm Noncommercial 1.0.0](LICENSE)（非商业） |
| 小丑鱼应用 `sdk/typescript/examples/companion/` | [PolyForm Noncommercial 1.0.0](LICENSE)（非商业） |
| 记忆内核 `@nemos/sdk` | 以[其仓库](https://github.com/mmlong818/nemos-memory)许可证为准 |
| 随包分发的第三方组件 | 各自的开源或软件许可条款，见[第三方软件声明](THIRD_PARTY_NOTICES.md) |

再说明一次：PolyForm Noncommercial 不是 OSI 认证的开源许可证。自有代码可非商业地使用与修改，商业用途需另行取得授权；第三方组件继续适用各自条款。
