# arXiv 投稿前检查

复核日期：2026-08-10

投稿包：`paper/arxiv-en.tar.gz`。包内仅包含英文论文需要的 `main.tex`、`refs.bib` 和 `main.bbl`。

## 先确认论文边界

- 这是工作草稿，尚未经过同行评审。
- BUC、ASP、FOR 各使用 50 条合成任务；ASP 为 250 个 probe，FOR 为 146 个 probe。
- LongMemEval 交叉锚点使用 30 个知识更新问题。
- 论文数字属于冻结实验配置，不代表当前 SDK 的总体性能。
- 作者姓名、顺序和机构由投稿人最终确认；仓库不保存私人邮箱。

## 官方流程

1. 使用投稿人自己的 arXiv 账号开始新投稿。官方说明：<https://info.arxiv.org/help/submit/index.html>
2. 如果系统要求背书，按官方背书流程处理：<https://info.arxiv.org/help/endorsement.html>
3. 根据论文主题选择分类。当前内容可考虑 `cs.CL` 为主分类、`cs.AI` 为交叉分类，但最终由作者判断。
4. 选择授权前阅读官方说明，并同时考虑未来会议或期刊的授权要求：<https://info.arxiv.org/help/license/index.html>
5. 上传 `arxiv-en.tar.gz`。arXiv 会识别编译器；若识别错误，应在提交界面调整并查看编译日志。
6. 逐页检查生成的 PDF：标题、作者、摘要、表格、引用、页码和超链接都必须正确。
7. 填写元数据时，标题、作者顺序和摘要必须与最终 PDF 一致。
8. 提交前再次下载或预览 arXiv 生成的 PDF，不以本地编译成功代替在线核验。

## 建议元数据

标题：

`MnemoBench: Evaluating Belief Update, Self-Pollution Resistance, and Forgetting in Long-Lived Memory Systems`

摘要：

> Persistent memory layers for LLM agents are typically evaluated on recall: can the system retrieve what was said earlier? We argue that in long-lived use the dominant failure modes are not recall but maintenance: (1) failing to revise a belief when a fact changes, (2) letting the agent's own generated or imagined content pollute the user's fact base, and (3) never forgetting, so that stale trivia degrades precision over time. We introduce MnemoBench, a reproducible benchmark with three task families targeting exactly these behaviours, with ground truth fixed by a generator rather than judged post hoc. We evaluate Nemos, an embeddable memory kernel with bitemporal contradiction invalidation, namespace isolation between user facts and agent self-narrative, and FSRS-based decay. On belief update, contradiction invalidation cuts stale-answer leakage from 80.0% to 34.0%, at a moderate recall cost (update accuracy 92.0% to 76.0%) that exposes a precision/recall knob; we further show that the earlier lexical contradiction detector misses attribute-replacement updates and that a semantic detector recovers them (leakage 50.0% to 34.0%). Namespace isolation reduces self-pollution from 96.8% to 1.6% with no recall loss. Decay suppresses stale-trivia leakage from 100.0% to 16.4% while retaining important facts. We release MnemoBench and all harness code.

## 本地提交前检查

```text
论文源码和结果 manifest 一致
中英文 PDF 均由当前源码重新生成
引用无缺失，编译日志无 undefined reference
投稿包可独立编译
隐私扫描未发现邮箱、密钥或本机路径
作者与机构信息已由投稿人确认
```

中文版用于项目留档。若未来单独提交中文版，应重新制作独立源码包，并在 arXiv 在线环境确认 XeLaTeX 编译结果。
