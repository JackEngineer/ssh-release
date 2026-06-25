import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createReleasePackage, listPackageEntries } from '../src/package.js';

test('creates a tgz package from directory contents and respects excludes', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ssh-release-package-'));
  const sourcePath = path.join(root, 'dist');
  await mkdir(path.join(sourcePath, 'assets'), { recursive: true });
  await writeFile(path.join(sourcePath, 'index.html'), '<h1>ok</h1>');
  await writeFile(path.join(sourcePath, 'assets', 'app.js'), 'console.log("ok");');
  await writeFile(path.join(sourcePath, '.DS_Store'), 'ignored');

  const releasePackage = await createReleasePackage({
    sourcePath,
    exclude: ['.DS_Store'],
    versionName: '20260625-153000',
  });

  const entries = await listPackageEntries(releasePackage.archivePath);

  assert.deepEqual(entries.sort(), ['./', './assets/', './assets/app.js', './index.html']);
  assert.equal(await readFile(releasePackage.archivePath).then((buffer) => buffer.length > 0), true);

  await releasePackage.cleanup();
});

test('creates a tgz package from a single file', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ssh-release-file-package-'));
  const sourcePath = path.join(root, 'robots.txt');
  await writeFile(sourcePath, 'User-agent: *');

  const releasePackage = await createReleasePackage({
    sourcePath,
    exclude: [],
    versionName: '20260625-153001',
  });

  const entries = await listPackageEntries(releasePackage.archivePath);

  assert.deepEqual(entries, ['robots.txt']);

  await releasePackage.cleanup();
});
