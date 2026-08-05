# 编译与核验论文

需要 TeX Live 或 MiKTeX。英文版使用 pdfLaTeX，中文版使用 XeLaTeX。

## 英文版

```bash
pdflatex main.tex
bibtex main
pdflatex main.tex
pdflatex main.tex
```

也可以使用 `latexmk -pdf main.tex`。输出为 `main.pdf`。

## 中文版

```bash
xelatex main-zh.tex
bibtex main-zh
xelatex main-zh.tex
xelatex main-zh.tex
```

输出为 `main-zh.pdf`。中文依赖 `ctexart`、Fandol 字体和 XeCJK。

## 数字来源

表格和摘要数字由 TeX 文件顶部的宏统一控制，必须与 `../bench/results/*.json` 和 `../bench/results/manifest.json` 对照。当前论文只使用冻结实验结果，不从最新 SDK 或 CHANGELOG 自动推导数字。

## 交付前核验

1. 检查编译日志中没有 undefined citation、undefined reference 或缺失字体。
2. 使用 `pdfinfo` 确认 PDF 可以读取。
3. 把所有页面渲染成图片，逐页检查裁切、溢出、空白页、表格和中英文换行。
4. 对源码、PDF 文本和 `arxiv-en.tar.gz` 做隐私扫描，排除私人邮箱、API Key 和本机绝对路径。
5. 从当前 `main.tex`、`refs.bib`、`main.bbl` 重新生成投稿包，并检查压缩包文件清单。
