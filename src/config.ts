import { pathToFileURL } from 'node:url';
import { readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { SshReleaseConfig, SshReleaseConfigInput } from './types.js';
import { normalizeConfig } from './validate.js';

export const CONFIG_FILE_NAME = 'ssh-release.config.ts';
export const CONFIG_TEMPLATE_NAMES = ['default', 'single-file', 'static-site'] as const;

export type ConfigTemplateName = typeof CONFIG_TEMPLATE_NAMES[number];
export type ConfigAuthMethod = 'password' | 'private-key';

export interface CustomConfigTemplateOptions {
  authMethod: ConfigAuthMethod;
  privateKeyPath?: string;
  sourcePath: string;
  targetPath: string;
}

export function listConfigTemplateNames(): ConfigTemplateName[] {
  return [...CONFIG_TEMPLATE_NAMES];
}

export function isConfigTemplateName(value: string): value is ConfigTemplateName {
  return CONFIG_TEMPLATE_NAMES.includes(value as ConfigTemplateName);
}

export function createConfigTemplate(templateName: ConfigTemplateName = 'default'): string {
  if (templateName === 'static-site') {
    return `export default {
  source: {
    path: './dist',
    exclude: ['.DS_Store', 'node_modules'],
  },

  server: {
    host: process.env.SSH_RELEASE_HOST,
    port: Number(process.env.SSH_RELEASE_PORT || 22),
    username: process.env.SSH_RELEASE_USER,
    password: process.env.SSH_RELEASE_PASSWORD,
    privateKeyPath: process.env.SSH_RELEASE_PRIVATE_KEY_PATH,
  },

  target: {
    path: '/var/www/example-static-site',
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

  if (templateName === 'single-file') {
    return `export default {
  source: {
    path: './dist/app.tar.gz',
    exclude: [],
  },

  server: {
    host: process.env.SSH_RELEASE_HOST,
    port: Number(process.env.SSH_RELEASE_PORT || 22),
    username: process.env.SSH_RELEASE_USER,
    password: process.env.SSH_RELEASE_PASSWORD,
    privateKeyPath: process.env.SSH_RELEASE_PRIVATE_KEY_PATH,
  },

  target: {
    path: '/var/www/example-artifacts',
    currentSymlink: 'current',
    releasesDir: 'releases',
    tempDir: '.ssh-release-tmp',
  },

  deploy: {
    mode: 'release',
    keepReleases: 10,
    compression: 'tgz',
    preferTar: true,
    fallbackToFileUpload: true,
  },
};
`;
  }

  return `export default {
  source: {
    path: './dist',
    exclude: ['.DS_Store', 'node_modules'],
  },

  server: {
    host: process.env.SSH_RELEASE_HOST,
    port: 22,
    username: process.env.SSH_RELEASE_USER,
    password: process.env.SSH_RELEASE_PASSWORD,
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

export function createCustomConfigTemplate(options: CustomConfigTemplateOptions): string {
  const authBlock = options.authMethod === 'private-key'
    ? `    privateKeyPath: process.env.SSH_RELEASE_PRIVATE_KEY_PATH || ${quoteConfigString(options.privateKeyPath ?? '~/.ssh/id_rsa')},`
    : '    password: process.env.SSH_RELEASE_PASSWORD,';

  return `export default {
  source: {
    path: ${quoteConfigString(options.sourcePath)},
    exclude: ['.DS_Store', 'node_modules'],
  },

  server: {
    host: process.env.SSH_RELEASE_HOST,
    port: Number(process.env.SSH_RELEASE_PORT || 22),
    username: process.env.SSH_RELEASE_USER,
${authBlock}
  },

  target: {
    path: ${quoteConfigString(options.targetPath)},
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

export async function writeConfigTemplate(
  configPath = CONFIG_FILE_NAME,
  templateName: ConfigTemplateName = 'default',
): Promise<void> {
  await writeFile(configPath, createConfigTemplate(templateName), { flag: 'wx' });
}

export async function writeCustomConfigTemplate(
  configPath = CONFIG_FILE_NAME,
  options: CustomConfigTemplateOptions,
): Promise<void> {
  await writeFile(configPath, createCustomConfigTemplate(options), { flag: 'wx' });
}

export async function loadConfigFile(configPath = CONFIG_FILE_NAME): Promise<SshReleaseConfig> {
  const absolutePath = path.resolve(configPath);
  const input = await loadConfigInput(absolutePath);
  const config = normalizeConfig(input);

  return {
    ...config,
    server: {
      ...config.server,
      privateKeyPath: config.server.privateKeyPath
        ? resolveUserPath(config.server.privateKeyPath)
        : undefined,
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

function quoteConfigString(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}
