import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';

import { isExcludedPath, toPosixPath } from './exclude.js';
import { runProcess, type ProcessResult } from './process.js';
import { remoteJoin, shellQuote } from './remote.js';
import type { SshReleaseConfig } from './types.js';

export interface RemoteClient {
  exec(command: string): Promise<ProcessResult>;
  uploadFile(localPath: string, remotePath: string): Promise<void>;
  uploadDirectory(localPath: string, remotePath: string, exclude: string[]): Promise<void>;
}

export interface ProcessSpec {
  command: string;
  args: string[];
  env?: NodeJS.ProcessEnv;
}

export class ShellRemoteClient implements RemoteClient {
  constructor(private readonly server: SshReleaseConfig['server']) {}

  async exec(command: string): Promise<ProcessResult> {
    const spec = createSshProcessSpec(this.server, command);
    return runProcess(spec.command, spec.args, { env: spec.env });
  }

  async uploadFile(localPath: string, remotePath: string): Promise<void> {
    const spec = createScpProcessSpec(this.server, localPath, remotePath);
    await runProcess(spec.command, spec.args, { env: spec.env });
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

export function createSshProcessSpec(
  server: SshReleaseConfig['server'],
  remoteCommand: string,
): ProcessSpec {
  const destination = `${server.username}@${server.host}`;

  if (server.password) {
    return {
      command: 'sshpass',
      args: [
        '-e',
        'ssh',
        '-p',
        String(server.port),
        '-o',
        'StrictHostKeyChecking=accept-new',
        '-o',
        'PreferredAuthentications=password',
        '-o',
        'PubkeyAuthentication=no',
        '-o',
        'NumberOfPasswordPrompts=1',
        destination,
        remoteCommand,
      ],
      env: {
        SSHPASS: server.password,
      },
    };
  }

  return {
    command: 'ssh',
    args: [
      '-p',
      String(server.port),
      '-i',
      requirePrivateKeyPath(server),
      '-o',
      'BatchMode=yes',
      destination,
      remoteCommand,
    ],
  };
}

export function createScpProcessSpec(
  server: SshReleaseConfig['server'],
  localPath: string,
  remotePath: string,
): ProcessSpec {
  const destination = `${server.username}@${server.host}`;

  if (server.password) {
    return {
      command: 'sshpass',
      args: [
        '-e',
        'scp',
        '-P',
        String(server.port),
        '-o',
        'StrictHostKeyChecking=accept-new',
        '-o',
        'PreferredAuthentications=password',
        '-o',
        'PubkeyAuthentication=no',
        '-o',
        'NumberOfPasswordPrompts=1',
        localPath,
        createScpRemoteTarget(destination, remotePath),
      ],
      env: {
        SSHPASS: server.password,
      },
    };
  }

  return {
    command: 'scp',
    args: [
      '-P',
      String(server.port),
      '-i',
      requirePrivateKeyPath(server),
      '-o',
      'BatchMode=yes',
      localPath,
      createScpRemoteTarget(destination, remotePath),
    ],
  };
}

function requirePrivateKeyPath(server: SshReleaseConfig['server']): string {
  if (!server.privateKeyPath) {
    throw new Error('server.privateKeyPath 或 server.password 必须配置一个');
  }

  return server.privateKeyPath;
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

export async function walkDirectory(
  client: RemoteClient,
  localDirectory: string,
  remoteDirectory: string,
  exclude: string[],
  relativeDirectory = '',
): Promise<void> {
  await client.exec(`mkdir -p ${shellQuote(remoteDirectory)}`);
  const entries = await readdir(localDirectory, { withFileTypes: true });

  for (const entry of entries) {
    const relativeEntryPath = toPosixPath(path.join(relativeDirectory, entry.name));

    if (isExcludedPath(relativeEntryPath, exclude)) {
      continue;
    }

    const localEntryPath = path.join(localDirectory, entry.name);
    const remoteEntryPath = remoteJoin(remoteDirectory, entry.name);

    if (entry.isDirectory()) {
      await walkDirectory(client, localEntryPath, remoteEntryPath, exclude, relativeEntryPath);
      continue;
    }

    if (entry.isFile()) {
      await client.uploadFile(localEntryPath, remoteEntryPath);
    }
  }
}
