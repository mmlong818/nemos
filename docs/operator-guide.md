# 本机运行与运维指南

更新：2026-08-06

本文只覆盖当前可运行的 TypeScript SDK 和小丑鱼本机应用，不描述尚未交付的云服务。

## 1. 系统要求

- Node.js 20 或更高版本；
- Windows 便携客户端需要 .NET Framework C# 编译器；
- 构建便携版时需要网络下载 WebView2、Node 和 Python 运行时。

## 2. 启动

~~~powershell
cd sdk\typescript
npm install
npm run companion
~~~

默认端口：**8787**
默认数据目录：**~/.clownfish**

~~~powershell
$env:PORT="8791"
$env:CLOWNFISH_HOME="D:\clownfish-data"
npm run companion
~~~

## 3. 数据

重点文件：

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

数据库、DPAPI 文件和用户交付物不得提交到 Git。

## 4. 备份

Windows 客户端启动时会创建数据备份，并保留最近 10 份。开发者模式也可以导出 JSON 备份。

重大升级前：

1. 关闭小丑鱼；
2. 复制整个数据目录；
3. 确认数据库、任务、交付物和 DPAPI 配置均在备份中；
4. 再替换程序文件。

DPAPI 密钥文件通常只能由同一 Windows 用户解密。

## 5. 升级

- 用户数据与程序目录分离；
- 新程序可以继续使用原数据目录；
- 新目录不存在且检测到旧版目录时，会沿用旧目录；
- 升级前先运行构建和测试；
- 数据迁移失败时保留原文件并查看日志。

## 6. 日志与诊断

常用接口：

~~~text
GET /api/version
GET /api/runtime
GET /api/llm-config
GET /api/agent/jobs
GET /api/agent/runs
GET /api/memory?who=me
~~~

日志和运行记录会脱敏常见凭证字段，但仍应限制数据目录访问权限。

## 7. 安全

- 不把 API Key 写入命令历史、任务正文或日志；
- 只监听本机地址，除非另行实现认证和网络隔离；
- 不把当前本机服务直接暴露公网；
- 扩展缺少沙箱时保持禁用；
- 分享便携包前检查不含用户数据目录；
- 调用外部模型和联网来源前明确数据边界。

## 8. 恢复

任务失败时优先在运行页查看错误。排队或运行任务可取消；失败和取消任务可受保护地重试。

如果数据库损坏：

1. 停止服务；
2. 复制损坏文件以供诊断；
3. 从最近完整备份恢复整个数据目录；
4. 启动后检查版本、模型连接、任务和记忆页面。
