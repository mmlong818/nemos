# PPTX 文字修改保真性验证（Microsoft PowerPoint 实机）

日期：2026-08-11
验证对象：`office-pptx-text-edit.ts` 的段落级文字补丁路径
工具：`scripts/pptx-fidelity/Test-PptxFidelity.ps1`

## 为什么需要这份记录

与 DOCX 同一条纪律：把某个格式标为"可编辑"之前，必须有真实 Office 软件的
证据。结构检查只能证明包没坏，回答不了"PowerPoint 能不能正常打开"和
"没改的内容格式是否一个字符都没动"。

## 方法

1. **样本由真实 PowerPoint 生成**（`New-PptxCorpus.ps1`）。PowerPoint 写出的
   文件包含母版、版式、主题和占位符继承等大量不会主动构造的部件。
2. **用引擎各改一个段落**（`sdk/typescript/scripts/pptx-fidelity-cli.ts`），
   在段落开头插入文字——改动落在第一个 run 内。
3. **用真实 PowerPoint 打开产物**，逐形状比对文字，并对未改动形状逐字符比对
   加粗／斜体／下划线／颜色／字号的行程压缩签名。
4. 同时核对页数与形状总数，并要求**只有一个形状**的文字发生变化。

## 样本

| 文件 | 覆盖内容 |
| --- | --- |
| `01-inline-formats.pptx` | 单段落内混排三种行内格式（常规／加粗／红色 28pt） |
| `02-multi-slide-table.pptx` | 两页、多段项目符号、3×3 表格 |
| `03-notes-softbreak.pptx` | 讲者备注、段内软换行（`<a:br/>`） |
| `04-long-mixed.pptx` | 8 页中英混排，共 16 个形状 |

## 结果

2026-08-11 运行，**4 / 4 全部通过**：

- 4 份产物全部被 PowerPoint 正常打开；
- 页数与形状总数与原文一致（最大样本 8 页 / 16 个形状）；
- 每份都只有目标形状的文字发生变化；
- 未改动形状的逐字符格式签名完全一致，讲者备注未被动。

单元测试另外覆盖了两条关键行为（`tests/unit/office-pptx-text-edit.test.ts`）：

- 改动落在单个 run 内时，同段其他 run 的 `b="1"`、`srgbClr` 与 `sz` 字节不变；
- **跨越不同格式的改动被拒绝**并计入 `skipped`，而不是打乱格式；会话层给出
  "请分段修改"的可照做提示。

对照：已冻结的 `office-structured-edit.ts` 按出现顺序整体重写整页全部 `<a:t>`，
会把分行、占位符归属和行内格式合并掉。

## 这份证据不覆盖什么

- 只验证了**段落文字修改**。增删页面、移动元素、改版式与母版都不在能力范围内。
- 跨格式改动不支持，是设计上的取舍：宁可拒绝，也不打乱行内格式。
- 表格单元格内的文字不在可改范围内（表格作为整体透传）。
- 图表、SmartArt、动画、嵌入媒体只做透传，未做实机编辑验证。
- **只声明 Microsoft PowerPoint 兼容**，不声称兼容 WPS 与 LibreOffice。

## 复现

```
pwsh -File scripts/pptx-fidelity/Test-PptxFidelity.ps1
```

需要本机安装 Microsoft PowerPoint。CI 不跑这项检查，它是发布前的人工检查项，
格式能力标注变更时必须重跑。
