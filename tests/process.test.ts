import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { runProcess } from '../src/process.js';

test('retries a transient process failure when retry options allow it', async () => {
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'ssh-release-process-'));
  const attemptsPath = path.join(tempDirectory, 'attempts.txt');
  const scriptPath = path.join(tempDirectory, 'flaky.mjs');

  await writeFile(scriptPath, `
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const attemptsPath = process.argv[2];
const attempts = existsSync(attemptsPath)
  ? Number(readFileSync(attemptsPath, 'utf8'))
  : 0;
const nextAttempt = attempts + 1;

writeFileSync(attemptsPath, String(nextAttempt));

if (nextAttempt < 3) {
  console.error('scp: Connection closed');
  process.exit(255);
}

console.log('ok');
`);

  try {
    const result = await runProcess(process.execPath, [scriptPath, attemptsPath], {
      retry: {
        attempts: 3,
        delayMs: 0,
        shouldRetry: (error) => error.message.includes('Connection closed'),
      },
    });

    assert.equal(result.stdout.trim(), 'ok');
    assert.equal(await readFile(attemptsPath, 'utf8'), '3');
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
  }
});
