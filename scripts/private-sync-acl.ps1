param([Parameter(Mandatory=$true)][string]$Directory, [switch]$Initialize, [switch]$Diagnostic)
$ErrorActionPreference = 'Stop'
$stage = 'validate-input'
try {
    $leaf = [IO.Path]::GetFileName($Directory)
    if (-not [IO.Path]::IsPathRooted($Directory) -or
        ($leaf -notin @('private-sync', 'private-codex', 'private-repair', 'private-quota', 'private-device-identity') -and $leaf -cnotmatch '^private-sync-retired-[a-f0-9]{64}$')) { throw 'Invalid directory' }
    $userSid = [Security.Principal.WindowsIdentity]::GetCurrent().User
    $allowed = @($userSid.Value, 'S-1-5-18', 'S-1-5-32-544')
    if ($Initialize) {
        $stage = 'initialize-security'
        if (Test-Path -LiteralPath $Directory) { throw 'Existing directory requires verification' }
        $security = New-Object Security.AccessControl.DirectorySecurity
        $security.SetOwner($userSid)
        $security.SetAccessRuleProtection($true, $false)
        foreach ($sid in $allowed) {
            $identity = New-Object Security.Principal.SecurityIdentifier($sid)
            $rule = New-Object Security.AccessControl.FileSystemAccessRule($identity, 'FullControl', 'ContainerInherit, ObjectInherit', 'None', 'Allow')
            $security.AddAccessRule($rule)
        }
        $stage = 'create-directory'
        [IO.Directory]::CreateDirectory($Directory, $security) | Out-Null
    }
    $stage = 'inspect-directory'
    $root = Get-Item -LiteralPath $Directory -Force
    if (-not $root.PSIsContainer -or ($root.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Unsafe directory' }
    $children = @(Get-ChildItem -LiteralPath $Directory -Force)
    if ($children.Count -gt 10) { throw 'Unexpected private state entries' }
    foreach ($item in @($root) + $children) {
        if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -or ($item.FullName -ne $root.FullName -and $item.PSIsContainer)) { throw 'Unsafe private state entry' }
        $stage = 'read-acl'
        $acl = Get-Acl -LiteralPath $item.FullName
        $stage = 'verify-owner'
        if ($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -notin $allowed) { throw 'Unexpected owner' }
        $stage = 'verify-inheritance'
        if ($item.FullName -eq $root.FullName -and -not $acl.AreAccessRulesProtected) { throw 'Inherited directory permissions' }
        $rules = @($acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]))
        $userAccess = $false
        if ($rules.Count -eq 0) { throw 'Empty access rules' }
        foreach ($rule in $rules) {
            $stage = 'verify-rules'
            if ($rule.IdentityReference.Value -notin $allowed -or $rule.AccessControlType -ne 'Allow' -or
                $rule.PropagationFlags -ne 'None' -or $rule.FileSystemRights -ne 'FullControl') { throw 'Unexpected access rule' }
            if ($item.FullName -eq $root.FullName -and $rule.InheritanceFlags -ne 'ContainerInherit, ObjectInherit') { throw 'Missing child protection' }
            if ($rule.IdentityReference.Value -eq $userSid.Value) { $userAccess = $true }
        }
        $stage = 'verify-current-account'
        if (-not $userAccess) { throw 'Current account access missing' }
    }
    Write-Output 'private-sync-acl: ok'
} catch {
    [Console]::Error.WriteLine('Private sync access-control verification failed')
    if ($Diagnostic) { [Console]::Error.WriteLine('Verification stage: ' + $stage) }
    # A concurrent SQLite transaction can remove its journal during inspection.
    # Signal a full reinspection, never accept an unchecked child or root.
    if ($stage -eq 'read-acl' -and $item.FullName -ne $root.FullName -and
        $_.Exception -is [System.Management.Automation.ItemNotFoundException]) { exit 2 }
    exit 1
}
