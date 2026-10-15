export function needsWindowsSetup(value) {
  return value?.version === 1 && value?.platform === 'windows' && value?.configured === false;
}
