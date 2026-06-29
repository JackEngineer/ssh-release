import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { isExcludedPath } from '../src/exclude.js';
import { walkDirectory, type RemoteClient } from '../src/ssh.js';
import type { ProcessResult } from '../src/process.js';

test('matches a bare pattern against any nested path segment', () => {
  assert.equal(isExcludedPath('node_modules/dep.js', ['node_modules']), true);
  assert.equal(isExcludedPath('sub/node_modules/nested.js', ['node_modules']), true);
  assert.equal(isExcludedPath('.DS_Store', ['.DS_Store']), true);
  assert.equal(isExcludedPath('src/app.js', ['node_modules']), false);
});

test('matches path patterns with wildcards', () => {
  assert.equal(isExcludedPath('dist/app.map', ['dist/*.map']), true);
  assert.equal(isExcludedPath('dist/app.js', ['dist/*.map']), false);
  assert.equal(isExcludedPath('logs/error.log', ['logs/error.log']), true);
  assert.equal(isExcludedPath('logs/access.log', ['logs/error.log']), false);
});

test('fallback directory upload skips nested excludes consistently', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ssh-release-walk-'));
  await mkdir(path.join(root, 'node_modules'), { recursive: true });
  await mkdir(path.join(root, 'sub', 'node_modules'), { recursive: true });
  await mkdir(path.join(root, 'dist'), { recursive: true });
  await writeFile(path.join(root, 'keep.txt'), 'keep');
  await writeFile(path.join(root, 'node_modules', 'dep.js'), 'dep');
  await writeFile(path.join(root, 'sub', 'app.js'), 'app');
  await writeFile(path.join(root, 'sub', 'node_modules', 'nested.js'), 'nested');
  await writeFile(path.join(root, 'dist', 'app.js'), 'bundle');
  await writeFile(path.join(root, 'dist', 'app.map'), 'sourcemap');

  const uploadedRemotePaths: string[] = [];
  const client: RemoteClient = {
    exec: async (): Promise<ProcessResult> => ({ stdout: '', stderr: '' }),
    uploadFile: async (_localPath: string, remotePath: string): Promise<void> => {
      uploadedRemotePaths.push(remotePath);
    },
    uploadDirectory: async (): Promise<void> => {},
  };

  await walkDirectory(client, root, '/remote', ['node_modules', 'dist/*.map']);

  assert.deepEqual(uploadedRemotePaths.sort(), [
    '/remote/dist/app.js',
    '/remote/keep.txt',
    '/remote/sub/app.js',
  ]);
});
