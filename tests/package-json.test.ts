import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

interface PackageJson {
  bin?: Record<string, string>;
  engines?: Record<string, string>;
  files?: string[];
  scripts?: Record<string, string>;
}

test('declares npm publish boundaries and verification hooks', async () => {
  const packageJson = JSON.parse(
    await readFile(new URL('../package.json', import.meta.url), 'utf8'),
  ) as PackageJson;

  assert.deepEqual(packageJson.bin, {
    'ssh-release': './dist/cli.js',
  });
  assert.deepEqual(packageJson.files, [
    'dist',
    'README.md',
    'LICENSE',
  ]);
  assert.equal(packageJson.engines?.node, '>=20.0.0');
  assert.equal(packageJson.scripts?.prepack, 'npm run build');
  assert.equal(packageJson.scripts?.prepublishOnly, 'npm run lint && npm test && npm run build');
});
