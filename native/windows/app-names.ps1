$script:AppNamesPath = Join-Path $PSScriptRoot '..\app-names.json'
function Read-AppNames {
    try {
        $names = Get-Content -LiteralPath $script:AppNamesPath -Raw | ConvertFrom-Json
        if ($names.schema -ne 1) { throw 'Invalid app names' }
        foreach ($group in @('visible','legacy','internal')) {
            $keys = switch ($group) {
                'visible' { @('productName','dataFolder','windowsTestName') }
                'legacy' { @('productName','dataFolder') }
                'internal' { @('windowsExecutable','windowsAppId','windowsStartupName','windowsPackageFolder') }
            }
            foreach ($key in $keys) {
                $value = $names.$group.$key
                if ($value -isnot [string] -or [string]::IsNullOrWhiteSpace($value) -or $value -cnotmatch '\A[A-Za-z0-9 .-]+\z') {
                    throw 'Invalid app names'
                }
            }
        }
        return $names
    } catch { throw 'Invalid app names' }
}
