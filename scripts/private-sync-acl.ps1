param([Parameter(Mandatory=$true)][string]$Directory, [switch]$Initialize, [switch]$Ancestor, [switch]$Diagnostic)
$ErrorActionPreference = 'Stop'
$stage = 'validate-input'
function Assert-KnownDacl($acl, [switch]$AllowGenericRights) {
    # GetAccessRules omits ACE types it cannot represent. Inspect the complete
    # binary DACL first so callbacks, object ACEs and unknown masks fail closed.
    $raw = New-Object Security.AccessControl.RawSecurityDescriptor($acl.GetSecurityDescriptorBinaryForm(), 0)
    if (-not ($raw.ControlFlags -band [Security.AccessControl.ControlFlags]::DiscretionaryAclPresent) -or
        $null -eq $raw.DiscretionaryAcl -or $raw.DiscretionaryAcl.Count -eq 0) { throw 'Missing access rules' }
    # Windows retains generic rights in inherit-only ACEs on containers.
    # Ancestry maps effective generic grants below. Private leaves stay exact.
    # https://learn.microsoft.com/en-us/windows/win32/secauthz/ace-inheritance-rules
    $knownMask = if ($AllowGenericRights) { 0xf01f01ff } else { 0x001f01ff }
    foreach ($ace in $raw.DiscretionaryAcl) {
        if ($ace -isnot [Security.AccessControl.CommonAce] -or $ace.IsCallback -or
            $ace.AceType -notin @([Security.AccessControl.AceType]::AccessAllowed, [Security.AccessControl.AceType]::AccessDenied) -or
            ([int]$ace.AceFlags -band (-bnot 0x1f)) -ne 0 -or
            ($ace.AccessMask -band (-bnot $knownMask)) -ne 0) { throw 'Unknown access rule' }
    }
}
try {
    $leaf = [IO.Path]::GetFileName($Directory)
    if ($Directory -cnotmatch '^[A-Za-z]:\\' -or [IO.Path]::GetFullPath($Directory) -ne $Directory -or
        ($Initialize -and $Ancestor) -or
        (-not $Ancestor -and $leaf -notin @('private-sync', 'private-codex', 'private-repair', 'private-quota', 'private-device-identity') -and $leaf -cnotmatch '^private-sync-retired-[a-f0-9]{64}$')) { throw 'Invalid directory' }
    $userSid = [Security.Principal.WindowsIdentity]::GetCurrent().User
    $allowed = @($userSid.Value, 'S-1-5-18', 'S-1-5-32-544')
    # TrustedInstaller is the Windows Modules Installer's OS-resource owner.
    # It is trusted for ancestry only, never as a private-state account.
    # https://learn.microsoft.com/en-us/windows/win32/wfp/about-windows-file-protection
    $ancestorOwners = $allowed + @('S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464')
    $stage = 'inspect-ancestry'
    $current = if ($Initialize) { [IO.Path]::GetDirectoryName($Directory) } else { $Directory }
    while ($current) {
        $ancestorItem = Get-Item -LiteralPath $current -Force
        if (-not $ancestorItem.PSIsContainer -or ($ancestorItem.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Unsafe ancestor' }
        $ancestorAcl = Get-Acl -LiteralPath $current
        Assert-KnownDacl $ancestorAcl -AllowGenericRights
        $ancestorOwner = $ancestorAcl.GetOwner([Security.Principal.SecurityIdentifier]).Value
        if ($ancestorOwner -notin $ancestorOwners) { throw 'Unexpected ancestor owner' }
        foreach ($rule in @($ancestorAcl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]))) {
            # OWNER RIGHTS names this object's already validated owner. Resolve
            # it here only, never as a trusted owner or a private-leaf account.
            # https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-dtyp/81d92bba-d22b-4a8c-908a-554ab29148ab
            $principal = $rule.IdentityReference.Value
            if ($principal -eq 'S-1-3-4') { $principal = $ancestorOwner }
            # Inherit-only ACEs do not authorize this directory. Each existing
            # child is inspected separately, including its effective inherited ACEs.
            if (($rule.PropagationFlags -band [Security.AccessControl.PropagationFlags]::InheritOnly) -or
                $rule.AccessControlType -eq 'Deny' -or $principal -in $ancestorOwners) { continue }
            # DELETE on the child and DELETE_CHILD on its parent independently
            # permit replacement. Also reject changes to ACL/owner/attributes/EA.
            # CreateFiles/CreateDirectories alone permit unrelated new entries,
            # not replacement of the protected path. Do not reject those rights.
            # https://learn.microsoft.com/en-us/windows/win32/fileio/file-access-rights-constants
            # Map file/directory generic rights before checking mutation rights.
            # The raw-DACL check already rejected every unrecognized mask bit.
            # https://learn.microsoft.com/en-us/windows/win32/fileio/file-security-and-access-rights
            $mask = [int]$rule.FileSystemRights
            $rights = $mask -band 0x001f01ff
            if ($mask -band 0x80000000) { $rights = $rights -bor 0x00120089 } # GENERIC_READ
            if ($mask -band 0x40000000) { $rights = $rights -bor 0x00120116 } # GENERIC_WRITE
            if ($mask -band 0x20000000) { $rights = $rights -bor 0x001200a0 } # GENERIC_EXECUTE
            if ($mask -band 0x10000000) { $rights = $rights -bor 0x001f01ff } # GENERIC_ALL
            if (($rights -band 0x000d0150) -ne 0) { throw 'Mutable ancestor' }
        }
        $parent = [IO.Path]::GetDirectoryName($current)
        if ($parent -eq $current) { throw 'Invalid ancestry' }
        $current = $parent
    }
    if ($Ancestor) { Write-Output 'private-sync-acl: ok'; exit 0 }
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
        Assert-KnownDacl $acl
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
