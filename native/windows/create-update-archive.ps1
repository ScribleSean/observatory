param([Parameter(Mandatory=$true)][string]$Directory, [Parameter(Mandatory=$true)][string]$Archive)
$ErrorActionPreference = 'Stop'
if (-not [IO.Path]::IsPathRooted($Directory) -or -not [IO.Path]::IsPathRooted($Archive)) { throw 'Absolute archive paths required.' }
$source = [IO.Path]::GetFullPath($Directory).TrimEnd('\','/')
$target = [IO.Path]::GetFullPath($Archive)
if ($target.StartsWith($source + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Archive must be outside the prepared directory.' }
foreach ($folder in @($source, [IO.Path]::GetDirectoryName($target))) {
    $current = Get-Item -LiteralPath $folder
    while ($current) {
        if ($current -isnot [IO.DirectoryInfo] -or -not $current.Exists -or ($current.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Unlinked existing directories required.' }
        $current = $current.Parent
    }
}
$pending = New-Object 'System.Collections.Generic.Queue[string]'
$files = New-Object 'System.Collections.Generic.List[string]'
$pending.Enqueue($source)
while ($pending.Count -gt 0) {
    foreach ($entry in Get-ChildItem -LiteralPath $pending.Dequeue() -Force) {
        if ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Linked archive input refused.' }
        if ($entry.PSIsContainer) { $pending.Enqueue($entry.FullName) }
        else { $files.Add($entry.FullName) }
        if ($files.Count + $pending.Count -gt 8000) { throw 'Update archive entry limit exceeded.' }
    }
}
if ($files.Count -eq 0) { throw 'Empty update archive refused.' }
Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName System.IO.Compression
# Create mode refuses an existing file. Keep partial output on failure.
$zip = [IO.Compression.ZipFile]::Open($target, [IO.Compression.ZipArchiveMode]::Create)
try {
    foreach ($file in $files) {
        # .NET Framework CreateFromDirectory can emit backslashes. ZIP names must
        # use forward slashes to satisfy the unchanged native extraction policy.
        $name = $file.Substring($source.Length + 1).Replace('\','/')
        [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip,$file,$name,[IO.Compression.CompressionLevel]::Optimal) | Out-Null
    }
} finally { $zip.Dispose() }
Write-Output 'Update archive created. Authenticate and verify the extracted payload before use.'
