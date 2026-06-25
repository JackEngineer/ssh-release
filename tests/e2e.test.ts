import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, readlink, readdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { runCli } from '../src/cli.js';

test('runs release, list, rollback, fallback, and overwrite through ssh and scp processes', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ssh-release-e2e-'));
  const fakeBin = path.join(root, 'bin');
  const projectPath = path.join(root, 'project');
  const sourcePath = path.join(projectPath, 'dist');
  const targetPath = path.join(root, 'remote', 'site');
  const previousCwd = process.cwd();
  const previousPath = process.env.PATH;
  const previousTarFail = process.env.SSH_RELEASE_FAKE_TAR_FAIL;

  await mkdir(fakeBin, { recursive: true });
  await mkdir(sourcePath, { recursive: true });
  await writeFakeSsh(fakeBin);
  await writeFakeScp(fakeBin);

  process.env.PATH = `${fakeBin}${path.delimiter}${previousPath ?? ''}`;

  try {
    process.chdir(projectPath);
    await writeConfig(targetPath, 'release');
    await writeFile(path.join(sourcePath, 'index.html'), 'release v1');

    const doctor = await runWithOutput(['doctor']);
    assert.equal(doctor.exitCode, 0);
    assert.ok(doctor.stdout.some((line) => line.includes('[pass] SSH 连接')));

    const deploy = await runWithOutput(['deploy']);
    assert.equal(deploy.exitCode, 0);
    assert.ok(deploy.stdout.some((line) => line.includes('发布成功')));

    const releasesAfterDeploy = await readdir(path.join(targetPath, 'releases'));
    assert.equal(releasesAfterDeploy.length, 1);
    const firstVersion = releasesAfterDeploy[0];
    assert.equal(
      await readFile(path.join(targetPath, 'releases', firstVersion, 'index.html'), 'utf8'),
      'release v1',
    );
    assert.equal(await readlink(path.join(targetPath, 'current')), `releases/${firstVersion}`);

    const list = await runWithOutput(['list']);
    assert.equal(list.exitCode, 0);
    assert.ok(list.stdout.some((line) => line.includes(firstVersion)));

    await mkdir(path.join(targetPath, 'releases', '20200101-010101'), { recursive: true });
    await mkdir(path.join(targetPath, 'releases', '20200101-010102'), { recursive: true });
    await writeFile(path.join(sourcePath, 'index.html'), 'release fallback');
    await waitForNextSecond();
    process.env.SSH_RELEASE_FAKE_TAR_FAIL = '1';

    const fallbackDeploy = await runWithOutput(['deploy']);
    assert.equal(fallbackDeploy.exitCode, 0);
    assert.ok(fallbackDeploy.stdout.some((line) => line.includes('逐文件上传')));
    process.env.SSH_RELEASE_FAKE_TAR_FAIL = previousTarFail;

    const releasesAfterFallback = (await readdir(path.join(targetPath, 'releases'))).sort();
    assert.equal(releasesAfterFallback.includes('20200101-010101'), false);
    assert.equal(releasesAfterFallback.length, 2);
    const currentBeforeRollback = path.basename(await readlink(path.join(targetPath, 'current')));
    assert.equal(
      await readFile(path.join(targetPath, 'releases', currentBeforeRollback, 'index.html'), 'utf8'),
      'release fallback',
    );

    const rollback = await runWithOutput(['rollback']);
    assert.equal(rollback.exitCode, 0);
    assert.equal(await readlink(path.join(targetPath, 'current')), `releases/${firstVersion}`);

    await writeConfig(targetPath, 'overwrite');
    await writeFile(path.join(sourcePath, 'index.html'), 'overwrite fallback');
    process.env.SSH_RELEASE_FAKE_TAR_FAIL = '1';

    const overwriteDeploy = await runWithOutput(['deploy']);
    assert.equal(overwriteDeploy.exitCode, 0);
    assert.ok(overwriteDeploy.stdout.some((line) => line.includes('覆盖发布成功')));
    assert.equal(await readFile(path.join(targetPath, 'index.html'), 'utf8'), 'overwrite fallback');
  } finally {
    process.chdir(previousCwd);
    process.env.PATH = previousPath;

    if (previousTarFail === undefined) {
      delete process.env.SSH_RELEASE_FAKE_TAR_FAIL;
    } else {
      process.env.SSH_RELEASE_FAKE_TAR_FAIL = previousTarFail;
    }
  }
});

async function waitForNextSecond(): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, 1100);
  });
}

async function runWithOutput(args: string[]): Promise<{
  exitCode: number;
  stdout: string[];
  stderr: string[];
}> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const exitCode = await runCli(args, {
    io: {
      log: (message) => stdout.push(message),
      error: (message) => stderr.push(message),
    },
  });

  return { exitCode, stdout, stderr };
}

async function writeConfig(targetPath: string, mode: 'release' | 'overwrite'): Promise<void> {
  await writeFile('ssh-release.config.ts', `export default {
  source: {
    path: './dist',
    exclude: [],
  },
  server: {
    host: 'example.com',
    username: 'deploy',
    privateKeyPath: '~/.ssh/id_rsa',
  },
  target: {
    path: ${JSON.stringify(targetPath)},
  },
  deploy: {
    mode: '${mode}',
    keepReleases: 2,
  },
};
`);
}

async function writeFakeSsh(fakeBin: string): Promise<void> {
  const scriptPath = path.join(fakeBin, 'ssh');
  await writeFile(scriptPath, `#!/bin/sh
set -eu
while [ "$#" -gt 0 ]; do
  case "$1" in
    -p|-i|-o)
      shift 2
      ;;
    -*)
      shift
      ;;
    *)
      shift
      break
      ;;
  esac
done
command="$*"
case "$command" in
  tar\\ -xzf*)
    if [ "\${SSH_RELEASE_FAKE_TAR_FAIL:-}" = "1" ]; then
      echo "fake tar failure" >&2
      exit 42
    fi
    ;;
esac
sh -c "$command"
`);
  await chmod(scriptPath, 0o755);
}

async function writeFakeScp(fakeBin: string): Promise<void> {
  const scriptPath = path.join(fakeBin, 'scp');
  await writeFile(scriptPath, `#!/bin/sh
set -eu
while [ "$#" -gt 0 ]; do
  case "$1" in
    -P|-i|-o)
      shift 2
      ;;
    -*)
      shift
      ;;
    *)
      break
      ;;
  esac
done
source_path="$1"
remote_target="$2"
remote_path="\${remote_target#*:}"
mkdir -p "$(dirname "$remote_path")"
cp "$source_path" "$remote_path"
`);
  await chmod(scriptPath, 0o755);
}
