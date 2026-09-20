# 授权结构

更新：2026-09-20

本仓库**自有代码统一**按 Clownfish Source-Available Non-Commercial License 1.0
提供，见 `LICENSE`。这是源码可见但完全禁止未经授权商用的自定义许可证，不是 OSI
开源许可证。本文件说明它覆盖到哪里、哪些部分不由它决定，以及随包分发的第三方代码各自适用什么条款。

## 一图说清

| 范围 | 路径 | 对外授权 | 说明 |
|---|---|---|---|
| **Nemos TypeScript 接入层与文档** | `sdk/typescript/src/`、`rfcs/`、`docs/` | Clownfish Source-Available Non-Commercial License 1.0（见 `LICENSE`） | 本仓库的 Agent 运行时、接入层和项目文档；完全禁止未经书面授权的商业用途 |
| **独立记忆内核依赖** | `@nemos/sdk`，来源 `mmlong818/nemos-memory` 固定 tag | 以该依赖随附的 `LICENSE` 为准 | 本仓库不再维护第二份记忆内核源码，也不改变该依赖的授权范围 |
| **小丑鱼应用** | `sdk/typescript/examples/companion/` | Clownfish Source-Available Non-Commercial License 1.0（见 `LICENSE`） | 与仓库其余自有代码统一；完全禁止未经书面授权的商业用途 |
| **示例** | `sdk/typescript/examples/`（companion 以外） | 同 SDK | 用于说明与复现 |

## 当前非商业许可的边界

当前许可允许个人、非商业教育和非营利研究使用，也允许在相同非商业边界内修改和再分发；
再分发必须保留版权、许可原文和修改说明。它明确禁止直接与间接商业使用，包括付费服务、
企业内部业务运营、商业产品集成、转售、SaaS / 托管、商业训练及其他营利活动。即使没有单独
收费，只要用于企业经营或为营利活动提供实质利益，仍属于被禁止的商业使用。

商业权利只能由版权所有者 **mmlong818（猫叔）** 通过单独签署的书面协议授予。公开仓库、
Issue、邮件、对话、下载或贡献行为本身都不构成商业许可。

## 旧版本不追溯变更

当前 `LICENSE` 只适用于随附这份许可的版本，以及之后明确采用它的发布。旧版本已经根据当时
随附许可证有效授予的权利不会被追溯撤销、缩减或替换；使用旧版本时仍应查看该版本自身的
`LICENSE`。取得旧版本不会自动获得新版本权利，取得新版本也不会改变旧版本的授权条件。

## 一个必须知道的事实：商业交付物内含 SDK 代码

打包产物 `sdk/typescript/examples/companion/client/dist/portable/小丑鱼/app/` 同时包含：

- `examples/` — 应用本体；
- `src/agent/` 与应用代码 — 本仓库的 Agent 运行时和小丑鱼应用；
- `node_modules/@nemos/sdk/` — 由固定 tag 安装的独立记忆内核依赖。

也就是说**小丑鱼在分发时把 SDK 一起装进去了**。这在法律上成立的前提是：SDK 的著作权由本项目所有者持有，所有者可以在对外发布非商业版本的同时，以单独书面协议授予商业权利。同一份代码由权利人以不同条款分发是允许的；公开非商业许可约束的是被许可方，不是权利人本人。

**著作权归属已核实：仓库自首个提交起没有第三方贡献者**，全部提交来自同一权利主体的 git 身份。因此 SDK 与应用的全部著作权归属单一所有者，权利人有权在对外发布非商业版本的同时单独授予商业权利。

`sdk/typescript/src/agent/` 是本仓库维护的 Agent 运行时代码。独立记忆内核不参与本仓库的源码归属判断，其来源、版本和许可证由 `@nemos/sdk` 依赖记录证明。随包分发的其他第三方代码单独列在下文，并保留各自的许可证。

**需要持续维持的条件：外部贡献必须附带足以支持商业再授权的许可授予。** 见下节。

## 外部贡献的入站授权

`CONTRIBUTING.md` 的入站条款是**附带商业再授权许可的授予**：贡献者保留自己的著作权，同时授予本项目在包括商业产品在内的范围内使用该贡献的许可。

这一条不是形式要求。商业交付物内含 SDK 代码，若贡献仅按公开非商业许可提供，它一旦合入 SDK 就无法由项目所有者另行商业授权。提交 Pull Request 即表示接受该条款。

## 第三方依赖

依赖许可证按当前锁文件和实际安装树检查。主要许可证包括 MIT、Apache-2.0、BSD、ISC 与 BlueOak；自动检查会拦截已知不兼容许可证和未经登记的元数据缺失。

需要明确记录的例外：

- `jszip@3.10.1` 为 `MIT OR GPL-3.0-or-later` 双许可，本项目选择 MIT；
- `png-js@1.1.0` 未在 `package.json` 声明许可证，但包内 `LICENSE` 为 MIT；
- `opencode-windows-x64@1.18.18` 与 `opencode-windows-x64-baseline@1.18.18` 未单独填写许可证元数据；它们是 MIT 许可的 `opencode-ai@1.18.18` 同版平台二进制发行物，上游仓库同为 MIT；
- `@img/sharp-win32-x64@0.35.3` 和 `@img/sharp-wasm32@0.35.3` 含 LGPL-3.0-or-later 的 libvips 组件。便携包保留其完整许可证，并以独立动态库或 WebAssembly 形式使用；
- `fast-xml-parser` 是 MIT 直接依赖，此前也已作为传递依赖存在。

因此不能再笼统写成“所有依赖均为宽松许可证”。当前分发方式可以保留项目自身授权边界，但必须携带第三方许可证。主要组件清单与许可证位置见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。新增或升级依赖后必须重新核查。

仓库的 `npm run licenses:check` 会扫描实际安装树：出现明确禁止的许可证或未经登记的许可证元数据缺失时直接失败，并已纳入 `npm run check`。人工判断仍以许可证原文和真实分发方式为准，自动检查只负责防止明显回退。

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

需要将本仓库代码或小丑鱼应用用于商业用途，请通过
[GitHub Issue](https://github.com/mmlong818/nemos/issues) 联系所有者。

根 `LICENSE` 是本仓库当前公开版本的自定义源码可见非商业许可，**不是 OSI 开源许可证**，
也不构成销售条款。任何商业授权都必须由版权所有者另行书面签署。
