param(
    [ValidateSet('status','copy')][string]$Action = 'status',
    [string]$Parent = $env:LOCALAPPDATA,
    [switch]$ConfirmAppQuit,
    [string]$AclScript = (Join-Path $PSScriptRoot '..\..\scripts\private-sync-acl.ps1'),
    [string]$RunKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
)
$ErrorActionPreference = 'Stop'
$failure = 'The data migration could not be completed safely.'
function Refuse([string]$Message) {
    $script:failure = $Message
    throw $Message
}
function Item([string]$Path) {
    try { Get-Item -LiteralPath $Path -Force }
    catch [System.Management.Automation.ItemNotFoundException] { return $null }
}
function SafeDirectory([string]$Path, [bool]$Required) {
    $entry = Item $Path
    if ($null -eq $entry) {
        if ($Required) { Refuse 'A required data folder is missing.' }
        return
    }
    if (-not $entry.PSIsContainer -or ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
        Refuse 'A data folder is a file or a reparse point.'
    }
}
function Manifest([string]$Root) {
    $pending = New-Object 'System.Collections.Generic.Stack[string]'
    $pending.Push($Root)
    $entries = New-Object 'System.Collections.Generic.List[object]'
    $links = New-Object 'System.Collections.Generic.List[string]'
    while ($pending.Count) {
        $directory = $pending.Pop()
        foreach ($entry in @(Get-ChildItem -LiteralPath $directory -Force)) {
            $relative = $entry.FullName.Substring($Root.TrimEnd('\').Length + 1)
            if ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) {
                $links.Add(($relative -replace '[\r\n]', '?'))
                continue
            }
            $kind = 'file'
            $size = [long]0
            $hash = ''
            if ($entry.PSIsContainer) {
                $kind = 'directory'
                $pending.Push($entry.FullName)
            } else {
                $size = $entry.Length
                $hash = (Get-FileHash -LiteralPath $entry.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
            }
            $entries.Add([pscustomobject][ordered]@{
                path = $relative
                type = $kind
                size = $size
                ticks = $entry.LastWriteTimeUtc.Ticks
                sha256 = $hash
            })
        }
    }
    if ($links.Count) { Refuse ('Reparse points are not allowed at relative paths: ' + ($links -join ', ') + '.') }
    # Ordinal ordering and JSON escaping keep the canonical text unambiguous.
    $byPath = @{}
    $paths = New-Object 'System.Collections.Generic.List[string]'
    foreach ($entry in $entries) { $byPath.Add($entry.path, $entry); $paths.Add($entry.path) }
    $paths.Sort([StringComparer]::Ordinal)
    foreach ($relative in $paths) { $byPath[$relative] }
}
function Digest($Entries) {
    $lines = @($Entries | ForEach-Object { $_ | ConvertTo-Json -Compress })
    $bytes = [Text.Encoding]::UTF8.GetBytes(($lines -join "`n"))
    $sha = [Security.Cryptography.SHA256]::Create()
    try { ([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-', '').ToLowerInvariant() }
    finally { $sha.Dispose() }
}
function PrivateFolder([string]$Relative) {
    $leaf = [IO.Path]::GetFileName($Relative)
    return $leaf -in @('private-sync','private-codex','private-repair','private-quota','private-device-identity') -or
        $leaf -cmatch '^private-sync-retired-[a-f0-9]{64}$'
}
function CheckAcl([string]$Directory, [bool]$Initialize) {
    $arguments = @('-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',$AclScript,'-Directory',$Directory)
    if ($Initialize) { $arguments += '-Initialize' }
    $result = @(& powershell.exe @arguments 2>$null)
    if ($LASTEXITCODE -ne 0 -or $result.Count -ne 1 -or $result[0] -ne 'private-sync-acl: ok') {
        Refuse 'Private data permissions could not be verified.'
    }
}
function StreamCopy([string]$Source, [string]$Destination, [long]$Ticks) {
    $partial = $Destination + '.' + [Guid]::NewGuid().ToString('N') + '.observatory-partial'
    $inputStream = $null
    $outputStream = $null
    try {
        $inputStream = [IO.File]::Open($Source, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
        $outputStream = [IO.FileStream]::new($partial, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
        $inputStream.CopyTo($outputStream)
        $outputStream.Flush($true)
    } finally {
        if ($null -ne $outputStream) { $outputStream.Dispose() }
        if ($null -ne $inputStream) { $inputStream.Dispose() }
    }
    # A stale file at the destination is an earlier staging copy made by this script, never earlier data.
    if ([IO.File]::Exists($Destination)) { [IO.File]::Delete($Destination) }
    [IO.File]::Move($partial, $Destination)
    [IO.File]::SetLastWriteTimeUtc($Destination, [DateTime]::new($Ticks, [DateTimeKind]::Utc))
}
try {
    if ($Action -eq 'copy' -and -not $ConfirmAppQuit) { Refuse 'Confirm that every Observatory app is quit before copying.' }
    if ($Parent -notmatch '^[A-Za-z]:\\' -or $Parent.Substring(2).Contains(':') -or
        [IO.Path]::GetFullPath($Parent).TrimEnd('\') -cne $Parent.TrimEnd('\')) {
        Refuse 'Choose an absolute full Windows parent path.'
    }
    $Parent = [IO.Path]::GetFullPath($Parent)
    for ($ancestor = $Parent; $ancestor; $ancestor = [IO.Path]::GetDirectoryName($ancestor.TrimEnd('\'))) {
        SafeDirectory $ancestor $true
        if ($ancestor.TrimEnd('\') -eq [IO.Path]::GetPathRoot($Parent).TrimEnd('\')) { break }
    }
    $names = Get-Content (Join-Path $PSScriptRoot '..\app-names.json') -Raw | ConvertFrom-Json
    $Legacy = Join-Path $Parent $names.legacy.dataFolder
    $Target = Join-Path $Parent $names.visible.dataFolder
    $Stage = Join-Path $Parent ('.' + $names.visible.dataFolder + '-migration')
    $mutex = $null
    $semaphore = $null
    try {
        $running = [Threading.Mutex]::TryOpenExisting(('Local\' + $names.internal.windowsAppId), [ref]$mutex)
        $running = [Threading.Semaphore]::TryOpenExisting(('Local\' + $names.internal.windowsAppId + '.InUse'), [ref]$semaphore) -or $running
        $processes = @(Get-Process -Name ([IO.Path]::GetFileNameWithoutExtension($names.internal.windowsExecutable)) -ErrorAction SilentlyContinue)
        if ($running -or $processes.Count) { Refuse 'Quit every Observatory app before inspecting or copying data.' }
    } finally {
        if ($null -ne $mutex) { $mutex.Dispose() }
        if ($null -ne $semaphore) { $semaphore.Dispose() }
    }
    SafeDirectory $Legacy $true
    SafeDirectory $Target $false
    SafeDirectory $Stage $false
    $receipt = 'updates\installed-envelope.json'
    $marker = 'observatory-migration.json'
    $original = @(Manifest $Legacy)
    if (@($original | Where-Object { $_.path -eq $marker }).Count) { Refuse 'The earlier folder already contains a migration record.' }
    $manifestHash = Digest $original
    $expected = @($original | Where-Object { $_.path -ne $receipt -or $_.type -ne 'file' })
    $skipped = @($original | Where-Object { $_.path -eq $receipt -and $_.type -eq 'file' } | ForEach-Object { $_.path })
    $directories = @($expected | Where-Object { $_.type -eq 'directory' })
    $files = @($expected | Where-Object { $_.type -eq 'file' })
    $bytes = [long]0
    foreach ($entry in $files) { $bytes += $entry.size }
    $state = 'missing'
    $targetManifest = @()
    if (Item $Target) {
        $targetManifest = @(Manifest $Target)
        $state = 'holds-data'
        if (-not $targetManifest.Count) { $state = 'empty' }
        elseif ($targetManifest.Count -eq 2 -and $targetManifest[0].path -eq 'updates' -and
            $targetManifest[0].type -eq 'directory' -and $targetManifest[1].path -eq $receipt -and
            $targetManifest[1].type -eq 'file') { $state = 'installer-receipt-only' }
        elseif (@($targetManifest | Where-Object { $_.path -eq $marker -and $_.type -eq 'file' }).Count) {
            $saved = Get-Content -LiteralPath (Join-Path $Target $marker) -Raw | ConvertFrom-Json
            if ($saved.manifestSha256 -eq $manifestHash) { $state = 'already-migrated' }
        }
    }
    if ($state -eq 'holds-data') { Refuse 'The destination holds data and cannot be replaced.' }
    $stageManifest = @()
    if (Item $Stage) { $stageManifest = @(Manifest $Stage) }
    $result = [ordered]@{ state = $state; directories = $directories.Count; files = $files.Count; bytes = $bytes; skipped = $skipped.Count }
    if ($Action -eq 'status' -or $state -eq 'already-migrated') {
        $result | ConvertTo-Json -Compress
        exit 0
    }
    $stopAfter = 0
    if ($env:OBSERVATORY_MIGRATION_STOP_AFTER -and
        (-not [int]::TryParse($env:OBSERVATORY_MIGRATION_STOP_AFTER, [ref]$stopAfter) -or $stopAfter -le 0)) {
        Refuse 'The test interruption count must be a positive integer.'
    }
    # Inspect the entire stage before deleting only abandoned partial files.
    foreach ($entry in $stageManifest) {
        if ($entry.type -eq 'file' -and $entry.path.EndsWith('.observatory-partial')) {
            [IO.File]::Delete((Join-Path $Stage $entry.path))
        }
    }
    if (-not (Item $Stage)) { New-Item -ItemType Directory -Path $Stage | Out-Null }
    foreach ($entry in $directories) {
        $destination = Join-Path $Stage $entry.path
        $exists = $null -ne (Item $destination)
        SafeDirectory $destination $false
        if (PrivateFolder $entry.path) { CheckAcl $destination (-not $exists) }
        elseif (-not $exists) { New-Item -ItemType Directory -Path $destination | Out-Null }
    }
    $copied = 0
    foreach ($entry in $files) {
        $destination = Join-Path $Stage $entry.path
        $existing = Item $destination
        if ($existing -and $existing.PSIsContainer) { Refuse 'The staging folder contains a conflicting directory.' }
        if ($existing -and $existing.Length -eq $entry.size -and
            (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash -eq $entry.sha256) {
            if ($existing.LastWriteTimeUtc.Ticks -ne $entry.ticks) {
                [IO.File]::SetLastWriteTimeUtc($destination, [DateTime]::new($entry.ticks, [DateTimeKind]::Utc))
            }
            continue
        }
        StreamCopy (Join-Path $Legacy $entry.path) $destination $entry.ticks
        $copied++
        if ($stopAfter -gt 0 -and $copied -ge $stopAfter) { Refuse 'The synthetic migration was interrupted for testing.' }
    }
    # Set directory times after all children have been written.
    foreach ($entry in @($directories | Sort-Object { $_.path.Length } -Descending)) {
        [IO.Directory]::SetLastWriteTimeUtc((Join-Path $Stage $entry.path), [DateTime]::new($entry.ticks, [DateTimeKind]::Utc))
    }
    if ((Digest @(Manifest $Legacy)) -ne $manifestHash) {
        Refuse 'The earlier data folder changed during the copy. Quit every Observatory app and run again.'
    }
    $staged = @(Manifest $Stage)
    $stagedReceipt = @($staged | Where-Object { $_.path -eq $receipt })
    if ($stagedReceipt.Count -and ($state -ne 'installer-receipt-only' -or
        $stagedReceipt[0].type -ne 'file' -or $stagedReceipt[0].sha256 -ne $targetManifest[1].sha256)) {
        Refuse 'The staging folder contains an unexpected installer receipt.'
    }
    $receiptDirectoryOnly = $state -eq 'installer-receipt-only' -and -not @($directories | Where-Object { $_.path -eq 'updates' }).Count
    $actual = @($staged | Where-Object {
        $_.path -ne $marker -and $_.path -ne $receipt -and -not ($receiptDirectoryOnly -and $_.path -eq 'updates')
    })
    if ((Digest $actual) -ne (Digest $expected)) { Refuse 'The staging folder does not exactly match the earlier data.' }
    foreach ($entry in $directories) {
        if ([IO.Path]::GetFileName($entry.path).StartsWith('private-', [StringComparison]::OrdinalIgnoreCase)) {
            CheckAcl (Join-Path $Stage $entry.path) $false
        }
    }
    $loginWasOn = $false
    if (Test-Path -LiteralPath $RunKey) {
        $properties = Get-ItemProperty -LiteralPath $RunKey
        $property = $properties.PSObject.Properties[$names.internal.windowsStartupName]
        if ($null -ne $property -and $property.Value -is [string]) {
            $legacyExe = Join-Path (Join-Path (Join-Path $Parent 'Programs') $names.legacy.dataFolder) $names.internal.windowsExecutable
            $command = $property.Value.Trim()
            $loginWasOn = $command -ieq $legacyExe -or $command -ieq ('"' + $legacyExe + '"') -or
                $command.StartsWith(('"' + $legacyExe + '" '), [StringComparison]::OrdinalIgnoreCase)
        }
    }
    $record = [ordered]@{ schema = 1; from = $names.legacy.dataFolder; to = $names.visible.dataFolder
        completedAt = [DateTime]::UtcNow.ToString('o'); directories = $directories.Count; files = $files.Count
        bytes = $bytes; manifestSha256 = $manifestHash; skipped = $skipped; loginWasOn = $loginWasOn }
    $recordPath = Join-Path $Stage $marker
    if (Item $recordPath) {
        $previous = Get-Content -LiteralPath $recordPath -Raw | ConvertFrom-Json
        if ($previous.schema -ne 1 -or $previous.manifestSha256 -ne $manifestHash) { Refuse 'The staging migration record does not match the earlier data.' }
    } else {
        $stream = [IO.FileStream]::new($recordPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
        try {
            $recordBytes = [Text.UTF8Encoding]::new($false).GetBytes(($record | ConvertTo-Json -Compress))
            $stream.Write($recordBytes, 0, $recordBytes.Length)
            $stream.Flush($true)
        } finally { $stream.Dispose() }
    }
    if ($state -eq 'installer-receipt-only') {
        $updates = Join-Path $Stage 'updates'
        SafeDirectory $updates $false
        if (-not (Item $updates)) { New-Item -ItemType Directory -Path $updates | Out-Null }
        $ownedReceipt = $targetManifest[1]
        StreamCopy (Join-Path $Target $receipt) (Join-Path $Stage $receipt) $ownedReceipt.ticks
        if ((Get-FileHash -LiteralPath (Join-Path $Stage $receipt) -Algorithm SHA256).Hash -ne $ownedReceipt.sha256) {
            Refuse 'The installer receipt copy could not be verified.'
        }
    }
    if ($state -ne 'missing') {
        if ((Digest @(Manifest $Target)) -ne (Digest $targetManifest)) { Refuse 'The destination changed during the copy.' }
        $suffix = 'empty'
        if ($state -eq 'installer-receipt-only') { $suffix = 'installer-receipt' }
        $aside = Join-Path $Parent ('.' + $names.visible.dataFolder + '-' + $suffix + '-' + [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffffffZ'))
        [IO.Directory]::Move($Target, $aside)
    }
    [IO.Directory]::Move($Stage, $Target)
    $result.state = 'migrated'
    $result | ConvertTo-Json -Compress
} catch {
    [Console]::Error.WriteLine($failure)
    exit 1
}
