# 用本机安装的 Microsoft Word 验证 DOCX 文字修改的保真性。
#
# 这是"可编辑"标注的证据来源。结构检查只能证明包没坏，
# 只有真实 Word 能回答两个问题：打开时会不会触发修复，以及未改动内容
# 的格式是否逐字符一致。
#
# 流程：
#   1. New-DocxCorpus.ps1 用真实 Word 生成样本；
#   2. docx-fidelity-cli.ts 用引擎各改一个段落；
#   3. 本脚本以 OpenAndRepair:=False 打开产物——文件损坏时 Word 直接抛错，
#      不会静默修复；
#   4. 逐段比对文字，并对未改动段落比对逐字符格式签名
#      （加粗/斜体/下划线/颜色/字号/字体）；
#   5. 比对文档级要素数量：表格、批注、脚注、修订、域、页眉文字。
#
# 用法：
#   pwsh -File scripts/docx-fidelity/Test-DocxFidelity.ps1
#
# 退出码：0 全部通过；1 有失败项；2 环境不满足（未装 Word / 缺 Node）。

[CmdletBinding()]
param(
  [string]$WorkingDirectory = (Join-Path $env:TEMP "clownfish-docx-fidelity")
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$sdkRoot = Join-Path $repoRoot "sdk\typescript"

$corpusDirectory = Join-Path $WorkingDirectory "corpus"
$editedDirectory = Join-Path $WorkingDirectory "edited"
$reportPath = Join-Path $WorkingDirectory "edit-report.json"

$wdAlertsNone = 0
$wdStatisticParagraphs = 4

Write-Output "工作目录：$WorkingDirectory"
New-Item -ItemType Directory -Force -Path $WorkingDirectory | Out-Null

# 1. 生成样本
& (Join-Path $PSScriptRoot "New-DocxCorpus.ps1") -OutputDirectory $corpusDirectory
if ($LASTEXITCODE -eq 2) { exit 2 }

# 2. 引擎改动
Push-Location $sdkRoot
try {
  $json = & npx tsx scripts/docx-fidelity-cli.ts $corpusDirectory $editedDirectory
  if (-not $json) { Write-Error "编辑步骤没有输出；确认已安装依赖。"; exit 2 }
  $json | Out-File -FilePath $reportPath -Encoding utf8
} finally {
  Pop-Location
}
# 先赋值再包 @()：PS 5.1 的 ConvertFrom-Json 在管道里不展开数组，
# 直接 @(管道) 会把整个数组当成一个元素。
$parsedReports = Get-Content $reportPath -Raw | ConvertFrom-Json
$reports = @($parsedReports)

# 3. Word 端核对
try {
  $word = New-Object -ComObject Word.Application
} catch {
  Write-Error "无法启动 Microsoft Word；本机未安装或 COM 不可用。"
  exit 2
}
$word.Visible = $false
$word.DisplayAlerts = $wdAlertsNone

function Get-FormatSignature {
  param([object]$Paragraph)
  # 逐字符采样后做行程压缩：未改动段落的签名必须完全一致。
  $range = $Paragraph.Range
  $parts = New-Object System.Collections.Generic.List[string]
  $previous = $null
  $count = 0
  foreach ($character in $range.Characters) {
    $font = $character.Font
    $key = "{0}|{1}|{2}|{3}|{4}|{5}" -f $font.Bold, $font.Italic, $font.Underline, $font.Color, $font.Size, $font.Name
    if ($key -eq $previous) { $count++ }
    else {
      if ($null -ne $previous) { $parts.Add("$previous x$count") }
      $previous = $key
      $count = 1
    }
  }
  if ($null -ne $previous) { $parts.Add("$previous x$count") }
  return ($parts -join " / ")
}

function Get-DocumentFacts {
  param([object]$Document)
  return [ordered]@{
    Paragraphs = $Document.ComputeStatistics($wdStatisticParagraphs)
    Tables     = $Document.Tables.Count
    Comments   = $Document.Comments.Count
    Footnotes  = $Document.Footnotes.Count
    Revisions  = $Document.Revisions.Count
    Fields     = $Document.Fields.Count
    InlineShapes = $Document.InlineShapes.Count
    HeaderText = $Document.Sections(1).Headers(1).Range.Text
    FooterText = $Document.Sections(1).Footers(1).Range.Text
  }
}

$failures = New-Object System.Collections.Generic.List[string]
$passedCount = 0

try {
  foreach ($report in $reports) {
    $name = $report.file
    Write-Output ""
    Write-Output "== $name"

    if ($report.error) {
      $failures.Add("$name 编辑步骤失败：$($report.error)")
      Write-Output "   FAIL 编辑步骤：$($report.error)"
      continue
    }
    if (-not $report.structureChecksPassed) {
      $failures.Add("$name 结构检查未通过：$($report.structureFailures -join '、')")
      Write-Output "   FAIL 结构检查：$($report.structureFailures -join '、')"
      continue
    }

    $originalPath = Join-Path $corpusDirectory $name
    $editedPath = $report.output
    $caseFailures = New-Object System.Collections.Generic.List[string]

    $originalDoc = $word.Documents.Open($originalPath, $false, $true, $false, "", "", $true)
    $originalFacts = Get-DocumentFacts -Document $originalDoc
    $originalParagraphs = @()
    $originalSignatures = @()
    foreach ($paragraph in $originalDoc.Paragraphs) {
      $originalParagraphs += $paragraph.Range.Text
      $originalSignatures += (Get-FormatSignature -Paragraph $paragraph)
    }
    $originalDoc.Close($false)

    # 关键一步：OpenAndRepair 传 $false。文件有问题时 Word 抛错而不是悄悄修好。
    $editedDoc = $null
    try {
      # 位置参数依次为：FileName, ConfirmConversions, ReadOnly, AddToRecentFiles,
      # PasswordDocument, PasswordTemplate, Revert, WritePasswordDocument,
      # WritePasswordTemplate, Format, Encoding, Visible, OpenAndRepair,
      # DocumentDirection, NoEncodingDialog。第 13 位就是 OpenAndRepair。
      $editedDoc = $word.Documents.Open($editedPath, $false, $true, $false, "", "", $true, "", "", 0, 0, $false, $false, 0, $true)
      Write-Output "   OK   Word 打开产物，未触发修复"
    } catch {
      $caseFailures.Add("Word 打开产物失败（可能需要修复）：$($_.Exception.Message)")
      Write-Output "   FAIL Word 打开产物失败：$($_.Exception.Message)"
    }

    if ($editedDoc) {
      $editedFacts = Get-DocumentFacts -Document $editedDoc
      foreach ($key in $originalFacts.Keys) {
        if ("$($originalFacts[$key])" -ne "$($editedFacts[$key])") {
          $caseFailures.Add("$key 变了：$($originalFacts[$key]) -> $($editedFacts[$key])")
        }
      }
      if ($caseFailures.Count -eq 0) { Write-Output "   OK   表格/批注/脚注/修订/域/页眉页脚数量与原文一致" }

      $editedParagraphs = @()
      $editedSignatures = @()
      foreach ($paragraph in $editedDoc.Paragraphs) {
        $editedParagraphs += $paragraph.Range.Text
        $editedSignatures += (Get-FormatSignature -Paragraph $paragraph)
      }
      $editedDoc.Close($false)

      if ($editedParagraphs.Count -ne $originalParagraphs.Count) {
        $caseFailures.Add("段落数变了：$($originalParagraphs.Count) -> $($editedParagraphs.Count)")
      } else {
        $ordinal = [int]$report.editedOrdinal
        $textMismatch = 0
        $formatMismatch = 0
        for ($i = 0; $i -lt $originalParagraphs.Count; $i++) {
          if ($i -eq $ordinal) {
            if ($editedParagraphs[$i] -notlike "*已改写*") { $caseFailures.Add("目标段落没有写入新文字") }
            continue
          }
          if ($originalParagraphs[$i] -ne $editedParagraphs[$i]) {
            $textMismatch++
            if ($textMismatch -le 2) { $caseFailures.Add("第 $($i+1) 段文字被改动") }
          }
          if ($originalSignatures[$i] -ne $editedSignatures[$i]) {
            $formatMismatch++
            if ($formatMismatch -le 2) { $caseFailures.Add("第 $($i+1) 段格式签名不一致") }
          }
        }
        if ($textMismatch -eq 0) { Write-Output "   OK   未改动段落文字逐段一致（$($originalParagraphs.Count - 1) 段）" }
        if ($formatMismatch -eq 0) { Write-Output "   OK   未改动段落格式签名逐字符一致" }
      }
    }

    if ($caseFailures.Count -eq 0) {
      $passedCount++
    } else {
      foreach ($failure in $caseFailures) {
        $failures.Add("$name ${failure}")
        Write-Output "   FAIL $failure"
      }
    }
  }
} finally {
  $word.Quit()
  [System.Runtime.InteropServices.Marshal]::ReleaseComObject($word) | Out-Null
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()
}

Write-Output ""
Write-Output "======================================"
Write-Output "通过 $passedCount / $($reports.Count)"
if ($failures.Count -gt 0) {
  Write-Output "失败项："
  foreach ($failure in $failures) { Write-Output "  - $failure" }
  exit 1
}
Write-Output "全部通过。"
exit 0
