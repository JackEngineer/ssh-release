import { mkdtemp, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { runProcess } from './process.js';

export interface CreateReleasePackageOptions {
  sourcePath: string;
  exclude: string[];
  versionName: string;
}

export interface ReleasePackage {
  archivePath: string;
  cleanup: () => Promise<void>;
}

export async function createReleasePackage(
  options: CreateReleasePackageOptions,
): Promise<ReleasePackage> {
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'ssh-release-'));
  const archivePath = path.join(tempDirectory, `${options.versionName}.tgz`);
  const sourceStat = await stat(options.sourcePath);
  const excludeArgs = options.exclude.flatMap((pattern) => ['--exclude', pattern]);

  if (sourceStat.isDirectory()) {
    await runProcess('tar', [
      '-czf',
      archivePath,
      ...excludeArgs,
      '-C',
      options.sourcePath,
      '.',
    ]);
  } else {
    await runProcess('tar', [
      '-czf',
      archivePath,
      ...excludeArgs,
      '-C',
      path.dirname(options.sourcePath),
      path.basename(options.sourcePath),
    ]);
  }

  return {
    archivePath,
    cleanup: async () => {
      await rm(tempDirectory, { recursive: true, force: true });
    },
  };
}

export async function listPackageEntries(archivePath: string): Promise<string[]> {
  const result = await runProcess('tar', ['-tzf', archivePath]);

  return result.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}
