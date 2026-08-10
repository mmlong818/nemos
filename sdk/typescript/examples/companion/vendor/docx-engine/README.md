# Vendored: docx-engine

DOCX 解析与段落级补丁保存引擎。小丑鱼用它做**保真的文字修改**：原文件是事实源，
只重写调用方明确改动的段落，其余部件保持原字节。

## 上游

- 项目：GenOffice（`packages/docx-engine`）
- 仓库：https://github.com/genspark-ai/genoffice
- 提交：`185040fd2f9f3114db164ea435cf155f52aa0330`（Sync snapshot 2026-08-09）
- 许可：Apache License 2.0，全文见同目录 `LICENSE`
- 版权：Copyright 2026 Mainfunc, Inc.

上游仓库的 `ee/` 目录**不是** Apache-2.0（GenOffice Enterprise License，仅限开发测试）。
本目录不包含、也永远不要引入 `ee/` 下的任何内容。当前上游 `ee/` 除许可证与说明外为空。

## 目录内容

- `src/` —— 上游 `packages/docx-engine/src` 的源码，除下述本地修改外逐字保留；
- `dist/` —— 由 `src/` 编译出的 CommonJS + 声明文件，**已提交入库**；
- `tsconfig.json` —— 本地新增，用于独立编译（见下）；
- `LICENSE` —— 上游 Apache-2.0 全文。

## 本地修改

改动只允许发生在这两处，且必须记录在此：

1. **`src/metafile.ts` 已替换。** 上游通过 `src/vendor/emf-converter/index.mjs`
   把 EMF/WMF 渲染成预览图。那是仅 ESM 的构建产物，与本项目的 CommonJS 运行方式
   不兼容；而小丑鱼在服务端解析文档，没有渲染用的 Canvas，上游函数在这种环境下
   本来就返回 null。因此保留同样的接口与降级语义，去掉该依赖，
   `src/vendor/emf-converter/`（含其 Apache-2.0 声明）整体未纳入。
   EMF/WMF 图片的字节在保存时原样透传，只是不生成预览图。
2. **新增 `tsconfig.json`。** 上游用 `module: ESNext` + `moduleResolution: bundler`，
   并关闭了 `noUnusedLocals`；本项目主配置是 CommonJS 且开启了多项严格检查。
   为了不改动上游源码，这里独立编译成 CommonJS，主项目只引用 `dist/`。
   `tsconfig.check.json` 已把 `examples/companion/vendor` 排除在严格检查之外，
   `dist/` 的声明文件在 `skipLibCheck` 下提供类型。

不要为了适配本项目而修改 `src/` 里的其他文件。需要新行为时，写在
`examples/companion/office-docx-text-edit.ts` 这一层。

## 编译

```
npm run vendor:docx-engine
```

改动 `src/` 后必须重新编译并把 `dist/` 一起提交，否则运行时用的还是旧代码。

## 同步上游

1. 取上游新提交，比对 `packages/docx-engine/src` 的差异；
2. 覆盖 `src/`，然后按"本地修改"一节重新施加第 1 项；
3. 运行 `npm run vendor:docx-engine`；
4. 运行 `npx tsx --test tests/unit/office-docx-text-edit.test.ts` 确认保真行为未退化；
5. 更新本文件的提交号与日期。

## 对外声明

分发小丑鱼时必须随包保留本目录的 `LICENSE` 与上游版权声明。
产品界面不出现 GenOffice 的名称、图标或术语。
