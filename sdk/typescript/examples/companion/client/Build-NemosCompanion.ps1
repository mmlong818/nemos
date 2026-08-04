$ErrorActionPreference = "Stop"

$ClientRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$Dist = Join-Path $ClientRoot "dist"
$PortableRoot = Join-Path $Dist "portable\Nemos Companion"
$PortableApp = Join-Path $PortableRoot "app"
$PortableNode = Join-Path $PortableRoot "node"
$PortableSandboxNode = Join-Path $PortableRoot "mcp-runtime"
$PortableSandboxPython = Join-Path $PortableSandboxNode "python"
$Vendor = Join-Path $ClientRoot "vendor\webview2"
$Version = "1.0.4022.49"
$PackageDir = Join-Path $Vendor $Version
$Source = Join-Path $ClientRoot "src\NemosCompanionClient.cs"
$Manifest = Join-Path $ClientRoot "manifest.json"
$Icon = Join-Path $ClientRoot "assets\nemos-companion.ico"
$Exe = Join-Path $Dist "Nemos Companion.exe"
$SandboxNodeVersion = "26.5.0"
$SandboxNodeArchive = "node-v$SandboxNodeVersion-win-x64.zip"
$SandboxNodeExpectedSha256 = "d3b2277dbcccfdf24ef6302928f64f484cff1d77a6d3caa3a28f4d20ce9158f6"
$SandboxNodeVendorRoot = Join-Path $ClientRoot "vendor\node"
$SandboxNodeArchivePath = Join-Path $SandboxNodeVendorRoot $SandboxNodeArchive
$SandboxNodePackageDir = Join-Path $SandboxNodeVendorRoot "node-v$SandboxNodeVersion-win-x64"
$SandboxPythonVersion = "3.14.6"
$SandboxPythonArchive = "python-$SandboxPythonVersion-embed-amd64.zip"
$SandboxPythonExpectedSha256 = "df901e84a896ff1ee720ad03377e0c8d8c2244fda79808aeeaff6316df1cb75c"
$SandboxPythonVendorRoot = Join-Path $ClientRoot "vendor\python"
$SandboxPythonArchivePath = Join-Path $SandboxPythonVendorRoot $SandboxPythonArchive
$SandboxPythonPackageDir = Join-Path $SandboxPythonVendorRoot $SandboxPythonVersion
$SandboxHostSource = Join-Path $ClientRoot "src\NemosSandboxHost.cs"
$SandboxHostExe = Join-Path $Dist "NemosSandboxHost.exe"

function Get-CscPath {
  $candidates = @(
    "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe",
    "$env:WINDIR\Microsoft.NET\Framework\v4.0.30319\csc.exe"
  )
  foreach ($candidate in $candidates) {
    if (Test-Path -LiteralPath $candidate) { return $candidate }
  }
  throw "找不到 .NET Framework C# 编译器 csc.exe"
}

function Ensure-WebView2Sdk {
  $core = Join-Path $PackageDir "lib\net462\Microsoft.Web.WebView2.Core.dll"
  $winforms = Join-Path $PackageDir "lib\net462\Microsoft.Web.WebView2.WinForms.dll"
  $loader = Join-Path $PackageDir "runtimes\win-x64\native\WebView2Loader.dll"
  if ((Test-Path -LiteralPath $core) -and (Test-Path -LiteralPath $winforms) -and (Test-Path -LiteralPath $loader)) {
    return
  }

  New-Item -ItemType Directory -Force -Path $Vendor | Out-Null
  $nupkg = Join-Path $Vendor "microsoft.web.webview2.$Version.nupkg"
  if (-not (Test-Path -LiteralPath $nupkg)) {
    Invoke-WebRequest -Uri "https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/$Version/microsoft.web.webview2.$Version.nupkg" -OutFile $nupkg
  }
  if (Test-Path -LiteralPath $PackageDir) { Remove-Item -LiteralPath $PackageDir -Recurse -Force }
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  [System.IO.Compression.ZipFile]::ExtractToDirectory($nupkg, $PackageDir)
}

function Ensure-SandboxNodeRuntime {
  New-Item -ItemType Directory -Force -Path $SandboxNodeVendorRoot | Out-Null
  $downloadPath = $SandboxNodeArchivePath + ".download"
  $archiveValid = $false

  if (Test-Path -LiteralPath $SandboxNodeArchivePath) {
    $archiveHash = (Get-FileHash -LiteralPath $SandboxNodeArchivePath -Algorithm SHA256).Hash.ToLowerInvariant()
    $archiveValid = $archiveHash -eq $SandboxNodeExpectedSha256
    if (-not $archiveValid) {
      Remove-Item -LiteralPath $SandboxNodeArchivePath -Force
    }
  }

  if (-not $archiveValid) {
    if (Test-Path -LiteralPath $downloadPath) {
      Remove-Item -LiteralPath $downloadPath -Force
    }
    Invoke-WebRequest -Uri "https://nodejs.org/dist/v$SandboxNodeVersion/$SandboxNodeArchive" -OutFile $downloadPath
    $downloadHash = (Get-FileHash -LiteralPath $downloadPath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($downloadHash -ne $SandboxNodeExpectedSha256) {
      Remove-Item -LiteralPath $downloadPath -Force
      throw "MCP 沙箱 Node 下载校验失败"
    }
    Move-Item -LiteralPath $downloadPath -Destination $SandboxNodeArchivePath -Force
  }

  if (Test-Path -LiteralPath $SandboxNodePackageDir) {
    Remove-Item -LiteralPath $SandboxNodePackageDir -Recurse -Force
  }
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  [System.IO.Compression.ZipFile]::ExtractToDirectory($SandboxNodeArchivePath, $SandboxNodeVendorRoot)

  $sandboxNodeExe = Join-Path $SandboxNodePackageDir "node.exe"
  if (-not (Test-Path -LiteralPath $sandboxNodeExe)) {
    throw "MCP 沙箱 Node 解压后缺少 node.exe"
  }
  $actualVersion = (& $sandboxNodeExe -p "process.versions.node").Trim()
  if ($actualVersion -ne $SandboxNodeVersion) {
    throw "MCP 沙箱 Node 版本不匹配：期望 $SandboxNodeVersion，实际 $actualVersion"
  }
  return $sandboxNodeExe
}

function Ensure-SandboxPythonRuntime {
  New-Item -ItemType Directory -Force -Path $SandboxPythonVendorRoot | Out-Null
  $pythonExe = Join-Path $SandboxPythonPackageDir "python.exe"
  if (Test-Path -LiteralPath $pythonExe) {
    $installedVersion = ((& $pythonExe --version) -replace "^Python\s+", "").Trim()
    if ($installedVersion -eq $SandboxPythonVersion) {
      return $pythonExe
    }
    Remove-Item -LiteralPath $SandboxPythonPackageDir -Recurse -Force
  }

  $downloadPath = $SandboxPythonArchivePath + ".download"
  $archiveValid = $false
  if (Test-Path -LiteralPath $SandboxPythonArchivePath) {
    $archiveHash = (Get-FileHash -LiteralPath $SandboxPythonArchivePath -Algorithm SHA256).Hash.ToLowerInvariant()
    $archiveValid = $archiveHash -eq $SandboxPythonExpectedSha256
    if (-not $archiveValid) {
      Remove-Item -LiteralPath $SandboxPythonArchivePath -Force
    }
  }

  if (-not $archiveValid) {
    if (Test-Path -LiteralPath $downloadPath) {
      Remove-Item -LiteralPath $downloadPath -Force
    }
    Invoke-WebRequest -Uri "https://www.python.org/ftp/python/$SandboxPythonVersion/$SandboxPythonArchive" -OutFile $downloadPath
    $downloadHash = (Get-FileHash -LiteralPath $downloadPath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($downloadHash -ne $SandboxPythonExpectedSha256) {
      Remove-Item -LiteralPath $downloadPath -Force
      throw "MCP 沙箱 Python 下载校验失败"
    }
    Move-Item -LiteralPath $downloadPath -Destination $SandboxPythonArchivePath -Force
  }

  New-Item -ItemType Directory -Force -Path $SandboxPythonPackageDir | Out-Null
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  [System.IO.Compression.ZipFile]::ExtractToDirectory($SandboxPythonArchivePath, $SandboxPythonPackageDir)
  if (-not (Test-Path -LiteralPath $pythonExe)) {
    throw "MCP 沙箱 Python 解压后缺少 python.exe"
  }
  $actualVersion = ((& $pythonExe --version) -replace "^Python\s+", "").Trim()
  if ($actualVersion -ne $SandboxPythonVersion) {
    throw "MCP 沙箱 Python 版本不匹配：期望 $SandboxPythonVersion，实际 $actualVersion"
  }
  return $pythonExe
}

Ensure-WebView2Sdk
$SandboxNodeExe = Ensure-SandboxNodeRuntime
$SandboxPythonExe = Ensure-SandboxPythonRuntime
New-Item -ItemType Directory -Force -Path $Dist | Out-Null
if (-not (Test-Path -LiteralPath $Icon)) {
  throw "找不到客户端图标：$Icon"
}

$CoreDll = Join-Path $PackageDir "lib\net462\Microsoft.Web.WebView2.Core.dll"
$WinFormsDll = Join-Path $PackageDir "lib\net462\Microsoft.Web.WebView2.WinForms.dll"
$LoaderDll = Join-Path $PackageDir "runtimes\win-x64\native\WebView2Loader.dll"
$Csc = Get-CscPath

& $Csc /nologo /target:exe /platform:x64 /optimize+ /nowin32manifest `
  /out:$SandboxHostExe `
  /reference:System.dll `
  /reference:System.Core.dll `
  /reference:System.Security.dll `
  $SandboxHostSource

& $Csc /nologo /target:winexe /platform:x64 /optimize+ `
  "/win32icon:$Icon" `
  /out:$Exe `
  /reference:System.dll `
  /reference:System.Core.dll `
  /reference:System.Drawing.dll `
  /reference:System.Security.dll `
  /reference:System.Windows.Forms.dll `
  /reference:$CoreDll `
  /reference:$WinFormsDll `
  $Source

Copy-Item -LiteralPath $CoreDll -Destination $Dist -Force
Copy-Item -LiteralPath $WinFormsDll -Destination $Dist -Force
Copy-Item -LiteralPath $LoaderDll -Destination $Dist -Force
Copy-Item -LiteralPath $Manifest -Destination $Dist -Force
Copy-Item -LiteralPath $Icon -Destination (Join-Path $Dist "Nemos Companion.ico") -Force
if (Test-Path -LiteralPath (Join-Path $ClientRoot "desktop-helper")) {
  Copy-Item -LiteralPath (Join-Path $ClientRoot "desktop-helper") -Destination $Dist -Recurse -Force
}

if (Test-Path -LiteralPath $PortableRoot) {
  Remove-Item -LiteralPath $PortableRoot -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $PortableRoot, $PortableApp, $PortableNode, $PortableSandboxNode | Out-Null

Copy-Item -LiteralPath $Exe -Destination $PortableRoot -Force
Copy-Item -LiteralPath $CoreDll -Destination $PortableRoot -Force
Copy-Item -LiteralPath $WinFormsDll -Destination $PortableRoot -Force
Copy-Item -LiteralPath $LoaderDll -Destination $PortableRoot -Force
Copy-Item -LiteralPath $Manifest -Destination $PortableRoot -Force
Copy-Item -LiteralPath $Icon -Destination (Join-Path $PortableRoot "Nemos Companion.ico") -Force
if (Test-Path -LiteralPath (Join-Path $ClientRoot "desktop-helper")) {
  Copy-Item -LiteralPath (Join-Path $ClientRoot "desktop-helper") -Destination $PortableRoot -Recurse -Force
}

$NodeExe = (Get-Command node.exe -ErrorAction Stop).Source
$NodeVersion = (& $NodeExe -p "process.versions.node").Trim()
$NodeMajor = [int]($NodeVersion.Split(".")[0])
if ($NodeMajor -lt 25) {
  Write-Host ('主服务继续使用 Node {0}；MCP 网络隔离由独立 Node {1} 运行时执行。' -f $NodeVersion, $SandboxNodeVersion)
}
Copy-Item -LiteralPath $NodeExe -Destination (Join-Path $PortableNode "node.exe") -Force
Copy-Item -LiteralPath $SandboxNodeExe -Destination (Join-Path $PortableSandboxNode "node.exe") -Force
Set-Content -LiteralPath (Join-Path $PortableSandboxNode "version.txt") -Encoding ASCII -Value $SandboxNodeVersion
Copy-Item -LiteralPath $SandboxHostExe -Destination (Join-Path $PortableSandboxNode "NemosSandboxHost.exe") -Force
Copy-Item -LiteralPath $SandboxPythonPackageDir -Destination $PortableSandboxPython -Recurse -Force
Set-Content -LiteralPath (Join-Path $PortableSandboxPython "version.txt") -Encoding ASCII -Value $SandboxPythonVersion

$SdkRoot = Resolve-Path (Join-Path $ClientRoot "..\..\..")
$RepoRoot = Resolve-Path (Join-Path $SdkRoot "..\..")
if (Test-Path -LiteralPath (Join-Path $RepoRoot "README.md")) {
  Copy-Item -LiteralPath (Join-Path $RepoRoot "README.md") -Destination $PortableRoot -Force
}
Copy-Item -LiteralPath (Join-Path $SdkRoot "package.json") -Destination $PortableApp -Force
Copy-Item -LiteralPath (Join-Path $SdkRoot "memory-core.version.json") -Destination $PortableApp -Force
if (Test-Path -LiteralPath (Join-Path $SdkRoot "package-lock.json")) {
  Copy-Item -LiteralPath (Join-Path $SdkRoot "package-lock.json") -Destination $PortableApp -Force
}
if (Test-Path -LiteralPath (Join-Path $SdkRoot "tsconfig.json")) {
  Copy-Item -LiteralPath (Join-Path $SdkRoot "tsconfig.json") -Destination $PortableApp -Force
}
Copy-Item -LiteralPath (Join-Path $SdkRoot "src") -Destination $PortableApp -Recurse -Force
Copy-Item -LiteralPath (Join-Path $SdkRoot "node_modules") -Destination $PortableApp -Recurse -Force

$PortableCompanion = Join-Path $PortableApp "examples\companion"
New-Item -ItemType Directory -Force -Path $PortableCompanion | Out-Null
Get-ChildItem -LiteralPath (Join-Path $SdkRoot "examples\companion") -File | ForEach-Object {
  Copy-Item -LiteralPath $_.FullName -Destination $PortableCompanion -Force
}
Copy-Item -LiteralPath (Join-Path $SdkRoot "examples\companion\web") -Destination $PortableCompanion -Recurse -Force
New-Item -ItemType Directory -Force -Path (Join-Path $PortableCompanion "client") | Out-Null
Copy-Item -LiteralPath $Manifest -Destination (Join-Path $PortableCompanion "client") -Force

Set-Content -LiteralPath (Join-Path $PortableRoot "Start Nemos Companion.cmd") -Encoding ASCII -Value @(
  "@echo off",
  "cd /d ""%~dp0""",
  "start """" ""%~dp0Nemos Companion.exe"""
)

Write-Host "Built: $Exe"
Write-Host "Portable: $PortableRoot"
