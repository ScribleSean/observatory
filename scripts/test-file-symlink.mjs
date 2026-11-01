import { symlink } from 'node:fs/promises';

export async function fileSymlinkOrSkip(t, target, link) {
  try {
    await symlink(target, link, 'file');
  } catch (error) {
    if (process.platform !== 'win32' || error.code !== 'EPERM') throw error;
    t.skip('Windows file symlink creation is unavailable (EPERM)');
    return false;
  }
  return true;
}
