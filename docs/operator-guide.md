# 运维指南

给自托管（SKU c）或小规模引用云（SKU a）的运维者。

详细实施在 Round 2 引用实现完成后补充——本文是占位 + 决策档。

---

## 系统要求（按 sizing study §10 估算）

| DAU | CPU | RAM | 磁盘 | 月度成本估算（公共云供应商） |
|---|---|---|---|---|
| 100（自用/小社区） | 1 vCPU | 2 GB | 50 GB | ~$10-20 |
| 1k | 2 vCPU | 4 GB | 500 GB | ~$131 |
| 10k | 4 vCPU + replica | 16 GB | 5 TB | ~$700-1k |
| 100k | Citus 分片 + dedicated index | 64 GB+ | 50 TB | ~$7.1k |

实际数据见 `../../memory-research/_meta/v2-sizing-study.md`。

---

## 部署形态

### SKU c · 自托管单二进制（推荐起点）

```
nemos-server  # Go single binary
├── 自带 embedded SQLite + sqlite-vec
├── REST + MCP server 同进程暴露
└── 配置 via 环境变量 / config.toml
```

启动（待 Round 2 实施后补具体命令）：
```bash
nemos serve --config /etc/nemos/config.toml
# or
docker run -d nemos/nemos:latest
```

适合：单用户、家庭、小团队（< 100 用户）

### SKU c · Postgres 模式（扩展）

```
nemos-server  + Postgres (with pgvector)
                + optional Redis cache
```

适合：100-10k 用户的自托管 / 小社区云

### SKU a · 引用云

需额外：
- 多租户 namespace 配置
- 用户 sign-up / billing（待 Round 2+ 决定方案）
- Backup / DR

不强求 k8s——sizing 中规模目标下 systemd + Docker Compose 已够。

---

## 配置（占位，等 Round 2 实施）

待具体配置项确定后补充。预期包含：
- 数据库连接
- 索引层选择（sqlite-vec / pgvector）
- 加密 key（含 E2EE 模式的客户端 key delegation）
- 速率限制
- 日志级别
- Metrics endpoint

---

## 备份与升级

### 备份

- 数据：DB dump + archival 文件（含 immutable 历史）
- 频率推荐：每日增量 + 每周全量
- archival 层因 immutable，可走 append-only 远程对象存储（S3/B2）

### Schema 迁移

nemos schema 版本号每条 memory 携带（`schema_version` 字段）。升级路径：
1. 先备份
2. 阅读 release notes 含 BREAKING-CHANGES 章节
3. 跑 `nemos migrate --dry-run` 验证
4. 跑 `nemos migrate` 应用

破坏性 schema 变更必须有 RFC + 30 天通知期。

---

## 监控

最小指标集（待 Round 2 实施后补完整 metric 名）：

- `nemos_query_latency_p50_ms` / `_p99_ms` — hot-path 关键
- `nemos_storage_bytes` — 容量增长
- `nemos_tenant_count` / `_user_count`
- `nemos_write_qps` / `_read_qps`
- `nemos_decay_jobs_completed_total`
- `nemos_contradiction_detected_total`
- `nemos_export_requests_total`

告警阈值：
- p99 latency > 500ms（持续 5 分钟）
- 存储使用率 > 80%
- decay job 落后 > 24h

---

## 安全 hardening 清单

启动生产实例前过一遍：

- [ ] 数据库密码 + API key 用 secret manager（不入仓库）
- [ ] TLS 全程（含 DB 连接）
- [ ] 网络隔离：DB 不直接暴露公网
- [ ] 速率限制：每 user / 每 API key 各自配额
- [ ] 备份加密 + 异地副本
- [ ] 审计日志（谁/何时/什么操作）至少保留 90 天
- [ ] 死后 archive-only 流程演练（虽然冷场景，但必备）
- [ ] PGP key 用于安全披露（见 SECURITY.md）
- [ ] PII 处理符合所在地区法规（GDPR/CCPA/PIPL 等）

E2EE 额外（SKU b）：
- [ ] 客户端 key 永不到服务端
- [ ] 服务端日志不记录 plaintext 字段
- [ ] 索引层不依赖服务端 plaintext

---

## 升级流程（建议）

1. 关注 GitHub release notification
2. 阅读 release notes 含 `BREAKING-CHANGES`
3. Stage 环境先验证（多租户：先 1 个 tenant 试）
4. 备份 + 演练回滚
5. 滚动升级（如 multi-replica）或停服窗口（单实例）
6. 验证关键 path（hot-path / write / reflect / export）

---

## 常见运维问题

待 Round 2 实施后补充 FAQ。
