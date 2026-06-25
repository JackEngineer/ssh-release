import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createScpProcessSpec,
  createScpRemoteTarget,
  createSshProcessSpec,
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
  assert.equal(spec.env, undefined);
});
