import { accessSync, constants, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { execPython } from '../../scripts/test-python.mjs';

// Test-only source-tree setup. Production helpers keep their explicit or
// bundled runtime selection and never use this launcher's PATH discovery.
// Preserve an explicit runtime, including failing closed if it is invalid.
let python = process.env.OBSERVATORY_PYTHON;
if (python === undefined) {
  python = JSON.parse(
    execPython(
      ['-I', '-c', 'import json, sys; print(json.dumps(sys.executable))'],
      { encoding: 'utf8', timeout: 10000, maxBuffer: 4096 },
    ),
  );
}
if (
  typeof python !== 'string' ||
  !path.isAbsolute(python) ||
  ['\r', '\n', '\0'].some((char) => python.includes(char))
)
  throw Error('Source tests require an absolute Python executable');
if (!statSync(python).isFile())
  throw Error('Source tests require a Python executable file');
accessSync(python, constants.X_OK);
// Windows X_OK also accepts ordinary files. Probe the exact selected runtime
// without site startup code, source imports, bytecode writes or shell fallback.
const version = execFileSync(
  python,
  ['-I', '-S', '-B', '-c', 'import sys\nprint(sys.version_info.major)'],
  {
    encoding: 'utf8',
    timeout: 10000,
    maxBuffer: 4096,
    killSignal: 'SIGKILL',
    shell: false,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  },
);
if (version.trim() !== '3')
  throw Error('Source tests require a working Python 3 executable');
process.env.OBSERVATORY_PYTHON = python;
