param([Parameter(Mandatory=$true)][string]$PackageDirectory)
$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted' -or $env:RUNNER_OS -ne 'Windows') {
    throw 'This integration check is restricted to disposable GitHub-hosted Windows runners.'
}
$installed = Join-Path $env:LOCALAPPDATA 'Programs\Workspace Observatory'
$data = Join-Path $env:LOCALAPPDATA 'Workspace Observatory'
$shortcuts = Join-Path ([Environment]::GetFolderPath('Programs')) 'Workspace Observatory'
$registration = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\WorkspaceObservatorySetup'
if ((Test-Path -LiteralPath $installed) -or (Test-Path -LiteralPath $data) -or
    (Test-Path -LiteralPath $shortcuts) -or (Test-Path $registration) -or
    @(Get-Process WorkspaceObservatory -ErrorAction SilentlyContinue).Count -ne 0) {
    throw 'An existing app, registration or data directory prevents this clean-runner check.'
}
$run = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Software\Microsoft\Windows\CurrentVersion\Run')
try { if ($run -and $null -ne $run.GetValue('WorkspaceObservatory')) { throw 'Existing startup preference prevents staging test.' } }
finally { if ($run) { $run.Dispose() } }
function RunChecked([string]$Exe, [string]$Arguments) {
    $info = New-Object Diagnostics.ProcessStartInfo
    $info.FileName = $Exe
    $info.Arguments = $Arguments
    $info.UseShellExecute = $false
    $process = [Diagnostics.Process]::Start($info)
    try {
        if (-not $process.WaitForExit(120000)) { throw 'Staging process still active. Retain all files for inspection.' }
        if ($process.ExitCode -ne 0) { throw ('Staging process failed: ' + $process.ExitCode) }
    } finally { $process.Dispose() }
}
$node = Join-Path $PackageDirectory 'Runtime\node.exe'
& $node (Join-Path $PSScriptRoot 'verify-manifest.mjs') $PackageDirectory
if ($LASTEXITCODE -ne 0) { throw 'Candidate verification failed.' }
$release = Join-Path $PSScriptRoot 'release'
$before = @(Get-ChildItem -LiteralPath $release -Directory | ForEach-Object FullName)
& (Join-Path $PSScriptRoot 'installer.ps1') -PackageDirectory $PackageDirectory
$created = @(Get-ChildItem -LiteralPath $release -Directory -Filter 'installer-*' | Where-Object { $_.FullName -notin $before })
if ($created.Count -ne 1) { throw 'Expected one newly compiled ordinary installer.' }
$buildPath = Join-Path $created[0].FullName 'artifacts\installer-build.json'
$build = Get-Content -LiteralPath $buildPath -Raw | ConvertFrom-Json
if ($build.testIdentity -or -not $build.buildNumber) { throw 'Expected versioned ordinary installer metadata.' }
$installer = Join-Path (Split-Path $buildPath) $build.installerName
$expectedHash = (Get-Content -LiteralPath ($installer + '.sha256') -Raw).Split(' ')[0]
if ((Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expectedHash) { throw 'Installer checksum mismatch.' }
$output = Join-Path $env:RUNNER_TEMP ('observatory-update-staging-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $output | Out-Null
RunChecked $installer '/S'
try {
    $request = Join-Path $output 'signing-request'
    & $node (Join-Path $PSScriptRoot 'prepare-installation-receipt.mjs') $installed $buildPath $request
    if ($LASTEXITCODE -ne 0) { throw 'Actual installer receipt preparation failed.' }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = Join-Path $output 'windows-update.zip'
    [IO.Compression.ZipFile]::CreateFromDirectory($installed, $archive)
    # Atomic replacement requires a candidate beside the installation, not on
    # the runner's potentially different temporary volume.
    $stagingParent = Split-Path -Parent $installed
    $existingStages = @(Get-ChildItem -LiteralPath $stagingParent -Force -Directory | ForEach-Object FullName)
    # Exercise the shipped extractor, not the framework's unrestricted extractor.
    RunChecked (Join-Path $installed 'WorkspaceObservatory.exe') ('--test-update-extraction "' + $archive + '" "' + $stagingParent + '"')
    $staged = @(Get-ChildItem -LiteralPath $stagingParent -Force -Directory |
        Where-Object { $_.FullName -notin $existingStages })
    if ($staged.Count -ne 1 -or -not $staged[0].PSIsContainer -or $staged[0].Name -notmatch '^\.observatory-stage-[a-f0-9]{32}$') {
        throw 'Expected exactly one native extractor staging directory.'
    }
    $expanded = $staged[0].FullName
    $roundtrip = Join-Path $output 'roundtrip-request'
    & $node (Join-Path $PSScriptRoot 'prepare-installation-receipt.mjs') $expanded $buildPath $roundtrip
    if ($LASTEXITCODE -ne 0) { throw 'Update archive roundtrip failed inventory verification.' }
    foreach ($name in @('installation-receipt.json', 'installation-receipt.signing-bytes')) {
        if ((Get-FileHash -LiteralPath (Join-Path $request $name)).Hash -ne (Get-FileHash -LiteralPath (Join-Path $roundtrip $name)).Hash) {
            throw 'Update archive changed the signed installation identity.'
        }
    }
    RunChecked (Join-Path $expanded 'WorkspaceObservatory.exe') '--self-test'
    if (Test-Path -LiteralPath $data) { throw 'Staging unexpectedly created live collection data.' }
    # No source configuration exists. Exercise the full update and normal UI
    # without allowing collection or touching any account or paired device.
    New-Item -ItemType Directory -Path $data | Out-Null
    [IO.File]::WriteAllText((Join-Path $data 'setup-state.json'), '{"version":1,"completed":true}')
    & $node (Join-Path $PSScriptRoot 'check-update-install.mjs') $installed $expanded (Join-Path $request 'installation-receipt.json') $output
    if ($LASTEXITCODE -ne 0) { throw 'Complete update and relaunch verification failed.' }
    $dataFiles = @(Get-ChildItem -LiteralPath $data -Recurse -File)
    # The update publishes its authenticated receipt before relaunch. The Node
    # integration check verifies its exact bytes and signature above.
    $expectedData = @((Join-Path $data 'setup-state.json'), (Join-Path $data 'updates\installed-envelope.json'))
    if ($dataFiles.Count -ne $expectedData.Count -or @($dataFiles | Where-Object { $_.FullName -notin $expectedData }).Count -ne 0) {
        throw 'Update test wrote unexpected data.'
    }
    if ((Get-Content -LiteralPath (Join-Path $data 'setup-state.json') -Raw) -cne '{"version":1,"completed":true}') {
        throw 'Update test changed setup state.'
    }
    Remove-Item -LiteralPath $data -Recurse -Force
    Write-Output ('PASS: actual installer receipt, bounded native archive roundtrip and expanded native contracts. Archive bytes: ' + (Get-Item -LiteralPath $archive).Length)
} finally {
    $uninstaller = Join-Path $output 'cleanup-uninstaller.exe'
    Copy-Item -LiteralPath (Join-Path $installed 'Uninstall.exe') -Destination $uninstaller
    RunChecked $uninstaller ('/S _?=' + $installed)
}
if ((Test-Path -LiteralPath $installed) -or (Test-Path -LiteralPath $data) -or (Test-Path -LiteralPath $shortcuts) -or (Test-Path $registration)) {
    throw 'Staging test did not leave a clean runner.'
}
Write-Output 'PASS: disposable ordinary installation removed. No release signed or published.'
