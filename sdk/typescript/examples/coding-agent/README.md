# Example: Coding Agent

模拟一个 coding agent 跨 session 持久化用户偏好 + 项目知识。

## 运行

```bash
ANTHROPIC_API_KEY=sk-... npx tsx examples/coding-agent/index.ts
```

## 关键点

- **Session 1** 用户用自然语言告诉 agent 自己的偏好（缩进、测试目录约定）。
- mnemos 把这些抽成 `personal_semantic` + `procedural` 派生记忆。
- **Session 2** agent 启动时调 `getRelevantContext('新写一个 handler')`，自动把"4 空格缩进"+"测试放 tests/"等带回 prompt。
- 这就是为什么 mnemos 比"把对话历史塞进 prompt"更省 token 且更准。
