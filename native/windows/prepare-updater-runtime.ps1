param([Parameter(Mandatory=$true)][string]$Archive, [Parameter(Mandatory=$true)][string]$Destination)
$ErrorActionPreference = 'Stop'
$pin = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'updater-tool.json') -Raw | ConvertFrom-Json
if ($pin.runtime.platform -ne 'windows-x64' -or $pin.sha256 -notmatch '^[a-f0-9]{64}$' -or
    $pin.runtime.sha256 -notmatch '^[a-f0-9]{64}$' -or $pin.runtime.bytes -lt 1 -or $pin.runtime.bytes -gt 16777216) {
    throw 'Invalid pinned updater runtime.'
}
foreach ($value in @($Archive,$Destination)) {
    if (-not [IO.Path]::IsPathRooted($value) -or [IO.Path]::GetFullPath($value) -cne $value) { throw 'Canonical absolute paths required.' }
    $current = Get-Item -LiteralPath ([IO.Path]::GetDirectoryName($value))
    while ($current) {
        if ($current -isnot [IO.DirectoryInfo] -or -not $current.Exists -or ($current.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
            throw 'Existing unlinked parent directories required.'
        }
        $current = $current.Parent
    }
}
if (Test-Path -LiteralPath $Destination) { throw 'Updater destination already exists.' }
$item = Get-Item -LiteralPath $Archive
if ($item -isnot [IO.FileInfo] -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $item.Length -gt 67108864) {
    throw 'Regular bounded updater archive required.'
}
Add-Type -AssemblyName System.IO.Compression
$inputStream = [IO.File]::Open($Archive,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
$sha = [Security.Cryptography.SHA256]::Create()
try {
    $digest = [BitConverter]::ToString($sha.ComputeHash($inputStream)).Replace('-','').ToLowerInvariant()
    if ($digest -cne $pin.sha256) { throw 'Updater archive checksum mismatch.' }
    $inputStream.Position = 0
    $zip = New-Object IO.Compression.ZipArchive($inputStream,[IO.Compression.ZipArchiveMode]::Read,$true)
    try {
        $names = @($pin.runtime.dll) + @($pin.runtime.notices)
        if ($names.Count -ne 3 -or @($names | Select-Object -Unique).Count -ne 3) { throw 'Unexpected updater inventory.' }
        $contents = @{}
        foreach ($name in $names) {
            $entries = @($zip.Entries | Where-Object { $_.FullName -ceq $name })
            $limit = if ($name -ceq $pin.runtime.dll) { $pin.runtime.bytes } else { 65536 }
            if ($entries.Count -ne 1 -or $entries[0].Length -lt 1 -or $entries[0].Length -gt $limit) { throw 'Invalid updater entry.' }
            $stream = $entries[0].Open()
            try {
                $bytes = New-Object byte[] ([int]$entries[0].Length)
                $offset = 0
                while ($offset -lt $bytes.Length) {
                    $count = $stream.Read($bytes,$offset,$bytes.Length-$offset)
                    if ($count -le 0) { throw 'Incomplete updater entry.' }
                    $offset += $count
                }
                if ($stream.ReadByte() -ne -1) { throw 'Oversized updater entry.' }
            } finally { $stream.Dispose() }
            $leaf = ($name -split '/')[-1]
            if ($leaf -cnotin @('WinSparkle.dll','COPYING','COPYING.expat') -or $contents.ContainsKey($leaf)) { throw 'Unexpected updater filename.' }
            $contents[$leaf] = $bytes
        }
        $dll = $contents['WinSparkle.dll']
        if ($null -eq $dll -or $dll.Length -ne $pin.runtime.bytes -or
            [BitConverter]::ToString($sha.ComputeHash($dll)).Replace('-','').ToLowerInvariant() -cne $pin.runtime.sha256) { throw 'Updater DLL mismatch.' }
        if ([BitConverter]::ToUInt16($dll,0) -ne 0x5a4d) { throw 'Invalid updater PE file.' }
        $pe = [BitConverter]::ToInt32($dll,0x3c)
        if ($pe -lt 0 -or $pe -gt $dll.Length-6 -or [BitConverter]::ToUInt32($dll,$pe) -ne 0x4550 -or
            [BitConverter]::ToUInt16($dll,$pe+4) -ne 0x8664) { throw 'Updater DLL must be x64.' }
        New-Item -ItemType Directory -Path $Destination -ErrorAction Stop | Out-Null
        foreach ($leaf in $contents.Keys) {
            $outputStream = [IO.File]::Open((Join-Path $Destination $leaf),[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
            try { $outputStream.Write($contents[$leaf],0,$contents[$leaf].Length); $outputStream.Flush($true) }
            finally { $outputStream.Dispose() }
        }
    } finally { $zip.Dispose() }
} finally { $sha.Dispose(); $inputStream.Dispose() }
Write-Output 'Verified updater DLL and notices prepared. No library was executed.'
