import path from 'node:path';

import type { RemoteClient } from './ssh.js';

export interface ReleaseEntry {
  version: string;
  modifiedAt: Date;
}

export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function remoteJoin(...parts: string[]): string {
  return path.posix.join(...parts);
}

export async function readRemoteReleaseNames(
  client: RemoteClient,
  releasesPath: string,
): Promise<string[]> {
  const result = await client.exec(`if [ -d ${shellQuote(releasesPath)} ]; then for release_path in ${shellQuote(releasesPath)}/*; do [ -d "$release_path" ] || continue; basename "$release_path"; done; fi`);

  return result.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .sort();
}

export async function readRemoteReleaseEntries(
  client: RemoteClient,
  releasesPath: string,
): Promise<ReleaseEntry[]> {
  const result = await client.exec(`if [ -d ${shellQuote(releasesPath)} ]; then for release_path in ${shellQuote(releasesPath)}/*; do [ -d "$release_path" ] || continue; version=$(basename "$release_path"); modified=$(stat -c %Y "$release_path" 2>/dev/null || stat -f %m "$release_path" 2>/dev/null || echo 0); printf '%s\\t%s\\n' "$version" "$modified"; done; fi`);

  return result.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [version, modifiedAtSeconds = '0'] = line.split('\t');
      return {
        version,
        modifiedAt: new Date(Number(modifiedAtSeconds) * 1000),
      };
    })
    .sort((left, right) => left.version.localeCompare(right.version));
}

export async function readCurrentVersion(
  client: RemoteClient,
  currentSymlinkPath: string,
): Promise<string | undefined> {
  const result = await client.exec(`readlink ${shellQuote(currentSymlinkPath)} 2>/dev/null || true`);
  const linkTarget = result.stdout.trim();

  if (!linkTarget) {
    return undefined;
  }

  return path.posix.basename(linkTarget);
}
