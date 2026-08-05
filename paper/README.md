# MnemoBench 论文资料

更新：2026-08-06

本目录保存 MnemoBench 工作论文的中英文源码、生成后的 PDF 和 arXiv 投稿包。

## 当前状态

- 论文仍是工作草稿，不代表同行评审结论。
- 主表使用 bench/results/ 中冻结的 2026 年 6—7 月结果。
- 三个合成任务族各有 50 条样本；ASP 与 FOR 按探针计分，LongMemEval 交叉锚点为 30 题。
- 结果来源、提交时间和 SHA-256 见 [结果清单](../bench/results/manifest.json)。
- 当前 SDK 已继续演进到 0.7.5-alpha.17，后续实现变化没有被悄悄并入论文数字。

## 文件

| 文件 | 用途 |
| --- | --- |
| [main.tex](main.tex) | 英文论文源码 |
| [main.pdf](main.pdf) | 英文最终渲染 |
| [main-zh.tex](main-zh.tex) | 中文论文源码 |
| [main-zh.pdf](main-zh.pdf) | 中文最终渲染 |
| [refs.bib](refs.bib) | 参考文献 |
| [BUILD.md](BUILD.md) | 编译与核验方法 |
| [ARXIV_SUBMIT.md](ARXIV_SUBMIT.md) | 投稿前检查清单 |
| arxiv-en.tar.gz | 由当前英文源码重新生成的投稿包 |

## 数字边界

论文数字只描述冻结实验，不等于当前产品或当前 SDK 的总体性能。更换模型、提示词、依赖、数据切片或 SDK 版本后，必须生成新的结果文件和 manifest，不能覆盖旧快照。
