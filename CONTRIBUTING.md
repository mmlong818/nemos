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

提交内容按本仓库的 PolyForm Noncommercial 1.0.0 许可提供。
