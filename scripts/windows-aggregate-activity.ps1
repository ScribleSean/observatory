$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$base = 'http://127.0.0.1:5600/api/0'
$end = [DateTimeOffset]::UtcNow
$start = $end.AddDays(-7)
$buckets = Invoke-RestMethod -Uri "$base/buckets/" -TimeoutSec 10
$windows = @($buckets.PSObject.Properties | Where-Object {$_.Value.type -eq 'currentwindow'})
$afks = @($buckets.PSObject.Properties | Where-Object {$_.Value.type -eq 'afkstatus'})
if ($windows.Count -ne 1 -or $afks.Count -ne 1) { throw 'Ambiguous collectors' }
$w = ConvertTo-Json -Compress -InputObject $windows[0].Name
$a = ConvertTo-Json -Compress -InputObject $afks[0].Name
$query = "w = query_bucket($w); a = query_bucket($a); a = filter_keyvals(a, `"status`", [`"not-afk`"]); RETURN = filter_period_intersect(w, a);"
$body = @{query=@($query);timeperiods=@(($start.ToString('o') + '/' + $end.ToString('o')))} | ConvertTo-Json -Compress
$result = Invoke-RestMethod -Method Post -Uri "$base/query/" -Body $body -ContentType 'application/json' -TimeoutSec 30
$intervals = @(foreach ($event in $result[0]) {
  $app = [string]$event.data.app
  $category = 'Other'
  if ($app -match '(?i)codex|chatgpt|antigravity') { $category='AI apps' }
  elseif ($app -match '(?i)code\.exe|visual studio|cursor|idea|pycharm') { $category='Editors' }
  elseif ($app -match '(?i)terminal|powershell|cmd\.exe|conhost|wezterm|ubuntu') { $category='Terminal' }
  elseif ($app -match '(?i)chrome|firefox|msedge|brave|safari') { $category='Browser' }
  $duration = [double]$event.duration
  $label = 'Other app'
  if ($app -match '(?i)codex') { $label='Codex' }
  elseif ($app -match '(?i)chatgpt') { $label='ChatGPT / Codex' }
  elseif ($app -match '(?i)antigravity') { $label='Antigravity' }
  elseif ($app -match '(?i)cursor') { $label='Cursor' }
  elseif ($app -match '(?i)code\.exe|visual studio code') { $label='VS Code' }
  elseif ($app -match '(?i)chrome') { $label='Chrome' }
  elseif ($app -match '(?i)msedge|microsoft edge') { $label='Edge' }
  elseif ($app -match '(?i)safari') { $label='Safari' }
  elseif ($app -match '(?i)firefox') { $label='Firefox' }
  elseif ($category -eq 'Terminal') { $label='Terminal' }
  if ([double]::IsNaN($duration) -or [double]::IsInfinity($duration) -or $duration -lt 0) { throw 'Invalid duration' }
  $eventStart = [DateTimeOffset]::Parse($event.timestamp)
  [pscustomobject]@{start=$eventStart.ToString('o');end=$eventStart.AddSeconds($duration).ToString('o');category=$category;app=$label}
})
$trackingQuery = "w = query_bucket($w); a = query_bucket($a); RETURN = filter_period_intersect(w, a);"
$trackingBody = @{query=@($trackingQuery);timeperiods=@(($start.ToString('o') + '/' + $end.ToString('o')))} | ConvertTo-Json -Compress
$observed = Invoke-RestMethod -Method Post -Uri "$base/query/" -Body $trackingBody -ContentType 'application/json' -TimeoutSec 30
$trackingIntervals = @(foreach ($event in $observed[0]) {
  $duration = [double]$event.duration
  if ([double]::IsNaN($duration) -or [double]::IsInfinity($duration) -or $duration -lt 0) { throw 'Invalid duration' }
  $eventStart = [DateTimeOffset]::Parse($event.timestamp)
  [pscustomobject]@{start=$eventStart.ToString('o');end=$eventStart.AddSeconds($duration).ToString('o')}
})
$latest = Invoke-RestMethod -Uri "$base/buckets/$([Uri]::EscapeDataString($windows[0].Name))/events?limit=1" -TimeoutSec 10
[pscustomobject]@{host='Windows';status='ok';start=$start.ToString('o');end=$end.ToString('o');latestEvent=$latest[0].timestamp;intervals=$intervals;trackingIntervals=$trackingIntervals} | ConvertTo-Json -Compress -Depth 5
