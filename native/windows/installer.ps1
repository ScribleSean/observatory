param(
    [string]$PackageDirectory,
    [string]$CacheRoot = (Join-Path $env:LOCALAPPDATA 'WorkspaceObservatoryBuild\cache'),
    [switch]$TestIdentity,
    [switch]$VerifyCompilerOnly
)
$ErrorActionPreference = 'Stop'
if ((-not $VerifyCompilerOnly -and (-not $PackageDirectory -or -not [IO.Path]::IsPathRooted($PackageDirectory))) -or
    -not [IO.Path]::IsPathRooted($CacheRoot)) { throw 'Absolute paths are required.' }
$asset = Get-Content (Join-Path $PSScriptRoot 'installer-tool.json') -Raw | ConvertFrom-Json
if ($asset.version -ne '3.12' -or $asset.filename -ne 'nsis-3.12.zip' -or $asset.sha256 -notmatch '^[a-f0-9]{64}$' -or
    $asset.url -ne 'https://downloads.sourceforge.net/project/nsis/NSIS%203/3.12/nsis-3.12.zip') { throw 'Unexpected installer tool metadata.' }
New-Item -ItemType Directory -Path $CacheRoot -Force | Out-Null
$archive = Join-Path $CacheRoot $asset.filename
if (-not (Test-Path -LiteralPath $archive)) {
    $partial = "$archive.$([guid]::NewGuid().ToString('N')).part"
    try {
        $curl = Join-Path $env:SystemRoot 'System32/curl.exe'
        if (-not (Test-Path -LiteralPath $curl -PathType Leaf)) { throw 'Windows curl is required to download the installer compiler.' }
        & $curl --fail --location --proto '=https' --proto-redir '=https' --connect-timeout 20 --max-time 120 --retry 2 --silent --show-error --output $partial $asset.url
        if ($LASTEXITCODE -ne 0) { throw 'Installer compiler download failed. No downloaded content was executed.' }
        if ((Get-FileHash -LiteralPath $partial -Algorithm SHA256).Hash.ToLowerInvariant() -ne $asset.sha256) {
            $bytes = (Get-Item -LiteralPath $partial).Length
            throw "Installer compiler checksum mismatch ($bytes bytes). No downloaded content was executed."
        }
        Move-Item -LiteralPath $partial -Destination $archive
    } finally { if (Test-Path -LiteralPath $partial) { Remove-Item -LiteralPath $partial } }
}
if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $asset.sha256) { throw 'Installer compiler checksum mismatch.' }
if ($VerifyCompilerOnly) {
    Write-Output "Pinned installer compiler archive verified: $((Get-Item -LiteralPath $archive).Length) bytes, SHA256 $($asset.sha256). No archive content was executed."
    return
}
# Extract a fresh compiler from the verified archive, not a mutable cached exe.
$compilerFolder = Join-Path $CacheRoot ('nsis-compiler-' + [guid]::NewGuid().ToString('N'))
Expand-Archive -LiteralPath $archive -DestinationPath $compilerFolder
$compilerRoot = Join-Path $compilerFolder 'nsis-3.12'
$work = Join-Path $PSScriptRoot ('release\installer-' + [guid]::NewGuid().ToString('N'))
$node = Join-Path $PackageDirectory 'Runtime\node.exe'
$generatorArgs = @((Join-Path $PSScriptRoot 'generate-installer.mjs'), $PackageDirectory, $work)
if ($TestIdentity) { $generatorArgs += '--test-identity' }
& $node @generatorArgs
if ($LASTEXITCODE -ne 0) { throw 'Installer package validation failed.' }
Push-Location $work
try {
    & (Join-Path $compilerRoot 'makensis.exe') /NOCONFIG /WX /V2 installer.nsi
    if ($LASTEXITCODE -ne 0) { throw 'Installer compilation failed.' }
    $artifacts = Join-Path $work 'artifacts'
    $build = Get-Content (Join-Path $artifacts 'installer-build.json') -Raw | ConvertFrom-Json
    $installer = Join-Path $artifacts $build.installerName
    $hash = (Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash.ToLowerInvariant()
    Set-Content -LiteralPath "$installer.sha256" -Value "$hash  $($build.installerName)" -Encoding Ascii
    Copy-Item -LiteralPath (Join-Path $compilerRoot 'COPYING') -Destination (Join-Path $artifacts 'NSIS-LICENSE.txt')
    Write-Output "Installer candidate: $installer"
    Write-Output 'Unsigned. Complete install, launch, uninstall and data-preservation checks before distribution.'
} finally { Pop-Location }
