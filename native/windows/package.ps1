param(
    [string]$Dotnet = 'dotnet',
    [string]$BuildPython = (Join-Path $env:SystemRoot 'py.exe'),
    [string]$CacheRoot = (Join-Path $env:LOCALAPPDATA 'WorkspaceObservatoryBuild\cache'),
    [switch]$SkipWebBuild
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'runtime-assets.ps1')
$sourceRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$assets = Get-Content (Join-Path $PSScriptRoot 'runtime-assets.json') -Raw | ConvertFrom-Json
if (-not $SkipWebBuild) { & (Join-Path $PSScriptRoot 'build.ps1') -Dotnet $Dotnet -CacheRoot $CacheRoot }
if (-not (Test-Path (Join-Path $sourceRoot '.native-build\web\index.html'))) { throw 'Build the dashboard first.' }
if (Test-Path (Join-Path $sourceRoot '.native-build\web\local')) { throw 'Private snapshots must never enter a package.' }

$nodeArchive = Get-ObservatoryArchive -Name node -CacheRoot $CacheRoot
$pythonArchive = Get-ObservatoryArchive -Name python -CacheRoot $CacheRoot
$pythonFullArchive = Get-ObservatoryArchive -Name pythonFull -CacheRoot $CacheRoot
$timezoneArchive = Get-ObservatoryArchive -Name tzdata -CacheRoot $CacheRoot
$candidateName = 'candidate-' + [guid]::NewGuid().ToString('N')
$candidate = Join-Path $PSScriptRoot "release\$candidateName"
$app = Join-Path $candidate 'Workspace Observatory'
New-Item -ItemType Directory -Path $app -Force | Out-Null
$priorTelemetry = $env:DOTNET_CLI_TELEMETRY_OPTOUT
$priorCertificateOption = $env:DOTNET_GENERATE_ASPNET_CERTIFICATE
Push-Location $sourceRoot
try {
    $env:DOTNET_CLI_TELEMETRY_OPTOUT = '1'
    $env:DOTNET_GENERATE_ASPNET_CERTIFICATE = 'false'
    & $Dotnet publish native/windows/WorkspaceObservatory.csproj -c Release -r win-x64 --self-contained true -p:RestoreLockedMode=true -o $app
    if ($LASTEXITCODE -ne 0) { throw 'Self-contained Windows publish failed.' }
    $runtime = Join-Path $app 'Runtime'
    $notices = Join-Path $app 'Licenses'
    New-Item -ItemType Directory -Path $runtime, $notices -Force | Out-Null
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $nodeZip = [IO.Compression.ZipFile]::OpenRead($nodeArchive)
    try {
        $nodeFolder = "node-v$($assets.node.version)-win-x64"
        [IO.Compression.ZipFileExtensions]::ExtractToFile($nodeZip.GetEntry("$nodeFolder/node.exe"), (Join-Path $runtime 'node.exe'))
        [IO.Compression.ZipFileExtensions]::ExtractToFile($nodeZip.GetEntry("$nodeFolder/LICENSE"), (Join-Path $notices 'Node-LICENSE.txt'))
    } finally { $nodeZip.Dispose() }
    $python = Join-Path $runtime 'python'
    $pythonBuilder = @('-B', (Join-Path $PSScriptRoot 'prepare-python.py'), '--cache', $CacheRoot, '--output', $python, '--assets', (Join-Path $PSScriptRoot 'runtime-assets.json'))
    if ([IO.Path]::GetFileName($BuildPython) -ieq 'py.exe') { $pythonBuilder = @('-3') + $pythonBuilder }
    & $BuildPython @pythonBuilder
    if ($LASTEXITCODE -ne 0) { throw 'Verified Python runtime preparation failed.' }
    Copy-Item -LiteralPath (Join-Path $python 'LICENSE.txt') -Destination (Join-Path $notices 'Python-LICENSE.txt')
    Copy-Item -LiteralPath (Join-Path $python 'licenses') -Destination (Join-Path $notices 'Python-dependencies') -Recurse
    Copy-Item -LiteralPath (Join-Path $sourceRoot 'LICENSE') -Destination $app
    Copy-Item -LiteralPath (Join-Path $sourceRoot 'THIRD-PARTY-NOTICES.md') -Destination $app
    Copy-Item -LiteralPath (Join-Path $app 'Web\assets\third-party-licenses.txt') -Destination (Join-Path $notices 'Dashboard-LICENSES.txt')
    Copy-Item -LiteralPath (Join-Path $python "tzdata-$($assets.tzdata.version).dist-info\licenses") -Destination (Join-Path $notices 'tzdata') -Recurse
    $packageFolders = (Get-Content (Join-Path $PSScriptRoot 'obj\project.assets.json') -Raw | ConvertFrom-Json).packageFolders.PSObject.Properties.Name
    [xml]$project = Get-Content (Join-Path $PSScriptRoot 'WorkspaceObservatory.csproj') -Raw
    $frameworkVersion = $project.SelectSingleNode('/Project/PropertyGroup/RuntimeFrameworkVersion').InnerText.Trim()
    $webviewVersion = $project.SelectSingleNode("/Project/ItemGroup/PackageReference[@Include='Microsoft.Web.WebView2']").GetAttribute('Version')
    $noticePackages = @(
        @{ id='Microsoft.NETCore.App.Runtime.win-x64'; version=$frameworkVersion; files=@('LICENSE.TXT','THIRD-PARTY-NOTICES.TXT') },
        @{ id='Microsoft.WindowsDesktop.App.Runtime.win-x64'; version=$frameworkVersion; files=@('LICENSE') },
        @{ id='Microsoft.Web.WebView2'; version=$webviewVersion; files=@('LICENSE.txt','NOTICE.txt') }
    )
    foreach ($package in $noticePackages) {
        foreach ($name in $package.files) {
            $found = $null
            foreach ($folder in $packageFolders) {
                $file = Join-Path $folder "$($package.id.ToLowerInvariant())\$($package.version)\$name"
                if (Test-Path -LiteralPath $file) { $found = $file; break }
            }
            if (-not $found) { throw "Missing package notice for $($package.id)." }
            Copy-Item -LiteralPath $found -Destination (Join-Path $notices "$($package.id)-$name")
        }
    }
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'runtime-assets.json') -Destination $app
    if (Test-Path (Join-Path $app 'Web\local')) { throw 'Private web data detected.' }
    if (Get-ChildItem -LiteralPath $app -Recurse -File | Where-Object { $_.Name -in @('usage.json', 'collector.json', 'collector.config.json', 'local.config.json', '.env') }) {
        throw 'Private runtime configuration or snapshots detected.'
    }
    & (Join-Path $runtime 'node.exe') (Join-Path $PSScriptRoot 'check-update-verifier.mjs') (Join-Path $app 'WorkspaceObservatory.exe')
    if ($LASTEXITCODE -ne 0) { throw 'Packaged native update verifier failed.' }
    & (Join-Path $PSScriptRoot 'check-update-startup.ps1') -Executable (Join-Path $app 'WorkspaceObservatory.exe')
    foreach ($testArgument in @('--self-test', '--test-sharing-bridge', '--test-archive-bridge', '--test-trusted-sync-owner')) {
    $nativeTest = New-Object System.Diagnostics.Process
    $nativeTest.StartInfo.FileName = Join-Path $app 'WorkspaceObservatory.exe'
    $nativeTest.StartInfo.Arguments = $testArgument
    if ($testArgument -eq '--test-trusted-sync-owner') {
        $nativeTest.StartInfo.Arguments += ' "' + (Join-Path $runtime 'node.exe') + '"'
    }
    $nativeTest.StartInfo.UseShellExecute = $false
    $nativeTest.StartInfo.CreateNoWindow = $true
    $nativeTest.StartInfo.RedirectStandardOutput = $true
    $nativeTest.StartInfo.RedirectStandardError = $true
    try {
        $nativeTest.Start() | Out-Null
        $testOutput = $nativeTest.StandardOutput.ReadToEndAsync()
        $testError = $nativeTest.StandardError.ReadToEndAsync()
        if (-not $nativeTest.WaitForExit(60000)) { $nativeTest.Kill(); throw 'Packaged native tests timed out.' }
        if ($nativeTest.ExitCode -ne 0) { throw 'Packaged native tests failed.' }
        Write-Output $testOutput.GetAwaiter().GetResult()
        $testError.GetAwaiter().GetResult() | Out-Null
    } finally { $nativeTest.Dispose() }
    }
    & (Join-Path $python 'python.exe') -B -X utf8 -c "import sqlite3, zoneinfo, sys; assert sys.flags.isolated; assert sys.dont_write_bytecode; assert zoneinfo.ZoneInfo('America/New_York'); print('Packaged Python SQLite and timezone checks passed')"
    if ($LASTEXITCODE -ne 0) { throw 'Packaged Python check failed.' }
    & (Join-Path $runtime 'node.exe') --version
    if ($LASTEXITCODE -ne 0) { throw 'Packaged Node check failed.' }
    & (Join-Path $runtime 'node.exe') (Join-Path $PSScriptRoot 'inspect-package.mjs') $app
    if ($LASTEXITCODE -ne 0) { throw 'Package content verification failed.' }
    & (Join-Path $runtime 'node.exe') (Join-Path $PSScriptRoot 'verify-manifest.mjs') $app --allow-dirty
    if ($LASTEXITCODE -ne 0) { throw 'Package manifest verification failed.' }
    Write-Output "Candidate prepared at $app"
    Write-Output 'Not a release yet. Complete license, packaged-collector and desktop checks before distributing.'
} finally {
    Pop-Location
    $env:DOTNET_CLI_TELEMETRY_OPTOUT = $priorTelemetry
    $env:DOTNET_GENERATE_ASPNET_CERTIFICATE = $priorCertificateOption
}
