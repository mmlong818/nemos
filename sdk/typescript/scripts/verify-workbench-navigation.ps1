param(
  [string]$BaseUrl = 'http://localhost:8787',
  [string]$BrowserExecutable = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
)
$ErrorActionPreference = 'Stop'
$auditSession = 'workbench-nav-' + [guid]::NewGuid().ToString('N').Substring(0, 8)
$auditBrowser = Join-Path (Split-Path (Get-Command agent-browser).Source) 'node_modules/agent-browser/bin/agent-browser-win32-x64.exe'
function Invoke-AuditBrowser {
  param([string[]]$BrowserArgs)
  $raw = & $auditBrowser --session $auditSession @BrowserArgs --json
  if ($LASTEXITCODE -ne 0) { throw ($raw -join "`n") }
  $response = ($raw -join "`n") | ConvertFrom-Json
  if (-not $response.success) { throw ($response.error | ConvertTo-Json -Compress) }
  return $response.data
}
# Compare actual text-node coordinates, not just the containing button rectangle.
$measure = @'
JSON.stringify({
  rootWidth:document.documentElement.getBoundingClientRect().width,
  barWidth:document.querySelector('.wb-topbar').getBoundingClientRect().width,
  links:[...document.querySelectorAll('#wbNavigation .wb-link')].map(e=>{
    const range=document.createRange();range.selectNodeContents(e.lastChild);
    const text=range.getBoundingClientRect(),icon=e.firstElementChild.getBoundingClientRect();
    return {path:e.dataset.wbPath,x:text.x,y:text.y,iconX:icon.x,iconY:icon.y,iconW:icon.width,iconH:icon.height};
  })
})
'@
$routes = @('/overview','/','/bots?view=market','/memory','/matters','/tasks','/spaces','/automations','/capabilities','/office','/resources','/artifacts','/collaboration','/runs','/settings')
$checked = 0
try {
  # Let the first daemon launch inherit the console, not a captured PowerShell pipe.
  & $auditBrowser --session $auditSession --executable-path $BrowserExecutable open "$BaseUrl/overview"
  if ($LASTEXITCODE -ne 0) { throw 'Browser launch failed' }
  foreach ($width in @(1440, 900, 710, 390)) {
    Write-Host "Checking $width px..."
    $null = Invoke-AuditBrowser @('set','viewport',"$width",'900')
    $baseline = $null
    foreach ($route in $routes) {
      $null = Invoke-AuditBrowser @('open',($BaseUrl + $route))
      $null = Invoke-AuditBrowser @('wait','--fn',"Boolean(document.querySelector('#wbNavigation'))")
      if ($width -le 700) { $null = Invoke-AuditBrowser @('click','#wbMenu') }
      $expanded = Invoke-AuditBrowser @('eval',"document.querySelector('.wb-tools').open")
      if (-not $expanded.result) { $null = Invoke-AuditBrowser @('click','.wb-tools>summary') }
      $null = Invoke-AuditBrowser @('eval',"document.querySelector('#wbNavigation>nav').scrollTop=0")
      $sample = (Invoke-AuditBrowser @('eval',$measure)).result
      if ($null -eq $baseline) { $baseline = $sample }
      elseif ($sample -cne $baseline) { throw "Navigation geometry differs at width $width, route $route`nExpected: $baseline`nActual: $sample" }
      $checked++
    }
    Write-Host "PASS: $width px / $($routes.Count) routes / text and icon coordinates"
  }
  $errors = (Invoke-AuditBrowser @('errors')).errors
  if ($errors.Count) { throw ($errors | ConvertTo-Json -Compress) }
  Write-Host "PASS: $checked route/viewport combinations"
} finally {
  $null = Invoke-AuditBrowser @('close')
}
