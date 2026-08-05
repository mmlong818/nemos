# 早期 v0.1 规范草案

状态复核：2026-08-06

本目录是 2026 年早期架构研究的归档，不是当前实现、公开 API 或开发承诺。它保留了当时对 REST、MCP、TypeScript/Python SDK 和云端形态的完整推演，方便追踪设计演变。

文中的 `example.invalid` 主机名、令牌和账号均为不可用示例。

## 当前事实入口

- 当前 TypeScript SDK： [SDK README](../sdk/typescript/README.md)
- 当前记忆核心边界： [0.7.x 设计基线](../sdk/typescript/docs/nemos-memory-v0.7-design.md)
- 当前本机应用： [小丑鱼 README](../sdk/typescript/examples/companion/README.md)
- 已采纳的架构决策： [RFC 索引](../rfcs/README.md)
- 文档导航：[资料入口](../docs/README.md)

## 归档内容

| 文件 | 历史用途 | 当前状态 |
| --- | --- | --- |
| [00-overview.md](00-overview.md) | v0.1 规范总览 | 归档草案 |
| [10-data-schema.md](10-data-schema.md) | 云端数据 Schema 设想 | 未作为当前 Schema 实施 |
| [20-rest-api.md](20-rest-api.md) | REST API 设想 | 未作为当前公开 API 实施 |
| [30-mcp-server.md](30-mcp-server.md) | MCP Server 设想 | 未作为当前公开服务实施 |
| [40-sdk-contract.md](40-sdk-contract.md) | TS/Python SDK 契约设想 | 已被当前 TypeScript SDK 取代 |

文件中的版本和约束仅适用于对应的历史草案。
