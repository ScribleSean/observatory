import test from 'node:test';
import { execPython } from './test-python.mjs';

test('source Python runner selection, isolation and fail-closed contracts', () => {
  execPython(
    [
      '-m',
      'unittest',
      'discover',
      '-s',
      'native/tests',
      '-p',
      'test_source_runtime.py',
      '-v',
    ],
    { encoding: 'utf8', timeout: 30000, stdio: 'pipe' },
  );
});
