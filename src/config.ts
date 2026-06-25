import { pathToFileURL } from 'node:url';
import { readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { SshReleaseConfig, SshReleaseConfigInput } from './types.js';
import { normalizeConfig } from './validate.js';

export const CONFIG_FILE_NAME = 'ssh-release.config.ts';

export function createConfigTemplate(): string {
  return `export default {
  source: {
    path: './dist',
    exclude: ['.DS_Store', 'node_modules'],
  },

  server: {
    host: process.env.SSH_RELEASE_HOST,
    port: 22,
    username: process.env.SSH_RELEASE_USER,
    privateKeyPath: '~/.ssh/id_rsa',
  },

  target: {
    path: '/var/www/my-app',
    currentSymlink: 'current',
    releasesDir: 'releases',
    tempDir: '.ssh-release-tmp',
  },

  deploy: {
    mode: 'release',
    keepReleases: 5,
    compression: 'tgz',
    preferTar: true,
    fallbackToFileUpload: true,
  },
};
`;
}

export async function writeConfigTemplate(configPath = CONFIG_FILE_NAME): Promise<void> {
  await writeFile(configPath, createConfigTemplate(), { flag: 'wx' });
}

export async function loadConfigFile(configPath = CONFIG_FILE_NAME): Promise<SshReleaseConfig> {
  const absolutePath = path.resolve(configPath);
  const input = await loadConfigInput(absolutePath);
  const config = normalizeConfig(input);

  return {
    ...config,
    server: {
      ...config.server,
      privateKeyPath: resolveUserPath(config.server.privateKeyPath),
    },
  };
}

export function resolveUserPath(filePath: string): string {
  if (filePath === '~') {
    return os.homedir();
  }

  if (filePath.startsWith('~/')) {
    return path.join(os.homedir(), filePath.slice(2));
  }

  return filePath;
}

async function loadConfigInput(configPath: string): Promise<SshReleaseConfigInput> {
  if (configPath.endsWith('.js') || configPath.endsWith('.mjs')) {
    const module = await import(`${pathToFileURL(configPath).href}?t=${Date.now()}`);
    return module.default as SshReleaseConfigInput;
  }

  const content = await readFile(configPath, 'utf8');
  const transformed = content.replace(/^\s*export\s+default\s+/, 'return ');

  if (transformed === content) {
    throw new Error('配置文件必须使用 export default 导出配置对象');
  }

  const factory = new Function('process', transformed);
  return factory(process) as SshReleaseConfigInput;
}
