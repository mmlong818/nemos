# Vendored: pptx-engine

PPTX 解析与元素级补丁保存引擎。小丑鱼用它做**保真的页面文字修改**：
原文件是事实源，只重写调用方明确改动的段落，其余元素与其他页面保持原字节。

## 上游

- 项目：GenOffice（`packages/pptx-engine`）
- 仓库：https://github.com/genspark-ai/genoffice
- 提交：`185040fd2f9f3114db164ea435cf155f52aa0330`（Sync snapshot 2026-08-09）
- 许可：Apache License 2.0，全文见同目录 `LICENSE`
- 版权：Copyright 2026 Mainfunc, Inc.

上游仓库的 `ee/` 目录**不是** Apache-2.0（GenOffice Enterprise License，仅限开发测试）。
本目录不包含、也永远不要引入 `ee/` 下的任何内容。

## 目录内容

- `src/` —— 上游 `packages/pptx-engine/src` 的源码，逐字保留，**没有本地修改**；
- `dist/` —— 由 `src/` 编译出的 CommonJS + 声明文件，已提交入库；
- `tsconfig.json` —— 本地新增，用于独立编译；
- `LICENSE` —— 上游 Apache-2.0 全文。

没有引入 `packages/pptx-render`：它依赖 opentype.js 与 bidi-js，只用于渲染，
小丑鱼的预览走另一条路径，不需要它。

## 本地修改

目前没有。需要新行为时写在 `examples/companion/office-pptx-text-edit.ts` 这一层，
不要改 `src/`。

## 编译

```
npm run vendor:pptx-engine
```

改动 `src/` 后必须重新编译并把 `dist/` 一起提交。

## 同步上游

1. 取上游新提交，比对 `packages/pptx-engine/src` 的差异；
2. 覆盖 `src/`；
3. 运行 `npm run vendor:pptx-engine`；
4. 运行 `npx tsx --test tests/unit/office-pptx-text-edit.test.ts` 确认保真行为未退化；
5. 更新本文件的提交号与日期。

## 对外声明

分发小丑鱼时必须随包保留本目录的 `LICENSE` 与上游版权声明。
产品界面不出现 GenOffice 的名称、图标或术语。
