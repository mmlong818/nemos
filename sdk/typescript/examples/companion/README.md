# 小丑鱼本机应用

当前应用版本：**0.2.19**
内置记忆核心：**Nemos 0.7.5-alpha.17**
文档复核：**2026-08-06**

小丑鱼可以作为网页应用运行，也可以构建成 Windows 便携客户端。聊天、能力、文件和工作页共享同一套本机数据。

## 快速运行

在 **sdk/typescript** 目录执行：

~~~powershell
npm install
npm run companion
~~~

默认打开 <http://localhost:8787>。

可用环境变量：

| 变量 | 作用 |
|---|---|
| **PORT** | 修改服务端口 |
| **CLOWNFISH_HOME** | 修改应用数据目录 |
| **COMPANION_USER** | 指定本机用户命名空间；服务部署时应由可信身份映射 |

## 首次使用

1. 设置称呼；
2. 在 **设置 → 模型连接** 中选择服务商、模型和 API Key；
   日常单人对话会自动使用轻量模型，专家、能力和复杂任务继续使用这里配置的主模型；
3. 连接测试通过后保存；
4. 从聊天直接描述目标，或进入能力、文件和工作页。

离线模式仍可浏览界面、管理本机内容，以及使用不需要模型的功能。

## 当前页面

| 路径 | 页面 | 主要用途 |
|---|---|---|
| **/** | 聊天 | 单聊、群聊、历史、分支、图片和语音 |
| **/capabilities** | 能力 | 自动选择或直接选择能力，启动并跟踪任务 |
| **/office** | 文件 | 打开、编辑、处理和导出办公文件 |
| **/tasks** | 工作 | 任务与计划 |
| **/artifacts** | 结果 | 查看和下载交付物 |
| **/runs** | 运行 | 运行、失败、取消、重试和恢复 |
| **/memory** | 记忆 | 查看分类记忆，添加或忘记习惯 |

## 内置能力

当前能力页提供 13 项能力：

1. 做 PPT
2. 写正式文档
3. 深度研究
4. 查港股资料
5. 梳理复杂问题
6. 设计产品界面
7. 整理会议纪要
8. 做网页报告
9. 比较方案
10. 推进商务合作
11. 模拟市场机会
12. 生成新能力
13. 开发项目（指定本地项目文件夹后，可选择只读检查或开发并验证）

## 文件工作台

- 读取 DOCX、PPTX、XLSX 和 PDF；
- 原文件保留在浏览器本机存储中，不被工作副本覆盖；
- PDF 使用原始文件预览，Office 文件提供结构化预览；
- 编辑和 AI 处理都留在文件页；
- 支持版本记录与恢复；
- 导出 DOCX、PDF、PPTX、XLSX、HTML 和 Markdown。

## 记忆行为

### 普通对话

- 用户消息进入用户命名空间；
- 角色回复进入该角色自己的命名空间；
- 召回只读取当前角色可见的会话范围；
- 原始归档与分类记忆分开保存；
- 反思、事实失效和领域路由由统一记忆配置开启。

### 能力与文件

- 能力页可选择 **使用我的习惯** 或关闭偏好召回；
- 已完成结果可连同完整原文和提要继续交给另一项能力；
- 开发项目只访问用户明确填写的文件夹，不读取密钥，不删除文件，也不执行推送、发布或部署；
- 文件页的 AI 处理使用偏好召回；
- 偏好召回只查 **procedural** 与 **personal_semantic**；
- 先取最多 12 个候选，再筛选与习惯、文笔、排版或格式相关的最多 6 项；
- 当前请求仍是任务主指令。

### 用户控制

- 记忆页可以明确写入一条全局习惯；
- 可以忘记单条非归档记忆；
- 原始归档受保护，不会被单条忘记或分类清理删除；

## 模型和网络边界

预设服务商包括智谱 GLM、OpenAI、Anthropic Claude、DeepSeek、通义千问、MiniMax 和自定义服务。

- 调用模型时，任务内容和必要上下文会发送给所选服务商；
- 使用联网搜索、公开来源或 X 连接时会访问对应网络服务；
- Windows 保存的模型 Key 使用当前用户的 DPAPI 加密；
- 接口与日志不应返回完整密钥；
- 工具、MCP 和 Agent App 按清单、权限和沙箱边界执行。

## 数据目录

默认目录：

~~~text
~/.clownfish
~~~

主要文件：

~~~text
companion.db
user-profile.json
llm-key.dpapi.json
tool-settings.dpapi.json
agent-runs.json
agent-jobs.json
agent-approvals.json
agent-extensions.json
capabilities/
backups/
logs/
~~~

旧版数据目录仅在新目录不存在时自动沿用。

## Windows 便携客户端

~~~powershell
powershell -NoProfile -ExecutionPolicy Bypass -File examples\companion\client\Build-Clownfish.ps1
~~~

构建脚本会下载并校验：

- Microsoft WebView2 SDK；
- Node 26.5.0 沙箱运行时；
- Python 3.14.6 嵌入式运行时。

输出目录：

~~~text
examples\companion\client\dist\portable\小丑鱼
~~~

用户数据默认不在程序目录。分享便携包前仍应检查是否误带 **~/.clownfish** 或自定义数据目录。

## 验证

~~~powershell
npm run build
npm test
~~~

常用只读接口：

~~~text
GET /api/version
GET /api/runtime
GET /api/llm-config
GET /api/capabilities
GET /api/agent/jobs
GET /api/memory?who=me
~~~
