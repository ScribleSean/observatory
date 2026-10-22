param([ValidateRange(1, 65535)][int]$Port = 5600)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$base = "http://127.0.0.1:$Port/api/0"
$end = [DateTimeOffset]::UtcNow
$start = $end.AddDays(-7)
$clock = [System.Diagnostics.Stopwatch]::StartNew()
function Get-RequestTimeout([int]$limit) {
  $left = 50 - [int]$clock.Elapsed.TotalSeconds
  if ($left -lt 1) { throw 'Activity read time limit' }
  return [Math]::Min($limit, $left)
}
$buckets = Invoke-RestMethod -Uri "$base/buckets/" -TimeoutSec (Get-RequestTimeout 10)
$dnsHostname = [System.Net.Dns]::GetHostName()
$localNames = @($env:COMPUTERNAME, $dnsHostname, $dnsHostname.Split('.')[0])
$groups = [System.Collections.Generic.Dictionary[string,object]]::new([StringComparer]::Ordinal)
foreach ($property in $buckets.PSObject.Properties) {
  $bucket = $property.Value
  if ($bucket.type -notin @('currentwindow', 'afkstatus')) { continue }
  if ($bucket.hostname -isnot [string] -or -not $bucket.hostname -or $localNames -inotcontains $bucket.hostname) { continue }
  if ($bucket.id -isnot [string] -or -not $bucket.id -or $bucket.id.Length -gt 512) { throw 'Invalid activity bucket' }
  if (-not $groups.ContainsKey($bucket.hostname)) {
    $groups.Add($bucket.hostname, @{windows=@();afks=@()})
  }
  if ($bucket.type -eq 'currentwindow') { $groups[$bucket.hostname].windows += $bucket.id }
  else { $groups[$bucket.hostname].afks += $bucket.id }
}
if ($groups.Count -lt 1 -or $groups.Count -gt 8) { throw 'No bounded local activity pairs' }
foreach ($group in $groups.Values) {
  if ($group.windows.Count -ne 1 -or $group.afks.Count -ne 1) { throw 'Ambiguous local activity pair' }
}
$intervals = @()
$trackingIntervals = @()
$latestEvent = $null
$latestTime = [DateTimeOffset]::MinValue
foreach ($windowGroup in $groups.Values) {
  $windowId = $windowGroup.windows[0]
  $w = ConvertTo-Json -Compress -InputObject $windowId
  foreach ($idleGroup in $groups.Values) {
    $a = ConvertTo-Json -Compress -InputObject $idleGroup.afks[0]
    $query = "w = query_bucket($w); a = query_bucket($a); a = filter_keyvals(a, `"status`", [`"not-afk`"]); RETURN = filter_period_intersect(w, a);"
    $body = @{query=@($query);timeperiods=@(($start.ToString('o') + '/' + $end.ToString('o')))} | ConvertTo-Json -Compress
    $result = Invoke-RestMethod -Method Post -Uri "$base/query/" -Body $body -ContentType 'application/json' -TimeoutSec (Get-RequestTimeout 30)
    $intervals += @(foreach ($event in $result[0]) {
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
    $observed = Invoke-RestMethod -Method Post -Uri "$base/query/" -Body $trackingBody -ContentType 'application/json' -TimeoutSec (Get-RequestTimeout 30)
    $trackingIntervals += @(foreach ($event in $observed[0]) {
      $duration = [double]$event.duration
      if ([double]::IsNaN($duration) -or [double]::IsInfinity($duration) -or $duration -lt 0) { throw 'Invalid duration' }
      $eventStart = [DateTimeOffset]::Parse($event.timestamp)
      [pscustomobject]@{start=$eventStart.ToString('o');end=$eventStart.AddSeconds($duration).ToString('o')}
    })
  }
  $latest = Invoke-RestMethod -Uri "$base/buckets/$([Uri]::EscapeDataString($windowId))/events?limit=1" -TimeoutSec (Get-RequestTimeout 10)
  if ($latest.Count -gt 0) {
    $parsed = [DateTimeOffset]::MinValue
    if ([DateTimeOffset]::TryParse([string]$latest[0].timestamp, [ref]$parsed) -and $parsed -gt $latestTime) {
      $latestTime = $parsed
      $latestEvent = $latest[0].timestamp
    }
  }
}
[pscustomobject]@{host='Windows';status='ok';start=$start.ToString('o');end=$end.ToString('o');latestEvent=$latestEvent;intervals=$intervals;trackingIntervals=$trackingIntervals} | ConvertTo-Json -Compress -Depth 5
