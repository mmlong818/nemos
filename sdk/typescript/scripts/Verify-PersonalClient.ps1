param(
  [Parameter(Mandatory=$true)][string]$PortableRoot,
  [Parameter(Mandatory=$true)][string]$EvidenceDirectory
)
$ErrorActionPreference = 'Stop'
$portable = (Resolve-Path -LiteralPath $PortableRoot).Path
$evidence = (Resolve-Path -LiteralPath $EvidenceDirectory).Path
$exe = Join-Path $portable '小丑鱼.exe'
$nodeExe = Join-Path $portable 'node\node.exe'
if (-not (Test-Path -LiteralPath $exe) -or -not (Test-Path -LiteralPath $nodeExe)) { throw 'Missing packaged executables' }
$privateFiles = @(Get-ChildItem -LiteralPath $portable -Recurse -File | Where-Object {
  $_.Name -match '\.dpapi\.json$|^\.env(?:\..*)?$|^(?:companion|personal-work|assistant-bots)\.db(?:-wal|-shm)?$|^(?:client-preferences|user-profile|agent-runs|agent-jobs|agent-approvals|delivery-outbox|relationships|familiarity|contacts|groups|hk-reminders|office-workbench|task-files|capability-tool-executions)\.json$'
})
if ($privateFiles.Count) { throw 'Package contains private runtime state; refuse distribution' }
$testHome = Join-Path $evidence ('native-fixture-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $testHome | Out-Null
# Synthetic fixture configuration only, never the user's preference file.
[IO.File]::WriteAllText((Join-Path $testHome 'client-preferences.json'), '{"closeBehavior":"exit","notificationPermission":"blocked"}')
$reservation = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
$reservation.Start(); $port = $reservation.LocalEndpoint.Port; $reservation.Stop()
$base = "http://127.0.0.1:$port"
foreach ($entry in @(Get-ChildItem Env: | Where-Object Name -Match '^COMPANION_|^ZHIPU_API_KEY$|^NEMOS_COMPANION_HOME$|^NODE_USE_ENV_PROXY$')) { [Environment]::SetEnvironmentVariable($entry.Name, $null, 'Process') }
$env:CLOWNFISH_HOME = $testHome
$env:PORT = [string]$port
$client = $null
$script:ownedBackendIds = @()
$script:exitModes = @()
function Read-Backend {
  $pidFile = Join-Path $testHome 'companion-server.pid'
  if (-not (Test-Path -LiteralPath $pidFile)) { throw 'Client has not recorded its backend' }
  $backendId = [int]([IO.File]::ReadAllText($pidFile).Trim())
  $backend = Get-CimInstance Win32_Process -Filter "ProcessId=$backendId"
  if (-not $backend -or $backend.ParentProcessId -ne $client.Id -or $backend.ExecutablePath -ne $nodeExe) { throw "Refusing to act on a backend not owned by this test client (backend=$backendId, parent=$($backend.ParentProcessId), client=$($client.Id), pathMatches=$($backend.ExecutablePath -eq $nodeExe))" }
  $script:ownedBackendIds += $backendId
  return $backend
}
function Wait-Ready {
  $deadline = [DateTime]::UtcNow.AddSeconds(45)
  do {
    if ($client.HasExited) { throw 'Native client exited before becoming ready' }
    try { $result = Invoke-RestMethod -Uri "$base/api/personal-work" -TimeoutSec 2 -NoProxy; if ($null -ne $result.matters) { return $result } } catch { }
    Start-Sleep -Milliseconds 250
  } while ([DateTime]::UtcNow -lt $deadline)
  throw 'Packaged client backend readiness timed out'
}
function Close-TestClient {
  if (-not $client -or $client.HasExited) { return }
  $client.Refresh()
  $requestedClose = $client.CloseMainWindow()
  if ($requestedClose -and $client.WaitForExit(10000)) { $script:exitModes += 'window-close' }
  else {
    # A hidden window may not expose MainWindowHandle. This is an explicit
    # forced process-tree exit test, not evidence of graceful UI shutdown.
    $script:exitModes += 'forced-owned-tree'
    $client.Kill($true); $client.WaitForExit()
  }
  foreach ($backendId in ($script:ownedBackendIds | Select-Object -Unique)) {
    $backend = Get-CimInstance Win32_Process -Filter "ProcessId=$backendId" -ErrorAction SilentlyContinue
    if ($backend -and $backend.ParentProcessId -eq $client.Id -and $backend.ExecutablePath -eq $nodeExe) { Stop-Process -Id $backendId -Force }
  }
}
try {
  $client = Start-Process -FilePath $exe -WorkingDirectory $portable -WindowStyle Hidden -PassThru
  $initial = Wait-Ready
  if ($initial.matters.Count -ne 0 -or $initial.proposals.Count -ne 0) { throw 'Fresh client is not empty' }
  $firstBackend = Read-Backend
  $pages = @('/','/matters','/capabilities','/settings','/memory','/bots','/bots?view=market','/assets/assistant-team.js','/assets/assistant-team.css')
  foreach ($path in $pages) { if ((Invoke-WebRequest -Uri "$base$path" -NoProxy -TimeoutSec 5).StatusCode -ne 200) { throw "Packaged page missing: $path" } }
  $team = Invoke-RestMethod -Uri "$base/api/assistant-team" -NoProxy
  if ($team.ready -or $team.jobs.Count -ne 0 -or $team.bots.Count -ne 2) { throw 'Fresh team contains saved connections, tasks or non-default Bots' }
  $market = Invoke-RestMethod -Uri "$base/api/assistant-team/market" -NoProxy
  if ($market.templates.Count -ne 8) { throw 'Packaged market does not contain the eight reviewed templates' }
  $marketBots = @()
  foreach ($template in $market.templates) {
    if ($template.permissions.tools -ne 'off' -or $template.permissions.memory -ne 'task-only' -or $template.permissions.automaticRoutines) { throw 'Template permissions unexpectedly expanded' }
    $importBody = @{id=$template.id;version=$template.version} | ConvertTo-Json -Compress
    $imported = Invoke-RestMethod -Uri "$base/api/assistant-team/import" -Method Post -NoProxy -ContentType 'application/json' -Body $importBody
    $duplicate = Invoke-RestMethod -Uri "$base/api/assistant-team/import" -Method Post -NoProxy -ContentType 'application/json' -Body $importBody
    if ($imported.record.id -ne $duplicate.record.id) { throw 'Duplicate market import created a second Bot' }
    $marketBots += $imported.record
  }
  $editedBot = $marketBots[0]
  $editedBot.instructions = 'Synthetic packaged QA rule; preserve after restart.'
  $editedBot.enabled = $false
  $editedBot = (Invoke-RestMethod -Uri "$base/api/assistant-team/bot" -Method Post -NoProxy -ContentType 'application/json' -Body ($editedBot | ConvertTo-Json -Depth 8)).record
  $created = Invoke-RestMethod -Uri "$base/api/personal-work/matters" -Method Post -NoProxy -ContentType 'application/json' -Body '{"title":"包装验收样例","goal":"确认独立启动和异常恢复","nextAction":"检查重启后仍保留记录","remindAt":"2020-01-01T00:00:00Z"}'
  if (-not $created.record.id) { throw 'Packaged client failed to save a matter' }
  Write-Output "Fresh native startup passed on port $port; testing owned backend recovery."
  # Read-Backend verified both the executable path and parent PID before this kill.
  Stop-Process -Id $firstBackend.ProcessId -Force
  $recovered = Wait-Ready
  $secondBackend = Read-Backend
  Write-Output 'Owned backend restart detected.'
  if ($secondBackend.ProcessId -eq $firstBackend.ProcessId -or $recovered.matters[0].id -ne $created.record.id) { throw 'Recovery lost state or failed to restart the backend' }
  if ($recovered.reminders.Count -ne 1) { throw 'Startup did not rebuild the due reminder' }
  $recoveredTeam = Invoke-RestMethod -Uri "$base/api/assistant-team" -NoProxy
  $recoveredBot = @($recoveredTeam.bots | Where-Object id -eq $editedBot.id)[0]
  if ($recoveredTeam.bots.Count -ne (2 + $market.templates.Count) -or $recoveredBot.instructions -ne $editedBot.instructions -or $recoveredBot.enabled -or $recoveredTeam.jobs.Count -ne 0) { throw 'Backend recovery lost Bot rules or started an unsolicited task' }
  $summary = Invoke-RestMethod -Uri "$base/api/personal-work/reminder-summary" -NoProxy
  if ($summary.count -ne 1 -or $summary.token -notmatch '^[a-f0-9]{64}$' -or (($summary | ConvertTo-Json) -match '包装验收样例')) { throw 'Reminder summary is invalid or leaks private titles' }
  Close-TestClient
  Write-Output 'First client closed; relaunching with the same synthetic data.'
  $client = Start-Process -FilePath $exe -WorkingDirectory $portable -WindowStyle Hidden -PassThru
  $reopened = Wait-Ready
  [void](Read-Backend)
  if ($reopened.matters[0].id -ne $created.record.id -or $reopened.reminders.Count -ne 1) { throw 'Client relaunch lost or duplicated state' }
  $reopenedTeam = Invoke-RestMethod -Uri "$base/api/assistant-team" -NoProxy
  $reimported = (Invoke-RestMethod -Uri "$base/api/assistant-team/import" -Method Post -NoProxy -ContentType 'application/json' -Body (@{id=$editedBot.template.id;version=$editedBot.template.version} | ConvertTo-Json)).record
  if ($reopenedTeam.bots.Count -ne (2 + $market.templates.Count) -or $reimported.id -ne $editedBot.id -or $reimported.instructions -ne $editedBot.instructions -or $reimported.enabled -or $reimported.revision -ne $editedBot.revision) { throw 'Client relaunch or repeat import overwrote the personal Bot' }
  Close-TestClient
  $result = [ordered]@{passed=$true; testedAt=[DateTime]::UtcNow.ToString('o'); portable=$portable; dataDirectory=$testHome; nativeStartup=$true; packagedNode=$true; blankState=$true; pages=$pages; marketTemplateCount=$market.templates.Count; marketIdempotentImport=$true; marketPersonalRulesPreserved=$true; marketImportDoesNotRunTasks=$true; ownedBackendCrashRecovery=$true; reminderDeduplication=$true; clientRelaunch=$true; exitModes=$script:exitModes; privateStateFiles=$privateFiles.Count; physicalSleepWake='not-tested'; cleanOtherMachine='not-tested'; modelCall='not-tested'}
  [IO.File]::WriteAllText((Join-Path $evidence 'native-smoke.json'), ($result | ConvertTo-Json -Depth 5))
  Write-Output ($result | ConvertTo-Json -Compress)
} finally {
  Close-TestClient
  foreach ($backendId in ($script:ownedBackendIds | Select-Object -Unique)) {
    $backend = Get-CimInstance Win32_Process -Filter "ProcessId=$backendId" -ErrorAction SilentlyContinue
    if ($backend -and $backend.ExecutablePath -eq $nodeExe) { Stop-Process -Id $backendId -Force -ErrorAction SilentlyContinue }
  }
}
