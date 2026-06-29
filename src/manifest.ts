import { createHash } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { isExcludedPath, toPosixPath } from './exclude.js';

export interface ReleaseManifestFile {
  path: string;
  size: number;
  sha256: string;
}

export interface ReleaseManifest {
  version: string;
  createdAt: string;
  source: {
    path: string;
    type: 'directory' | 'file';
    exclude: string[];
  };
  files: ReleaseManifestFile[];
  totals: {
    files: number;
    bytes: number;
  };
}

export interface CreateReleaseManifestOptions {
  version: string;
  createdAt: Date;
  sourcePath: string;
  exclude: string[];
}

export interface WrittenReleaseManifest {
  localPath: string;
  sha256: string;
  cleanup: () => Promise<void>;
}

export async function createReleaseManifest(
  options: CreateReleaseManifestOptions,
): Promise<ReleaseManifest> {
  const sourceStat = await stat(options.sourcePath);
  const files = sourceStat.isDirectory()
    ? await collectDirectoryFiles(options.sourcePath, options.exclude)
    : [await createManifestFileEntry(options.sourcePath, path.basename(options.sourcePath))];

  const sortedFiles = files.sort((left, right) => left.path.localeCompare(right.path));

  return {
    version: options.version,
    createdAt: options.createdAt.toISOString(),
    source: {
      path: options.sourcePath,
      type: sourceStat.isDirectory() ? 'directory' : 'file',
      exclude: options.exclude,
    },
    files: sortedFiles,
    totals: {
      files: sortedFiles.length,
      bytes: sortedFiles.reduce((total, file) => total + file.size, 0),
    },
  };
}

export async function writeReleaseManifest(
  manifest: ReleaseManifest,
): Promise<WrittenReleaseManifest> {
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'ssh-release-manifest-'));
  const localPath = path.join(tempDirectory, 'manifest.json');
  const content = `${JSON.stringify(manifest, null, 2)}\n`;
  await writeFile(localPath, content);

  return {
    localPath,
    sha256: createHash('sha256').update(content).digest('hex'),
    cleanup: async () => {
      await rm(tempDirectory, { recursive: true, force: true });
    },
  };
}

async function collectDirectoryFiles(
  sourcePath: string,
  exclude: string[],
  relativeDirectory = '',
): Promise<ReleaseManifestFile[]> {
  const entries = await readdir(path.join(sourcePath, relativeDirectory), { withFileTypes: true });
  const files: ReleaseManifestFile[] = [];

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const relativePath = toPosixPath(path.join(relativeDirectory, entry.name));

    if (isExcludedPath(relativePath, exclude)) {
      continue;
    }

    const localPath = path.join(sourcePath, relativePath);

    if (entry.isDirectory()) {
      files.push(...await collectDirectoryFiles(sourcePath, exclude, relativePath));
      continue;
    }

    if (entry.isFile()) {
      files.push(await createManifestFileEntry(localPath, relativePath));
    }
  }

  return files;
}

async function createManifestFileEntry(
  localPath: string,
  relativePath: string,
): Promise<ReleaseManifestFile> {
  const content = await readFile(localPath);

  return {
    path: toPosixPath(relativePath),
    size: content.byteLength,
    sha256: createHash('sha256').update(content).digest('hex'),
  };
}
