# Building the paper

Requires a TeX distribution (TeX Live / MiKTeX / TinyTeX). Packages used: `microtype`,
`lmodern`, `fontenc`, `booktabs`, `amsmath`, `graphicx`, `hyperref`, `xcolor`, `geometry`.

```bash
pdflatex main.tex
bibtex   main
pdflatex main.tex
pdflatex main.tex
```

Or `latexmk -pdf main.tex`. Output: `main.pdf` (6 pages).

Numbers in the tables/abstract are LaTeX macros defined at the top of `main.tex`; they are
filled from the frozen runs in `../bench/results/*.json`.
