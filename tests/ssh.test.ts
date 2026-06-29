import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  createScpProcessSpec,
  createScpRemoteTarget,
  createSshProcessSpec,
  isRetryableSshProcessError,
  ShellRemoteClient,
} from '../src/ssh.js';

test('formats scp remote target without shell quote characters', () => {
  assert.equal(
    createScpRemoteTarget('deploy@example.com', '/var/www/site/.ssh-release-tmp/release.tgz'),
    'deploy@example.com:/var/www/site/.ssh-release-tmp/release.tgz',
  );
});

test('uses sshpass with SSHPASS environment for password ssh commands', () => {
  const spec = createSshProcessSpec({
    host: 'example.com',
    port: 22,
    username: 'deploy',
    password: 'secret-password',
  }, 'true');

  assert.equal(spec.command, 'sshpass');
  assert.deepEqual(spec.args.slice(0, 2), ['-e', 'ssh']);
  assert.equal(spec.env?.SSHPASS, 'secret-password');
  assert.equal(spec.args.includes('secret-password'), false);
  assert.equal(spec.args.includes('BatchMode=yes'), false);
  assert.equal(spec.args.includes('-i'), false);
  assert.equal(spec.args.includes('StrictHostKeyChecking=accept-new'), true);
  assert.equal(spec.args.includes('NumberOfPasswordPrompts=1'), true);
  assert.equal(spec.args.includes('ConnectTimeout=15'), true);
  assert.equal(spec.args.includes('ServerAliveInterval=15'), true);
  assert.equal(spec.args.includes('ServerAliveCountMax=2'), true);
});

test('uses sshpass with SSHPASS environment for password scp commands', () => {
  const spec = createScpProcessSpec({
    host: 'example.com',
    port: 22,
    username: 'deploy',
    password: 'secret-password',
  }, '/tmp/local.tgz', '/tmp/remote.tgz');

  assert.equal(spec.command, 'sshpass');
  assert.deepEqual(spec.args.slice(0, 2), ['-e', 'scp']);
  assert.equal(spec.env?.SSHPASS, 'secret-password');
  assert.equal(spec.args.includes('secret-password'), false);
  assert.equal(spec.args.includes('BatchMode=yes'), false);
  assert.equal(spec.args.includes('-i'), false);
  assert.equal(spec.args.includes('StrictHostKeyChecking=accept-new'), true);
  assert.equal(spec.args.includes('NumberOfPasswordPrompts=1'), true);
  assert.equal(spec.args.includes('ConnectTimeout=15'), true);
  assert.equal(spec.args.includes('ServerAliveInterval=15'), true);
  assert.equal(spec.args.includes('ServerAliveCountMax=2'), true);
});

test('keeps private key ssh commands in batch mode', () => {
  const spec = createSshProcessSpec({
    host: 'example.com',
    port: 22,
    username: 'deploy',
    privateKeyPath: '/Users/example/.ssh/id_rsa',
  }, 'true');

  assert.equal(spec.command, 'ssh');
  assert.equal(spec.args.includes('-i'), true);
  assert.equal(spec.args.includes('/Users/example/.ssh/id_rsa'), true);
  assert.equal(spec.args.includes('BatchMode=yes'), true);
  assert.equal(spec.args.includes('ConnectTimeout=15'), true);
  assert.equal(spec.args.includes('ServerAliveInterval=15'), true);
  assert.equal(spec.args.includes('ServerAliveCountMax=2'), true);
  assert.equal(spec.env, undefined);
});

test('classifies transient ssh transport errors without retrying plain auth failures', () => {
  assert.equal(
    isRetryableSshProcessError(new Error('sshpass 执行失败: scp: Connection closed')),
    true,
  );
  assert.equal(
    isRetryableSshProcessError(new Error('ssh 执行失败: kex_exchange_identification: banner exchange')),
    true,
  );
  assert.equal(
    isRetryableSshProcessError(new Error('ssh 执行失败: Permission denied (publickey,password).')),
    false,
  );
});

test('retries transient password ssh command failures before succeeding', async () => {
  await withFakeSshpass('kex_exchange_identification: Connection closed by remote host', async (attemptsPath) => {
    const client = new ShellRemoteClient({
      host: 'example.com',
      port: 22,
      username: 'deploy',
      password: 'secret-password',
    });

    await client.exec('true');

    assert.equal(await readFile(attemptsPath, 'utf8'), '3');
  });
});

test('retries transient password scp upload failures before succeeding', async () => {
  await withFakeSshpass('scp: Connection closed', async (attemptsPath) => {
    const client = new ShellRemoteClient({
      host: 'example.com',
      port: 22,
      username: 'deploy',
      password: 'secret-password',
    });

    await client.uploadFile('/tmp/local.tgz', '/tmp/remote.tgz');

    assert.equal(await readFile(attemptsPath, 'utf8'), '3');
  });
});

async function withFakeSshpass(
  errorMessage: string,
  callback: (attemptsPath: string) => Promise<void>,
): Promise<void> {
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'ssh-release-ssh-'));
  const attemptsPath = path.join(tempDirectory, 'attempts.txt');
  const sshpassPath = path.join(tempDirectory, 'sshpass');
  const previousPath = process.env.PATH;
  const previousErrorMessage = process.env.SSH_RELEASE_FAKE_SSH_ERROR;

  await writeFile(sshpassPath, `#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const attemptsPath = process.env.SSH_RELEASE_FAKE_ATTEMPTS;
if (!attemptsPath) {
  console.error('missing attempts path');
  process.exit(2);
}

const attempts = existsSync(attemptsPath)
  ? Number(readFileSync(attemptsPath, 'utf8'))
  : 0;
const nextAttempt = attempts + 1;
writeFileSync(attemptsPath, String(nextAttempt));

if (nextAttempt < 3) {
  console.error(process.env.SSH_RELEASE_FAKE_SSH_ERROR || 'scp: Connection closed');
  process.exit(255);
}
`);
  await chmod(sshpassPath, 0o755);

  process.env.PATH = `${tempDirectory}${path.delimiter}${previousPath ?? ''}`;
  process.env.SSH_RELEASE_FAKE_ATTEMPTS = attemptsPath;
  process.env.SSH_RELEASE_FAKE_SSH_ERROR = errorMessage;

  try {
    await callback(attemptsPath);
  } finally {
    process.env.PATH = previousPath;
    delete process.env.SSH_RELEASE_FAKE_ATTEMPTS;

    if (previousErrorMessage === undefined) {
      delete process.env.SSH_RELEASE_FAKE_SSH_ERROR;
    } else {
      process.env.SSH_RELEASE_FAKE_SSH_ERROR = previousErrorMessage;
    }

    await rm(tempDirectory, { recursive: true, force: true });
  }
}
