import test from 'node:test';
import assert from 'node:assert/strict';
import {
  readFileSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  realpathSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { generateInstaller } from '../windows/generate-installer.mjs';

const file = (name) => new URL('../windows/' + name, import.meta.url);
const read = (name) => {
  assert.ok(existsSync(file(name)), `Missing required source owner: ${name}`);
  return readFileSync(file(name), 'utf8');
};

// These are source-contract checks, not compiled Windows runtime acceptance.
void test('TEST application selects an installation identity before dispatch or state access', () => {
  const program = read('Program.cs');
  const main = program.slice(
    program.indexOf('private static void Main(string[] args)'),
  );
  assert.match(
    main,
    /try \{ _ = AppIdentity.Current; \}/,
    'Resolve TEST ownership before any helper, IPC, application data or registry operation',
  );
  assert.ok(
    main.indexOf('_ = AppIdentity.Current') <
      main.indexOf('if (args.Contains('),
  );
  assert.ok(
    existsSync(file('AppIdentity.cs')),
    'A single identity owner is required',
  );
  const identity = read('AppIdentity.cs');
  assert.match(identity, /Workspace Observatory Installer Test/);
  assert.match(identity, /WorkspaceObservatoryInstallerTest/);
  assert.match(identity, /installer-owner\.ini/);
  assert.match(identity, /FileAttributes.ReparsePoint/);
  assert.match(identity, /throw new IOException/);
  assert.match(
    program,
    /private readonly string runtime = AppIdentity.Current.Runtime/,
  );
});

void test('all default IPC callers use the selected identity, including update helpers', () => {
  const program = read('Program.cs');
  assert.match(
    program,
    /new Mutex\(true, AppIdentity.Current.SingletonName, out var first\)/,
  );
  assert.match(
    program,
    /new EventWaitHandle\(false, EventResetMode.AutoReset, AppIdentity.Current.ActivationName\)/,
  );
  assert.match(
    program,
    /new EventWaitHandle\(false, EventResetMode.AutoReset, AppIdentity.Current.QuitName\)/,
  );
  assert.equal(
    (
      program.match(
        /UpdateQuit.Request\(AppIdentity.Current.SingletonName, AppIdentity.Current.QuitName,/g,
      ) ?? []
    ).length,
    2,
  );
  assert.match(
    read('InstallationGate.cs'),
    /new Mutex\(false, name \?\? AppIdentity.Current.SetupName, out var created\)/,
  );
  const session = read('UpdateSession.cs');
  assert.match(session, /string\? setupName = null/);
  assert.match(session, /singletonName \?\? AppIdentity.Current.SingletonName/);
  assert.match(session, /requestName \?\? AppIdentity.Current.QuitName/);
  for (const caller of [
    'UpdateHelper.cs',
    'UpdateInstalledState.cs',
    'UpdateReceiptStore.cs',
    'UpdateStaging.cs',
  ])
    assert.match(read(caller), /InstallationGate.TryEnter\(\)/, caller);
  assert.match(
    read('AppIdentity.cs'),
    /SingletonName => "Local\\\\" \+ \(IsTest \? TestId \+ "\.App" : StartupName\)/,
  );
  assert.match(
    read('generate-installer.mjs'),
    /APP_ID:testIdentity\?'WorkspaceObservatoryInstallerTest.App':'WorkspaceObservatory'/,
  );
  assert.match(
    read('installer.nsi'),
    /OpenMutexW\(i 0x100000, i 0, w "Local\\\$\{APP_ID\}"\)/,
  );
  assert.doesNotMatch(program, /"Local\\\\WorkspaceObservatory(?:\.Open)?"/);
});

void test('TEST startup, dashboard preferences and receipt storage cannot select ordinary defaults', () => {
  assert.match(
    read('LoginStartup.cs'),
    /ValueName => AppIdentity.Current.StartupName/,
  );
  assert.match(
    read('DashboardWindowPreferences.cs'),
    /Key => AppIdentity.Current.IsTest \? @"Software\\WorkspaceObservatoryInstallerTest\\Dashboard" : @"Software\\Observatory\\Dashboard"/,
  );
  assert.match(read('UpdateInstall.cs'), /AppIdentity.Current.Runtime/);
  assert.doesNotMatch(
    read('UpdateInstall.cs'),
    /SpecialFolder.LocalApplicationData/,
  );
  const installerTest = read('test-installer.ps1');
  assert.match(
    installerTest,
    /\$data = Join-Path \$env:LOCALAPPDATA \$appName/,
  );
  assert.match(installerTest, /'Local\\WorkspaceObservatoryInstallerTest.App'/);
  assert.doesNotMatch(
    installerTest,
    /'Workspace Observatory'|'Local\\WorkspaceObservatory'/,
  );
});

void test('malformed, mixed and unknown commands return 64 before helper or UI dispatch', () => {
  const program = read('Program.cs');
  assert.match(
    program,
    /if \(!LaunchArguments.Valid\(args\)\) \{ Environment.ExitCode = 64; return; \}/,
  );
  assert.ok(
    program.indexOf('!LaunchArguments.Valid(args)') <
      program.indexOf('_ = AppIdentity.Current'),
  );
  const validation = read('LaunchArguments.cs');
  assert.match(
    validation,
    /args.Distinct\(StringComparer.Ordinal\).Count\(\) == args.Length/,
  );
  assert.match(
    validation,
    /string.IsNullOrWhiteSpace\(argument\) \|\| argument.StartsWith\("--", StringComparison.Ordinal\)/,
  );
  assert.match(validation, /_ => 0/);
  const flags = new Set(
    [...program.matchAll(/"(--[a-z-]+)"/g)].map((match) => match[1]),
  );
  flags.delete('--test-antigravity-');
  for (const flag of flags)
    assert.ok(
      validation.includes('"' + flag + '"'),
      `Unvalidated handler: ${flag}`,
    );
  assert.ok(
    program.indexOf('AntigravityUsageProcessTests.Command(args)') <
      program.indexOf('AntigravityUsageProcess.Command(args[1])'),
    'The synthetic argv round trip must dispatch before interpreting its payload as another command',
  );
});

void test('TEST installations refuse production update and explicit-runtime helper routes', () => {
  const program = read('Program.cs');
  assert.match(
    program,
    /if \(AppIdentity.Current.IsTest && !LaunchArguments.ValidForTestInstallation\(args\)\)\s*\{ Environment.ExitCode = 64; return; \}/,
  );
  assert.ok(
    program.indexOf('!LaunchArguments.ValidForTestInstallation(args)') <
      program.indexOf('AntigravityUsageProcessTests.Command(args)'),
  );
  const allowed = read('LaunchArguments.cs').split(
    'internal static bool ValidForTestInstallation',
  )[1];
  assert.ok(allowed, 'A separate installed TEST allowlist is required');
  assert.doesNotMatch(
    allowed,
    /"--apply-update"|"--collect-once"|"--test-update-install"|StartsWith/,
  );
  assert.match(allowed, /"--self-test"/);
  assert.match(allowed, /"--quit-for-update"/);
  const update = read('UpdateController.cs');
  assert.match(
    update,
    /if \(AppIdentity.Current.IsTest\) throw new IOException\(/,
  );
  assert.ok(
    update.indexOf('if (AppIdentity.Current.IsTest)') <
      update.indexOf('UpdateTrust.ReadEmbedded()'),
  );
});

void test('installed self-tests retain their scoped readiness child command', () => {
  assert.match(read('Program.cs'), /UpdateReady.SelfTest\(\)/);
  const commands = [
    ...read('UpdateReady.cs').matchAll(
      /start.ArgumentList.Add\("(--test-[a-z-]+)"\)/g,
    ),
  ].map((match) => match[1]);
  assert.deepEqual(commands, ['--test-update-ready']);
  const allowed = read('LaunchArguments.cs').split(
    'internal static bool ValidForTestInstallation',
  )[1];
  assert.ok(
    allowed,
    'A TEST allowlist must preserve the scoped self-test child',
  );
  for (const command of commands)
    assert.ok(
      allowed.includes('"' + command + '"'),
      `Blocked self-test child: ${command}`,
    );
});

void test('a bounded identity diagnostic precedes normal startup and runs pure native contracts', () => {
  const program = read('Program.cs');
  assert.match(
    program,
    /if \(args.SequenceEqual\(new\[\] \{ "--test-launch-isolation" \}\)\)/,
  );
  assert.ok(
    program.indexOf('LaunchIsolationTests.Run()') <
      program.indexOf('ApplicationConfiguration.Initialize()'),
  );
  assert.match(read('LaunchArguments.cs'), /"--test-launch-isolation"/);
  const tests = read('LaunchIsolationTests.cs');
  for (const contract of [
    'AppIdentity.Select',
    'LaunchArguments.Valid(',
    'LaunchArguments.ValidForTestInstallation(',
  ])
    assert.ok(tests.includes(contract), contract);
  assert.doesNotMatch(
    tests,
    /Registry|Directory.Create|File.Write|new Mutex|Process.Start|Application.Run/,
  );
});

// Exercise the real generator with inert payload bytes. Nothing is compiled.
void test('generated TEST metadata separates setup, singleton, startup and uninstall identities', (t) => {
  const root = realpathSync(
    mkdtempSync(path.join(tmpdir(), 'observatory-test-identity-')),
  );
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const app = path.join(root, 'payload');
  mkdirSync(app);
  mkdirSync(path.join(app, 'Runtime'));
  const bytes = Buffer.from('Inert fictional payload, not executable');
  const files = ['LICENSE', 'Runtime/node.exe', 'WorkspaceObservatory.exe'].map(
    (name) => {
      writeFileSync(path.join(app, name), bytes);
      return {
        path: name,
        bytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      };
    },
  );
  writeFileSync(
    path.join(app, 'package-manifest.json'),
    JSON.stringify({
      schema: 1,
      platform: 'win-x64',
      sourceRevision: 'a'.repeat(40),
      sourceDirty: true,
      totalBytes: files.reduce((sum, file) => sum + file.bytes, 0),
      files,
    }),
  );
  const output = path.join(root, 'generated');
  generateInstaller(app, output, { testIdentity: true });
  const definitions = new Map(
    [
      ...readFileSync(path.join(output, 'metadata.nsh'), 'utf8').matchAll(
        /^!define (\w+) "(.*)"$/gm,
      ),
    ].map((match) => [match[1], match[2]]),
  );
  assert.equal(
    definitions.get('APP_NAME'),
    'Workspace Observatory Installer Test',
  );
  assert.equal(
    definitions.get('APP_ID'),
    'WorkspaceObservatoryInstallerTest.App',
  );
  assert.equal(
    definitions.get('SETUP_ID'),
    'WorkspaceObservatoryInstallerTest',
  );
  assert.equal(
    definitions.get('STARTUP_NAME'),
    'WorkspaceObservatoryInstallerTest',
  );
  assert.equal(
    definitions.get('UNINSTALL_KEY'),
    'Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\WorkspaceObservatoryInstallerTest',
  );
  assert.notEqual(definitions.get('APP_ID'), definitions.get('SETUP_ID'));
  const build = JSON.parse(
    readFileSync(path.join(output, 'artifacts/installer-build.json'), 'utf8'),
  );
  assert.equal(build.testIdentity, true);
  assert.match(build.installerName, /-TEST-setup\.exe$/);
  const ordinary = path.join(root, 'ordinary-refused');
  assert.throws(
    () => generateInstaller(app, ordinary),
    /Invalid or unreleased package manifest/,
  );
  assert.equal(
    existsSync(ordinary),
    false,
    'TEST generation must not relax ordinary dirty-source refusal',
  );
});
