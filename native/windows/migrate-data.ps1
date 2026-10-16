param(
    [string]$Action = 'status',
    [string]$Parent = $env:LOCALAPPDATA,
    [switch]$ConfirmAppQuit,
    [string]$AclScript = (Join-Path $PSScriptRoot '..\..\scripts\private-sync-acl.ps1'),
    [string]$RunKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run',
    # Test-only names isolate synthetic checks from an installed application.
    [string]$AppIdOverride = '',
    [string]$ProcessNameOverride = '',
    # Test only. Hosted CI runners are elevated. A person never needs this.
    [switch]$AllowElevatedTestRun
)
$ErrorActionPreference = 'Stop'
$failure = $null
$step = 'input'
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
                $links.Add((DisplayPath $relative))
                continue
            }
            $kind = 'file'
            $size = [long]0
            $hash = ''
            if ($entry.PSIsContainer) {
                if ($entry.Name.StartsWith('private-', [StringComparison]::OrdinalIgnoreCase) -and -not (PrivateFolder $relative)) {
                    Refuse ('Unknown private folder at relative path: ' + (DisplayPath $relative))
                }
                $kind = 'directory'
                $pending.Push($entry.FullName)
            } else {
                if ((PrivateFolder ($relative.Split('\')[0])) -and [MigrationFileLinks]::Count($entry.FullName) -ne 1) {
                    Refuse ('Hard links are not allowed at relative path: ' + (DisplayPath $relative))
                }
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
    $entries
}
function Digest($Entries, [switch]$IgnoreDirectoryTimes) {
    $lines = New-Object 'System.Collections.Generic.List[string]'
    foreach ($entry in $Entries) {
        $hex = ([BitConverter]::ToString([Text.Encoding]::UTF8.GetBytes($entry.path))).Replace('-', '').ToLowerInvariant()
        # Target directories are compared by path and type because NTFS enumeration can return stale times.
        if ($IgnoreDirectoryTimes -and $entry.type -eq 'directory') {
            $lines.Add(($hex, $entry.type -join "`t"))
        } else {
            $lines.Add(($hex, $entry.type, $entry.size.ToString([Globalization.CultureInfo]::InvariantCulture), $entry.ticks.ToString([Globalization.CultureInfo]::InvariantCulture), $entry.sha256 -join "`t"))
        }
    }
    $lines.Sort([StringComparer]::Ordinal)
    $sha = [Security.Cryptography.SHA256]::Create()
    try { ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes(($lines -join "`n"))))).Replace('-', '').ToLowerInvariant() }
    finally { $sha.Dispose() }
}
function PrivateFolder([string]$Relative) {
    return -not $Relative.Contains('\') -and ($Relative -cin @('private-sync','private-codex','private-repair','private-quota','private-device-identity') -or
        $Relative -cmatch '^private-sync-retired-[a-f0-9]{64}$')
}
function DisplayPath([string]$Relative) {
    $parts = $Relative.Split('\')
    for ($i = 0; $i -lt $parts.Length; $i++) {
        if ($parts[$i].StartsWith('private-', [StringComparison]::OrdinalIgnoreCase)) {
            return (($parts[0..$i] -join '\') -replace '[\r\n]', '?')
        }
    }
    return ($Relative -replace '[\r\n]', '?')
}
function ExchangeLock {
    $script:step = 'lock'
    $database = Join-Path $Legacy 'private-repair\operation.sqlite'
    $message = 'The Mac pairing exchange is using the earlier folder. Quit the Mac app and run again.'
    if ((Item ($database + '-journal')) -or (Item ($database + '-wal'))) { Refuse $message }
    if (Item $database) {
        try {
            $handle = [IO.File]::Open($database, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::None)
            $handle.Dispose()
        } catch { Refuse $message }
    }
}
function SaveJson([string]$Path, $Value) {
    $bytes = [Text.UTF8Encoding]::new($false).GetBytes(($Value | ConvertTo-Json -Depth 8 -Compress))
    $stream = [IO.FileStream]::new($Path, [IO.FileMode]::Create, [IO.FileAccess]::Write, [IO.FileShare]::None)
    try { $stream.Write($bytes, 0, $bytes.Length); $stream.Flush($true) }
    finally { $stream.Dispose() }
}
function ReadLogin {
    if (Test-Path -LiteralPath $RunKey) {
        $property = (Get-ItemProperty -LiteralPath $RunKey).PSObject.Properties[$names.internal.windowsStartupName]
        if ($null -ne $property -and $property.Value -is [string]) {
            $exe = Join-Path (Join-Path (Join-Path $Parent 'Programs') $names.legacy.productName) $names.internal.windowsExecutable
            return $property.Value -ieq ('"' + $exe + '"') -or $property.Value -ieq ('"' + $exe + '" --background')
        }
    }
    return $false
}
function SshPaths($Name) {
    $install = Join-Path (Join-Path $Parent 'Programs') $Name.productName
    return [ordered]@{ remoteNode = (Join-Path $install 'Runtime\node.exe'); remoteScript = (Join-Path $install 'Collector\scripts\peer-exchange.mjs'); remoteRuntime = (Join-Path $Parent $Name.dataFolder) }
}
function CheckAcl([string]$Directory, [bool]$Initialize) {
    $script:step = 'acl'
    $arguments = @('-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',$AclScript,'-Directory',$Directory)
    if ($Initialize) { $arguments += '-Initialize' }
    $result = @(& powershell.exe @arguments 2>$null)
    if ($LASTEXITCODE -ne 0 -or $result.Count -ne 1 -or $result[0] -ne 'private-sync-acl: ok') {
        Refuse 'Private data permissions could not be verified.'
    }
}
function StreamCopy([string]$Source, [string]$Destination, [long]$Ticks) {
    # Alternate data streams are not copied. Only the unnamed stream is opened.
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
    if ($Action -notin @('status','copy')) { Refuse 'Choose status or copy.' }
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    if (-not $AllowElevatedTestRun -and $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { Refuse 'Run without administrator rights.' }
    . (Join-Path $PSScriptRoot 'app-names.ps1')
    $names = Read-AppNames
    if (-not ('MigrationFileLinks' -as [type])) {
        Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
public static class MigrationFileLinks {
    [StructLayout(LayoutKind.Sequential)]
    struct Info {
        public uint Attributes;
        public System.Runtime.InteropServices.ComTypes.FILETIME Created, Accessed, Written;
        public uint Volume, SizeHigh, SizeLow, Links, IndexHigh, IndexLow;
    }
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool GetFileInformationByHandle(SafeFileHandle handle, out Info info);
    public static uint Count(string path) {
        using (var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read)) {
            Info info;
            if (!GetFileInformationByHandle(stream.SafeFileHandle, out info)) throw new IOException();
            return info.Links;
        }
    }
}
'@
    }
    if ($Action -eq 'copy' -and -not $ConfirmAppQuit) { Refuse 'Confirm that every Observatory app is quit before copying.' }
    if ($Parent -notmatch '^[A-Za-z]:\\' -or $Parent.Substring(2).Contains(':') -or
        [IO.Path]::GetFullPath($Parent).TrimEnd('\') -cne $Parent.TrimEnd('\')) {
        Refuse 'Choose an absolute full Windows parent path.'
    }
    $Parent = [IO.Path]::GetFullPath($Parent)
    if ($Parent.Length -gt 3) { $Parent = $Parent.TrimEnd('\') }
    $step = 'folders'
    for ($ancestor = $Parent; $ancestor; $ancestor = [IO.Path]::GetDirectoryName($ancestor.TrimEnd('\'))) {
        SafeDirectory $ancestor $true
        if ($ancestor.TrimEnd('\') -eq [IO.Path]::GetPathRoot($Parent).TrimEnd('\')) { break }
    }
    $Legacy = Join-Path $Parent $names.legacy.dataFolder
    $Target = Join-Path $Parent $names.visible.dataFolder
    $Stage = Join-Path $Parent ('.' + $names.visible.dataFolder + '-migration')
    $step = 'running'
    $appId = $names.internal.windowsAppId
    if ($AppIdOverride) { $appId = $AppIdOverride }
    $processName = [IO.Path]::GetFileNameWithoutExtension($names.internal.windowsExecutable)
    if ($ProcessNameOverride) { $processName = $ProcessNameOverride }
    $mutex = $null
    $semaphore = $null
    try {
        $running = [Threading.Mutex]::TryOpenExisting(('Local\' + $appId), [ref]$mutex)
        $running = [Threading.Semaphore]::TryOpenExisting(('Local\' + $appId + '.InUse'), [ref]$semaphore) -or $running
        $processes = @(Get-Process -Name $processName -ErrorAction SilentlyContinue)
        if ($running -or $processes.Count) { Refuse 'Quit every Observatory app before inspecting or copying data.' }
    } finally {
        if ($null -ne $mutex) { $mutex.Dispose() }
        if ($null -ne $semaphore) { $semaphore.Dispose() }
    }
    $step = 'folders'
    SafeDirectory $Legacy $true
    SafeDirectory $Target $false
    SafeDirectory $Stage $false
    $receipt = 'updates\installed-envelope.json'
    $marker = 'observatory-migration.json'
    ExchangeLock
    $step = 'manifest'
    $original = @(Manifest $Legacy)
    if (@($original | Where-Object { $_.path -in @($marker, 'login-state.json') }).Count) { Refuse 'The earlier folder already contains a migration record.' }
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
        elseif ($targetManifest.Count -eq 2 -and @($targetManifest | Where-Object { $_.path -eq 'updates' -and $_.type -eq 'directory' }).Count -eq 1 -and
            @($targetManifest | Where-Object { $_.path -eq $receipt -and $_.type -eq 'file' }).Count -eq 1) { $state = 'installer-receipt-only' }
        elseif (@($targetManifest | Where-Object { $_.path -eq $marker -and $_.type -eq 'file' }).Count) {
            $saved = Get-Content -LiteralPath (Join-Path $Target $marker) -Raw -Encoding UTF8 | ConvertFrom-Json
            if ($saved.manifestSha256 -eq $manifestHash) { $state = 'already-migrated' }
        }
    }
    $step = 'folders'
    if ($state -eq 'holds-data') { Refuse 'The destination holds data and cannot be replaced.' }
    $step = 'manifest'
    $stageManifest = @()
    if (Item $Stage) { $stageManifest = @(Manifest $Stage) }
    $step = 'login'
    $loginWasOn = ReadLogin
    $loginPath = Join-Path $Stage 'login-state.json'
    if (Item $loginPath) {
        $login = Get-Content -LiteralPath $loginPath -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($login.schema -ne 1 -or $login.loginWasOn -isnot [bool]) { Refuse 'Invalid saved login state.' }
        $loginWasOn = $login.loginWasOn
    }
    elseif (Item (Join-Path $Stage $marker)) {
        $savedLogin = Get-Content -LiteralPath (Join-Path $Stage $marker) -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($savedLogin.loginWasOn -is [bool]) { $loginWasOn = $savedLogin.loginWasOn }
    }
    $ssh = [ordered]@{ from = (SshPaths $names.legacy); to = (SshPaths $names.visible) }
    $result = [ordered]@{ state = $state; directories = $directories.Count; files = $files.Count; bytes = $bytes; skipped = $skipped.Count
        loginWasOn = $loginWasOn; notes = 'alternate data streams are not copied'; manifestSha256 = $manifestHash }
    if ($Action -eq 'status' -or $state -eq 'already-migrated') {
        if ($state -eq 'already-migrated') { $result.loginWasOn = $saved.loginWasOn }
        $result | ConvertTo-Json -Depth 8 -Compress
        exit 0
    }
    $step = 'input'
    $stopAfter = 0
    if ($env:OBSERVATORY_MIGRATION_STOP_AFTER -and
        (-not [int]::TryParse($env:OBSERVATORY_MIGRATION_STOP_AFTER, [ref]$stopAfter) -or $stopAfter -le 0)) {
        Refuse 'The test interruption count must be a positive integer.'
    }
    $step = 'stage'
    $recordPath = Join-Path $Stage $marker
    $previous = $null
    $validStage = $false
    if (Item $recordPath) {
        try {
            $previous = Get-Content -LiteralPath $recordPath -Raw -Encoding UTF8 | ConvertFrom-Json
            $validStage = $previous.schema -eq 1 -and $previous.manifestSha256 -eq $manifestHash
        } catch { $validStage = $false }
    }
    # A partial stage must contain only verified source entries and migration metadata.
    foreach ($entry in $stageManifest) {
        if ($entry.path -in @($marker, 'login-state.json', $receipt)) { continue }
        $match = @($expected | Where-Object { $_.path -ceq $entry.path -and $_.type -eq $entry.type })
        if ($entry.path -eq 'updates' -and $previous.receiptSha256) { continue }
        if ($match.Count -ne 1 -or ($entry.type -eq 'file' -and ($entry.sha256 -ne $match[0].sha256 -or $entry.ticks -ne $match[0].ticks))) { $validStage = $false }
    }
    $receiptSource = $null
    $receiptHash = $null
    if ($state -eq 'installer-receipt-only') {
        $receiptSource = Join-Path $Target $receipt
        $receiptHash = (Get-FileHash -LiteralPath $receiptSource -Algorithm SHA256).Hash.ToLowerInvariant()
    } elseif ($state -eq 'missing' -and $previous.aside -and $previous.receiptSha256) {
        if ([IO.Path]::GetFileName($previous.aside) -cne $previous.aside -or $previous.aside -in @('.', '..')) { Refuse 'Invalid retained receipt folder.' }
        $retained = Join-Path $Parent $previous.aside
        SafeDirectory $retained $true
        SafeDirectory (Join-Path $retained 'updates') $true
        $receiptSource = Join-Path $retained $receipt
        $receiptItem = Item $receiptSource
        if (-not $receiptItem -or $receiptItem.PSIsContainer -or ($receiptItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -or
            (Get-FileHash -LiteralPath $receiptSource -Algorithm SHA256).Hash -ne $previous.receiptSha256) { Refuse 'The retained installer receipt could not be verified.' }
        $receiptHash = $previous.receiptSha256
    }
    foreach ($entry in $stageManifest) {
        if ($entry.path -eq $receipt -and ($entry.type -ne 'file' -or $entry.sha256 -ne $receiptHash)) { $validStage = $false }
    }
    if ((Item $Stage) -and -not $validStage) {
        $stale = Join-Path $Parent ('.' + $names.visible.dataFolder + '-migration-stale-' + [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ') + '-' + [Guid]::NewGuid().ToString('N').Substring(0,4))
        [IO.Directory]::Move($Stage, $stale)
    }
    if (-not (Item $Stage)) { [IO.Directory]::CreateDirectory($Stage) | Out-Null }
    $step = 'login'
    SaveJson $loginPath ([ordered]@{ schema = 1; loginWasOn = $loginWasOn })
    if ($loginWasOn -and (ReadLogin)) {
        Remove-ItemProperty -LiteralPath $RunKey -Name $names.internal.windowsStartupName
    }
    $record = [ordered]@{ schema = 1; from = $names.legacy.dataFolder; to = $names.visible.dataFolder
        directories = $directories.Count; files = $files.Count; bytes = $bytes; manifestSha256 = $manifestHash
        skipped = $skipped; loginWasOn = $loginWasOn; ssh = $ssh }
    if ($receiptSource) {
        $record.receiptSha256 = $receiptHash
        if ($state -eq 'missing') { $record.aside = $previous.aside }
    }
    $step = 'stage'
    SaveJson $recordPath $record
    foreach ($entry in $directories) {
        $destination = Join-Path $Stage $entry.path
        $exists = $null -ne (Item $destination)
        SafeDirectory $destination $false
        if (PrivateFolder $entry.path) { CheckAcl $destination (-not $exists) }
        elseif (-not $exists) { [IO.Directory]::CreateDirectory($destination) | Out-Null }
    }
    $step = 'copy'
    $copied = 0
    foreach ($entry in $files) {
        $destination = Join-Path $Stage $entry.path
        if (-not (Item $destination)) {
            StreamCopy (Join-Path $Legacy $entry.path) $destination $entry.ticks
            $copied++
            if ($stopAfter -gt 0 -and $copied -ge $stopAfter) { Refuse 'The synthetic migration was interrupted for testing.' }
        }
    }
    if ($receiptSource) {
        [IO.Directory]::CreateDirectory((Join-Path $Stage 'updates')) | Out-Null
        StreamCopy $receiptSource (Join-Path $Stage $receipt) (Item $receiptSource).LastWriteTimeUtc.Ticks
    }
    foreach ($entry in @($directories | Sort-Object { $_.path.Length } -Descending)) {
        [IO.Directory]::SetLastWriteTimeUtc((Join-Path $Stage $entry.path), [DateTime]::new($entry.ticks, [DateTimeKind]::Utc))
    }
    ExchangeLock
    $step = 'manifest'
    $second = @(Manifest $Legacy)
    $step = 'verify'
    if ((Digest $second) -ne $manifestHash) { Refuse 'The earlier data folder changed during the copy. Quit every Observatory app and run again.' }
    $staged = @(Manifest $Stage)
    $receiptDirectoryOnly = $receiptSource -and -not @($directories | Where-Object { $_.path -eq 'updates' }).Count
    $actual = @($staged | Where-Object {
        $_.path -notin @($marker, 'login-state.json', $receipt) -and -not ($receiptDirectoryOnly -and $_.path -eq 'updates')
    })
    if ((Digest $actual) -ne (Digest $expected)) { Refuse 'The staging folder does not exactly match the earlier data.' }
    if ($receiptSource -and (Get-FileHash -LiteralPath (Join-Path $Stage $receipt) -Algorithm SHA256).Hash -ne $receiptHash) { Refuse 'The installer receipt copy could not be verified.' }
    foreach ($entry in $directories) {
        if (PrivateFolder $entry.path) { CheckAcl (Join-Path $Stage $entry.path) $false }
    }
    $step = 'switch'
    $record.completedAt = [DateTime]::UtcNow.ToString('o')
    if ($state -ne 'missing') {
        # Test only. The test owns the mutation and acknowledges it through stdin.
        if ($env:OBSERVATORY_MIGRATION_TOUCH_TARGET -eq '1') {
            [Console]::Out.WriteLine('migration-target-check-ready')
            if ([Console]::ReadLine() -ne 'target-change-complete') { Refuse 'The synthetic target change was not acknowledged.' }
        }
        if ((Digest @(Manifest $Target) -IgnoreDirectoryTimes) -ne (Digest $targetManifest -IgnoreDirectoryTimes)) { Refuse 'The destination changed during the copy.' }
        $suffix = 'empty'
        if ($state -eq 'installer-receipt-only') { $suffix = 'installer-receipt' }
        $record.aside = '.' + $names.visible.dataFolder + '-' + $suffix + '-' + [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffffffZ')
        SaveJson $recordPath $record
        [IO.Directory]::Move($Target, (Join-Path $Parent $record.aside))
        if ($env:OBSERVATORY_MIGRATION_STOP_BEFORE_SWITCH -eq '1') { Refuse 'The synthetic migration was interrupted before switching.' }
    }
    SaveJson $recordPath $record
    [IO.File]::Delete($loginPath)
    [IO.Directory]::Move($Stage, $Target)
    $result.state = 'migrated'
    $result.ssh = $ssh
    $result | ConvertTo-Json -Depth 8 -Compress
} catch {
    if (-not $failure) { $failure = $_.Exception.GetType().Name }
    [Console]::Error.WriteLine(('Migration refused (' + $step + '): ' + $failure))
    exit 1
}
