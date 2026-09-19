$ErrorActionPreference = "Stop"

if ($env:CLOWNFISH_DEVELOPMENT_BUILD -notin @($null, "", "0", "1")) {
  throw "CLOWNFISH_DEVELOPMENT_BUILD must be 0, 1, or unset"
}
$ClientCompilerDefine = if ($env:CLOWNFISH_DEVELOPMENT_BUILD -eq "1") {
  "/define:CLOWNFISH_DEVELOPMENT"
} else {
  "/define:CLOWNFISH_RELEASE"
}

$ClientRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$Dist = Join-Path $ClientRoot "dist"
if ($env:CLOWNFISH_RELEASE_DIRECTORY) {
  $releaseName = $env:CLOWNFISH_RELEASE_DIRECTORY
  if ($releaseName -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]{0,70}$') { throw "Release directory must be a single directory name under dist" }
  $Dist = Join-Path $Dist $releaseName
  if (Test-Path -LiteralPath $Dist) { throw "Release directory already exists; refusing to overwrite" }
}
$PortableRoot = Join-Path $Dist "portable\小丑鱼"
$PortableApp = Join-Path $PortableRoot "app"
$PortableNode = Join-Path $PortableRoot "node"
$PortableSandboxNode = Join-Path $PortableRoot "mcp-runtime"
$PortableSandboxPython = Join-Path $PortableSandboxNode "python"
$PortableLicenses = Join-Path $PortableRoot "licenses"
$RuntimeLockPath = Join-Path $ClientRoot "runtime-lock.json"
$RuntimeLock = Get-Content -LiteralPath $RuntimeLockPath -Raw | ConvertFrom-Json
$Vendor = Join-Path $ClientRoot "vendor\webview2"
$Version = [string]$RuntimeLock.webView2Sdk.version
$PackageDir = Join-Path $Vendor $Version
$Source = Join-Path $ClientRoot "src\ClownfishClient.cs"
$PortableLauncherSource = Join-Path $ClientRoot "src\ClownfishPortableLauncher.cs"
$Manifest = Join-Path $ClientRoot "manifest.json"
$AppVersion = [string](Get-Content -LiteralPath $Manifest -Raw | ConvertFrom-Json).version
$Icon = Join-Path $ClientRoot "assets\clownfish.ico"
$Exe = Join-Path $Dist "小丑鱼.exe"
$MainNodeVersion = [string]$RuntimeLock.mainNode.version
$MainNodeArchive = [string]$RuntimeLock.mainNode.archive
$MainNodeExpectedSha256 = [string]$RuntimeLock.mainNode.sha256
$SandboxNodeVersion = [string]$RuntimeLock.mcpNode.version
$SandboxNodeArchive = [string]$RuntimeLock.mcpNode.archive
$SandboxNodeExpectedSha256 = [string]$RuntimeLock.mcpNode.sha256
$SandboxNodeVendorRoot = Join-Path $ClientRoot "vendor\node"
$MainNodeArchivePath = Join-Path $SandboxNodeVendorRoot $MainNodeArchive
$MainNodePackageDir = Join-Path $SandboxNodeVendorRoot "node-v$MainNodeVersion-win-x64"
$SandboxNodeArchivePath = Join-Path $SandboxNodeVendorRoot $SandboxNodeArchive
$SandboxNodePackageDir = Join-Path $SandboxNodeVendorRoot "node-v$SandboxNodeVersion-win-x64"
$SandboxPythonVersion = [string]$RuntimeLock.mcpPython.version
$SandboxPythonArchive = [string]$RuntimeLock.mcpPython.archive
$SandboxPythonExpectedSha256 = [string]$RuntimeLock.mcpPython.sha256
$SandboxPythonVendorRoot = Join-Path $ClientRoot "vendor\python"
$SandboxPythonArchivePath = Join-Path $SandboxPythonVendorRoot $SandboxPythonArchive
$SandboxPythonPackageDir = Join-Path $SandboxPythonVendorRoot $SandboxPythonVersion
$SandboxHostSource = Join-Path $ClientRoot "src\ClownfishSandboxHost.cs"
$SandboxHostExe = Join-Path $Dist "ClownfishSandboxHost.exe"

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

function Copy-DirectoryTree {
  param(
    [Parameter(Mandatory = $true)][string]$Source,
    [Parameter(Mandatory = $true)][string]$Destination
  )

  New-Item -ItemType Directory -Force -Path $Destination | Out-Null
  & robocopy $Source $Destination /E /COPY:DAT /DCOPY:DAT /R:2 /W:1 /NFL /NDL /NJH /NJS /NP /LOG:NUL
  if ($LASTEXITCODE -ge 8) {
    throw "复制目录失败（robocopy exit code $LASTEXITCODE）：$Source"
  }
}

function Copy-RuntimeAssetTree {
  param(
    [Parameter(Mandatory = $true)][string]$Source,
    [Parameter(Mandatory = $true)][string]$Destination
  )

  New-Item -ItemType Directory -Force -Path $Destination | Out-Null
  & robocopy $Source $Destination /E /COPY:DAT /DCOPY:DAT /R:2 /W:1 /NFL /NDL /NJH /NJS /NP /LOG:NUL `
    /XD client docs /XF *.ts *.tsx *.map *.cmd *.ps1 tsconfig*.json
  if ($LASTEXITCODE -ge 8) {
    throw "复制运行时资源失败（robocopy exit code $LASTEXITCODE）：$Source"
  }
}

function Remove-BuildDirectoryTree {
  param([Parameter(Mandatory = $true)][string]$Path)

  if (-not (Test-Path -LiteralPath $Path)) { return }
  $resolvedPath = [System.IO.Path]::GetFullPath($Path)
  $distPrefix = [System.IO.Path]::GetFullPath((Join-Path $ClientRoot "dist")) + [System.IO.Path]::DirectorySeparatorChar
  if (-not $resolvedPath.StartsWith($distPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "拒绝清理客户端 dist 之外的目录：$resolvedPath"
  }

  $empty = Join-Path ([System.IO.Path]::GetTempPath()) ("clownfish-empty-" + [guid]::NewGuid().ToString("N"))
  New-Item -ItemType Directory -Force -Path $empty | Out-Null
  try {
    & robocopy $empty $resolvedPath /MIR /R:2 /W:1 /NFL /NDL /NJH /NJS /NP /LOG:NUL
    if ($LASTEXITCODE -ge 8) {
      throw "清理目录失败（robocopy exit code $LASTEXITCODE）：$resolvedPath"
    }
  } finally {
    Remove-Item -LiteralPath $empty -Recurse -Force -ErrorAction SilentlyContinue
  }
  Remove-Item -LiteralPath $resolvedPath -Recurse -Force
}

function Ensure-WebView2Sdk {
  $core = Join-Path $PackageDir "lib\net462\Microsoft.Web.WebView2.Core.dll"
  $winforms = Join-Path $PackageDir "lib\net462\Microsoft.Web.WebView2.WinForms.dll"
  $loader = Join-Path $PackageDir "runtimes\win-x64\native\WebView2Loader.dll"
  New-Item -ItemType Directory -Force -Path $Vendor | Out-Null
  $nupkg = Join-Path $Vendor "microsoft.web.webview2.$Version.nupkg"
  $nupkgExpectedSha256 = [string]$RuntimeLock.webView2Sdk.nupkgSha256
  $archiveValid = (Test-Path -LiteralPath $nupkg) -and ((Get-FileHash -LiteralPath $nupkg -Algorithm SHA256).Hash.ToLowerInvariant() -eq $nupkgExpectedSha256)
  if (-not $archiveValid) {
    $download = $nupkg + ".download"
    if (Test-Path -LiteralPath $download) { Remove-Item -LiteralPath $download -Force }
    Invoke-WebRequest -Uri "https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/$Version/microsoft.web.webview2.$Version.nupkg" -OutFile $download
    if ((Get-FileHash -LiteralPath $download -Algorithm SHA256).Hash.ToLowerInvariant() -ne $nupkgExpectedSha256) {
      Remove-Item -LiteralPath $download -Force
      throw "WebView2 SDK 下载校验失败"
    }
    Move-Item -LiteralPath $download -Destination $nupkg -Force
  }
  $installedValid = (Test-Path -LiteralPath $core) -and (Test-Path -LiteralPath $winforms) -and (Test-Path -LiteralPath $loader) `
    -and ((Get-FileHash -LiteralPath $core -Algorithm SHA256).Hash.ToLowerInvariant() -eq [string]$RuntimeLock.webView2Sdk.coreDllSha256) `
    -and ((Get-FileHash -LiteralPath $winforms -Algorithm SHA256).Hash.ToLowerInvariant() -eq [string]$RuntimeLock.webView2Sdk.winFormsDllSha256) `
    -and ((Get-FileHash -LiteralPath $loader -Algorithm SHA256).Hash.ToLowerInvariant() -eq [string]$RuntimeLock.webView2Sdk.loaderDllSha256)
  if ($installedValid) { return }
  if (Test-Path -LiteralPath $PackageDir) { Remove-Item -LiteralPath $PackageDir -Recurse -Force }
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  [System.IO.Compression.ZipFile]::ExtractToDirectory($nupkg, $PackageDir)
  if ((Get-FileHash -LiteralPath $core -Algorithm SHA256).Hash.ToLowerInvariant() -ne [string]$RuntimeLock.webView2Sdk.coreDllSha256 `
    -or (Get-FileHash -LiteralPath $winforms -Algorithm SHA256).Hash.ToLowerInvariant() -ne [string]$RuntimeLock.webView2Sdk.winFormsDllSha256 `
    -or (Get-FileHash -LiteralPath $loader -Algorithm SHA256).Hash.ToLowerInvariant() -ne [string]$RuntimeLock.webView2Sdk.loaderDllSha256) {
    throw "WebView2 SDK 解压文件校验失败"
  }
}

function Ensure-NodeRuntime {
  param(
    [Parameter(Mandatory = $true)][string]$RuntimeName,
    [Parameter(Mandatory = $true)][string]$RuntimeVersion,
    [Parameter(Mandatory = $true)][string]$ArchiveName,
    [Parameter(Mandatory = $true)][string]$ExpectedSha256,
    [Parameter(Mandatory = $true)][string]$ArchivePath,
    [Parameter(Mandatory = $true)][string]$PackagePath
  )
  New-Item -ItemType Directory -Force -Path $SandboxNodeVendorRoot | Out-Null
  $downloadPath = $ArchivePath + ".download"
  $archiveValid = $false

  if (Test-Path -LiteralPath $ArchivePath) {
    $archiveHash = (Get-FileHash -LiteralPath $ArchivePath -Algorithm SHA256).Hash.ToLowerInvariant()
    $archiveValid = $archiveHash -eq $ExpectedSha256
    if (-not $archiveValid) {
      Remove-Item -LiteralPath $ArchivePath -Force
    }
  }

  if (-not $archiveValid) {
    if (Test-Path -LiteralPath $downloadPath) {
      Remove-Item -LiteralPath $downloadPath -Force
    }
    Invoke-WebRequest -Uri "https://nodejs.org/dist/v$RuntimeVersion/$ArchiveName" -OutFile $downloadPath
    $downloadHash = (Get-FileHash -LiteralPath $downloadPath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($downloadHash -ne $ExpectedSha256) {
      Remove-Item -LiteralPath $downloadPath -Force
      throw "$RuntimeName Node 下载校验失败"
    }
    Move-Item -LiteralPath $downloadPath -Destination $ArchivePath -Force
  }

  if (Test-Path -LiteralPath $PackagePath) {
    Remove-Item -LiteralPath $PackagePath -Recurse -Force
  }
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  [System.IO.Compression.ZipFile]::ExtractToDirectory($ArchivePath, $SandboxNodeVendorRoot)

  $nodeExe = Join-Path $PackagePath "node.exe"
  if (-not (Test-Path -LiteralPath $nodeExe)) {
    throw "$RuntimeName Node 解压后缺少 node.exe"
  }
  $actualVersion = (& $nodeExe -p "process.versions.node").Trim()
  if ($actualVersion -ne $RuntimeVersion) {
    throw "$RuntimeName Node 版本不匹配：期望 $RuntimeVersion，实际 $actualVersion"
  }
  return $nodeExe
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
$MainNodeExe = Ensure-NodeRuntime -RuntimeName "主服务" -RuntimeVersion $MainNodeVersion -ArchiveName $MainNodeArchive -ExpectedSha256 $MainNodeExpectedSha256 -ArchivePath $MainNodeArchivePath -PackagePath $MainNodePackageDir
$SandboxNodeExe = Ensure-NodeRuntime -RuntimeName "MCP 沙箱" -RuntimeVersion $SandboxNodeVersion -ArchiveName $SandboxNodeArchive -ExpectedSha256 $SandboxNodeExpectedSha256 -ArchivePath $SandboxNodeArchivePath -PackagePath $SandboxNodePackageDir
$SandboxPythonExe = Ensure-SandboxPythonRuntime
New-Item -ItemType Directory -Force -Path $Dist | Out-Null
if (-not (Test-Path -LiteralPath $Icon)) {
  throw "找不到客户端图标：$Icon"
}

$CoreDll = Join-Path $PackageDir "lib\net462\Microsoft.Web.WebView2.Core.dll"
$WinFormsDll = Join-Path $PackageDir "lib\net462\Microsoft.Web.WebView2.WinForms.dll"
$LoaderDll = Join-Path $PackageDir "runtimes\win-x64\native\WebView2Loader.dll"
$Csc = Get-CscPath
$SdkRoot = Resolve-Path (Join-Path $ClientRoot "..\..\..")
$RepoRoot = Resolve-Path (Join-Path $SdkRoot "..\..")
$BuildWork = Join-Path $Dist (".client-build-" + [guid]::NewGuid().ToString("N"))
$CompileRoot = Join-Path $BuildWork "compiled"
$ProductionInstallRoot = Join-Path $BuildWork "production"
New-Item -ItemType Directory -Force -Path $CompileRoot, $ProductionInstallRoot | Out-Null

$Tsc = Join-Path $SdkRoot "node_modules\typescript\bin\tsc"
if (-not (Test-Path -LiteralPath $Tsc)) { throw "缺少锁文件安装的 TypeScript 编译器：$Tsc" }
& $MainNodeExe $Tsc -p (Join-Path $SdkRoot "tsconfig.portable.json") --outDir $CompileRoot
if ($LASTEXITCODE -ne 0) { throw "Portable TypeScript compilation failed" }

Copy-Item -LiteralPath (Join-Path $SdkRoot "package.json") -Destination $ProductionInstallRoot -Force
Copy-Item -LiteralPath (Join-Path $SdkRoot "package-lock.json") -Destination $ProductionInstallRoot -Force
$NpmCli = Join-Path $MainNodePackageDir "node_modules\npm\bin\npm-cli.js"
if (-not (Test-Path -LiteralPath $NpmCli)) { throw "固定 Node 运行时缺少 npm-cli.js" }
$PreviousNpmCache = $env:npm_config_cache
$PreviousPath = $env:PATH
$env:npm_config_cache = Join-Path ([System.IO.Path]::GetTempPath()) "clownfish-release-npm-cache"
$env:PATH = $MainNodePackageDir + ";" + $env:PATH
try {
  Push-Location $ProductionInstallRoot
  try {
    & $MainNodeExe $NpmCli ci --omit=dev --omit=peer --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw "Production dependency install failed" }
  } finally {
    Pop-Location
  }
} catch {
  Remove-BuildDirectoryTree -Path $BuildWork
  throw
} finally {
  $env:npm_config_cache = $PreviousNpmCache
  $env:PATH = $PreviousPath
}
$OptionalPeerCompiler = Join-Path $ProductionInstallRoot "node_modules\typescript"
if (Test-Path -LiteralPath $OptionalPeerCompiler) {
  # Vue advertises TypeScript as an optional peer. The precompiled desktop
  # runtime never invokes it, so keeping the compiler would only restore a
  # build-time tool to the production closure.
  Remove-BuildDirectoryTree -Path $OptionalPeerCompiler
}
$OptionalNativeCompilerScope = Join-Path $ProductionInstallRoot "node_modules\@typescript"
if (Test-Path -LiteralPath $OptionalNativeCompilerScope) {
  # TypeScript 7 can install a platform compiler as an optional peer companion.
  # The portable app executes only precompiled JavaScript, so no compiler binary
  # belongs in the production closure.
  Remove-BuildDirectoryTree -Path $OptionalNativeCompilerScope
}
$ProductionBin = Join-Path $ProductionInstallRoot "node_modules\.bin"
foreach ($CompilerShimName in @("tsc", "tsc.cmd", "tsc.ps1", "tsserver", "tsserver.cmd", "tsserver.ps1")) {
  $CompilerShim = Join-Path $ProductionBin $CompilerShimName
  if (Test-Path -LiteralPath $CompilerShim -PathType Leaf) {
    Remove-Item -LiteralPath $CompilerShim -Force
  }
}
$RemainingCompilerShims = if (Test-Path -LiteralPath $ProductionBin) {
  @(Get-ChildItem -LiteralPath $ProductionBin -Force | Where-Object { $_.Name -match '^(tsc|tsserver)(\.|$)' })
} else { @() }
$RemainingNativeCompilers = @(Get-ChildItem -LiteralPath (Join-Path $ProductionInstallRoot "node_modules") -Recurse -File -Filter "tsc.exe" -ErrorAction SilentlyContinue)
if ((Test-Path -LiteralPath $OptionalPeerCompiler) -or (Test-Path -LiteralPath $OptionalNativeCompilerScope) `
    -or $RemainingCompilerShims.Count -gt 0 -or $RemainingNativeCompilers.Count -gt 0) {
  throw "Production dependency closure still contains TypeScript compiler artifacts"
}

& $Csc /nologo /target:exe /platform:x64 /optimize+ /nowin32manifest `
  /out:$SandboxHostExe `
  /reference:System.dll `
  /reference:System.Core.dll `
  /reference:System.Security.dll `
  $SandboxHostSource
if ($LASTEXITCODE -ne 0) { throw "Sandbox host compilation failed" }

& $Csc /nologo /target:winexe /platform:x64 /optimize+ $ClientCompilerDefine `
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
if ($LASTEXITCODE -ne 0) { throw "Client compilation failed" }

Copy-Item -LiteralPath $CoreDll -Destination $Dist -Force
Copy-Item -LiteralPath $WinFormsDll -Destination $Dist -Force
Copy-Item -LiteralPath $LoaderDll -Destination $Dist -Force
Copy-Item -LiteralPath $Manifest -Destination $Dist -Force
Copy-Item -LiteralPath $Icon -Destination (Join-Path $Dist "小丑鱼.ico") -Force
if (Test-Path -LiteralPath (Join-Path $ClientRoot "desktop-helper")) {
  Copy-Item -LiteralPath (Join-Path $ClientRoot "desktop-helper") -Destination $Dist -Recurse -Force
}

if (Test-Path -LiteralPath $PortableRoot) {
  Remove-BuildDirectoryTree -Path $PortableRoot
}
New-Item -ItemType Directory -Force -Path $PortableRoot, $PortableApp, $PortableNode, $PortableSandboxNode, $PortableLicenses | Out-Null

Copy-Item -LiteralPath $Exe -Destination $PortableRoot -Force
Copy-Item -LiteralPath $CoreDll -Destination $PortableRoot -Force
Copy-Item -LiteralPath $WinFormsDll -Destination $PortableRoot -Force
Copy-Item -LiteralPath $LoaderDll -Destination $PortableRoot -Force
Copy-Item -LiteralPath $Manifest -Destination $PortableRoot -Force
Copy-Item -LiteralPath $RuntimeLockPath -Destination $PortableRoot -Force
Copy-Item -LiteralPath $Icon -Destination (Join-Path $PortableRoot "小丑鱼.ico") -Force
if (Test-Path -LiteralPath (Join-Path $ClientRoot "desktop-helper")) {
  Copy-Item -LiteralPath (Join-Path $ClientRoot "desktop-helper") -Destination $PortableRoot -Recurse -Force
}

Copy-Item -LiteralPath $MainNodeExe -Destination (Join-Path $PortableNode "node.exe") -Force
Set-Content -LiteralPath (Join-Path $PortableNode "version.txt") -Encoding ASCII -Value $MainNodeVersion
Copy-Item -LiteralPath $SandboxNodeExe -Destination (Join-Path $PortableSandboxNode "node.exe") -Force
Set-Content -LiteralPath (Join-Path $PortableSandboxNode "version.txt") -Encoding ASCII -Value $SandboxNodeVersion
Copy-Item -LiteralPath $SandboxHostExe -Destination (Join-Path $PortableSandboxNode "ClownfishSandboxHost.exe") -Force
Copy-Item -LiteralPath $SandboxPythonPackageDir -Destination $PortableSandboxPython -Recurse -Force
Set-Content -LiteralPath (Join-Path $PortableSandboxPython "version.txt") -Encoding ASCII -Value $SandboxPythonVersion

$SandboxNodeLicense = Join-Path $SandboxNodePackageDir "LICENSE"
if (Test-Path -LiteralPath $SandboxNodeLicense) {
  Copy-Item -LiteralPath $SandboxNodeLicense -Destination (Join-Path $PortableLicenses "Node.js-LICENSE.txt") -Force
}
$SandboxPythonLicense = Join-Path $SandboxPythonPackageDir "LICENSE.txt"
if (Test-Path -LiteralPath $SandboxPythonLicense) {
  Copy-Item -LiteralPath $SandboxPythonLicense -Destination (Join-Path $PortableLicenses "Python-LICENSE.txt") -Force
}

$WebView2LicenseRoot = Join-Path $PortableLicenses "webview2"
New-Item -ItemType Directory -Force -Path $WebView2LicenseRoot | Out-Null
Get-ChildItem -LiteralPath $PackageDir -Recurse -File | Where-Object {
  $_.Name -match '^(LICENSE|NOTICE)' -or $_.Extension -eq '.nuspec'
} | ForEach-Object {
  Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $WebView2LicenseRoot $_.Name) -Force
}

foreach ($PublicDocument in @("README.md", "PRIVACY.md", "PRIVACY.en.md", "LICENSE", "LICENSING.md", "THIRD_PARTY_NOTICES.md")) {
  $PublicDocumentPath = Join-Path $RepoRoot $PublicDocument
  if (Test-Path -LiteralPath $PublicDocumentPath) {
    Copy-Item -LiteralPath $PublicDocumentPath -Destination $PortableRoot -Force
  }
}
Copy-Item -LiteralPath (Join-Path $SdkRoot "memory-core.version.json") -Destination $PortableApp -Force
$RuntimePackage = Get-Content -LiteralPath (Join-Path $SdkRoot "package.json") -Raw | ConvertFrom-Json
$RuntimePackage.PSObject.Properties.Remove("devDependencies")
$RuntimePackage.PSObject.Properties.Remove("scripts")
$RuntimePackage.PSObject.Properties.Remove("files")
$RuntimePackage.PSObject.Properties.Remove("allowScripts")
$RuntimePackage | Add-Member -NotePropertyName scripts -NotePropertyValue @{ start = 'node examples/companion/portable-launcher.js' }
$RuntimePackage | ConvertTo-Json -Depth 100 | Set-Content -LiteralPath (Join-Path $PortableApp "package.json") -Encoding UTF8
Copy-DirectoryTree `
  -Source (Join-Path $ProductionInstallRoot "node_modules") `
  -Destination (Join-Path $PortableApp "node_modules")
Copy-DirectoryTree -Source (Join-Path $CompileRoot "src") -Destination (Join-Path $PortableApp "src")
$PortableCompanion = Join-Path $PortableApp "examples\companion"
Copy-RuntimeAssetTree -Source (Join-Path $SdkRoot "examples\companion") -Destination $PortableCompanion
Copy-DirectoryTree -Source (Join-Path $CompileRoot "examples\companion") -Destination $PortableCompanion
New-Item -ItemType Directory -Force -Path (Join-Path $PortableCompanion "client") | Out-Null
Copy-Item -LiteralPath $Manifest -Destination (Join-Path $PortableCompanion "client") -Force


$LauncherPath = Join-Path $PortableRoot "启动小丑鱼.cmd"
[System.IO.File]::WriteAllLines($LauncherPath, @(
  '@echo off',
  'chcp 65001 >nul',
  'cd /d "%~dp0"',
  'start "" "%~dp0小丑鱼.exe"'
), [System.Text.UTF8Encoding]::new($false))

# Keep the root convenience entry safe: it may only locate the complete
# portable client tree and never run a second, runtime-less client copy.
& $Csc /nologo /target:winexe /platform:x64 /optimize+ `
  "/win32icon:$Icon" `
  /out:$Exe `
  /reference:System.dll `
  /reference:System.Core.dll `
  /reference:System.Windows.Forms.dll `
  $PortableLauncherSource
if ($LASTEXITCODE -ne 0) { throw "Portable root launcher compilation failed" }

Write-Host "Launcher: $Exe"
Write-Host "Portable: $PortableRoot"
Remove-BuildDirectoryTree -Path $BuildWork
$ArchivePath = Join-Path $Dist ("小丑鱼-" + $AppVersion + "-windows-x64-portable.zip")
Compress-Archive -Path $PortableRoot -DestinationPath $ArchivePath -CompressionLevel Optimal
$ArchiveHash = (Get-FileHash -LiteralPath $ArchivePath -Algorithm SHA256).Hash.ToLowerInvariant()
[System.IO.File]::WriteAllText($ArchivePath + ".sha256.txt", $ArchiveHash + " *" + [System.IO.Path]::GetFileName($ArchivePath) + [Environment]::NewLine, [System.Text.UTF8Encoding]::new($false))
Write-Host "Archive: $ArchivePath"
Write-Host "SHA256: $ArchiveHash"
