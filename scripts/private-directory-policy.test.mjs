import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { windowsPowerShellEnvironment } from './windows-powershell.mjs';

const literal = (value) => "'" + value.replaceAll("'", "''") + "'";
const script = fileURLToPath(
  new URL('./private-sync-acl.ps1', import.meta.url),
);
const windows = { skip: process.platform !== 'win32' };
const scratch = mkdtempSync(path.join(tmpdir(), 'observatory-policy-'));
after(() => rmSync(scratch, { recursive: true, force: true }));

// All items and ACLs below are in memory. Never set permissions on OS objects.
function inspectWindows({
  change = '',
  ancestor = false,
  initialize = false,
  diagnostic = false,
} = {}) {
  const command = `& {
    $ErrorActionPreference='Stop'
    $user=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    $fixture=[IO.Path]::Combine(${literal(scratch)},'fixture')
    $directory=[IO.Path]::Combine($fixture,'owned','private-repair')
    $driveRoot=[IO.Path]::GetPathRoot($directory)
    $items=@{}; $acls=@{}; $modeledChildren=@(); $vanishedJournal=$null
    for($name=$directory;$name;$name=[IO.Path]::GetDirectoryName($name)) {
      $items[$name]=[pscustomobject]@{FullName=$name;PSIsContainer=$true;Attributes=[IO.FileAttributes]::Directory}
      $acl=New-Object Security.AccessControl.DirectorySecurity
      $acl.SetSecurityDescriptorSddlForm(('O:'+ $user +'G:SYD:P(A;OICI;FA;;;'+$user+')(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)'))
      $acls[$name]=$acl
    }
    ${change}
    function Get-Item { param([string]$LiteralPath,[switch]$Force)
      if(-not $items.ContainsKey($LiteralPath)) { throw 'Unmodeled path' }
      $items[$LiteralPath]
    }
    function Get-Acl { param([string]$LiteralPath)
      if(-not $acls.ContainsKey($LiteralPath)) { throw 'Unmodeled ACL' }
      if($LiteralPath -eq $vanishedJournal) { throw [System.Management.Automation.ItemNotFoundException]::new('Modeled vanished journal') }
      $acls[$LiteralPath]
    }
    function Get-ChildItem { param([string]$LiteralPath,[switch]$Force)
      if($LiteralPath -ne $directory) { throw 'Unmodeled enumeration' }
      $modeledChildren
    }
    function Set-Acl { throw 'Permission writes forbidden' }
    function New-Item { throw 'Filesystem writes forbidden' }
    function Test-Path { throw 'Initialization reached the creation gate' }
    & ${literal(script)} -Directory $directory ${ancestor ? '-Ancestor' : ''} ${initialize ? '-Initialize' : ''} ${initialize || diagnostic ? '-Diagnostic' : ''}
    exit $LASTEXITCODE
  }`;
  return spawnSync(
    path.join(
      process.env.SystemRoot || 'C:/Windows',
      'System32/WindowsPowerShell/v1.0/powershell.exe',
    ),
    ['-NoProfile', '-NonInteractive', '-Command', command],
    { encoding: 'utf8', timeout: 15000, env: windowsPowerShellEnvironment() },
  );
}
function refused(result, stage, status = 1) {
  assert.ifError(result.error);
  assert.equal(
    result.status,
    status,
    `stdout=${result.stdout}, stderr=${result.stderr}`,
  );
  assert.doesNotMatch(result.stdout, /private-sync-acl: ok/);
  assert.match(
    result.stderr,
    /Private sync access-control verification failed/,
  );
  if (stage)
    assert.match(result.stderr, new RegExp(`Verification stage: ${stage}`));
}
function accepted(result) {
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), 'private-sync-acl: ok');
}

test('Windows modeled target stays beneath owned scratch', windows, () => {
  accepted(
    inspectWindows({
      change: `if(-not $directory.StartsWith(${literal(scratch + path.sep)},[StringComparison]::OrdinalIgnoreCase)) { throw ('Modeled target outside owned scratch: '+$directory) }`,
    }),
  );
});

test(
  'Windows private leaf refuses a replaceable ancestor before authorizing bytes',
  windows,
  () => {
    refused(
      inspectWindows({
        change: `$acls[$fixture].SetSecurityDescriptorSddlForm(('O:'+ $user +'G:SYD:P(A;;0x40;;;WD)(A;OICI;FA;;;'+$user+')'))`,
      }),
    );
  },
);
test(
  'Windows safe owned ancestry retains the private-leaf control',
  windows,
  () => {
    accepted(inspectWindows());
  },
);

const ownerRightsAncestor = `$acls[$fixture].SetSecurityDescriptorSddlForm(('O:'+$user+'G:SYD:P(A;OICI;FA;;;S-1-3-4)(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)'))`;

const privateChild = `
    $file=[IO.Path]::Combine($directory,'modeled.sqlite-journal')
    $modeledChildren=@([pscustomobject]@{FullName=$file;PSIsContainer=$false;Attributes=[IO.FileAttributes]::Normal})
    $child=New-Object Security.AccessControl.FileSecurity
    $child.SetSecurityDescriptorSddlForm(('O:'+$user+'G:SYD:AI(A;ID;FA;;;'+$user+')(A;ID;FA;;;SY)(A;ID;FA;;;BA)'))
    $acls[$file]=$child
`;

test(
  'Windows private child accepts exact inherited current-account file grants',
  windows,
  () => {
    accepted(inspectWindows({ change: ownerRightsAncestor + privateChild }));
  },
);

for (const [name, change, stage] of [
  [
    'foreign owner',
    "$child.SetOwner([Security.Principal.SecurityIdentifier]'S-1-5-21-1-2-3-1000')",
    'verify-owner',
  ],
  [
    'OWNER RIGHTS as an owner identity',
    "$child.SetOwner([Security.Principal.SecurityIdentifier]'S-1-3-4')",
    'verify-owner',
  ],
  [
    'OWNER RIGHTS instead of the current-account grant',
    "$child.SetSecurityDescriptorSddlForm(('O:'+$user+'G:SYD:P(A;;FA;;;S-1-3-4)(A;;FA;;;SY)(A;;FA;;;BA)'))",
    'verify-rules',
  ],
  [
    'OWNER RIGHTS in addition to the current-account grant',
    "$child.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]'S-1-3-4','FullControl','Allow'))",
    'verify-rules',
  ],
  [
    'missing current-account grant',
    "$child.SetSecurityDescriptorSddlForm(('O:'+$user+'G:SYD:P(A;;FA;;;SY)(A;;FA;;;BA)'))",
    'verify-current-account',
  ],
  [
    'unknown OWNER RIGHTS mask',
    "$child.SetSecurityDescriptorSddlForm(('O:'+$user+'G:SYD:P(A;;0x200;;;S-1-3-4)(A;;FA;;;'+$user+')'))",
    'read-acl',
  ],
  [
    'generic instead of exact full control',
    "$child.SetSecurityDescriptorSddlForm(('O:'+$user+'G:SYD:P(A;;GA;;;'+$user+')'))",
    'read-acl',
  ],
  [
    'non-full current-account grant',
    "$child.SetSecurityDescriptorSddlForm(('O:'+$user+'G:SYD:P(A;;FR;;;'+$user+')(A;;FA;;;SY)(A;;FA;;;BA)'))",
    'verify-rules',
  ],
])
  test(`Windows private child refuses ${name}`, windows, () => {
    refused(
      inspectWindows({
        diagnostic: true,
        change: ownerRightsAncestor + privateChild + change,
      }),
      stage,
    );
  });

test(
  'Windows vanished private journal requests reinspection, never acceptance',
  windows,
  () => {
    refused(
      inspectWindows({
        diagnostic: true,
        change: ownerRightsAncestor + privateChild + '$vanishedJournal=$file',
      }),
      'read-acl',
      2,
    );
  },
);

// OWNER RIGHTS applies to the object's current owner, not an unrelated account.
// https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-dtyp/81d92bba-d22b-4a8c-908a-554ab29148ab
test(
  'Windows ancestry accepts the protected current-owner OWNER RIGHTS descriptor',
  windows,
  () => {
    accepted(
      inspectWindows({
        ancestor: true,
        change: `$directory=([IO.Path]::Combine($fixture,'owned'))
    $acl=$acls[$directory]
    $acl.SetSecurityDescriptorSddlForm(('O:'+$user+'G:SYD:P(A;OICI;FA;;;S-1-3-4)(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)'))
    $rules=@($acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]))
    if($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $user -or
       -not $acl.AreAccessRulesProtected -or $rules.Count -ne 3) { throw 'Unexpected modeled descriptor' }
    foreach($rule in $rules) {
      if($rule.IdentityReference.Value -notin @('S-1-3-4','S-1-5-18','S-1-5-32-544') -or
         $rule.AccessControlType -ne 'Allow' -or [int]$rule.FileSystemRights -ne 2032127 -or
         $rule.InheritanceFlags -ne 'ContainerInherit, ObjectInherit' -or
         $rule.PropagationFlags -ne 'None' -or $rule.IsInherited) { throw 'Unexpected modeled rule' }
    }`,
      }),
    );
  },
);

test(
  'Windows OWNER RIGHTS ancestry preserves exact private-leaf grants',
  windows,
  () => {
    accepted(inspectWindows({ change: ownerRightsAncestor }));
  },
);

test(
  'Windows OWNER RIGHTS initializer reaches only the inert creation gate',
  windows,
  () => {
    refused(
      inspectWindows({
        initialize: true,
        change: ownerRightsAncestor,
      }),
      'initialize-security',
    );
  },
);

for (const [name, owner] of [
  ['system', 'S-1-5-18'],
  ['administrators', 'S-1-5-32-544'],
  [
    'trusted installer',
    'S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464',
  ],
])
  test(
    `Windows OWNER RIGHTS resolves to the already trusted ${name} owner`,
    windows,
    () => {
      accepted(
        inspectWindows({
          change: `${ownerRightsAncestor}
    $acls[$fixture].SetOwner((New-Object Security.Principal.SecurityIdentifier('${owner}')))`,
        }),
      );
    },
  );

test(
  'Windows inherited effective OWNER RIGHTS resolves to this object owner',
  windows,
  () => {
    accepted(
      inspectWindows({
        change: `$acls[$fixture].SetSecurityDescriptorSddlForm('O:SYG:SYD:P(A;OICIID;FA;;;S-1-3-4)(A;;FA;;;SY)(A;;FA;;;BA)')`,
      }),
    );
  },
);

for (const [name, change] of [
  [
    'foreign owner',
    "$acl.SetOwner((New-Object Security.Principal.SecurityIdentifier('S-1-5-21-1-2-3-1000')))",
  ],
  [
    'OWNER RIGHTS as an owner identity',
    "$acl.SetOwner((New-Object Security.Principal.SecurityIdentifier('S-1-3-4')))",
  ],
  [
    'creator-owner effective full control',
    "$acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]'S-1-3-0','FullControl','Allow'))",
  ],
  [
    'foreign principal effective full control',
    "$acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]'S-1-5-21-1-2-3-1000','FullControl','Allow'))",
  ],
  [
    'everyone effective deletion',
    "$acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]'S-1-1-0','DeleteSubdirectoriesAndFiles','Allow'))",
  ],
  [
    'unknown OWNER RIGHTS mask',
    "$acl.SetSecurityDescriptorSddlForm(('O:'+$user+'G:SYD:P(A;;0x200;;;S-1-3-4)(A;;FA;;;SY)(A;;FA;;;BA)'))",
  ],
  [
    'unknown generic OWNER RIGHTS mask',
    "$acl.SetSecurityDescriptorSddlForm(('O:'+$user+'G:SYD:P(A;;0x10000200;;;S-1-3-4)(A;;FA;;;SY)(A;;FA;;;BA)'))",
  ],
  [
    'OWNER RIGHTS deny with another mutating principal',
    "$acl.SetSecurityDescriptorSddlForm(('O:'+$user+'G:SYD:P(D;;FA;;;S-1-3-4)(A;;GW;;;WD)(A;;FA;;;SY)(A;;FA;;;BA)'))",
  ],
])
  test(`Windows OWNER RIGHTS ancestry still refuses ${name}`, windows, () => {
    refused(
      inspectWindows({
        diagnostic: true,
        change: `${ownerRightsAncestor}
    $acl=$acls[$fixture]
    ${change}`,
      }),
      'inspect-ancestry',
    );
  });

for (const [name, grants, stage] of [
  [
    'instead of the required current-account grant',
    '(A;OICI;FA;;;S-1-3-4)',
    'verify-rules',
  ],
  [
    'in addition to the current-account grant',
    "(A;OICI;FA;;;S-1-3-4)(A;OICI;FA;;;'+$user+')",
    'verify-rules',
  ],
  [
    'with neither an owner nor current-account grant',
    '',
    'verify-current-account',
  ],
])
  test(`Windows private leaf refuses OWNER RIGHTS ${name}`, windows, () => {
    refused(
      inspectWindows({
        diagnostic: true,
        change: `${ownerRightsAncestor}
    $acls[$directory].SetSecurityDescriptorSddlForm(('O:'+$user+'G:SYD:P${grants}(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)'))`,
      }),
      stage,
    );
  });

test(
  'Windows OWNER RIGHTS ancestry does not relax protected private-leaf inheritance',
  windows,
  () => {
    refused(
      inspectWindows({
        diagnostic: true,
        change: `${ownerRightsAncestor}
    $acls[$directory].SetAccessRuleProtection($false,$false)`,
      }),
      'verify-inheritance',
    );
  },
);

for (const [name, sddl] of [
  ['foreign owner', "'O:S-1-5-21-1-2-3-1000G:SYD:P(A;;FA;;;'+$user+')'"],
  [
    'DELETE on an intermediate child',
    "'O:'+$user+'G:SYD:P(A;;SD;;;WD)(A;;FA;;;'+$user+')'",
  ],
  ['WRITE_DAC', "'O:'+$user+'G:SYD:P(A;;WD;;;WD)(A;;FA;;;'+$user+')'"],
  ['WRITE_OWNER', "'O:'+$user+'G:SYD:P(A;;WO;;;WD)(A;;FA;;;'+$user+')'"],
  [
    'attribute mutation',
    "'O:'+$user+'G:SYD:P(A;;0x100;;;WD)(A;;FA;;;'+$user+')'",
  ],
  [
    'effective inherited mutation',
    "'O:'+$user+'G:SYD:AI(A;ID;0x40;;;WD)(A;;FA;;;'+$user+')'",
  ],
  ['null DACL', "'O:'+$user+'G:SYD:NO_ACCESS_CONTROL'"],
  [
    'generic full control',
    "'O:'+$user+'G:SYD:P(A;;GA;;;WD)(A;;FA;;;'+$user+')'",
  ],
])
  test(`Windows ancestry refuses ${name}`, windows, () => {
    refused(
      inspectWindows({
        change: `$acls[$fixture].SetSecurityDescriptorSddlForm((${sddl}))`,
      }),
    );
  });
test('Windows ancestry refuses ACL query failure', windows, () => {
  refused(inspectWindows({ change: `$acls.Remove($fixture)` }));
});
test(
  'Windows ancestry refuses an unknown descriptor representation',
  windows,
  () => {
    refused(
      inspectWindows({
        change: `$acl=$acls[$fixture]; $model=[pscustomobject]@{Inner=$acl}
    $model | Add-Member ScriptMethod GetOwner { param($type) $this.Inner.GetOwner($type) }
    $model | Add-Member ScriptMethod GetAccessRules { param($explicit,$inherited,$type) $this.Inner.GetAccessRules($explicit,$inherited,$type) }
    $model | Add-Member ScriptMethod GetSecurityDescriptorBinaryForm { [byte[]]@(255) }
    $acls[$fixture]=$model`,
      }),
    );
  },
);
test(
  'Windows root entry-creation and inherit-only rights do not authorize replacement',
  windows,
  () => {
    accepted(
      inspectWindows({
        change: `$acls[$driveRoot].SetSecurityDescriptorSddlForm(('O:SYG:SYD:P(A;;0x1200af;;;BU)(A;;0x4;;;AU)(A;OICIIO;FA;;;CO)(A;;FA;;;SY)(A;;FA;;;BA)'))`,
      }),
    );
  },
);
// Generic rights remain unmapped in inherit-only ACEs on Windows containers.
// https://learn.microsoft.com/en-us/windows/win32/secauthz/ace-inheritance-rules
for (const [name, ace] of [
  ['creator-owner inherit-only full control', '(A;OICIIO;GA;;;CO)'],
  ['users inherit-only read and execute', '(A;OICIIO;GRGX;;;BU)'],
  ['everyone effective generic read', '(A;;GR;;;WD)'],
  ['everyone effective generic execute', '(A;;GX;;;WD)'],
  ['everyone inherited generic read and execute', '(A;ID;GRGX;;;WD)'],
  ['trusted system generic full control', '(A;;GA;;;SY)'],
  ['trusted administrators generic full control', '(A;;GA;;;BA)'],
  ['generic deny without a mutating grant', '(D;;GA;;;WD)'],
])
  test(`Windows ancestry accepts ${name}`, windows, () => {
    accepted(
      inspectWindows({
        change: `$acls[$fixture].SetSecurityDescriptorSddlForm(('O:'+$user+'G:SYD:P${ace}(A;;FA;;;'+$user+')'))`,
      }),
    );
  });

for (const [name, ace] of [
  ['generic write attributes and extended attributes', '(A;;GW;;;WD)'],
  ['generic read plus write', '(A;;GRGW;;;WD)'],
  ['generic read plus DELETE_CHILD', '(A;;0x80000040;;;WD)'],
  ['generic execute plus DELETE', '(A;;0x20010000;;;WD)'],
  ['generic read plus WRITE_DAC', '(A;;0x80040000;;;WD)'],
  ['generic execute plus WRITE_OWNER', '(A;;0x20080000;;;WD)'],
  ['inherited generic write', '(A;ID;GW;;;WD)'],
  ['unknown bits mixed with generic read', '(A;;0x80000200;;;WD)'],
  ['trusted generic grant with unknown bits', '(A;;0x10000200;;;SY)'],
  [
    'inherit-only generic grant with unknown bits',
    '(A;OICIIO;0x10000200;;;CO)',
  ],
  ['generic deny with unknown bits', '(D;;0x10000200;;;WD)'],
  ['generic deny paired with a mutating grant', '(D;;GA;;;WD)(A;;GW;;;WD)'],
])
  test(`Windows ancestry refuses ${name}`, windows, () => {
    refused(
      inspectWindows({
        change: `$acls[$fixture].SetSecurityDescriptorSddlForm(('O:'+$user+'G:SYD:P${ace}(A;;FA;;;'+$user+')'))`,
      }),
    );
  });

for (const [name, sddl] of [
  [
    'generic instead of exact file full control',
    "'O:'+$user+'G:SYD:P(A;OICI;GA;;;'+$user+')(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)'",
  ],
  [
    'missing current-account grant',
    "'O:'+$user+'G:SYD:P(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)'",
  ],
  [
    'denied current-account grant',
    "'O:'+$user+'G:SYD:P(D;OICI;FA;;;'+$user+')(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)'",
  ],
  [
    'inherit-only current-account grant',
    "'O:'+$user+'G:SYD:P(A;OICIIO;FA;;;'+$user+')(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)'",
  ],
])
  test(`Windows private leaf refuses ${name}`, windows, () => {
    refused(
      inspectWindows({
        change: `$acls[$directory].SetSecurityDescriptorSddlForm((${sddl}))`,
      }),
    );
  });

// Preserve raw ACEs that the higher-level .NET access-rule view can omit.
function withRawAncestorAce(expression, identity = 'S-1-1-0') {
  return `$acl=$acls[$fixture]
    $raw=New-Object Security.AccessControl.RawSecurityDescriptor($acl.GetSecurityDescriptorBinaryForm(),0)
    $sid=New-Object Security.Principal.SecurityIdentifier(${literal(identity)})
    $raw.DiscretionaryAcl.InsertAce(0,(${expression}))
    $bytes=New-Object byte[] $raw.BinaryLength
    $raw.GetBinaryForm($bytes,0)
    $model=[pscustomobject]@{Inner=$acl;Bytes=$bytes}
    $model | Add-Member ScriptMethod GetOwner { param($type) $this.Inner.GetOwner($type) }
    $model | Add-Member ScriptMethod GetAccessRules { param($explicit,$inherited,$type) $this.Inner.GetAccessRules($explicit,$inherited,$type) }
    $model | Add-Member ScriptMethod GetSecurityDescriptorBinaryForm { $this.Bytes }
    $acls[$fixture]=$model`;
}
test(
  'Windows raw inherit-only generic ACE remains non-authorizing',
  windows,
  () => {
    accepted(
      inspectWindows({
        change: withRawAncestorAce(
          '[Security.AccessControl.CommonAce]::new([Security.AccessControl.AceFlags]0x0b,[Security.AccessControl.AceQualifier]::AccessAllowed,0x10000000,$sid,$false,$null)',
        ),
      }),
    );
  },
);
for (const [name, expression] of [
  [
    'callback ACE',
    '[Security.AccessControl.CommonAce]::new([Security.AccessControl.AceFlags]::None,[Security.AccessControl.AceQualifier]::AccessAllowed,0x10000000,$sid,$true,[byte[]]@(1,2,3,4))',
  ],
  [
    'object ACE',
    "[Security.AccessControl.ObjectAce]::new([Security.AccessControl.AceFlags]::None,[Security.AccessControl.AceQualifier]::AccessAllowed,0x10000000,$sid,[Security.AccessControl.ObjectAceFlags]::ObjectAceTypePresent,[Guid]'00000000-0000-0000-0000-000000000001',[Guid]::Empty,$false,$null)",
  ],
  [
    'unknown ACE type',
    '[Security.AccessControl.CustomAce]::new([Enum]::ToObject([Security.AccessControl.AceType],127),[Security.AccessControl.AceFlags]::None,[byte[]]@(1,2,3,4))',
  ],
  [
    'unknown ACE flags',
    '[Security.AccessControl.CommonAce]::new([Enum]::ToObject([Security.AccessControl.AceFlags],0x20),[Security.AccessControl.AceQualifier]::AccessAllowed,0x10000000,$sid,$false,$null)',
  ],
]) {
  test(
    `Windows ancestry refuses a raw ${name} hidden from access rules`,
    windows,
    () => {
      refused(inspectWindows({ change: withRawAncestorAce(expression) }));
    },
  );
  test(`Windows OWNER RIGHTS cannot hide a raw ${name}`, windows, () => {
    refused(
      inspectWindows({
        diagnostic: true,
        change: `${ownerRightsAncestor}
    ${withRawAncestorAce(expression, 'S-1-3-4')}`,
      }),
      'inspect-ancestry',
    );
  });
  test(`Windows DirectorySecurity round-trip refuses ${name}`, windows, () => {
    refused(
      inspectWindows({
        diagnostic: true,
        change: `${ownerRightsAncestor}
    ${withRawAncestorAce(expression, 'S-1-3-4')}
    $roundtrip=New-Object Security.AccessControl.DirectorySecurity
    $roundtrip.SetSecurityDescriptorBinaryForm($bytes)
    $again=[Security.AccessControl.RawSecurityDescriptor]::new($roundtrip.GetSecurityDescriptorBinaryForm(),0)
    # DirectorySecurity can reorder object ACEs. Compare every ACE byte-for-byte.
    function Get-RawAceBytes($dacl) {
      foreach($ace in $dacl) {
        $aceBytes=New-Object byte[] $ace.BinaryLength
        $ace.GetBinaryForm($aceBytes,0)
        [Convert]::ToBase64String($aceBytes)
      }
    }
    if((@(Get-RawAceBytes $raw.DiscretionaryAcl | Sort-Object) -join ',') -cne (@(Get-RawAceBytes $again.DiscretionaryAcl | Sort-Object) -join ',')) { throw 'Round-trip changed a raw ACE' }
    $acls[$fixture]=$roundtrip`,
      }),
      'inspect-ancestry',
    );
  });
}

test(
  'Windows trusted OS service ancestry does not widen private-leaf accounts',
  windows,
  () => {
    const owner =
      'S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464';
    accepted(
      inspectWindows({
        change: `$acls[$driveRoot].SetSecurityDescriptorSddlForm('O:${owner}G:SYD:P(A;;FA;;;${owner})(A;;FR;;;WD)')`,
      }),
    );
    refused(
      inspectWindows({
        change: `$acls[$directory].SetOwner((New-Object Security.Principal.SecurityIdentifier('${owner}')))`,
      }),
    );
  },
);
test(
  'Windows ancestry mode validates generic directories without private-leaf grants',
  windows,
  () => {
    accepted(
      inspectWindows({
        ancestor: true,
        change: `$directory=$fixture; $acls[$directory].SetSecurityDescriptorSddlForm('O:SYG:SYD:P(A;;FR;;;WD)(A;;FA;;;SY)')`,
      }),
    );
  },
);
test(
  'Windows initializer rejects unsafe ancestry before reaching directory creation',
  windows,
  () => {
    const result = inspectWindows({
      initialize: true,
      change: `$acls[$fixture].SetSecurityDescriptorSddlForm(('O:'+$user+'G:SYD:P(A;;0x40;;;WD)(A;;FA;;;'+$user+')'))`,
    });
    refused(result);
    assert.match(result.stderr, /Verification stage: inspect-ancestry/);
    assert.doesNotMatch(result.stderr, /initialize-security|create-directory/);
  },
);
test(
  'Windows inherited private-leaf state is rejected without repair',
  windows,
  () => {
    refused(
      inspectWindows({
        change: `$acls[$directory].SetAccessRuleProtection($false,$false)`,
      }),
    );
  },
);
test(
  'Windows extra private-leaf read grants are rejected without repair',
  windows,
  () => {
    refused(
      inspectWindows({
        change: `$acls[$directory].SetSecurityDescriptorSddlForm(('O:'+$user+'G:SYD:P(A;OICI;FA;;;'+$user+')(A;;FR;;;WD)'))`,
      }),
    );
  },
);
test(
  'Windows reparse ancestor metadata is rejected without filesystem substitution',
  windows,
  () => {
    refused(
      inspectWindows({
        change: `$items[$fixture].Attributes=[IO.FileAttributes]::ReparsePoint -bor [IO.FileAttributes]::Directory`,
      }),
    );
  },
);
