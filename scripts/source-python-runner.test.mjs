import test from 'node:test';
import { execPython } from './test-python.mjs';

// Children and POSIX locks are modeled. The Python suite never launches a
// collector, contacts a provider or queries platform access-control state.
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
