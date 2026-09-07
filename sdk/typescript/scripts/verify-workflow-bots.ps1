param([string]$BaseUrl = 'http://localhost:8787')
$ErrorActionPreference = 'Stop'
$auditSession = 'workflow-bots-' + [guid]::NewGuid().ToString('N').Substring(0,8)
$auditBrowser = Join-Path (Split-Path (Get-Command agent-browser).Source) 'node_modules/agent-browser/bin/agent-browser-win32-x64.exe'
function Invoke-Browser {
  param([string[]]$BrowserArgs)
  $raw = & $auditBrowser --session $auditSession @BrowserArgs --json
  if ($LASTEXITCODE -ne 0) { throw (($BrowserArgs -join ' ') + "`n" + ($raw -join "`n")) }
  $response = ($raw -join "`n") | ConvertFrom-Json
  if (-not $response.success) { throw ($response.error | ConvertTo-Json -Compress) }
  return $response.data
}
try {
  & $auditBrowser --session $auditSession --executable-path 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' open "$BaseUrl/bots?view=bots"
  if ($LASTEXITCODE -ne 0) { throw 'Browser launch failed' }
  $null = Invoke-Browser @('wait','--fn',"document.querySelectorAll('#builtinBotList [data-workflow-bot]').length===11")
  $workflows = ((Invoke-Browser @('eval','JSON.stringify(window.ClownfishWorkflowCatalog.workflows.map(({id,name})=>({id,name})))')).result | ConvertFrom-Json)
  if ($workflows.Count -ne 11) { throw 'Expected 11 native workflows' }
  foreach ($width in @(1440,390)) {
    $null = Invoke-Browser @('set','viewport',"$width",'900')
    foreach ($bot in $workflows) {
      $null = Invoke-Browser @('open',"$BaseUrl/bots?view=bots")
      $null = Invoke-Browser @('wait','--fn',"document.querySelectorAll('#builtinBotList [data-workflow-bot]').length===11")
      $selector = '#builtinBotList [data-workflow-bot="' + $bot.id + '"] a'
      $null = Invoke-Browser @('click',$selector)
      $null = Invoke-Browser @('wait','--url',"**/capabilities?bot=$($bot.id)")
      $null = Invoke-Browser @('wait','#launchTitle')
      $sample = ((Invoke-Browser @('eval',"JSON.stringify({title:document.getElementById('launchTitle').textContent,overflow:document.documentElement.scrollWidth>innerWidth,disabled:document.getElementById('startTask').disabled,materials:!document.getElementById('materialDrop').hidden})")).result | ConvertFrom-Json)
      if ($sample.title -cne $bot.name -or $sample.overflow -or -not $sample.disabled -or -not $sample.materials) { throw "Invalid workflow launch at $width / $($bot.id): $($sample | ConvertTo-Json -Compress)" }
    }
    Write-Host "PASS: $width px / 11 My Bot links / native task forms / no horizontal overflow"
  }
  $null = Invoke-Browser @('open',"$BaseUrl/capabilities")
  $cards = (Invoke-Browser @('eval',"Array.from(document.querySelectorAll('[data-capability]')).map(e=>e.dataset.capability).join(',')")).result
  if ($cards -cne 'translate,speech,polish,ability') { throw "Wrong tool partition: $cards" }
  $null = Invoke-Browser @('open',"$BaseUrl/capabilities?bot=missing")
  $null = Invoke-Browser @('wait','--fn',"document.getElementById('toast').textContent.startsWith('\u672a\u627e\u5230')")
  $hidden = (Invoke-Browser @('eval',"document.getElementById('launchPanel').hidden")).result
  if (-not $hidden) { throw 'Unknown Bot opened a fallback workflow' }
  $null = Invoke-Browser @('open',"$BaseUrl/bots?view=market")
  $null = Invoke-Browser @('wait','#marketHeading')
  $empty = (Invoke-Browser @('eval',"document.querySelectorAll('#marketPane .market-card').length===0 && !document.getElementById('marketPane').hidden && document.getElementById('newTask').hidden")).result
  if (-not $empty) { throw 'Official market is not empty' }
  $navTarget = (Invoke-Browser @('get','attr','#railBots','href')).value
  Write-Host 'PASS: tool partition / invalid Bot / empty official market; no task was submitted'
} finally {
  & $auditBrowser --session $auditSession close
}
