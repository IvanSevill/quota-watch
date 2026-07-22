import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createProjectPythonPathPlugin } from '../opencode/project-python-path.mjs';

const PROJECT_ROOT = 'C:\\workspace\\python-app';
const PYTHON_PATH = `${PROJECT_ROOT}\\backend\\.venv\\Scripts`;

async function hooks(baselineEnv = {}) {
  return createProjectPythonPathPlugin({
    projects: [{ root: PROJECT_ROOT, pythonDirectory: 'backend\\.venv\\Scripts' }],
    baselineEnv,
  })();
}

test('prepends the configured Python directory within the project tree', async () => {
  const pluginHooks = await hooks({ PATH: 'D:\\fallback' });
  const output = { env: { Path: 'C:\\Windows\\System32;C:\\tools' } };

  await pluginHooks['shell.env']({ cwd: `${PROJECT_ROOT}\\backend\\app` }, output);

  assert.equal(output.env.Path, `${PYTHON_PATH};C:\\Windows\\System32;C:\\tools`);
});

test('uses the process PATH baseline when OpenCode supplies an empty environment', async () => {
  const pluginHooks = await hooks({ Path: 'C:\\Windows\\System32;C:\\tools' });
  const output = { env: {} };

  await pluginHooks['shell.env']({ cwd: PROJECT_ROOT }, output);

  assert.equal(output.env.Path, `${PYTHON_PATH};C:\\Windows\\System32;C:\\tools`);
});

test('leaves the environment untouched when the hook output has no PATH', async () => {
  const pluginHooks = await hooks();
  const output = { env: { COMSPEC: 'C:\\Windows\\System32\\cmd.exe' } };

  await pluginHooks['shell.env']({ cwd: PROJECT_ROOT }, output);

  assert.deepEqual(output.env, { COMSPEC: 'C:\\Windows\\System32\\cmd.exe' });
  assert.equal(Object.keys(output.env).some((key) => key.toLowerCase() === 'path'), false);
});

test('leaves an empty PATH untouched instead of replacing it', async () => {
  const pluginHooks = await hooks();
  const output = { env: { Path: '' } };

  await pluginHooks['shell.env']({ cwd: PROJECT_ROOT }, output);

  assert.deepEqual(output.env, { Path: '' });
});

test('does not modify PATH outside the configured project boundary', async () => {
  const pluginHooks = await hooks();
  const output = { env: { Path: 'C:\\Windows\\System32' } };

  await pluginHooks['shell.env']({ cwd: 'C:\\workspace\\python-app-copy' }, output);

  assert.equal(output.env.Path, 'C:\\Windows\\System32');
});

test('preserves the existing PATH key and avoids duplicate entries case-insensitively', async () => {
  const pluginHooks = await hooks();
  const output = { env: { PATH: `c:\\WORKSPACE\\PYTHON-APP\\backend\\.venv\\Scripts;C:\\tools` } };

  await pluginHooks['shell.env']({ cwd: PROJECT_ROOT.toUpperCase() }, output);

  assert.deepEqual(output.env, {
    PATH: `c:\\WORKSPACE\\PYTHON-APP\\backend\\.venv\\Scripts;C:\\tools`,
  });
});

test('supports multiple independently scoped projects', async () => {
  const plugin = createProjectPythonPathPlugin({
    projects: [
      { root: PROJECT_ROOT, pythonDirectory: 'backend\\.venv\\Scripts' },
      { root: 'D:\\other', pythonDirectory: '.venv\\Scripts' },
    ],
  });
  const pluginHooks = await plugin();
  const output = { env: { Path: 'C:\\tools' } };

  await pluginHooks['shell.env']({ cwd: 'D:\\other\\src' }, output);

  assert.equal(output.env.Path, 'D:\\other\\.venv\\Scripts;C:\\tools');
});

test('rejects Python directories outside the configured project', () => {
  assert.throws(() => createProjectPythonPathPlugin({
    projects: [{ root: PROJECT_ROOT, pythonDirectory: '..\\shared-venv\\Scripts' }],
  }), /must stay inside/);
  assert.throws(() => createProjectPythonPathPlugin({
    projects: [{ root: PROJECT_ROOT, pythonDirectory: 'D:\\shared-venv\\Scripts' }],
  }), /must be relative/);
});
