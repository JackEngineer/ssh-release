import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { loadConfigFile, resolveUserPath } from '../src/config.js';

test('loads and normalizes a TypeScript config file', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'ssh-release-config-'));
  const configPath = path.join(directory, 'ssh-release.config.ts');

  process.env.SSH_RELEASE_HOST = 'example.com';
  process.env.SSH_RELEASE_USER = 'deploy';

  await writeFile(configPath, `export default {
  source: {
    path: './public',
  },
  server: {
    host: process.env.SSH_RELEASE_HOST,
    username: process.env.SSH_RELEASE_USER,
    privateKeyPath: '~/.ssh/id_ed25519',
  },
  target: {
    path: '/var/www/site',
  },
};
`);

  const config = await loadConfigFile(configPath);

  assert.equal(config.source.path, './public');
  assert.equal(config.source.exclude.length, 0);
  assert.equal(config.server.host, 'example.com');
  assert.equal(config.server.username, 'deploy');
  assert.equal(config.server.port, 22);
  assert.equal(config.server.privateKeyPath, path.join(os.homedir(), '.ssh/id_ed25519'));
  assert.equal(config.target.path, '/var/www/site');
  assert.equal(config.deploy.mode, 'release');
});

test('loads password authentication from environment without requiring a private key', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'ssh-release-password-config-'));
  const configPath = path.join(directory, 'ssh-release.config.ts');
  const previousPassword = process.env.SSH_RELEASE_PASSWORD;

  process.env.SSH_RELEASE_PASSWORD = 'secret-password';

  await writeFile(configPath, `export default {
  source: {
    path: './public',
  },
  server: {
    host: 'example.com',
    username: 'deploy',
    password: process.env.SSH_RELEASE_PASSWORD,
  },
  target: {
    path: '/var/www/site',
  },
};
`);

  try {
    const config = await loadConfigFile(configPath);

    assert.equal(config.server.password, 'secret-password');
    assert.equal(config.server.privateKeyPath, undefined);
  } finally {
    if (previousPassword === undefined) {
      delete process.env.SSH_RELEASE_PASSWORD;
    } else {
      process.env.SSH_RELEASE_PASSWORD = previousPassword;
    }
  }
});

test('resolveUserPath expands a leading home directory marker', () => {
  assert.equal(resolveUserPath('~/.ssh/id_rsa'), path.join(os.homedir(), '.ssh/id_rsa'));
  assert.equal(resolveUserPath('/tmp/id_rsa'), '/tmp/id_rsa');
});
