[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [Parameter(Mandatory = $true)]
  [string]$InputPng
)

$ErrorActionPreference = "Stop"

$source = (Resolve-Path -LiteralPath $InputPng).Path
if ([System.IO.Path]::GetExtension($source) -ne ".png") {
  throw "图标母版必须是 PNG 文件：$source"
}

$magick = Get-Command magick.exe -ErrorAction SilentlyContinue
if (-not $magick) {
  $magick = Get-Command magick -ErrorAction SilentlyContinue
}
if (-not $magick) {
  throw "找不到 ImageMagick（magick）。请先安装后再生成图标。"
}

$metadata = (& $magick.Source identify -quiet -format "%m|%w|%h|%[channels]|%[opaque]" $source).Trim()
if ($LASTEXITCODE -ne 0) {
  throw "无法读取图标母版：$source"
}
$parts = $metadata.Split("|")
if ($parts.Count -ne 5) {
  throw "无法解析图标母版元数据：$metadata"
}
if ($parts[0] -ne "PNG") {
  throw "图标母版内容必须是真实 PNG，当前解码格式为 $($parts[0])。"
}
$width = [int]$parts[1]
$height = [int]$parts[2]
$channels = $parts[3].ToLowerInvariant()
$opaque = $parts[4].ToLowerInvariant()
if ($width -ne $height) {
  throw "图标母版必须为正方形，当前为 ${width}x${height}。"
}
if (($channels -notmatch "a") -or ($opaque -in @("true", "1"))) {
  throw "图标母版必须包含实际透明像素；拒绝不含透明通道或完全不透明的 PNG。"
}

$webIcon = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\web\assets\brand\clownfish-mark.png"))
$clientPng = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "assets\clownfish-icon.png"))
$clientIco = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "assets\clownfish.ico"))
$tempRoot = [System.IO.Path]::GetFullPath((Join-Path ([System.IO.Path]::GetTempPath()) ("clownfish-icons-" + [guid]::NewGuid().ToString("N"))))
$systemTempPrefix = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath()).TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
if (-not $tempRoot.StartsWith($systemTempPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "拒绝使用系统临时目录之外的工作目录：$tempRoot"
}

New-Item -ItemType Directory -Path $tempRoot | Out-Null

function Assert-TransparentPng {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][int]$ExpectedSize
  )
  $actual = (& $magick.Source identify -quiet -format "%m|%w|%h|%[channels]|%[opaque]" $Path).Trim().Split("|")
  if ($LASTEXITCODE -ne 0 -or $actual.Count -ne 5 -or $actual[0] -ne "PNG" -or [int]$actual[1] -ne $ExpectedSize -or [int]$actual[2] -ne $ExpectedSize -or $actual[3].ToLowerInvariant() -notmatch "a" -or $actual[4].ToLowerInvariant() -in @("true", "1")) {
    throw "生成物不是 ${ExpectedSize}px 透明 PNG：$Path"
  }
}

function Assert-MultiSizeIco {
  param([Parameter(Mandatory = $true)][string]$Path)
  $frames = @(& $magick.Source identify -quiet -format "%m|%w|%h`n" $Path) | Where-Object { $_ -ne "" }
  if ($LASTEXITCODE -ne 0) { throw "无法回读生成的 ICO：$Path" }
  $actualSizes = @($frames | ForEach-Object {
    $frame = $_.Trim().Split("|")
    if ($frame.Count -ne 3 -or $frame[0] -ne "ICO" -or $frame[1] -ne $frame[2]) { throw "ICO 帧格式无效：$_" }
    [int]$frame[1]
  } | Sort-Object)
  $expectedSizes = @(16, 24, 32, 48, 64, 128, 256)
  if (($actualSizes -join ",") -ne ($expectedSizes -join ",")) {
    throw "ICO 帧尺寸不完整：$($actualSizes -join ',')"
  }
}

try {
  $stagedWeb = Join-Path $tempRoot "clownfish-mark.png"
  $stagedClient = Join-Path $tempRoot "clownfish-icon.png"
  $stagedIco = Join-Path $tempRoot "clownfish.ico"

  & $magick.Source $source -filter Lanczos -resize "512x512!" -strip $stagedWeb
  if ($LASTEXITCODE -ne 0) { throw "生成 512px Web 图标失败。" }
  & $magick.Source $source -filter Lanczos -resize "256x256!" -strip $stagedClient
  if ($LASTEXITCODE -ne 0) { throw "生成 256px 客户端 PNG 图标失败。" }

  $icoFrames = @()
  foreach ($size in @(16, 24, 32, 48, 64, 128, 256)) {
    $frame = Join-Path $tempRoot ("icon-{0}.png" -f $size)
    & $magick.Source $source -filter Lanczos -resize ("{0}x{0}!" -f $size) -strip $frame
    if ($LASTEXITCODE -ne 0) { throw "生成 ${size}px ICO 帧失败。" }
    $icoFrames += $frame
  }
  & $magick.Source $icoFrames $stagedIco
  if ($LASTEXITCODE -ne 0) { throw "生成多尺寸 ICO 失败。" }

  Assert-TransparentPng -Path $stagedWeb -ExpectedSize 512
  Assert-TransparentPng -Path $stagedClient -ExpectedSize 256
  Assert-MultiSizeIco -Path $stagedIco

  if ($PSCmdlet.ShouldProcess("小丑鱼 Web 与 Windows 图标", "以透明 PNG 母版更新三个图标资源")) {
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $webIcon), (Split-Path -Parent $clientPng) | Out-Null
    $replacements = @(
      @{ Source = $stagedWeb; Target = $webIcon },
      @{ Source = $stagedClient; Target = $clientPng },
      @{ Source = $stagedIco; Target = $clientIco }
    )
    $installed = @()
    try {
      foreach ($item in $replacements) {
        $backup = Join-Path $tempRoot (([System.IO.Path]::GetFileName($item.Target)) + ".backup")
        if (Test-Path -LiteralPath $item.Target) {
          Copy-Item -LiteralPath $item.Target -Destination $backup
        }
        $installed += @{ Target = $item.Target; Backup = $backup }
        Copy-Item -LiteralPath $item.Source -Destination $item.Target -Force
      }
    } catch {
      foreach ($item in $installed) {
        if (Test-Path -LiteralPath $item.Backup) {
          Copy-Item -LiteralPath $item.Backup -Destination $item.Target -Force
        } elseif (Test-Path -LiteralPath $item.Target) {
          Remove-Item -LiteralPath $item.Target -Force
        }
      }
      throw
    }
    Write-Host "Updated: $webIcon"
    Write-Host "Updated: $clientPng"
    Write-Host "Updated: $clientIco"
  }
} finally {
  $resolvedTemp = [System.IO.Path]::GetFullPath($tempRoot)
  if ($resolvedTemp.StartsWith($systemTempPrefix, [System.StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $resolvedTemp)) {
    Remove-Item -LiteralPath $resolvedTemp -Recurse -Force
  }
}
