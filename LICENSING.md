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

**著作权归属已于 2026-08-10 核实并确认。** 仓库自 2026-06-22 首个提交（`Nemos — 多人格 AI 陪伴 App + 可独立的记忆系统内核`）起，全部提交仅来自三个 git 身份：

| 身份 | 提交数 | 说明 |
|---|---|---|
| `猫叔 <112069064+mmlong818@users.noreply.github.com>` | 47 | GitHub 账号 |
| `mmlong818 <112069064+mmlong818@users.noreply.github.com>` | 1 | 与上一行邮箱相同，同一账号的旧显示名 |
| `totoroo <nduser17@besoinc.com>` | 33 | 本机 git 全局配置 |

三者经所有者确认为同一权利主体，**从无第三方贡献者**。因此 SDK 与应用的全部著作权归属单一所有者，权利人有权在对外发布 PolyForm Noncommercial 版本的同时，为自有商业产品保留另一份使用授权。

`sdk/typescript/src/` 共 66 个文件 18,979 行，全量检索 `adapted from`、`based on`、`ported from`、`derived from`、`SPDX-License`、`copyright (c)` 等外部代码标记，**零命中**：无从第三方仓库拷贝或改编的代码。这与审计工作区记录的"对外代码来源特征扫描无命中"一致——`nemos-harness-review` 中 164 个仓库的核查只提炼机制，未搬运代码。

**需要持续维持的条件：外部贡献必须附带足以支持商业再授权的许可授予。** 见下节。

## 外部贡献的入站授权

在 2026-08-10 之前，`CONTRIBUTING.md` 规定"提交内容按本仓库的 PolyForm Noncommercial 1.0.0 许可提供"。这一表述使外部贡献**只能**用于非商业场景——而商业交付物内含 SDK 代码，因此任何外部贡献一旦合入 SDK，都将无法随商业产品合法分发。

该条款已修订为附带商业再授权许可的入站授予。经核实，修订前**没有任何外部贡献合入**（见上节作者清单），因此不存在需要补充授权的历史贡献。

新条款须在接受第一个外部 Pull Request 之前生效——这是本次修订的实际紧迫性所在。

## 第三方依赖

2026-08-10 全量核查：`sdk/typescript` 的依赖树共 236 个包，**无 AGPL、SSPL、BUSL、Commons Clause、CC-BY-NC 或其他限制商业使用的许可证**。

两处需说明：

- `jszip@3.10.1` 为 `MIT OR GPL-3.0-or-later` 双许可，本项目选择 MIT；
- `png-js@1.1.0`（`pdfkit` 的传递依赖）未在 `package.json` 声明许可证，但包内 `LICENSE` 文件为 MIT。

依赖层面不构成商业化阻碍。新增依赖时应复核许可证。

2026-08-10 增补：`fast-xml-parser` 提升为直接依赖（MIT）。它此前已作为
`@aws-sdk/xml-builder` 的传递依赖存在于树中，因此没有引入新的许可证主体。
复核后依赖树共 245 个包，受限许可仍为零。

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

## 尚未完成

以下属于法律事务，需由所有者与专业顾问处理，工程侧不代做：

- 小丑鱼的最终用户许可协议（EULA）正文；
- 商业授权的销售条款、退款与责任限制；
- 商标与产品名称权利；
- SDK 商业授权的对外报价与流程。

`sdk/typescript/examples/companion/LICENSE` 目前是权利保留声明，用于确立边界，**不是** EULA，也不构成销售条款。
