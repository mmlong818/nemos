# arXiv 投稿手把手指南

> 我（助手）无法替你点"提交"——arXiv 需要你本人的账号，且首次投稿通常需要**背书
> (endorsement)**。下面每一步照做即可。投稿包已备好：**`paper/arxiv-en.tar.gz`**
> （含 `main.tex` + `refs.bib` + `main.bbl`，根级无子目录，本文无图片）。

## 一句实话（先看）
这是一篇**工作草稿**：单作者、合成 benchmark、n=50。作为 **preprint** 发 arXiv 完全可以；
若你之后想投会议/期刊，建议先找一位同行/导师过一遍。要不要现在就发，由你决定。

## 步骤

### 1. 注册并登录 arXiv
- 打开 https://arxiv.org/ → Login → 没账号就 Register（建议用机构邮箱；可绑定 ORCID）。

### 2. 背书（endorsement，首次投 cs 类常需要）
- 新用户在 cs 分类下投稿，arXiv 可能要求一位已有投稿资格的人给你背书。
- 登录后开始投稿时若提示需要背书，arXiv 会给你一个 endorsement code，发给一位
  在 **cs.CL / cs.AI** 有投稿记录的同行，请其到 https://arxiv.org/auth/endorse 输入码即可。
- 如果系统没要求背书，跳过本步。

### 3. 开始投稿
- 顶部 **Submit** → Start New Submission。
- **License**：推荐 `CC BY 4.0`（最开放，便于被引）；保守可选 arXiv 默认的非独占授权。
- **Primary category**：`cs.CL`（Computation and Language）。
- **Cross-list**：`cs.AI`（建议加，记忆/智能体读者多）。

### 4. 上传源码（关键）
- 选择 **Upload files** → 上传 **`arxiv-en.tar.gz`**。
- arXiv 会自动用 TeX 编译。本文用 **pdfLaTeX**，已附 `main.bbl`，不依赖 arXiv 跑 bibtex。
- 若编译报错，看 arXiv 的日志；常见是缺包——本文只用标准包
  (microtype, lmodern, fontenc, booktabs, amsmath, graphicx, hyperref, xcolor, geometry)，
  arXiv 的 TeX Live 都有，正常情况一次过。
- 预览生成的 PDF，确认与本地 `main.pdf` 一致（6 页）。

### 5. 填元数据
- **Title**：
  `MnemoBench: Evaluating Belief Update, Self-Pollution Resistance, and Forgetting in Long-Lived Memory Systems`
- **Authors**：`Shen Wei`（如要显示汉字可写 `Shen Wei (魏申)`）
- **Abstract**：粘贴下面《纯文本摘要》整段。
- **Comments（可选）**：`Working draft; benchmark and code: https://github.com/mmlong818/nemos`

### 6. 提交
- 检查无误 → **Submit**。
- arXiv 有审核+挂出延迟（工作日通常隔天 20:00 ET 后挂出）。挂出后会给你
  `arXiv:XXXX.XXXXX` 编号。

---

## 纯文本摘要（粘进 arXiv 的 Abstract 框）

Persistent memory layers for LLM agents are typically evaluated on recall: can the system
retrieve what was said earlier? We argue that in long-lived use the dominant failure modes
are not recall but maintenance: (1) failing to revise a belief when a fact changes, (2)
letting the agent's own generated or imagined content pollute the user's fact base, and (3)
never forgetting, so that stale trivia degrades precision over time. We introduce MnemoBench,
a reproducible benchmark with three task families targeting exactly these behaviours, with
ground truth fixed by a generator rather than judged post hoc. We evaluate Nemos, an
embeddable memory kernel with bitemporal contradiction invalidation, namespace isolation
between user facts and agent self-narrative, and FSRS-based decay. On belief update,
contradiction invalidation cuts stale-answer leakage from 80.0% to 34.0%, at a moderate
recall cost (update accuracy 92.0 -> 76.0%) that exposes a precision/recall knob; we further
show that the shipped lexical contradiction detector misses attribute-replacement updates and
that a semantic detector recovers them (leakage 50.0 -> 34.0%). Namespace isolation reduces
self-pollution from 71.2% to 1.6% with no recall loss. Decay suppresses stale-trivia leakage
from 96.0% to 17.4% while retaining important facts. We release MnemoBench and all harness code.

---

## 中文版（可选）
`main-zh.tex` 用 **XeLaTeX**（ctex + Fandol）。arXiv 支持 XeLaTeX，但中文论文在 arXiv
较少见、读者面窄；一般建议**英文版投 arXiv**，中文版自用/留档。若仍要投中文版，单独打包
`main-zh.tex + refs.bib + main-zh.bbl`，并在上传后确认 arXiv 用 XeLaTeX 编译通过。
