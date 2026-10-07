param([Parameter(Mandatory=$true)][string]$InstallerPath)
$ErrorActionPreference = 'Stop'
if (-not [IO.Path]::IsPathRooted($InstallerPath)) { throw 'Absolute installer path required.' }
$build = Get-Content (Join-Path (Split-Path $InstallerPath) 'installer-build.json') -Raw | ConvertFrom-Json
if (-not $build.testIdentity -or [IO.Path]::GetFileName($InstallerPath) -ne $build.installerName) { throw 'Only a generated TEST-identity installer may be used.' }
$expectedHash = (Get-Content -LiteralPath "$InstallerPath.sha256" -Raw).Split(' ')[0]
if ((Get-FileHash -LiteralPath $InstallerPath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expectedHash) { throw 'Installer checksum mismatch.' }
$appName = 'Workspace Observatory Installer Test'
$install = Join-Path $env:LOCALAPPDATA "Programs\$appName"
$shortcuts = Join-Path ([Environment]::GetFolderPath('Programs')) $appName
$keyName = 'Software\Microsoft\Windows\CurrentVersion\Uninstall\WorkspaceObservatoryInstallerTest'
$runName = 'Software\Microsoft\Windows\CurrentVersion\Run'
$startupName = 'WorkspaceObservatoryInstallerTest'
$registry = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::CurrentUser, [Microsoft.Win32.RegistryView]::Registry64)
$existing = $registry.OpenSubKey($keyName)
if ($existing) { $existing.Dispose(); throw 'Test registration already exists. Inspect it before another run.' }
$run = $registry.CreateSubKey($runName)
if ($null -ne $run.GetValue($startupName)) { $run.Dispose(); throw 'Test startup registration already exists.' }
if ((Test-Path -LiteralPath $install) -or (Test-Path -LiteralPath $shortcuts)) { throw 'Test install or shortcut folder already exists. Inspect it first.' }
$work = Join-Path $env:LOCALAPPDATA ('WorkspaceObservatoryBuild\installer-test-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $work | Out-Null
$data = Join-Path $env:LOCALAPPDATA $appName
$createdData = -not (Test-Path -LiteralPath $data)
if ($createdData) { New-Item -ItemType Directory -Path $data | Out-Null }
if ((Get-Item -LiteralPath $data).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Do not test through a linked saved-data directory.' }
$canary = Join-Path $data ('installer-test-' + [guid]::NewGuid().ToString('N') + '.txt')
[IO.File]::WriteAllText($canary, 'Synthetic installer preservation check.')
$canaryHash = (Get-FileHash -LiteralPath $canary -Algorithm SHA256).Hash

function Invoke-CheckedProcess([string]$Executable, [string]$Arguments, [int]$Expected = 0) {
    $process = New-Object System.Diagnostics.Process
    $process.StartInfo.FileName = $Executable
    $process.StartInfo.Arguments = $Arguments
    $process.StartInfo.UseShellExecute = $false
    $process.StartInfo.CreateNoWindow = $true
    try {
        $process.Start() | Out-Null
        if (-not $process.WaitForExit(45000)) { $process.Kill(); throw 'Owned installer test process timed out.' }
        if ($process.ExitCode -ne $Expected) { throw "Installer test process returned $($process.ExitCode), expected $Expected." }
    } finally { $process.Dispose() }
}
function Check([bool]$Condition, [string]$Message) { if (-not $Condition) { throw $Message } }
function Check-Payload {
    $manifest = Get-Content (Join-Path $install 'package-manifest.json') -Raw | ConvertFrom-Json
    foreach ($file in $manifest.files) {
        $target = Join-Path $install $file.path
        Check ((Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant() -eq $file.sha256) 'Installed payload checksum mismatch.'
    }
}
function Invoke-TestUninstall([int]$Expected = 0) {
    # NSIS documents _?= for an already copied uninstaller. It allows us to wait
    # for the real uninstall, not only the parent process that copies itself.
    $copy = Join-Path $work ('uninstall-' + [guid]::NewGuid().ToString('N') + '.exe')
    Copy-Item -LiteralPath (Join-Path $install 'Uninstall.exe') -Destination $copy
    Invoke-CheckedProcess $copy ("/S _?=$install") $Expected
}

try {
    # The TEST singleton is distinct from both ordinary IPC and the setup lock.
    $first = $false
    $mutex = New-Object System.Threading.Mutex($true, 'Local\WorkspaceObservatoryInstallerTest.App', [ref]$first)
    try {
        Check $first 'An Observatory app is already running in this test session.'
        Invoke-CheckedProcess $InstallerPath '/S' 10
        Check (-not (Test-Path -LiteralPath $install)) 'Running-app refusal created an install folder.'
    } finally { if ($first) { $mutex.ReleaseMutex() }; $mutex.Dispose() }
    Write-Output 'PASS: running-app refusal'

    Invoke-CheckedProcess $InstallerPath '/S'
    Check-Payload
    $key = $registry.OpenSubKey($keyName, $true)
    try {
        Check ($key.GetValue('InstallLocation') -eq $install) 'Incorrect install registration.'
        Check ($key.GetValue('UninstallString') -eq ('"' + $install + '\Uninstall.exe"')) 'Uninstaller command is not correctly quoted.'
        $key.SetValue('UnrelatedTestValue', 'preserve')
    } finally { $key.Dispose() }
    Check ($null -eq $run.GetValue($startupName)) 'Installer opted into login startup.'
    $shell = New-Object -ComObject WScript.Shell
    $link = $shell.CreateShortcut((Join-Path $shortcuts "$appName.lnk"))
    Check ($link.TargetPath -eq (Join-Path $install 'WorkspaceObservatory.exe')) 'Incorrect Start menu shortcut.'
    [Runtime.InteropServices.Marshal]::ReleaseComObject($link) | Out-Null
    [Runtime.InteropServices.Marshal]::ReleaseComObject($shell) | Out-Null
    Invoke-CheckedProcess (Join-Path $install 'WorkspaceObservatory.exe') '--self-test'
    Write-Output 'PASS: per-user install, all payload hashes, shortcut, quoted registration and native self-tests'

    Invoke-CheckedProcess $InstallerPath '/S' 14
    Check-Payload
    Write-Output 'PASS: existing-install overwrite refused'

    # A replaced payload directory must be rejected before any file is removed.
    $runtime = Join-Path $install 'Runtime'
    $held = Join-Path $install 'Runtime-test-held'
    $outside = Join-Path $work 'unrelated-target'
    New-Item -ItemType Directory -Path $outside | Out-Null
    [IO.File]::WriteAllText((Join-Path $outside 'node.exe'), 'Synthetic unrelated file.')
    Move-Item -LiteralPath $runtime -Destination $held
    New-Item -ItemType Junction -Path $runtime -Target $outside | Out-Null
    Invoke-TestUninstall 12
    Check ((Get-Content (Join-Path $outside 'node.exe') -Raw) -eq 'Synthetic unrelated file.') 'Linked target was changed.'
    Check ((Get-Item -LiteralPath $runtime).Attributes -band [IO.FileAttributes]::ReparsePoint) 'Expected test junction is missing.'
    [IO.Directory]::Delete($runtime, $false)
    Move-Item -LiteralPath $held -Destination $runtime
    Check-Payload
    Write-Output 'PASS: linked payload directory rejected without deleting its target'

    [IO.File]::WriteAllText((Join-Path $install 'unrelated-test.txt'), 'preserve')
    [IO.File]::WriteAllText((Join-Path $shortcuts 'unrelated-test.txt'), 'preserve')
    $run.SetValue($startupName, ('"' + $install + '\WorkspaceObservatory.exe" --background'))
    Invoke-TestUninstall
    Check (-not (Test-Path (Join-Path $install 'WorkspaceObservatory.exe'))) 'Application executable remains.'
    Check ((Get-ChildItem -LiteralPath $install -Force).Count -eq 1) 'Unexpected files remain after uninstall.'
    Check ((Get-Content (Join-Path $install 'unrelated-test.txt') -Raw) -eq 'preserve') 'Unrelated install file was removed.'
    Check ((Get-Content (Join-Path $shortcuts 'unrelated-test.txt') -Raw) -eq 'preserve') 'Unrelated shortcut-folder file was removed.'
    Check ($null -eq $run.GetValue($startupName)) 'Owned login startup registration remains.'
    $key = $registry.OpenSubKey($keyName, $true)
    try {
        Check ($key.GetValue('UnrelatedTestValue') -eq 'preserve') 'Unrelated registration value was removed.'
        Check ($null -eq $key.GetValue('UninstallString')) 'Owned uninstall registration remains.'
        $key.DeleteValue('UnrelatedTestValue')
    } finally { $key.Dispose() }
    Check ((Get-FileHash -LiteralPath $canary -Algorithm SHA256).Hash -eq $canaryHash) 'Saved-data canary changed.'
    Write-Output 'PASS: uninstall preserves saved data and unrelated files/registry values; removes owned startup'

    # Remove only this test's exact sentinels and now-empty test containers.
    Remove-Item -LiteralPath (Join-Path $install 'unrelated-test.txt')
    [IO.Directory]::Delete($install, $false)
    Remove-Item -LiteralPath (Join-Path $shortcuts 'unrelated-test.txt')
    [IO.Directory]::Delete($shortcuts, $false)
    $registry.DeleteSubKey($keyName, $false)
    Invoke-CheckedProcess $InstallerPath '/S'
    $run.SetValue($startupName, 'another test installation')
    Invoke-TestUninstall
    Check ($run.GetValue($startupName) -eq 'another test installation') 'Unrelated startup value was removed.'
    $run.DeleteValue($startupName)
    Check (-not (Test-Path -LiteralPath $install)) 'Empty reinstall folder remains.'
    Check (-not (Test-Path -LiteralPath $shortcuts)) 'Empty shortcut folder remains.'
    Write-Output 'PASS: reinstall/uninstall and preservation of another startup owner'
    Write-Output 'Installer integration checks passed. No ordinary app registration was modified.'
} finally {
    $run.Dispose(); $registry.Dispose()
    if ((Test-Path -LiteralPath $canary) -and (Get-FileHash -LiteralPath $canary -Algorithm SHA256).Hash -eq $canaryHash) {
        Remove-Item -LiteralPath $canary
        if ($createdData -and -not (Get-ChildItem -LiteralPath $data -Force)) { [IO.Directory]::Delete($data, $false) }
    }
}
