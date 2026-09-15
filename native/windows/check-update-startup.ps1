param([Parameter(Mandatory=$true)][string]$Executable)
$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted') {
    Write-Host 'SKIP: normal update startup requires a disposable hosted Windows runner.'
    return
}
if (-not [IO.Path]::IsPathFullyQualified($Executable) -or -not (Test-Path -LiteralPath $Executable -PathType Leaf)) { throw 'Package executable required.' }
$runtime = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'Workspace Observatory'
if (Test-Path -LiteralPath $runtime) { throw 'Refusing startup test with existing application data.' }
$existing = $null
if ([Threading.Mutex]::TryOpenExisting('Local\WorkspaceObservatory', [ref]$existing)) {
    $existing.Dispose()
    throw 'Refusing startup test with an existing application.'
}
$name = 'Local\Observatory.UpdateReady.' + [Guid]::NewGuid().ToString('N')
$ready = [Threading.EventWaitHandle]::new($false, [Threading.EventResetMode]::ManualReset, $name)
$child = $null
$passed = $false
try {
    New-Item -ItemType Directory -Path $runtime | Out-Null
    # Completed setup without any source configuration keeps collection disabled.
    [IO.File]::WriteAllText((Join-Path $runtime 'setup-state.json'), '{"version":1,"completed":true}')
    $start = [Diagnostics.ProcessStartInfo]::new($Executable)
    $start.UseShellExecute = $false
    $start.WorkingDirectory = Split-Path -Parent $Executable
    $start.ArgumentList.Add('--update-ready')
    $start.ArgumentList.Add($name)
    $child = [Diagnostics.Process]::Start($start)
    if (-not $ready.WaitOne(30000) -or $child.HasExited) { throw 'Normal application did not acknowledge its event loop.' }
    $quit = [Threading.EventWaitHandle]::OpenExisting('Local\WorkspaceObservatory.QuitForUpdate')
    try { $quit.Set() | Out-Null } finally { $quit.Dispose() }
    if (-not $child.WaitForExit(15000) -or $child.ExitCode -ne 0) { throw 'Normal update quit did not complete.' }
    $files = @(Get-ChildItem -LiteralPath $runtime -Recurse -File)
    if ($files.Count -ne 1 -or $files[0].Name -ne 'setup-state.json') { throw 'Startup wrote unexpected data. Retaining fixture for inspection.' }
    $passed = $true
    Write-Host 'PASS: normal packaged startup acknowledges readiness and exits gracefully without collection or source configuration.'
} finally {
    $ready.Dispose()
    if ($null -ne $child) {
        # Only this test-owned process on a disposable runner may be terminated.
        if (-not $child.HasExited) { $child.Kill($true); $child.WaitForExit() }
        $child.Dispose()
    }
    if ($passed) { Remove-Item -LiteralPath $runtime -Recurse -Force }
}
