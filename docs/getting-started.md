# 快速开始

更新：2026-08-10

## 运行小丑鱼

需要 Node.js 22.19 或更高版本。

~~~powershell
cd sdk\typescript
npm install
npm run companion
~~~

打开 <http://localhost:8787>。

可选配置：

~~~powershell
$env:PORT="8791"
$env:CLOWNFISH_HOME="D:\clownfish-data"
npm run companion
~~~

首次启动后，点击左下角 **设置 → 模型与服务**，选择服务商、模型名称和 API Key。也可以保持离线模式。

连接成功后，日常单人对话会自动使用该服务商的轻量模型；专家、能力、文件生成和复杂任务使用设置中的主模型。

## 验证代码

~~~powershell
cd sdk\typescript
npm run build
npm test
~~~

## 构建 Windows 便携版

~~~powershell
cd sdk\typescript
powershell -NoProfile -ExecutionPolicy Bypass -File examples\companion\client\Build-Clownfish.ps1
~~~

构建过程会联网下载并校验 WebView2、Node 沙箱运行时和 Python 嵌入式运行时。

## 在其他 TypeScript 应用中使用记忆

~~~typescript
import { Nemos } from "@nemos/sdk";

const nemos = new Nemos({
  storage: { type: "sqlite", path: "./memory.db" },
  llm,
});

const memory = nemos.forUser(authenticatedUserId);
await memory.ingest("用户说：我偏好简洁中文");

const packet = await memory.recall("用户偏好什么表达方式？", {
  maxResults: 8,
  maxTokens: 1200,
});

await nemos.close();
~~~

集成方必须自己处理登录和授权。不要直接使用客户端提交的 userId。

## 继续阅读

- [小丑鱼使用说明](../sdk/typescript/examples/companion/README.md)
- [TypeScript SDK](../sdk/typescript/README.md)
- [架构总览](architecture-overview.md)
- [集成指南](integration-guide.md)
