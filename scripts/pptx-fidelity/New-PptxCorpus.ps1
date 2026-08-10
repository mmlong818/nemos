# 用本机安装的 Microsoft PowerPoint 生成 PPTX 回归样本。
#
# 与 DOCX 同样的道理：手工拼的 OOXML 只覆盖我们自己想到的结构，
# PowerPoint 实际写出的文件还包含母版、版式、主题、占位符继承等
# 大量不会主动构造的部件。保真性只有对着真实文件才有意义。
#
# 用法：
#   pwsh -File scripts/pptx-fidelity/New-PptxCorpus.ps1 -OutputDirectory <目录>
#
# 需要本机已安装 Microsoft PowerPoint。样本不入库，每次验证前重新生成。

[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$OutputDirectory
)

$ErrorActionPreference = 'Stop'

$ppSaveAsOpenXMLPresentation = 24
$ppLayoutText = 2
$ppLayoutTitleOnly = 11

New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
$resolved = (Resolve-Path $OutputDirectory).Path

try {
  $ppt = New-Object -ComObject PowerPoint.Application
} catch {
  Write-Error "无法启动 Microsoft PowerPoint；本机未安装或 COM 不可用。"
  exit 2
}

function Save-Deck {
  param([object]$Presentation, [string]$Name)
  [string]$path = [System.IO.Path]::Combine($resolved, $Name)
  if (Test-Path $path) { Remove-Item $path -Force }
  $Presentation.SaveAs($path, $ppSaveAsOpenXMLPresentation)
  $Presentation.Close()
  Write-Output "  生成 $Name"
}

try {
  Write-Output "在 $resolved 生成回归样本："

  # 1. 单段落内混排三种行内格式
  $pres = $ppt.Presentations.Add(0)
  $slide = $pres.Slides.Add(1, $ppLayoutText)
  $slide.Shapes(1).TextFrame.TextRange.Text = "季度业绩回顾"
  $body = $slide.Shapes(2).TextFrame.TextRange
  $body.Text = "收入同比增长 18% 需要复核"
  $body.Characters(5, 9).Font.Bold = -1
  $red = $body.Characters(15, 4)
  $red.Font.Color.RGB = 255
  $red.Font.Size = 28
  Save-Deck -Presentation $pres -Name "01-inline-formats.pptx"

  # 2. 多页 + 表格 + 多段项目符号
  $pres = $ppt.Presentations.Add(0)
  $s1 = $pres.Slides.Add(1, $ppLayoutText)
  $s1.Shapes(1).TextFrame.TextRange.Text = "项目进度"
  $s1.Shapes(2).TextFrame.TextRange.Text = "范围确认" + [char]13 + "本季度交付" + [char]13 + "下一步计划"
  $s2 = $pres.Slides.Add(2, $ppLayoutTitleOnly)
  $s2.Shapes(1).TextFrame.TextRange.Text = "数据一览"
  $table = $s2.Shapes.AddTable(3, 3)
  for ($row = 1; $row -le 3; $row++) {
    for ($col = 1; $col -le 3; $col++) {
      $table.Table.Cell($row, $col).Shape.TextFrame.TextRange.Text = "R" + $row + " C" + $col
    }
  }
  Save-Deck -Presentation $pres -Name "02-multi-slide-table.pptx"

  # 3. 讲者备注与段内软换行
  $pres = $ppt.Presentations.Add(0)
  $slide = $pres.Slides.Add(1, $ppLayoutText)
  $slide.Shapes(1).TextFrame.TextRange.Text = "带备注的页面"
  $slide.Shapes(2).TextFrame.TextRange.Text = "第一行" + [char]11 + "第二行同段软换行"
  $slide.NotesPage.Shapes(2).TextFrame.TextRange.Text = "这是讲者备注，不应被改动。"
  Save-Deck -Presentation $pres -Name "03-notes-softbreak.pptx"

  # 4. 中英混排多页
  $pres = $ppt.Presentations.Add(0)
  for ($i = 1; $i -le 8; $i++) {
    $slide = $pres.Slides.Add($i, $ppLayoutText)
    $slide.Shapes(1).TextFrame.TextRange.Text = "第 $i 页标题"
    $slide.Shapes(2).TextFrame.TextRange.Text = "中文正文 with English words 与数字 $i。"
  }
  Save-Deck -Presentation $pres -Name "04-long-mixed.pptx"

  Write-Output "完成。"
} finally {
  $ppt.Quit()
  [System.Runtime.InteropServices.Marshal]::ReleaseComObject($ppt) | Out-Null
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()
}
