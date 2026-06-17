# 贡献指南 / Contributing to Nemos

欢迎为 Nemos 贡献。Nemos 是一个 AI agent 的开源个人记忆基础设施，我们对所有形式的贡献开放——代码、文档、设计、bug 报告、用例分享。

本项目仍处于 Phase 0（Pre-Alpha）。在引用实现落地之前，最有价值的贡献是 **spec 评审、RFC 讨论、设计反馈**。

---

## 三条贡献路径

| 路径 | 适用场景 | 流程 |
|---|---|---|
| **Issue** | bug 报告、问题讨论、文档勘误、小型功能建议 | 直接开 issue，使用对应模板 |
| **PR** | bug 修复、文档改进、非破坏性新增、向后兼容的小功能 | Fork → branch → PR，关联 issue |
| **RFC** | 协议/schema 变更、破坏性 API、新核心能力、governance/license/商业化决策 | 见 [`rfcs/README.md`](rfcs/README.md) |

不确定走哪条？先开 issue 问。

---

## Code of Conduct

参与本项目即表示你接受 [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md)。

---

## DCO（Developer Certificate of Origin）

Nemos 使用 **DCO sign-off** 而非 CLA。每个 commit 必须包含：

```
Signed-off-by: Your Name <your.email@example.com>
```

使用 `git commit -s` 自动添加。DCO 全文见 https://developercertificate.org/。简言之：你声明你有权提交这段代码，并以本项目 license（Apache-2.0）授权。

不接受未 sign-off 的 PR。

---

## 提交流程

### 1. 找到或开 issue

任何非琐碎改动都应有对应 issue。这避免重复劳动，也让 maintainer 提前给出方向反馈。

### 2. Fork & branch

```
git checkout -b feat/<short-description>
git checkout -b fix/<issue-number>-<short>
git checkout -b docs/<area>
```

### 3. 写代码 / 文档

- 遵循现有风格（具体语言风格指南待 sdk/server 落地后补）
- 加测试（任何代码改动，单元测试覆盖；spec 变更，加对应 conformance fixture）
- 更新相关文档

### 4. Commit message：Conventional Commits

```
<type>(<scope>): <subject>

<body>

Signed-off-by: Your Name <email>
```

**type**：`feat` / `fix` / `docs` / `refactor` / `test` / `chore` / `perf` / `ci` / `spec` / `rfc`

**scope**（可选）：`spec` / `sdk-ts` / `sdk-py` / `server` / `mcp` / `docs` / `rfc-NNNN` 等

**示例**：
```
feat(spec): add cross-vendor portability section to schema v0.2

Resolves discussion in RFC-0003.

Signed-off-by: Jane Doe <jane@example.com>
```

### 5. 开 PR

- 使用 PR 模板
- 关联 issue：`Closes #123` / `Refs #456`
- 标注是否包含破坏性变更
- CI 必须全绿（CI 在 Round 2 后启用，目前为手动检查）

### 6. Review

- 至少一位 maintainer approve
- 协议/schema 变更必须经 RFC 流程，不能直接 PR 改 `spec/`
- review 期 1-7 天，超时可在 PR 中 @ maintainer

### 7. Merge

- maintainer 执行 merge
- 默认 **squash merge**，commit message 由 maintainer 整理
- DCO sign-off 在 squash 后保留

---

## 代码风格

具体风格规范待 Round 2（实现阶段）补充。临时原则：

- 函数 < 50 行，文件 < 800 行
- 不可变优先（除非语言惯例不同）
- 显式错误处理，不静默吞错
- 不引入未在 issue/RFC 讨论过的依赖
- 不硬编码任何 secret

---

## 开发环境

> TODO：待 `sdk/` 和 `server/` 提交首批代码后补充具体命令。

预计将包括：
- Node.js LTS（SDK TypeScript / MCP server）
- Python 3.11+（SDK Python）
- Go 1.22+（self-host server 引用实现）
- Docker（本地起依赖：Postgres + pgvector）

---

## 怎么算"好贡献"

- **设计先于实现**：复杂改动先 issue/RFC 讨论
- **小而独立**：单个 PR 聚焦一件事
- **可验证**：附测试、附复现步骤、附 before/after
- **尊重 maintainer 时间**：先读相关 docs / RFCs / 既往讨论
- **承认未知**：不确定时直说，不要硬推

---

## 不接受的贡献

- 未 sign-off 的 commit
- 引入新依赖但未在 issue 讨论
- 同时改动 spec + 实现 + 文档的大杂烩 PR（拆成多个）
- 重写大段现有代码且无明确收益
- 加入"AI 替用户决策"特性（违反 Nemos 设计原则，见 [`rfcs/0001-nemos-design-principles.md`](rfcs/0001-nemos-design-principles.md)）

---

## 联系

- 一般讨论 / 问题：GitHub issue
- 安全漏洞：见 [`SECURITY.md`](SECURITY.md)
- 商业 / 法律 / governance 相关：`<maintainer-email-placeholder>`（TODO）

感谢贡献。
