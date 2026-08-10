# 用本机安装的 Microsoft Word 生成 DOCX 回归样本。
#
# 为什么必须由真实 Word 生成：手工拼的 OOXML 只覆盖我们自己想到的结构，
# 而 Word 实际写出的文件包含样式继承、主题、字体回退、rsid、latent styles 等
# 大量我们不会主动构造的部件。保真性只有对着真实文件才有意义。
#
# 用法：
#   pwsh -File scripts/docx-fidelity/New-DocxCorpus.ps1 -OutputDirectory <目录>
#
# 需要本机已安装 Microsoft Word。样本不入库（体积与授权原因），
# 每次验证前重新生成。

[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$OutputDirectory
)

$ErrorActionPreference = 'Stop'

$wdFormatXMLDocument = 12
$wdAlertsNone = 0
# 内置样式用常量而不是名称：Word 本地化后样式名会跟着界面语言变。
$wdStyleNormal = -1
$wdStyleHeading1 = -2
$wdFieldPage = 33

New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
$resolved = (Resolve-Path $OutputDirectory).Path

try {
  $word = New-Object -ComObject Word.Application
} catch {
  Write-Error "无法启动 Microsoft Word；本机未安装或 COM 不可用。"
  exit 2
}
$word.Visible = $false
$word.DisplayAlerts = $wdAlertsNone

function Save-Doc {
  param([object]$Document, [string]$Name)
  [string]$path = [System.IO.Path]::Combine($resolved, $Name)
  if (Test-Path $path) { Remove-Item $path -Force }
  $Document.SaveAs2($path, $wdFormatXMLDocument)
  $Document.Close($false)
  Write-Output "  生成 $Name"
}

try {
  Write-Output "在 $resolved 生成回归样本："

  # 1. 中英混排 + 段落内多种行内格式
  $doc = $word.Documents.Add()
  $r = $doc.Content
  $r.Text = "季度收入 "
  $r.InsertAfter("同比增长 18%")
  $r.InsertAfter("（needs review）")
  $doc.Paragraphs(1).Range.Font.Name = "Calibri"
  $words = $doc.Paragraphs(1).Range
  $bold = $doc.Range($words.Start + 5, $words.Start + 16)
  $bold.Bold = $true
  $red = $doc.Range($words.Start + 16, $words.End - 1)
  $red.Font.Color = 255
  $red.Font.Size = 16
  $doc.Paragraphs.Add() | Out-Null
  $doc.Paragraphs(2).Range.Text = "第二段保持不动，用于验证未改动段落字节不变。"
  Save-Doc -Document $doc -Name "01-inline-formats.docx"

  # 2. 标题体系 + 列表 + 表格
  $doc = $word.Documents.Add()
  $doc.Content.Text = "项目进度报告"
  $doc.Paragraphs(1).Style = $wdStyleHeading1
  $doc.Paragraphs.Add() | Out-Null
  $doc.Paragraphs(2).Range.Text = "本季度完成三项交付。"
  $doc.Paragraphs(2).Style = $wdStyleNormal
  $doc.Paragraphs.Add() | Out-Null
  $doc.Paragraphs(3).Range.Text = "范围确认"
  $doc.Paragraphs(3).Range.ListFormat.ApplyBulletDefault()
  $doc.Paragraphs.Add() | Out-Null
  $table = $doc.Tables.Add($doc.Paragraphs($doc.Paragraphs.Count).Range, 3, 3)
  $table.Borders.Enable = $true
  for ($row = 1; $row -le 3; $row++) {
    for ($col = 1; $col -le 3; $col++) { $table.Cell($row, $col).Range.Text = "R$row C$col" }
  }
  Save-Doc -Document $doc -Name "02-headings-list-table.docx"

  # 3. 页眉页脚 + 页码 + 脚注
  $doc = $word.Documents.Add()
  $doc.Content.Text = "带页眉页脚与脚注的正文段落。"
  $section = $doc.Sections(1)
  $section.Headers(1).Range.Text = "内部资料"
  $section.Footers(1).Range.Text = "第 "
  $section.Footers(1).Range.Fields.Add($section.Footers(1).Range, $wdFieldPage) | Out-Null
  $doc.Footnotes.Add($doc.Paragraphs(1).Range, "", "脚注内容") | Out-Null
  Save-Doc -Document $doc -Name "03-header-footer-footnote.docx"

  # 4. 批注 + 修订
  $doc = $word.Documents.Add()
  $doc.Content.Text = "这一段带有批注与修订，用于验证它们不被破坏。"
  $doc.Comments.Add($doc.Paragraphs(1).Range, "请复核这句表述") | Out-Null
  $doc.TrackRevisions = $true
  $doc.Paragraphs.Add() | Out-Null
  $doc.Paragraphs(2).Range.Text = "这一段是在开启修订后新增的。"
  $doc.TrackRevisions = $false
  Save-Doc -Document $doc -Name "04-comments-revisions.docx"

  # 5. 长文档：多段中文，用于验证只改一段不影响其余
  $doc = $word.Documents.Add()
  $doc.Content.Text = "第 1 段：这是用于回归的长文档。"
  for ($i = 2; $i -le 60; $i++) {
    $doc.Paragraphs.Add() | Out-Null
    $doc.Paragraphs($i).Range.Text = "第 $i 段：中文正文内容，混入 English words 与数字 $i。"
  }
  Save-Doc -Document $doc -Name "05-long-chinese.docx"

  # 6. 空段落与制表符，验证不被 filter 掉后错位
  $doc = $word.Documents.Add()
  $doc.Content.Text = "第一段有内容。"
  $doc.Paragraphs.Add() | Out-Null
  $doc.Paragraphs.Add() | Out-Null
  $doc.Paragraphs(3).Range.Text = "第三段有内容，第二段是空段。"
  $doc.Paragraphs.Add() | Out-Null
  $doc.Paragraphs(4).Range.Text = "带`t制表符`t的段落。"
  Save-Doc -Document $doc -Name "06-empty-paragraphs.docx"

  Write-Output "完成。"
} finally {
  $word.Quit()
  [System.Runtime.InteropServices.Marshal]::ReleaseComObject($word) | Out-Null
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()
}
