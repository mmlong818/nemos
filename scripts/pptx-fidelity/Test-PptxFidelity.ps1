# 用本机安装的 Microsoft PowerPoint 验证 PPTX 文字修改的保真性。
#
# 与 scripts/docx-fidelity 那套同构：样本由真实 PowerPoint 生成，
# 改一个段落后再用真实 PowerPoint 打开，逐形状比对文字与逐字符格式签名。
# 结构检查只能证明包没坏，能不能正常打开、格式有没有被动，只有真实
# PowerPoint 能回答。
#
# 用法：
#   pwsh -File scripts/pptx-fidelity/Test-PptxFidelity.ps1
#
# 退出码：0 全部通过；1 有失败项；2 环境不满足。
# CI 不跑这项检查——CI 机器上没有 PowerPoint。

[CmdletBinding()]
param(
  [string]$WorkingDirectory = (Join-Path $env:TEMP "clownfish-pptx-fidelity")
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$sdkRoot = Join-Path $repoRoot "sdk\typescript"

$corpusDirectory = Join-Path $WorkingDirectory "corpus"
$editedDirectory = Join-Path $WorkingDirectory "edited"
$reportPath = Join-Path $WorkingDirectory "edit-report.json"

Write-Output "工作目录：$WorkingDirectory"
New-Item -ItemType Directory -Force -Path $WorkingDirectory | Out-Null

& (Join-Path $PSScriptRoot "New-PptxCorpus.ps1") -OutputDirectory $corpusDirectory
if ($LASTEXITCODE -eq 2) { exit 2 }

Push-Location $sdkRoot
try {
  $json = & npx tsx scripts/pptx-fidelity-cli.ts $corpusDirectory $editedDirectory
  if (-not $json) { Write-Error "编辑步骤没有输出；确认已安装依赖。"; exit 2 }
  $json | Out-File -FilePath $reportPath -Encoding utf8
} finally {
  Pop-Location
}

# 先赋值再包 @()：PS 5.1 的 ConvertFrom-Json 在管道里不展开数组。
$parsedReports = Get-Content $reportPath -Raw | ConvertFrom-Json
$reports = @($parsedReports)

try {
  $ppt = New-Object -ComObject PowerPoint.Application
} catch {
  Write-Error "无法启动 Microsoft PowerPoint；本机未安装或 COM 不可用。"
  exit 2
}

function Get-Snapshot {
  param([object]$Presentation)
  $rows = @()
  foreach ($slide in $Presentation.Slides) {
    foreach ($shape in $slide.Shapes) {
      $text = ""
      $sig = ""
      if ($shape.HasTextFrame -eq -1 -and $shape.TextFrame.HasText -eq -1) {
        $range = $shape.TextFrame.TextRange
        $text = $range.Text
        $parts = @()
        $prev = $null
        $n = 0
        for ($i = 1; $i -le $range.Length; $i++) {
          $f = $range.Characters($i, 1).Font
          $k = "{0}|{1}|{2}|{3}|{4}" -f $f.Bold, $f.Italic, $f.Underline, $f.Color.RGB, $f.Size
          if ($k -eq $prev) { $n++ }
          else {
            if ($null -ne $prev) { $parts += "$prev x$n" }
            $prev = $k
            $n = 1
          }
        }
        if ($null -ne $prev) { $parts += "$prev x$n" }
        $sig = ($parts -join " / ")
      }
      $rows += [pscustomobject]@{ Slide = $slide.SlideIndex; Name = $shape.Name; Text = $text; Sig = $sig }
    }
  }
  return $rows
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
    if (@($report.changed).Count -eq 0) {
      $failures.Add("$name 没有写入任何改动")
      Write-Output "   FAIL 没有写入任何改动"
      continue
    }

    $originalPath = Join-Path $corpusDirectory $name
    $caseFailures = New-Object System.Collections.Generic.List[string]

    $a = $ppt.Presentations.Open($originalPath, -1, 0, 0)
    $aRows = Get-Snapshot -Presentation $a
    $aSlides = $a.Slides.Count
    $a.Close()

    $b = $null
    try {
      $b = $ppt.Presentations.Open($report.output, -1, 0, 0)
      Write-Output "   OK   PowerPoint 打开产物"
    } catch {
      $caseFailures.Add("PowerPoint 打开产物失败：$($_.Exception.Message)")
      Write-Output "   FAIL PowerPoint 打开产物失败：$($_.Exception.Message)"
    }

    if ($b) {
      $bRows = Get-Snapshot -Presentation $b
      $bSlides = $b.Slides.Count
      $b.Close()
      if ($aSlides -ne $bSlides) {
        $caseFailures.Add("页数变了：$aSlides -> $bSlides")
      } elseif ($aRows.Count -ne $bRows.Count) {
        $caseFailures.Add("形状数变了：$($aRows.Count) -> $($bRows.Count)")
      } else {
        Write-Output "   OK   页数与形状数与原文一致（$aSlides 页 / $($aRows.Count) 个形状）"
        $changedShapes = 0
        $formatMismatch = 0
        for ($i = 0; $i -lt $aRows.Count; $i++) {
          $sameText = $aRows[$i].Text -eq $bRows[$i].Text
          $sameSig = $aRows[$i].Sig -eq $bRows[$i].Sig
          if (-not $sameText) {
            $changedShapes++
            if ($bRows[$i].Text -notlike "*已改写*") {
              $caseFailures.Add("形状 $($aRows[$i].Name) 的文字变了但不是目标改动")
            }
            continue
          }
          if (-not $sameSig) {
            $formatMismatch++
            if ($formatMismatch -le 2) { $caseFailures.Add("未改动形状 $($aRows[$i].Name) 的格式签名不一致") }
          }
        }
        if ($changedShapes -ne 1) { $caseFailures.Add("应只有 1 个形状发生文字变化，实际 $changedShapes 个") }
        else { Write-Output "   OK   只有目标形状的文字发生变化" }
        if ($formatMismatch -eq 0) { Write-Output "   OK   未改动形状的格式签名逐字符一致" }
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
  $ppt.Quit()
  [System.Runtime.InteropServices.Marshal]::ReleaseComObject($ppt) | Out-Null
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
