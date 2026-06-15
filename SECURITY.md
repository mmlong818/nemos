# Security Policy

## 范围

本文档覆盖 nemos 项目的：
- 协议规范（`spec/`）的设计层缺陷
- 引用实现（`server/`、`sdk/`）的代码层缺陷
- 文档（`docs/`、`rfcs/`）误导导致的安全风险

特别关注：
- 隐私数据泄漏（含 E2EE 模式下的 metadata leak）
- 多租户隔离失败
- AI 应用之间的 scope 越权
- Source 标签伪造（AI 推断内容被冒充为用户明确陈述）
- 跨厂商 export 时的敏感字段处理

## 报告方式

**不要在公开 issue 报告安全问题。**

发送邮件到：`<security-email-placeholder>`（待项目实例化后填）。

PGP key fingerprint（待真上线后填）：`<pgp-fingerprint-placeholder>`

报告中请包含：
- 影响范围（哪个组件、哪个版本、哪个 SKU）
- 重现步骤
- 实际影响 vs 潜在影响
- 你建议的缓解方案（可选）

## 响应 SLA

| 严重程度 | 确认 | 修复发布 |
|---|---|---|
| **Critical**（数据泄漏 / 远程代码执行 / 跨租户隔离失败） | 48 小时内 | 7 天内 |
| **High**（认证绕过 / 权限提升） | 7 天内 | 30 天内 |
| **Medium**（信息泄漏不含 PII） | 14 天内 | 60 天内 |
| **Low**（最佳实践缺失） | 30 天内 | 视情况 |

## 披露原则

- Coordinated disclosure：在修复发布前不公开细节
- Credit：除非报告者要求匿名，会在发布说明里致谢
- 修复发布后 30 天，CVE 申请（如适用）

## 安全设计原则（贯穿 spec / 实现 / 运维）

nemos 在 spec 层就明确以下硬约束：
1. **derived 内容不能进入 authoritative 通道**（防 AI 自污染）
2. **archival 是 immutable**（防 reflect 改写历史）
3. **跨 scope 读取必须经过 Manifest 授权**（多 agent 防串供）
4. **E2EE SKU 下服务端不可见的字段必须在 schema 标注**
5. **关系类记忆需要 principal 同意**（防单方面共享）
6. **死后默认 archive-only**（防 AI 冒充已故用户发言）

任何违反上述原则的报告应优先处理（无论实施层是否真触发漏洞）。

## 自托管运维者

如果你运营 nemos 自托管实例：
- 订阅本仓库 release notifications 获取安全补丁
- 关注 `SECURITY-ADVISORIES.md`（首次披露后添加）
- 推荐配置：见 `docs/operator-guide.md` § "安全 hardening 清单"
