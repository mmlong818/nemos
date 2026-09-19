param(
  [Parameter(Mandatory = $true)][string]$CandidateRoot,
  [ValidateRange(1, 20)][int]$Repeat = 1
)

$ErrorActionPreference = "Stop"
$candidate = [System.IO.Path]::GetFullPath($CandidateRoot)
$rootLauncher = Join-Path $candidate "小丑鱼.exe"
$portableRoot = Join-Path $candidate "portable\小丑鱼"
$portableClient = Join-Path $portableRoot "小丑鱼.exe"
$expectedNode = Join-Path $portableRoot "node\node.exe"
$expectedEntry = Join-Path $portableRoot "app\examples\companion\portable-launcher.js"
foreach ($required in @($rootLauncher, $portableClient, $expectedNode, $expectedEntry)) {
  if (-not (Test-Path -LiteralPath $required -PathType Leaf)) { throw "Missing candidate artifact: $required" }
}

function Get-CandidateClientProcesses {
  @(Get-CimInstance Win32_Process -Filter "Name='小丑鱼.exe'" -ErrorAction SilentlyContinue | Where-Object {
    $_.ExecutablePath -and [string]::Equals([System.IO.Path]::GetFullPath($_.ExecutablePath), $portableClient, [StringComparison]::OrdinalIgnoreCase)
  })
}

function Remove-IsolatedTestDirectory {
  param([Parameter(Mandatory = $true)][string]$Path)
  $resolved = [System.IO.Path]::GetFullPath($Path)
  $tempPrefix = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath()).TrimEnd('\') + '\clownfish-'
  if (-not $resolved.StartsWith($tempPrefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to remove a non-isolated test directory: $resolved"
  }
  if (Test-Path -LiteralPath $resolved) { Remove-Item -LiteralPath $resolved -Recurse -Force }
}

function Invoke-StartupCase {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string]$Executable,
    [Parameter(Mandatory = $true)][string]$WorkingDirectory,
    [Parameter(Mandatory = $true)][string]$WorkingDirectoryCategory,
    [Parameter(Mandatory = $true)][bool]$ExpectLauncherExit
  )

  if ((Get-CandidateClientProcesses).Count -ne 0) { throw "Candidate client already running before $Name" }
  $caseRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("clownfish-final17-" + $Name + "-" + [guid]::NewGuid().ToString("N"))
  $caseHome = Join-Path $caseRoot "home"
  $trap = Join-Path $caseRoot "sdk\typescript\examples\node_modules\npm\bin"
  New-Item -ItemType Directory -Force -Path $caseHome, $trap | Out-Null
  [System.IO.File]::WriteAllText((Join-Path $caseHome "client-preferences.json"), '{"closeBehavior":"exit","notificationPermission":"denied"}', [System.Text.UTF8Encoding]::new($false))
  [System.IO.File]::WriteAllText((Join-Path $trap "npm-prefix.js"), "throw new Error('polluted NODE_OPTIONS executed')", [System.Text.UTF8Encoding]::new($false))
  [System.IO.File]::WriteAllText((Join-Path $trap "npm-cli.js"), "throw new Error('polluted npm shim executed')", [System.Text.UTF8Encoding]::new($false))

  $launched = $null
  $client = $null
  $startedAtUtc = [DateTime]::UtcNow
  try {
    $info = [System.Diagnostics.ProcessStartInfo]::new()
    $info.FileName = $Executable
    $info.WorkingDirectory = $WorkingDirectory
    $info.UseShellExecute = $false
    $info.EnvironmentVariables["CLOWNFISH_HOME"] = $caseHome
    $info.EnvironmentVariables["PORT"] = "0"
    $info.EnvironmentVariables["PATH"] = $trap
    $info.EnvironmentVariables["npm_config_prefix"] = $trap
    $info.EnvironmentVariables["NPM_CONFIG_USERCONFIG"] = Join-Path $trap "npmrc"
    $info.EnvironmentVariables["npm_execpath"] = Join-Path $trap "npm-cli.js"
    $info.EnvironmentVariables["NODE_OPTIONS"] = "--require `"$(Join-Path $trap 'npm-prefix.js')`""
    $info.EnvironmentVariables["NODE_PATH"] = $trap
    $info.EnvironmentVariables["INIT_CWD"] = $WorkingDirectory
    $launched = [System.Diagnostics.Process]::Start($info)
    if ($ExpectLauncherExit) {
      if (-not $launched.WaitForExit(10000) -or $launched.ExitCode -ne 0) { throw "$Name launcher did not exit successfully" }
    } else {
      $client = $launched
    }

    $deadline = [DateTime]::UtcNow.AddSeconds(45)
    $logPath = Join-Path $caseHome "logs\client-server.log"
    $ready = $false
    while ([DateTime]::UtcNow -lt $deadline) {
      if ($null -eq $client) {
        $match = Get-CandidateClientProcesses | Select-Object -First 1
        if ($match) { $client = [System.Diagnostics.Process]::GetProcessById([int]$match.ProcessId) }
      }
      if (Test-Path -LiteralPath $logPath -PathType Leaf) {
        $logText = [System.IO.File]::ReadAllText($logPath)
        if ($logText.Contains("CLOWNFISH_READY ")) { $ready = $true; break }
      }
      Start-Sleep -Milliseconds 250
    }
    if (-not $ready) { throw "$Name did not reach CLOWNFISH_READY" }
    if ($logText -notmatch [regex]::Escape("command: $expectedNode")) { throw "$Name did not use packaged node" }
    if ($logText -notmatch [regex]::Escape("arguments: `"$expectedEntry`"")) { throw "$Name did not use packaged entry" }
    if ($logText -match 'npm\.cmd|npm-cli\.js|sdk\\typescript\\examples\\companion\\server') { throw "$Name used a forbidden developer launch path" }
    $readyAtUtc = [DateTime]::UtcNow

    $null = $client.CloseMainWindow()
    if (-not $client.WaitForExit(20000)) { throw "$Name did not exit cleanly" }
    $exitCode = [int]$client.ExitCode
    if ($exitCode -ne 0) { throw "$Name exited with code $exitCode" }
    [pscustomobject]@{
      Case = $Name
      Entry = if ($ExpectLauncherExit) { "<candidate>\\小丑鱼.exe -> <candidate>\\portable\\小丑鱼\\小丑鱼.exe" } else { "<candidate>\\portable\\小丑鱼\\小丑鱼.exe" }
      Command = "<candidate>\\portable\\小丑鱼\\node\\node.exe"
      Arguments = '"<candidate>\\portable\\小丑鱼\\app\\examples\\companion\\portable-launcher.js"'
      WorkingDirectoryCategory = $WorkingDirectoryCategory
      Ready = $true
      ReadyMarker = "CLOWNFISH_READY"
      ExitCode = $exitCode
      NpmOrSourceFallback = $false
      PortPolicy = "PORT=0"
      HomePolicy = "isolated-temporary-and-removed"
      StartedAtUtc = $startedAtUtc.ToString("o")
      ReadyAtUtc = $readyAtUtc.ToString("o")
    }
  }
  finally {
    foreach ($candidateProcess in (Get-CandidateClientProcesses)) {
      try { Stop-Process -Id ([int]$candidateProcess.ProcessId) -Force -ErrorAction SilentlyContinue } catch { }
    }
    if ($launched -and -not $launched.HasExited) { try { $launched.Kill() } catch { } }
    Remove-IsolatedTestDirectory -Path $caseRoot
  }
}

$existing = Get-CandidateClientProcesses
if ($existing.Count -ne 0) { throw "Refusing to test while this candidate is already running" }
$sourceWorkingDirectory = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\..\examples"))
$absentSourceWorkingDirectory = Join-Path ([System.IO.Path]::GetTempPath()) ("clownfish-empty-cwd-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Force -Path $absentSourceWorkingDirectory | Out-Null
try {
  $results = @()
  foreach ($iteration in 1..$Repeat) {
    $results += Invoke-StartupCase -Name "top-level-$iteration" -Executable $rootLauncher -WorkingDirectory $sourceWorkingDirectory -WorkingDirectoryCategory "source-tree-present" -ExpectLauncherExit $true
    $results += Invoke-StartupCase -Name "portable-$iteration" -Executable $portableClient -WorkingDirectory $absentSourceWorkingDirectory -WorkingDirectoryCategory "empty-no-source-tree" -ExpectLauncherExit $false
  }
  $results | ConvertTo-Json -Compress
}
finally {
  Remove-IsolatedTestDirectory -Path $absentSourceWorkingDirectory
}
