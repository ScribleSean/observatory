param([string]$CacheRoot = (Join-Path $env:LOCALAPPDATA 'WorkspaceObservatoryBuild/cache'))
$ErrorActionPreference = 'Stop'
$installer = Join-Path $PSScriptRoot 'installer.ps1'
$tokens = $null
$errors = $null
[System.Management.Automation.Language.Parser]::ParseFile($installer, [ref]$tokens, [ref]$errors) | Out-Null
if ($errors.Count -ne 0) { throw 'Installer script parse failed.' }
& $installer -VerifyCompilerOnly -CacheRoot $CacheRoot

# This unique fixture contains no compiler, executable or personal data.
$fixture = Join-Path ([IO.Path]::GetTempPath()) ('observatory-compiler-check-' + [Guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($fixture) | Out-Null
$archive = Join-Path $fixture 'nsis-3.12.zip'
[IO.File]::WriteAllText($archive, 'Synthetic invalid archive. Must never execute.')
$before = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash
try {
    $refused = $false
    try { & $installer -VerifyCompilerOnly -CacheRoot $fixture }
    catch {
        if ($_.Exception.Message -ne 'Installer compiler checksum mismatch.') { throw }
        $refused = $true
    }
    if (-not $refused) { throw 'Invalid compiler archive was accepted.' }
    if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ne $before) { throw 'Rejected archive was changed.' }
    if (@(Get-ChildItem -LiteralPath $fixture -Force).Count -ne 1) { throw 'Compiler contents unexpectedly extracted.' }
    Write-Output 'PASS: verified compiler archive and corrupt-cache rejection without extraction or mutation'
} finally {
    Remove-Item -LiteralPath $archive
    [IO.Directory]::Delete($fixture, $false)
}
