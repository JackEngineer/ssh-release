import assert from 'node:assert/strict';
import test from 'node:test';

import { runCli } from '../src/cli.js';

test('dispatches deploy, rollback, list, and doctor commands', async () => {
  const calls: string[] = [];
  const stdout: string[] = [];
  const stderr: string[] = [];

  const base = {
    io: {
      log: (message: string) => stdout.push(message),
      error: (message: string) => stderr.push(message),
    },
    handlers: {
      init: async () => {
        calls.push('init');
      },
      deploy: async () => {
        calls.push('deploy');
        return {
          mode: 'release' as const,
          version: '20260625-153000',
          targetPath: '/var/www/site/releases/20260625-153000',
          currentSymlink: '/var/www/site/current',
          usedFallback: false,
          warnings: [],
        };
      },
      rollback: async (version?: string) => {
        calls.push(`rollback:${version ?? ''}`);
        return {
          version: version ?? '20260625-150000',
          currentSymlink: '/var/www/site/current',
        };
      },
      list: async () => {
        calls.push('list');
        return {
          mode: 'release' as const,
          targetPath: '/var/www/site',
          currentVersion: '20260625-153000',
          releases: [],
        };
      },
      doctor: async () => {
        calls.push('doctor');
        return {
          ok: true,
          checks: [],
        };
      },
    },
  };

  assert.equal(await runCli(['deploy'], base), 0);
  assert.equal(await runCli(['rollback', '20260625-120000'], base), 0);
  assert.equal(await runCli(['list'], base), 0);
  assert.equal(await runCli(['doctor'], base), 0);

  assert.deepEqual(calls, [
    'deploy',
    'rollback:20260625-120000',
    'list',
    'doctor',
  ]);
  assert.equal(stderr.length, 0);
  assert.equal(stdout.some((line) => line.includes('命令尚未实现')), false);
});
