# 授权结构

更新：2026-08-10

本仓库采用**双授权结构**。这份文件是授权范围的权威说明；`LICENSE` 文件只是其中一部分的许可证正文。

## 一图说清

| 范围 | 路径 | 对外授权 | 说明 |
|---|---|---|---|
| **Nemos Memory SDK** | `sdk/typescript/src/`、`spec/`、`rfcs/`、`bench/`、`docs/` | PolyForm Noncommercial 1.0.0（见 `LICENSE`） | 研究、个人与非营利用途免费；商业用途需另行取得授权 |
| **小丑鱼应用** | `sdk/typescript/examples/companion/` | 保留全部权利，另行授权（见该目录下 `LICENSE`） | 不在 PolyForm Noncommercial 覆盖范围内 |
| **示例与基准** | `sdk/typescript/examples/`（companion 以外）、`bench/` | 同 SDK | 用于说明与复现 |

## 为什么应用要单独授权

小丑鱼是面向最终用户的商业产品，而 PolyForm Noncommercial **明确排除商业用途**。若应用沿用该许可证，销售行为将与自身授权条款冲突。因此应用从仓库根许可证中划出，按单独条款授权。

## 一个必须知道的事实：商业交付物内含 SDK 代码

打包产物 `sdk/typescript/examples/companion/client/dist/portable/小丑鱼/app/` 同时包含：

- `examples/` — 应用本体；
- `src/` — Nemos Memory SDK。

也就是说**小丑鱼在分发时把 SDK 一起装进去了**。这在法律上成立的前提是：SDK 的著作权由本项目所有者持有，所有者可以在对外发布 PolyForm Noncommercial 版本的同时，为自己的商业产品保留另一份使用授权。同一份代码由权利人以不同条款分发是允许的；受 PolyForm Noncommercial 约束的是被许可方，不是权利人本人。

**著作权归属已核实：仓库自首个提交起没有第三方贡献者**，全部提交来自同一权利主体的 git 身份。因此 SDK 与应用的全部著作权归属单一所有者，权利人有权在对外发布 PolyForm Noncommercial 版本的同时，为自有商业产品保留另一份使用授权。

`sdk/typescript/src/` 全量检索 `adapted from`、`based on`、`ported from`、`derived from`、`SPDX-License`、`copyright (c)` 等外部代码标记为**零命中**：没有从第三方仓库拷贝或改编的代码。随包分发的第三方代码单独列在下文，并保留各自的许可证。

**需要持续维持的条件：外部贡献必须附带足以支持商业再授权的许可授予。** 见下节。

## 外部贡献的入站授权

`CONTRIBUTING.md` 的入站条款是**附带商业再授权许可的授予**：贡献者保留自己的著作权，同时授予本项目在包括商业产品在内的范围内使用该贡献的许可。

这一条不是形式要求。商业交付物内含 SDK 代码，若贡献仅按 PolyForm Noncommercial 提供，它一旦合入 SDK 就无法随商业产品合法分发。提交 Pull Request 即表示接受该条款。

## 第三方依赖

2026-08-10 全量核查：`sdk/typescript` 的依赖树共 236 个包，**无 AGPL、SSPL、BUSL、Commons Clause、CC-BY-NC 或其他限制商业使用的许可证**。

两处需说明：

- `jszip@3.10.1` 为 `MIT OR GPL-3.0-or-later` 双许可，本项目选择 MIT；
- `png-js@1.1.0`（`pdfkit` 的传递依赖）未在 `package.json` 声明许可证，但包内 `LICENSE` 文件为 MIT。

依赖层面不构成商业化阻碍。新增依赖时应复核许可证。

2026-08-10 增补：`fast-xml-parser` 提升为直接依赖（MIT）。它此前已作为
`@aws-sdk/xml-builder` 的传递依赖存在于树中，因此没有引入新的许可证主体。
复核后依赖树共 245 个包，受限许可仍为零。

### 一条与分发方式相关的依赖约束

`better-sqlite3` 锁在 12.x，不升 13。这不是许可证问题，而是分发前提：
13 起不再提供 Node 22 win-x64 的预编译包，安装会回落到 node-gyp 源码编译，
等于要求每台安装机器都具备原生编译环境。小丑鱼是面向最终用户的桌面产品，
这个前提不成立（CI 的 windows-latest 就因此装不上）。约束记录在
`.github/dependabot.yml` 中，上游恢复预编译包后再重新评估。

新增或升级**原生模块**依赖时，必须先确认它为目标平台提供预编译包，
不能以"开发机装得上"作为判断依据。

## 随包分发的第三方代码

与仅在构建期使用的依赖不同，以下第三方代码**以源码形式进入本仓库并随产品分发**，
其许可证声明必须随包保留：

| 位置 | 组件 | 上游与提交 | 许可 |
| --- | --- | --- | --- |
| `sdk/typescript/examples/companion/vendor/docx-engine/` | GenOffice `packages/docx-engine`（DOCX 解析与段落级补丁保存） | genspark-ai/genoffice `185040fd2f9f3114db164ea435cf155f52aa0330` | Apache-2.0 |
| `sdk/typescript/examples/companion/vendor/pptx-engine/` | GenOffice `packages/pptx-engine`（PPTX 解析与元素级补丁保存） | genspark-ai/genoffice `185040fd2f9f3114db164ea435cf155f52aa0330` | Apache-2.0 |

要点：

- Apache-2.0 与商业分发兼容，要求保留版权、许可证与变更说明。该目录内已包含
  `LICENSE` 全文，`README.md` 逐条记录了本地修改，满足 Apache-2.0 第 4 条。
- 上游仓库的 `ee/` 目录采用 GenOffice Enterprise License（仅限开发测试，
  商业使用需单独协议），**未纳入本仓库，也不得纳入**。当前上游该目录除许可证
  与说明外为空。
- 这两个目录位于 `examples/` 下，因此不进入 npm 包（`files` 白名单仅含 `dist`），
  但会进入便携客户端打包产物——打包脚本必须把它的 `LICENSE` 一起带上。
- 产品界面不出现该项目的名称、图标或术语。

新增随包分发的第三方代码时，必须在此表登记，并在其目录内保留许可证与本地修改说明。

## 商业授权

需要将 Nemos Memory SDK 用于商业用途，或需要小丑鱼应用的授权，请通过
[GitHub Issue](https://github.com/mmlong818/nemos/issues) 联系所有者。

`sdk/typescript/examples/companion/LICENSE` 是权利保留声明，用于确立授权边界，
**不是**最终用户许可协议，也不构成销售条款。
