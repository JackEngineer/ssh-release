import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

interface PackageJson {
  bin?: Record<string, string>;
  bugs?: {
    url?: string;
  };
  engines?: Record<string, string>;
  files?: string[];
  homepage?: string;
  repository?: {
    type?: string;
    url?: string;
  };
  scripts?: Record<string, string>;
  version?: string;
}

test('declares npm publish boundaries and verification hooks', async () => {
  const packageJson = JSON.parse(
    await readFile(new URL('../package.json', import.meta.url), 'utf8'),
  ) as PackageJson;

  assert.deepEqual(packageJson.bin, {
    'ssh-release': 'dist/cli.js',
  });
  assert.deepEqual(packageJson.files, [
    'dist',
    'examples',
    'README.md',
    'CHANGELOG.md',
    'LICENSE',
  ]);
  assert.equal(packageJson.engines?.node, '>=20.0.0');
  assert.deepEqual(packageJson.repository, {
    type: 'git',
    url: 'git+https://github.com/JackEngineer/ssh-release.git',
  });
  assert.deepEqual(packageJson.bugs, {
    url: 'https://github.com/JackEngineer/ssh-release/issues',
  });
  assert.equal(packageJson.homepage, 'https://github.com/JackEngineer/ssh-release#readme');
  assert.equal(packageJson.scripts?.prepack, 'npm run build');
  assert.equal(packageJson.scripts?.prepublishOnly, 'npm run lint && npm test && npm run build');
  assert.equal(packageJson.scripts?.['release:preflight'], 'bash scripts/release-preflight.sh');
  assert.equal(packageJson.scripts?.['release:postcheck'], 'bash scripts/release-postcheck.sh');
});

test('prepares the next minor release version', async () => {
  const packageJson = JSON.parse(
    await readFile(new URL('../package.json', import.meta.url), 'utf8'),
  ) as PackageJson;

  assert.equal(packageJson.version, '1.5.0');
});
