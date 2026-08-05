# TypeScript 应用集成指南

更新：2026-08-06

## 1. 选择接入方式

当前正式接入面是嵌入式 TypeScript SDK。Python、独立 REST 服务和独立 MCP 记忆服务尚未交付。

## 2. 初始化

~~~typescript
import { Nemos } from "@nemos/sdk";

const nemos = new Nemos({
  tenantId: "my-product",
  storage: { type: "sqlite", path: "./memory.db" },
  llm,
  embedding,
});
~~~

LLM 和 embedding 可以使用内置配置或自定义 provider。Embedding 可省略。

## 3. 身份

~~~typescript
const memory = nemos.forUser(authenticatedUser.id);
~~~

要求：

- userId 来自服务端可信身份；
- 不从查询参数或请求正文直接相信 userId；
- 不把多个真实用户映射到同一默认值；
- tenantId 用于区分不同产品或部署。

SDK 不提供登录、权限、配额或计费。

## 4. 写入

~~~typescript
await memory.ingest("用户说：以后正式文档先给结论", {
  scenario: "chat",
  scope: "global",
});
~~~

对于明确结构化事实，可以使用 **write**，并填写来源、主体、谓词、对象和有效时间。

不要把模型总结标记为用户权威陈述。

## 5. 后台写入

~~~typescript
const handle = await memory.ingest(longDocument, {
  mode: "background",
  scenario: "doc-research",
});

const status = await memory.getIngestStatus(handle.id);
~~~

原始事件先保存，抽取在后台继续。调用方应显示真实阶段和失败。

## 6. 召回

~~~typescript
const packet = await memory.recall("用户目前偏好什么文档结构？", {
  maxResults: 8,
  maxTokens: 1200,
});

if (packet.reliable) {
  for (const item of packet.items) {
    console.log(item.memory.content, item.reasons);
  }
}
~~~

兼容接口：

- **search**：返回记忆数组；
- **getRelevantContext**：生成可放入模型提示的上下文；
- **explainRecall**：返回召回轨迹。

## 7. 纠正和失效

~~~typescript
await memory.correct(memoryId, {
  content: "更正：我现在住在上海",
  object: "上海",
});

await memory.invalidate(otherId, "用户确认该信息已失效");
~~~

不要直接覆盖旧事实；保留纠正和有效时间关系。

## 8. 忘记与导出

~~~typescript
await memory.forget(memoryId);
const json = await memory.export("json-ld");
const markdown = await memory.export("markdown");
~~~

archival 的删除限制取决于 SDK 不变量和调用方式。产品界面必须准确说明删除范围。

## 9. 关闭

~~~typescript
await nemos.close();
~~~

关闭会等待后台任务并释放 SQLite。

## 10. 安全清单

- 数据库文件不放进公开仓库；
- 密钥只从安全配置读取；
- 生产应用为每个用户使用稳定且不可猜测的服务端身份；
- 调用外部模型前说明数据会离开本机；
- 日志不记录原始密钥和完整敏感上下文；
- 多用户服务必须测试 tenantId 与 userId 隔离。
