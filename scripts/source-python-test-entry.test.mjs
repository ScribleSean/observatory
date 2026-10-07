import test from 'node:test';
import assert from 'node:assert/strict';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execPython } from './test-python.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const preload = new URL(
  '../native/tests/test-source-runtime.mjs',
  import.meta.url,
).href;
const packageJSON = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
);
const selected = () =>
  JSON.parse(
    execPython(
      ['-I', '-c', 'import json, sys; print(json.dumps(sys.executable))'],
      { encoding: 'utf8', timeout: 10000, maxBuffer: 4096 },
    ),
  );

function launch(env) {
  // This child only reports the selected interpreter. It imports no collector
  // or permission helper and does not log the inherited environment.
  return spawnSync(
    process.execPath,
    [
      '--import',
      preload,
      '--input-type=module',
      '-e',
      'console.log(JSON.stringify({python:process.env.OBSERVATORY_PYTHON}))',
    ],
    { cwd: root, env, encoding: 'utf8', timeout: 15000, maxBuffer: 4096 },
  );
}
function testEnvironment() {
  const env = { ...process.env };
  delete env.OBSERVATORY_PYTHON;
  return env;
}
function refused(result) {
  assert.ifError(result.error);
  assert.notEqual(result.status, 0);
  assert.equal(
    result.stdout,
    '',
    'No test child may start with an invalid selected runtime',
  );
}

test('normal source-tree npm test selects Python before starting test files', () => {
  assert.equal(
    packageJSON.scripts.test,
    'node --import ./native/tests/test-source-runtime.mjs --test scripts/*.test.mjs',
  );
  assert.equal(packageJSON.scripts.collect, 'python3 scripts/run-collector.py');
});

test('source-test preload exports the interpreter chosen by test-python', () => {
  const python = selected();
  assert.ok(path.isAbsolute(python));
  const result = launch({
    ...testEnvironment(),
    OBSERVATORY_TEST_PYTHON: python,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { python });
});

test('source-test preload preserves an explicit runtime without test-launcher fallback', () => {
  const python = selected();
  const result = launch({
    ...testEnvironment(),
    OBSERVATORY_PYTHON: python,
    OBSERVATORY_TEST_PYTHON: path.join(root, 'fictional-missing-test-python'),
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { python });
});

test('source-test preload refuses invalid explicit runtimes before executing test code', () => {
  const python = selected();
  for (const value of [
    '',
    'python3',
    '../python3',
    path.join(root, 'fictional-missing-python'),
    root,
    python + '\r',
    python + '\n',
  ])
    refused(
      launch({
        ...testEnvironment(),
        OBSERVATORY_PYTHON: value,
        OBSERVATORY_TEST_PYTHON: python,
      }),
    );
});

test('source-test preload does not fall back when the chosen test Python is invalid', () => {
  for (const value of [
    '',
    'python3',
    path.join(root, 'fictional-missing-test-python'),
  ])
    refused(launch({ ...testEnvironment(), OBSERVATORY_TEST_PYTHON: value }));
});

for (const extension of ['txt', 'exe']) {
  test(`source-test preload refuses existing nonlaunchable .${extension} files without fallback`, () => {
    const directory = mkdtempSync(
      path.join(tmpdir(), 'observatory-runtime-file-'),
    );
    try {
      const file = path.join(directory, `fictional-python.${extension}`);
      writeFileSync(file, 'Not a Python executable\n', { flag: 'wx' });
      const result = launch({
        ...testEnvironment(),
        OBSERVATORY_PYTHON: file,
        OBSERVATORY_TEST_PYTHON: selected(),
      });
      assert.equal(
        result.stdout,
        '',
        'No test body may start or use a fallback',
      );
      refused(result);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
}

test('source-test preload refuses a launchable non-Python executable', () => {
  refused(
    launch({
      ...testEnvironment(),
      OBSERVATORY_PYTHON: process.execPath,
      OBSERVATORY_TEST_PYTHON: selected(),
    }),
  );
});

for (const mode of ['timeout', 'stdout', 'stderr']) {
  test(`source-test probe enforces the real ${mode} bound before test bodies`, (t) => {
    const directory = mkdtempSync(
      path.join(tmpdir(), 'observatory-probe-bound-'),
    );
    try {
      const python = selected();
      const marker = path.join(directory, 'python-started');
      const body = path.join(directory, 'body-started');
      const trace = path.join(directory, 'trace.json');
      const env = {};
      for (const [key, value] of Object.entries(process.env))
        if (
          /^(SystemRoot|WINDIR|COMSPEC|PATHEXT|NUMBER_OF_PROCESSORS|PROCESSOR_ARCHITECTURE)$/i.test(
            key,
          )
        )
          env[key] = value;
      for (const key of [
        'HOME',
        'USERPROFILE',
        'APPDATA',
        'LOCALAPPDATA',
        'TEMP',
        'TMP',
        'TMPDIR',
        'npm_config_cache',
      ]) {
        env[key] = path.join(directory, key);
        mkdirSync(env[key]);
      }
      Object.assign(env, {
        OBSERVATORY_PYTHON: python,
        OBSERVATORY_TEST_PYTHON: path.join(directory, 'missing-python'),
        PROBE_STARTED: marker,
        BODY_MARKER: body,
        PROBE_TRACE: trace,
      });
      // Substitute only the harmless -c payload. The selected executable and
      // original execFileSync options still enforce the real process bounds.
      const payload =
        'import os,pathlib,sys,time\n' +
        'pathlib.Path(os.environ["PROBE_STARTED"]).write_text(str(os.getpid()))\n' +
        (mode === 'timeout'
          ? 'time.sleep(30)'
          : `sys.${mode}.write("x" * 262144)\nsys.${mode}.flush()`);
      const inertBody = path.join(directory, 'inert-body.mjs');
      writeFileSync(
        inertBody,
        `
import { writeFileSync } from 'node:fs';
writeFileSync(process.env.BODY_MARKER, 'started', { flag: 'wx' });
`,
      );
      const result = spawnSync(
        process.execPath,
        [
          '--input-type=module',
          '-e',
          `
import assert from 'node:assert/strict';
import cp from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { pathToFileURL } from 'node:url';
const original = cp.execFileSync;
const calls = [];
cp.execFileSync = function(executable, args, options) {
  assert.equal(executable, process.env.OBSERVATORY_PYTHON);
  assert.deepEqual(args, ['-I', '-S', '-B', '-c', 'import sys\\nprint(sys.version_info.major)']);
  assert.equal(options.timeout, 10000);
  assert.equal(options.maxBuffer, 4096);
  assert.equal(options.killSignal, 'SIGKILL');
  assert.equal(options.shell, false);
  assert.equal(options.windowsHide, true);
  assert.deepEqual(options.stdio, ['ignore', 'pipe', 'pipe']);
  const call = { executable, args, options };
  calls.push(call);
  const begin = performance.now();
  try {
    return Reflect.apply(original, cp, [executable, [...args.slice(0, -1), ${JSON.stringify(payload)}], options]);
  } catch (error) {
    call.error = {
      code: error.code, pid: error.pid, signal: error.signal,
      stdoutLength: error.stdout?.length ?? 0,
      stderrLength: error.stderr?.length ?? 0,
    };
    throw error;
  } finally {
    call.elapsedMs = performance.now() - begin;
  }
};
syncBuiltinESMExports();
let failure;
try {
  await import(${JSON.stringify(preload)});
  await import(pathToFileURL(${JSON.stringify(inertBody)}).href);
} catch (error) {
  failure = { code: error.code, pid: error.pid, signal: error.signal };
  process.exitCode = 29;
} finally {
  writeFileSync(process.env.PROBE_TRACE, JSON.stringify({ calls, failure }), { flag: 'wx' });
}
`,
        ],
        {
          cwd: directory,
          env,
          encoding: 'utf8',
          shell: false,
          windowsHide: true,
          // The sleeper also exits after 30 seconds if enforcement regresses.
          // No external PID cleanup or arbitrary descendant process is used.
          timeout: 40000,
          maxBuffer: 16384,
          killSignal: 'SIGKILL',
        },
      );
      assert.ifError(result.error);
      const observed = JSON.parse(readFileSync(trace, 'utf8'));
      const startMarker = existsSync(marker)
        ? readFileSync(marker, 'utf8')
        : null;
      const bodyStarted = existsSync(body);
      t.diagnostic(
        JSON.stringify({ mode, startMarker, bodyStarted, ...observed }),
      );
      assert.equal(result.status, 29, result.stdout + result.stderr);
      assert.equal(result.stdout, '');
      assert.equal(result.stderr, '');
      assert.equal(observed.calls.length, 1, 'No fallback probe may run');
      const call = observed.calls[0];
      const expectedCode = mode === 'timeout' ? 'ETIMEDOUT' : 'ENOBUFS';
      assert.equal(call.error?.code, expectedCode);
      assert.equal(observed.failure.code, expectedCode);
      assert.equal(observed.failure.pid, call.error.pid);
      assert.match(startMarker ?? '', /^[1-9][0-9]*$/);
      assert.equal(
        Number(startMarker),
        call.error.pid,
        'The real Python child started',
      );
      assert.equal(
        bodyStarted,
        false,
        'The inert test body must not run after probe failure',
      );
      if (mode === 'timeout') {
        assert.equal(call.error.signal, 'SIGKILL');
        assert.ok(call.elapsedMs >= 9000 && call.elapsedMs < 20000);
        assert.equal(call.error.stdoutLength, 0);
        assert.equal(call.error.stderrLength, 0);
      } else {
        assert.ok(call.elapsedMs < 10000);
        assert.ok(call.error[`${mode}Length`] > 4096);
        assert.ok(call.error[`${mode}Length`] <= 262144);
        assert.equal(
          call.error[mode === 'stdout' ? 'stderrLength' : 'stdoutLength'],
          0,
        );
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
}

test('normal offline npm discovery validates Python before inert test bodies', () => {
  const directory = mkdtempSync(
    path.join(tmpdir(), 'observatory-runtime-npm-'),
  );
  try {
    const python = selected();
    const npm =
      process.env.npm_execpath ??
      path.resolve(
        path.dirname(process.execPath),
        process.platform === 'win32'
          ? 'node_modules/npm/bin/npm-cli.js'
          : '../lib/node_modules/npm/bin/npm-cli.js',
      );
    for (const file of [
      'native/tests/test-source-runtime.mjs',
      'scripts/test-python.mjs',
    ]) {
      mkdirSync(path.dirname(path.join(directory, file)), { recursive: true });
      copyFileSync(path.join(root, file), path.join(directory, file));
    }
    writeFileSync(
      path.join(directory, 'package.json'),
      JSON.stringify({
        name: 'fictional-source-runtime',
        private: true,
        type: 'module',
        scripts: { test: packageJSON.scripts.test },
      }),
    );
    // Only inert fixtures are discoverable. No install or production import.
    for (const name of ['first', 'second'])
      writeFileSync(
        path.join(directory, 'scripts', `${name}.test.mjs`),
        `
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
writeFileSync(path.join(process.env.RUNTIME_MARKERS, '${name}'), 'started');
assert.equal(process.env.OBSERVATORY_PYTHON, process.env.EXPECTED_PYTHON);
const child = spawnSync(process.execPath, ['-e',
  'console.log(JSON.stringify(process.env.OBSERVATORY_PYTHON))'], {
  cwd: process.env.RUNTIME_MARKERS, encoding: 'utf8', timeout: 5000,
});
assert.ifError(child.error);
assert.equal(child.status, 0, child.stderr);
assert.equal(JSON.parse(child.stdout), process.env.EXPECTED_PYTHON);
`,
      );
    for (const file of ['user.npmrc', 'global.npmrc'])
      writeFileSync(path.join(directory, file), '');
    const text = path.join(directory, 'fictional-python.txt');
    writeFileSync(text, 'Not a Python executable\n');
    const missing = path.join(directory, 'fictional-missing-python');
    for (const [name, explicit, testPython, valid] of [
      ['selected', undefined, python, true],
      ['explicit', python, missing, true],
      ['missing', missing, python, false],
      ['text', text, python, false],
    ]) {
      const markers = path.join(directory, name);
      mkdirSync(markers);
      const env = {
        ...testEnvironment(),
        OBSERVATORY_TEST_PYTHON: testPython,
        EXPECTED_PYTHON: python,
        RUNTIME_MARKERS: markers,
        npm_config_cache: path.join(directory, 'npm-cache'),
        npm_config_userconfig: path.join(directory, 'user.npmrc'),
        npm_config_globalconfig: path.join(directory, 'global.npmrc'),
      };
      for (const key of Object.keys(env))
        if (key.toLowerCase() === 'path') delete env[key];
      env.PATH = [
        path.dirname(process.execPath),
        process.env.PATH ?? process.env.Path ?? '',
      ].join(path.delimiter);
      delete env.NODE_OPTIONS;
      // This is a separate npm invocation, not a recursive node:test run.
      delete env.NODE_TEST_CONTEXT;
      if (explicit !== undefined) env.OBSERVATORY_PYTHON = explicit;
      const result = spawnSync(
        process.execPath,
        [
          npm,
          '--offline',
          '--no-audit',
          '--no-fund',
          '--update-notifier=false',
          'test',
        ],
        {
          cwd: directory,
          env,
          encoding: 'utf8',
          timeout: 30000,
          maxBuffer: 32768,
        },
      );
      assert.ifError(result.error);
      if (valid) assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.deepEqual(
        readdirSync(markers).sort(),
        valid ? ['first', 'second'] : [],
        name + result.stdout + result.stderr,
      );
      if (!valid) assert.notEqual(result.status, 0, name);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
