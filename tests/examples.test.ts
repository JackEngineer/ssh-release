import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { loadConfigFile } from '../src/config.js';

const examples = [
  {
    name: 'static-site',
    sourcePath: './dist',
    targetPath: '/var/www/example-static-site',
  },
  {
    name: 'single-file',
    sourcePath: './dist/app.tar.gz',
    targetPath: '/var/www/example-artifacts',
  },
  {
    name: 'github-actions',
    sourcePath: './dist',
    targetPath: '/var/www/example-ci-app',
  },
];

const sensitivePattern = new RegExp([
  ['47', '114', '97', '21'].join('\\.'),
  ['xiao', 'mao', '1994'].join(''),
  'npm_[A-Za-z0-9]{20,}',
  'password:\\s*[\'"`]',
  'host:\\s*[\'"`](?!/var/www)',
].join('|'), 'i');

test('README exposes a short path to runnable examples', async () => {
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');

  assert.match(readme, /3 分钟接入/);
  assert.match(readme, /examples\/static-site/);
  assert.match(readme, /examples\/single-file/);
  assert.match(readme, /examples\/github-actions/);
  assert.match(readme, /ssh-release init --template static-site/);
  assert.doesNotMatch(readme, /^cp examples\/static-site\/ssh-release\.config\.ts/m);
  assert.doesNotMatch(readme, /raw\.githubusercontent\.com\/JackEngineer\/ssh-release\/main\/examples\/static-site\/ssh-release\.config\.ts/);
});

test('example configs load with environment variables and stay inside safe placeholders', async () => {
  await withExampleEnv(async () => {
    for (const example of examples) {
      const configPath = path.resolve('examples', example.name, 'ssh-release.config.ts');
      const configContent = await readFile(configPath, 'utf8');
      const readmeContent = await readFile(
        path.resolve('examples', example.name, 'README.md'),
        'utf8',
      );
      const config = await loadConfigFile(configPath);

      assert.equal(config.source.path, example.sourcePath);
      assert.equal(config.server.host, 'example.com');
      assert.equal(config.server.username, 'deploy');
      assert.equal(config.server.password, 'example-password');
      assert.equal(config.target.path, example.targetPath);
      assert.equal(config.deploy.mode, 'release');
      assert.match(configContent, /process\.env\.SSH_RELEASE_HOST/);
      assert.match(configContent, /process\.env\.SSH_RELEASE_USER/);
      assert.match(configContent, /process\.env\.SSH_RELEASE_PASSWORD/);
      assert.doesNotMatch(`${configContent}\n${readmeContent}`, sensitivePattern);
    }
  });
});

test('GitHub Actions example keeps deploy credentials in secrets', async () => {
  const workflow = await readFile(
    new URL('../examples/github-actions/deploy.yml', import.meta.url),
    'utf8',
  );

  assert.match(workflow, /environment: production/);
  assert.match(workflow, /actions\/checkout@v6/);
  assert.match(workflow, /actions\/setup-node@v6/);
  assert.match(workflow, /node-version: '24'/);
  assert.match(workflow, /npx ssh-release doctor --json/);
  assert.match(workflow, /npx ssh-release deploy --json --progress/);
  assert.match(workflow, /secrets\.SSH_RELEASE_HOST/);
  assert.match(workflow, /secrets\.SSH_RELEASE_USER/);
  assert.match(workflow, /secrets\.SSH_RELEASE_PASSWORD/);
  assert.doesNotMatch(workflow, /actions\/checkout@v4|actions\/setup-node@v4|node-version: 20/);
  assert.doesNotMatch(workflow, sensitivePattern);
});

async function withExampleEnv(run: () => Promise<void>): Promise<void> {
  const previous = {
    SSH_RELEASE_HOST: process.env.SSH_RELEASE_HOST,
    SSH_RELEASE_USER: process.env.SSH_RELEASE_USER,
    SSH_RELEASE_PASSWORD: process.env.SSH_RELEASE_PASSWORD,
  };

  process.env.SSH_RELEASE_HOST = 'example.com';
  process.env.SSH_RELEASE_USER = 'deploy';
  process.env.SSH_RELEASE_PASSWORD = 'example-password';

  try {
    await run();
  } finally {
    restoreEnv('SSH_RELEASE_HOST', previous.SSH_RELEASE_HOST);
    restoreEnv('SSH_RELEASE_USER', previous.SSH_RELEASE_USER);
    restoreEnv('SSH_RELEASE_PASSWORD', previous.SSH_RELEASE_PASSWORD);
  }
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}
