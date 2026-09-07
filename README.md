# 小丑鱼（Clownfish）

**中文** · [English](README.en.md)

[![CI](https://github.com/mmlong818/nemos/actions/workflows/ci.yml/badge.svg)](https://github.com/mmlong818/nemos/actions/workflows/ci.yml)
[![版本](https://img.shields.io/badge/版本-v0.2.3-b33f72)](https://github.com/mmlong818/nemos/tree/v0.2.3)
[![License](https://img.shields.io/badge/接入层-PolyForm%20Noncommercial%201.0.0-blue)](LICENSE)
[![Node](https://img.shields.io/badge/Node-%E2%89%A522.19-brightgreen)](#本地运行)

小丑鱼是一款**本机优先、带长期记忆、能够真实执行任务的 AI 工作应用**。用户只需要描述目标；小丑鱼负责选择能力、调用专业执行单元、处理文件，并把过程和结果留在同一个任务中。

本地更新：新增 `/bots` 助理团队，支持专职 Bot 工作规则、任务级共享、交接回执、独立核验与自动汇总。当前团队仅处理文字，工具关闭；现有文件与能力入口保留。已生成独立便携预览版，未覆盖旧客户端；详见[便携版验收边界](docs/bot-market-release-2026-09-06.md)。

Bot 市场入口：`/bots?view=market`。首批提供项目推进、会前准备、植物养护记录三个原生适配 Bot，可搜索、筛选、查看来源与边界、添加并编辑自己的版本，再发起协作任务。仅借鉴 Grok 公开模板的工作流程，不打包其原提示词、脚本、个人记忆或插件；不是 Grok 市场镜像。详见[市场适配与验证](docs/bot-market-adoption-2026-09-06.md)。

## v0.2.3 正式版

本版本完成了能力真实质量验收，并统一应用、桌面壳、清单和文档版本。23 项内置能力均有真实执行路径；复杂能力拥有独立超时和结构修复边界；设置中心提供与当前版本绑定的隐私协议入口。

![小丑鱼任务界面](docs/assets/readme/clownfish-chat-2026-08-16.png)

## 现在可以做什么

| 入口 | 用户操作 | 交付结果 |
| --- | --- | --- |
| **任务** | 直接说明想完成的事情，可附加图片和文件 | 可继续的任务记录、自动标题、执行进度与结果 |
| **能力** | 自动选择或直接启动专门能力 | 研究、文档、演示、分析、设计等结构化成果 |
| **文件** | 打开常见办公文件，转换后编辑、处理和导出 | 原文件、可编辑副本、版本记录与新导出文件 |
| **自动化** | 管理需要重复执行的任务 | 可暂停、编辑、立即执行的计划任务 |
| **设置** | 配置模型、连接器和数据保存 | 加密配置、连接状态与本地/自托管保存方式 |

这些入口共享任务、附件、决定和产物编号。任务转交给能力时会携带完整原文、提炼后的上下文、附件和已有决定，不会只传最后一句话。

## 任务与协作

新任务支持三种方式：

- **直接聊聊**：问答、讨论和临时处理；
- **完成任务**：围绕明确结果持续推进，可在后台并行执行；
- **学习辅导**：使用讲解、追问、练习和反馈帮助理解。

小丑鱼是统一的用户入口。专家不是需要配置或一对一聊天的角色，而是按本轮任务动态选择的内部执行单元；任务变化时，参与的专业判断也会重新选择。最终结果始终由小丑鱼整合和交付。

任务运行保留检查点、取消、失败原因、重试入口和交付回执。运行完成与结果送达分开记录，刷新或重启不会把未送达结果误标为完成。

## 能力工作台

当前内置 23 项能力，主要分为：

- **研究与核验**：深度研究、信息源发现、决策辅助、市场资料简报；
- **办公与内容**：文档稿、文档转换、OCR、会议纪要、文章润色、HTML 报告；
- **演示与设计**：演示文稿、产品设计、图片提示词反推；
- **工作与商业**：任务工作台、群聊进展、流程搭建、商务推进、市场机会模拟；
- **能力扩展**：生成新能力。

能力页默认展示全部常用能力。用户也可以先输入目标，让系统自动选择。能力之间可以连续流转，仍沿用原任务及其完整上下文。

底层采用统一能力注册表：**工具**负责一次真实操作，**能力**负责完整做事流程，**服务提供方**负责模型、搜索、语音和图像等外部连接。任务、学习辅导、能力、文件和工作入口只组合自己需要的工具，并共享就绪检查；MCP 与其他扩展保留独立生命周期，只在请求命中时加载。界面可以直接说明某项能力是否可用以及缺少什么配置。

工具状态会区分“可直接调用”和“由产品流程承接”，不会把只有提示词的能力冒充成独立工具。直接调用会保存工具来源、开始与完成时间、耗时及结果截断状态，过长结果会明确提示缩小范围。

设置中心还提供四组按需安装的能力插件：微软官方 Playwright MCP 浏览器、安全 CSV/JSON 分析、EML/ICS 文件整理，以及通过用户自有 OpenAI 兼容端点生成图像和视频。数据分析与 EML/ICS 整理完全在本机运行；浏览器需要本机 Chrome；图像和视频生成需要用户自己的媒体 API。安装前会显示权限和依赖，媒体密钥只从本机环境变量读取。

实时价格、余票、房态和订座等数据只有在可靠实时来源实际返回时才会标记为已确认；目前不内置动车、航班、酒店和餐馆的实时交易适配器。

![小丑鱼能力页](docs/assets/readme/clownfish-capabilities-2026-08-16.png)

## 文件工作台

支持 Word、PowerPoint、Excel、PDF、OpenDocument、RTF、EPUB、CSV、TXT 和 Markdown。

文件处理遵循一个清楚的边界：**原文件保留，转换成可编辑副本，导出时生成新文件。**

- Word 保留标题、段落、空行、连续空格、缩进、编号、表格和段落对齐等可转换结构；
- PDF 通过 AnyDoc 转换为可编辑 Markdown 副本，扫描版仍需要 OCR；
- PowerPoint 按页保留文字、表格和讲者备注；Excel 按工作表保留表格；
- TXT 与 Markdown 可在明确授权且通过冲突检查后写回原文件；
- 其他格式不覆盖原件，并显示转换变化和已知限制；
- 支持自动保存、版本比较、恢复、垃圾桶和独立导出；
- 可导出 DOCX、PDF、PPTX、XLSX、HTML 和 Markdown。

复杂浮动对象、批注、跨节页眉页脚、公式、图表、演示母版和电子表格公式仍由原文件或桌面 Office/WPS 保真承接。

![小丑鱼文件工作台](docs/assets/readme/clownfish-office-2026-08-16.png)

## 记忆、模型与数据

记忆内核来自独立依赖 [`@nemos/sdk`](https://github.com/mmlong818/nemos-memory)，本仓库不保留重复副本。

- 用户事实、角色自身内容和任务上下文分开保存，避免身份互换；
- 普通任务只召回当前问题需要的内容；
- 能力可以只采用文笔、排版和格式等少量交付习惯，也可单次关闭；
- 当前任务的明确要求始终高于历史偏好；
- 记忆页只展示用户可理解的分类内容，不暴露内部原始归档。

模型设置支持智谱 GLM、OpenAI、Anthropic Claude、DeepSeek、通义千问、MiniMax 和自定义 OpenAI/Anthropic 兼容服务。日常请求可使用轻量模型，复杂任务和能力使用主任务模型。Windows 下密钥使用当前用户的 DPAPI 加密，接口不会回显完整密钥。

默认数据目录为 `~/.clownfish`。默认纯本地保存；也可以连接仓库提供的 Docker 同步服务。客户端使用 AES-256-GCM 加密快照，服务器只保存密文，本机仍是工作副本。

```powershell
$env:CLOWNFISH_SYNC_TOKEN="请替换为至少24位随机令牌"
docker compose up -d --build
```

本机服务可使用 `http://127.0.0.1:8799`，远程部署必须使用 HTTPS。

## 已验证状态

截至 2026-08-17：

- 构建和类型检查通过；
- **483 项自动化测试：482 项通过，1 项因本机缺少 Blender 跳过**；
- 官方 Playwright MCP 已完成真实进程发现；媒体连接器完成本机模拟 API 的生成、查询和下载闭环；
- 文档转换、Office 导出、任务恢复和加密同步均有自动化验证。

测试证明具体代码路径工作，不等于所有外部模型账号、实时数据源或复杂 Office 版式都已人工核验。

## 本地运行

需要 Node.js 22.19 或更高版本。

```powershell
cd sdk\typescript
npm install
npm run companion
```

打开 <http://localhost:8787>。使用 `PORT` 修改端口，使用 `CLOWNFISH_HOME` 修改数据目录。

### Windows 便携客户端

```powershell
cd sdk\typescript
powershell -NoProfile -ExecutionPolicy Bypass -File examples\companion\client\Build-Clownfish.ps1
```

输出目录：`examples\companion\client\dist\portable\小丑鱼`。

## 文档

| 文档 | 用途 |
| --- | --- |
| [应用使用与运维说明](sdk/typescript/examples/companion/README.md) | 页面、数据、接口与桌面构建 |
| [TypeScript 接入层](sdk/typescript/README.md) | Agent 运行时导出与记忆 API |
| [记忆架构](docs/architecture-overview.md) | 当前实现结构和边界 |
| [Agent 运行架构](sdk/typescript/examples/companion/docs/agent-runtime-design.md) | 任务、工具、权限与恢复 |
| [文档导航](docs/README.md) | 全部公开文档入口 |
| [安全策略](SECURITY.md) | 漏洞报告方式 |
| [隐私协议](PRIVACY.md) | 本机数据、外部服务、同步、导出与删除边界 |

## 授权

以 [LICENSING.md](LICENSING.md) 为准：

- TypeScript 接入层、Agent 运行时与公开研究资料采用 [PolyForm Noncommercial 1.0.0](LICENSE)；
- 独立记忆内核 `@nemos/sdk` 以其仓库许可证为准；
- 小丑鱼应用 `sdk/typescript/examples/companion/` 保留全部权利，见其[单独声明](sdk/typescript/examples/companion/LICENSE)；
- 随包分发的开源组件、版本与许可证见[第三方软件声明](THIRD_PARTY_NOTICES.md)。

严格来说，本仓库整体不是单一 OSI 开源许可证项目：接入层是非商业源码开放，小丑鱼应用另行授权，第三方组件继续适用各自的开源或软件许可条款。
