import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createReleaseManifest } from '../src/manifest.js';

test('creates a release manifest with relative file paths, sizes, and hashes', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ssh-release-manifest-'));
  const sourcePath = path.join(root, 'dist');
  await mkdir(path.join(sourcePath, 'assets'), { recursive: true });
  await writeFile(path.join(sourcePath, 'index.html'), '<h1>ok</h1>');
  await writeFile(path.join(sourcePath, 'assets', 'app.js'), 'console.log("ok");');
  await writeFile(path.join(sourcePath, '.DS_Store'), 'ignored');

  const manifest = await createReleaseManifest({
    version: '20260625-153000',
    createdAt: new Date('2026-06-25T07:30:00.000Z'),
    sourcePath,
    exclude: ['.DS_Store'],
  });

  assert.equal(manifest.version, '20260625-153000');
  assert.equal(manifest.createdAt, '2026-06-25T07:30:00.000Z');
  assert.deepEqual(manifest.source, {
    path: sourcePath,
    type: 'directory',
    exclude: ['.DS_Store'],
  });
  assert.deepEqual(manifest.files, [
    {
      path: 'assets/app.js',
      size: Buffer.byteLength('console.log("ok");'),
      sha256: sha256('console.log("ok");'),
    },
    {
      path: 'index.html',
      size: Buffer.byteLength('<h1>ok</h1>'),
      sha256: sha256('<h1>ok</h1>'),
    },
  ]);
  assert.deepEqual(manifest.totals, {
    files: 2,
    bytes: Buffer.byteLength('console.log("ok");') + Buffer.byteLength('<h1>ok</h1>'),
  });
}
);

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}
