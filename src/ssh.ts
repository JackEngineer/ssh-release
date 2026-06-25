import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';

import { runProcess, type ProcessResult } from './process.js';
import { remoteJoin, shellQuote } from './remote.js';
import type { SshReleaseConfig } from './types.js';

export interface RemoteClient {
  exec(command: string): Promise<ProcessResult>;
  uploadFile(localPath: string, remotePath: string): Promise<void>;
  uploadDirectory(localPath: string, remotePath: string, exclude: string[]): Promise<void>;
}

export class ShellRemoteClient implements RemoteClient {
  private readonly destination: string;
  private readonly sshArgs: string[];
  private readonly scpArgs: string[];

  constructor(private readonly server: SshReleaseConfig['server']) {
    this.destination = `${server.username}@${server.host}`;
    this.sshArgs = [
      '-p',
      String(server.port),
      '-i',
      server.privateKeyPath,
      '-o',
      'BatchMode=yes',
    ];
    this.scpArgs = [
      '-P',
      String(server.port),
      '-i',
      server.privateKeyPath,
      '-o',
      'BatchMode=yes',
    ];
  }

  async exec(command: string): Promise<ProcessResult> {
    return runProcess('ssh', [
      ...this.sshArgs,
      this.destination,
      command,
    ]);
  }

  async uploadFile(localPath: string, remotePath: string): Promise<void> {
    await runProcess('scp', [
      ...this.scpArgs,
      localPath,
      createScpRemoteTarget(this.destination, remotePath),
    ]);
  }

  async uploadDirectory(localPath: string, remotePath: string, exclude: string[]): Promise<void> {
    await uploadDirectoryContents(this, localPath, remotePath, exclude);
  }
}

export function createRemoteClient(config: SshReleaseConfig): RemoteClient {
  return new ShellRemoteClient(config.server);
}

export function createScpRemoteTarget(destination: string, remotePath: string): string {
  return `${destination}:${remotePath}`;
}

async function uploadDirectoryContents(
  client: RemoteClient,
  localPath: string,
  remotePath: string,
  exclude: string[],
): Promise<void> {
  const sourceStat = await stat(localPath);

  if (!sourceStat.isDirectory()) {
    await client.uploadFile(localPath, remoteJoin(remotePath, path.basename(localPath)));
    return;
  }

  await walkDirectory(client, localPath, remotePath, exclude);
}

async function walkDirectory(
  client: RemoteClient,
  localDirectory: string,
  remoteDirectory: string,
  exclude: string[],
): Promise<void> {
  await client.exec(`mkdir -p ${shellQuote(remoteDirectory)}`);
  const entries = await readdir(localDirectory, { withFileTypes: true });

  for (const entry of entries) {
    if (exclude.includes(entry.name)) {
      continue;
    }

    const localEntryPath = path.join(localDirectory, entry.name);
    const remoteEntryPath = remoteJoin(remoteDirectory, entry.name);

    if (entry.isDirectory()) {
      await walkDirectory(client, localEntryPath, remoteEntryPath, exclude);
      continue;
    }

    if (entry.isFile()) {
      await client.uploadFile(localEntryPath, remoteEntryPath);
    }
  }
}
