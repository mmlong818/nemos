# 证据登记

更新：2026-08-13

可信等级：A 为本地代码或实际运行；B 为厂商官方资料；C 为第三方介绍，仅用于发现线索。

| 对象 | 证据 | 等级 | 已确认 | 仍需验证 |
|---|---|---:|---|---|
| WorkBuddy | 更新后的本机安装包、内置 CLI、技能目录、便携 Node/Git/Python、Office 编辑桥 | A | 存在完整本地执行底座、技能市场流程、专家包和 Office/WPS 编辑接口 | 使用当前账号逐项实际运行；外部服务可用性 |
| 小丑鱼 | `capabilities.ts`、`companion-agent-tools.ts`、`development-proposals.ts`、MCP 与沙箱实现 | A | 23 个内置能力、动态专家、任务持久化、授权、提案和回滚 | 每项能力的真实成功率和产物质量 |
| Claude Cowork | Anthropic 产品页、连接器与安全工程说明 | B | 本地文件、多步任务、桌面扩展、连接器、文件和网络代理 | Windows 当前版本的完整交互与限制 |
| OpenAI Codex | Codex App 官方介绍、Automations 官方说明 | B | 多线程、工作树、差异审阅、技能、自动化、审阅队列 | 非开发知识工作的具体文件编辑质量 |
| Microsoft 365 Copilot | Microsoft 365 官方博客和支持文档 | B | Word/Excel/PowerPoint 原位多步编辑、可编辑产物、修改控制 | 不同订阅和桌面版本的实际覆盖范围 |
| Manus | 官方材料待补充，当前只列为验证对象 | C | 可作为云端任务代理样本 | 必须补官方文档和真实任务验证后再采纳结论 |
| Genspark / GenOffice | 已有本机 GenOffice 安装分析；官网材料待补充 | A/C | 安装包存在文档、表格和演示集成组件 | 当前版本真实生成、编辑和导出流程 |
| ONLYOFFICE Docs | 官方 Docs API、版本与授权说明 | B | 可嵌入文档、表格、演示和 PDF 编辑器；Community 为 AGPL v3，面向闭源嵌入的 Developer 为商业许可 | Windows 本机部署成本、资源占用、中文复杂版式保真 |
| Collabora Online | 官方 CODE、集成与 FAQ | B | 基于 LibreOffice，支持主要 Office 格式，通过 WOPI 集成；CODE 不建议生产使用 | Windows 产品形态、生产授权与部署、嵌入交互质量 |

## 官方来源

- WorkBuddy 产品指南：https://www.codebuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Product-Guide
- Claude Cowork：https://www.anthropic.com/product/claude-cowork
- Claude 安全隔离：https://www.anthropic.com/engineering/how-we-contain-claude
- Codex App：https://openai.com/index/introducing-the-codex-app/
- Codex Automations：https://openai.com/academy/codex-automations/
- Microsoft 365 Copilot Office 原位能力：https://www.microsoft.com/en-us/microsoft-365/blog/2026/04/22/copilots-agentic-capabilities-in-word-excel-and-powerpoint-are-generally-available/
- Microsoft Office Agent Mode：https://support.microsoft.com/en-us/topic/get-started-with-agent-mode-in-word-excel-and-powerpoint-4d322d7f-5e89-4f66-9fa4-57d328b156ff
- ONLYOFFICE Docs API：https://api.onlyoffice.com/docs
- ONLYOFFICE 版本与许可：https://www.onlyoffice.com/compare-editions
- ONLYOFFICE Community 授权说明：https://helpcenter.onlyoffice.com/docs/faq/docs-community.aspx
- Collabora CODE：https://www.collaboraonline.com/code/
- Collabora 集成说明：https://www.collaboraonline.com/integrate-collabora-online/

## 下一轮取证顺序

1. WorkBuddy：开发、Office、技能安装、连接器、自动化各跑一条完整任务。
2. GenOffice：文档、表格、演示分别验证创建、修改和导出。
3. Claude Cowork：文件夹授权、长任务恢复、连接器权限。
4. Codex：隔离工作树、差异审阅、自动化审阅队列。
5. Manus 与其他云代理：只在取得官方证据或可实际使用后进入能力矩阵。
