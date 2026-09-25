# 文档导航

**中文** · [English](README.en.md)

这里汇总小丑鱼应用、Nemos Memory SDK、开发接入与运维资料。

## 开始使用

| 文档 | 内容 |
| --- | --- |
| [项目首页](../README.md) | 产品能力、截图、隐私边界和本地运行 |
| [小丑鱼与 Nemos](intro.md) | 应用与记忆内核两个层次的关系 |
| [快速开始](getting-started.md) | 启动应用、构建客户端和验证代码 |
| [小丑鱼使用说明](../sdk/typescript/examples/companion/README.md) | 页面、数据目录、模型连接、构件沙箱和便携客户端 |
| [能力地图](../sdk/typescript/examples/companion/docs/clownfish-capability-map.md) | 面向用户的能力与默认交付结果 |
| [运维指南](operator-guide.md) | 备份、恢复、日志和安全操作 |

## 网络与安全

| 文档 | 内容 |
| --- | --- |
| [出站网络策略](network-policy.md) | 应用自身网页读取的主机名规则 |
| [出站代理](outbound-proxy.md) | 模型服务请求使用 HTTP(S) 代理的方式 |
| [非 Windows 密钥存储限制](model-key-storage-non-windows.md) | 当前密钥持久化依赖 Windows DPAPI |

## 开发与集成

| 文档 | 内容 |
| --- | --- |
| [TypeScript SDK](../sdk/typescript/README.md) | 安装、公开 API 和示例 |
| [English SDK Guide](../sdk/typescript/README.en.md) | English integration guide |
| [集成指南](integration-guide.md) | 用户隔离、写入、召回和生命周期 |
| [架构总览](architecture-overview.md) | 记忆分层、写入链路、召回和数据边界 |
| [RFC 流程](../rfcs/README.md) | 公开接口与数据模型变更的提案方式 |

公开接口以当前 SDK 类型、README、测试和发布元数据为准。
