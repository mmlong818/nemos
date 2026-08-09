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

**这个前提有两个维持条件：**

1. **SDK 的全部著作权必须归属同一所有者。** 截至本次核对，`sdk/typescript/src/` 的提交者为 `猫叔 <112069064+mmlong818@users.noreply.github.com>` 与 `totoroo <nduser17@besoinc.com>`。若二者并非同一权利主体，需在商业发布前完成权属确认或书面授权。
2. **外部贡献必须附带足以支持商业再授权的许可授予。** 见下节。

## 外部贡献的入站授权

在 2026-08-10 之前，`CONTRIBUTING.md` 规定"提交内容按本仓库的 PolyForm Noncommercial 1.0.0 许可提供"。这一表述使外部贡献**只能**用于非商业场景——而商业交付物内含 SDK 代码，因此任何外部贡献一旦合入 SDK，都将无法随商业产品合法分发。

该条款已修订为附带商业再授权许可的入站授予。修订前合入的外部贡献（如有）需单独排查并取得补充授权。

## 第三方依赖

2026-08-10 全量核查：`sdk/typescript` 的依赖树共 236 个包，**无 AGPL、SSPL、BUSL、Commons Clause、CC-BY-NC 或其他限制商业使用的许可证**。

两处需说明：

- `jszip@3.10.1` 为 `MIT OR GPL-3.0-or-later` 双许可，本项目选择 MIT；
- `png-js@1.1.0`（`pdfkit` 的传递依赖）未在 `package.json` 声明许可证，但包内 `LICENSE` 文件为 MIT。

依赖层面不构成商业化阻碍。新增依赖时应复核许可证。

## 尚未完成

以下属于法律事务，需由所有者与专业顾问处理，工程侧不代做：

- 小丑鱼的最终用户许可协议（EULA）正文；
- 商业授权的销售条款、退款与责任限制；
- 商标与产品名称权利；
- SDK 商业授权的对外报价与流程。

`sdk/typescript/examples/companion/LICENSE` 目前是权利保留声明，用于确立边界，**不是** EULA，也不构成销售条款。
