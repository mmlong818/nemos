# 第三方软件声明

更新：2026-08-16

小丑鱼与 Nemos 使用或随包分发下列第三方软件。各组件仍由原权利人所有，并继续适用各自许可证；本仓库的许可证不会覆盖或替代这些条款。

## 主要运行组件

| 组件 | 当前版本 | 用途 | 许可证 | 上游 |
| --- | --- | --- | --- | --- |
| AnyDoc | 0.1.8 | 文档解析适配 | MIT | [firecrawl/anydoc](https://github.com/firecrawl/anydoc) |
| Microsoft WebView2 SDK | 1.0.4022.49 | Windows 桌面外壳 | Microsoft 软件许可条款 | [NuGet 包](https://www.nuget.org/packages/Microsoft.Web.WebView2/) |
| Node.js | 主机版本及 26.5.0 沙箱版本 | 应用与隔离工具运行时 | MIT 及随附第三方条款 | [nodejs/node](https://github.com/nodejs/node) |
| Python | 3.14.6 嵌入式版本 | 隔离工具运行时 | Python Software Foundation License | [python/cpython](https://github.com/python/cpython) |

## 纳入仓库的代码

| 本地位置 | 上游代码 | 上游提交 | 许可证 |
| --- | --- | --- | --- |
| `sdk/typescript/examples/companion/vendor/docx-engine/` | GenOffice `packages/docx-engine` | `185040fd2f9f3114db164ea435cf155f52aa0330` | Apache-2.0 |
| `sdk/typescript/examples/companion/vendor/pptx-engine/` | GenOffice `packages/pptx-engine` | `185040fd2f9f3114db164ea435cf155f52aa0330` | Apache-2.0 |
| `sdk/typescript/examples/companion/web/assets/agent-events.js`（重连判断函数） | Block Buzz `desktop/src/shared/api/relayReconnectPolicy.ts` | `3c7f288c60d67df78577b237e27c3dfc8831aaa1` | Apache-2.0 |

两个目录均保留上游 `LICENSE` 全文，并在各自 `README.md` 中记录来源与本地修改。GenOffice 的企业授权目录未被复制。

Buzz 部分版权归 Copyright 2026 Block, Inc. 所有，适用 Apache-2.0。许可证全文及修改范围见 `sdk/typescript/examples/companion/vendor/buzz/`，该目录随便携包分发。只适配了独立重连判断函数，未嵌入 Buzz 服务端、开发引擎或桌面框架。

## 图像运行库

`sharp` 的 Windows 与 WebAssembly 预编译包包含按 LGPL-3.0-or-later 提供的 libvips 组件，同时包含 Apache-2.0（WebAssembly 包还包含 MIT）部分。便携包保留对应 npm 包内的 `LICENSE`，并以独立动态库或 WebAssembly 形式使用，不将其许可证扩展到小丑鱼自身代码。

## 视觉素材

`sdk/typescript/examples/companion/web/assets/wallpapers/wallpaper-anime-teal.png` 是用户提供的视觉素材，不包含在本仓库的软件许可证授权范围内；其中可能涉及的角色、商标与其他权利仍归各自权利人所有。

## 完整许可证位置

- npm 依赖的许可证随各包保留在便携包的 `app/node_modules/<包名>/` 中；
- Node.js 与 Python 的许可证复制到便携包的 `licenses/`；
- 纳入仓库的文档引擎在各自目录保留 `LICENSE` 与修改说明；
- WebView2 的包元数据和许可文件（如上游包提供）复制到便携包的 `licenses/webview2/`；
- 本项目自身的授权边界见 [LICENSING.md](LICENSING.md)。

依赖版本变化时必须重新检查锁文件与实际分发物，不能把本文件当成永久不变的结论。
