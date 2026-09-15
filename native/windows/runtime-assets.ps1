function Get-ObservatoryArchive {
    param([string]$Name, [string]$CacheRoot)
    $asset = if ($Name -eq 'updater') {
        Get-Content (Join-Path $PSScriptRoot 'updater-tool.json') -Raw | ConvertFrom-Json
    } else {
        (Get-Content (Join-Path $PSScriptRoot 'runtime-assets.json') -Raw | ConvertFrom-Json).$Name
    }
    if (-not $asset -or $asset.filename -notmatch '^[A-Za-z0-9._+-]+$' -or $asset.sha256 -notmatch '^[a-f0-9]{64}$') {
        throw 'Invalid pinned runtime asset.'
    }
    $uri = [uri]$asset.url
    $astral = $uri.Host -eq 'github.com' -and $uri.AbsolutePath.StartsWith('/astral-sh/python-build-standalone/releases/download/')
    $updater = $Name -eq 'updater' -and $uri.Host -eq 'github.com' -and $uri.AbsolutePath.StartsWith('/vslavik/winsparkle/releases/download/')
    if ($uri.Scheme -ne 'https' -or (-not $astral -and -not $updater -and $uri.Host -notin @('nodejs.org', 'www.python.org', 'files.pythonhosted.org')) -or $uri.UserInfo) {
        throw 'Unexpected runtime download origin.'
    }
    if (-not [IO.Path]::IsPathRooted($CacheRoot)) { throw 'CacheRoot must be absolute.' }
    New-Item -ItemType Directory -Path $CacheRoot -Force | Out-Null
    $archive = Join-Path $CacheRoot $asset.filename
    if (-not (Test-Path -LiteralPath $archive)) {
        $partial = "$archive.$([guid]::NewGuid().ToString('N')).part"
        try {
            $ProgressPreference = 'SilentlyContinue'
            Invoke-WebRequest -UseBasicParsing $asset.url -OutFile $partial
            if ((Get-FileHash -LiteralPath $partial -Algorithm SHA256).Hash.ToLowerInvariant() -ne $asset.sha256) {
                throw 'Runtime archive checksum mismatch. No archive contents were executed.'
            }
            Move-Item -LiteralPath $partial -Destination $archive
        } finally {
            if (Test-Path -LiteralPath $partial) { Remove-Item -LiteralPath $partial }
        }
    }
    if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $asset.sha256) {
        throw 'Cached runtime checksum mismatch. Refusing to use it.'
    }
    return $archive
}
