param(
  [string]$CorpusDir = ".tmp-runtime\office-corpus",
  [string]$ReportFile = ".tmp-runtime\office-corpus\word-report.json"
)

$ErrorActionPreference = "Stop"
$resolvedCorpus = (Resolve-Path -LiteralPath $CorpusDir).Path
$files = @(Get-ChildItem -LiteralPath $resolvedCorpus -File -Filter "*.docx" | Sort-Object Name)
if ($files.Count -ne 20) { throw "Office corpus must contain exactly 20 DOCX files; found $($files.Count)." }

$word = $null
$receipts = @()
try {
  $word = New-Object -ComObject Word.Application
  $word.Visible = $false
  $word.DisplayAlerts = 0
  foreach ($file in $files) {
    $document = $null
    try {
      $document = $word.Documents.Open($file.FullName, $false, $true)
      $pageCount = [int]$document.ComputeStatistics(2)
      $receipts += [pscustomobject]@{
        file = $file.Name
        passed = ($document.Paragraphs.Count -gt 0 -and $pageCount -gt 0)
        paragraphs = [int]$document.Paragraphs.Count
        tables = [int]$document.Tables.Count
        pages = $pageCount
        byteLength = [int64]$file.Length
      }
    } catch {
      $receipts += [pscustomobject]@{
        file = $file.Name
        passed = $false
        error = $_.Exception.Message
        byteLength = [int64]$file.Length
      }
    } finally {
      if ($null -ne $document) { $document.Close(0) }
    }
  }
} finally {
  if ($null -ne $word) { $word.Quit() }
}

$report = [pscustomobject]@{
  schema = "clownfish.office-word.v1"
  checkedAt = (Get-Date).ToUniversalTime().ToString("o")
  application = "Microsoft Word"
  total = $receipts.Count
  passed = @($receipts | Where-Object passed).Count
  failed = @($receipts | Where-Object { -not $_.passed }).Count
  receipts = $receipts
}
$reportPath = [System.IO.Path]::GetFullPath($ReportFile)
[System.IO.Directory]::CreateDirectory([System.IO.Path]::GetDirectoryName($reportPath)) | Out-Null
$report | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $reportPath -Encoding UTF8
$report | Select-Object schema, application, total, passed, failed | ConvertTo-Json -Compress
if ($report.failed -gt 0) { exit 1 }
