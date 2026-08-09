# 贡献指南

欢迎提交代码、测试、文档、设计改进和问题报告。

## 当前范围

仓库包含：

- Nemos TypeScript 记忆 SDK；
- 小丑鱼本机应用；
- Agent Runtime；
- 记忆基准；
- 历史规范与 RFC。

当前处于 Alpha。新增能力必须有真实实现和测试，不能只添加文案或提示词。

## 贡献路径

| 类型 | 建议 |
|---|---|
| Bug、文档勘误、小改进 | Issue 或直接 PR |
| 新公开 API、数据结构、破坏性变化 | 先 Issue，必要时 RFC |
| 安全问题 | 按 [SECURITY.md](SECURITY.md) 私密报告 |

## 开发

~~~powershell
cd sdk\typescript
npm install
npm run build
npm test
~~~

仓库根目录还提供公开文档核验：

~~~powershell
node scripts\verify-docs.mjs
~~~

它会检查本地链接、能力数量、README 测试数、历史文档标识、冻结实验哈希与论文关键结果。

小丑鱼：

~~~powershell
npm run companion
~~~

## 修改要求

- 修改范围聚焦；
- 保持用户、角色和 tenant 隔离；
- 不把模型推断标记为用户权威事实；
- 新功能增加测试；
- 修改用户行为时同步更新 README 和相关文档；
- 不提交数据库、日志、密钥、令牌、私人配置或用户交付物；
- 外部模型、数据源和高影响写操作必须说明边界。

## 提交

使用 Conventional Commits，例如：

~~~text
feat(memory): add recall trace filter
fix(companion): keep office result on current page
docs: refresh current product guide
~~~

如项目要求 DCO，使用 **git commit -s** 添加 Signed-off-by。

## 设计与规范

- 当前公开 API 以类型定义、测试和 SDK README 为准；
- 架构变化通过 RFC 保留决策记录；
- 示例和文档应与当前版本保持一致。

## 行为准则

参与项目表示接受 [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)。

## 许可

本仓库采用双授权结构：`sdk/typescript/src/` 等 SDK 部分对外按 PolyForm
Noncommercial 1.0.0 提供，`sdk/typescript/examples/companion/`（小丑鱼应用）
保留全部权利并另行授权。完整说明见 [LICENSING.md](LICENSING.md)。

小丑鱼的打包产物内含 SDK 代码，因此提交贡献时需要一并给出商业再授权许可，
否则该贡献将无法随应用分发。

**提交 Pull Request 即表示你声明并同意：**

1. 你拥有所提交内容的著作权，或已获得足以作出本节授权的权利；
2. 你授予项目所有者一份永久、全球、非独占、免费、不可撤销、可转授的许可，
   允许其以任何条款（包括但不限于 PolyForm Noncommercial 及商业许可）
   使用、复制、修改、演绎、公开发布、分发与再授权你的贡献；
3. 你的贡献同时按本仓库当前适用的对外许可证向公众提供；
4. 你保留对自身贡献的著作权，本节授权为许可而非著作权转让。

若你代表雇主或其他组织提交，请确认已获得该组织的相应授权。无法作出上述
授权时，请在 issue 中说明，不要直接提交 Pull Request。
