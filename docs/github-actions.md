# GitHub Actions 发布模板

本文档给使用 `ssh-release` 的业务仓库提供 GitHub Actions 示例。不要把真实服务器 IP、用户名、密码、私钥或生产路径写进 workflow 文件。

## 准备工作

在业务仓库的 GitHub Secrets 中配置：

- `SSH_RELEASE_HOST`：服务器地址。
- `SSH_RELEASE_USER`：SSH 用户名。
- `SSH_RELEASE_PASSWORD`：SSH 密码。使用私钥时可改为 `SSH_RELEASE_PRIVATE_KEY`，并在配置文件中读取私钥路径。

建议在 GitHub Environments 中创建 `production` 环境，并开启人工审批。正式发布 job 使用 `environment: production`，避免误触发生产发布。

业务仓库中保留 `ssh-release.config.ts`，服务器信息从环境变量读取：

```ts
export default {
  source: {
    path: './dist',
    exclude: ['node_modules', '.DS_Store'],
  },
  server: {
    host: process.env.SSH_RELEASE_HOST,
    username: process.env.SSH_RELEASE_USER,
    password: process.env.SSH_RELEASE_PASSWORD,
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
```

## Pull Request 预检

Pull Request 中只运行构建和发布预检，不修改服务器。

```yaml
name: Deploy Check

on:
  pull_request:

jobs:
  deploy-check:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm

      - run: npm ci
      - run: npm run build

      - name: Check ssh-release plan
        run: npx ssh-release deploy --dry-run --json
        env:
          SSH_RELEASE_HOST: ${{ secrets.SSH_RELEASE_HOST }}
          SSH_RELEASE_USER: ${{ secrets.SSH_RELEASE_USER }}
          SSH_RELEASE_PASSWORD: ${{ secrets.SSH_RELEASE_PASSWORD }}
```

## 生产发布

`main` 分支构建通过后发布到生产环境。`deploy --json --progress` 会按行输出发布阶段，最后一行包含最终结果和远端校验状态。

```yaml
name: Deploy

on:
  push:
    branches:
      - main

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: production
    concurrency:
      group: production-deploy
      cancel-in-progress: false

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm

      - run: npm ci
      - run: npm run build

      - name: Check remote environment
        run: npx ssh-release doctor --json
        env:
          SSH_RELEASE_HOST: ${{ secrets.SSH_RELEASE_HOST }}
          SSH_RELEASE_USER: ${{ secrets.SSH_RELEASE_USER }}
          SSH_RELEASE_PASSWORD: ${{ secrets.SSH_RELEASE_PASSWORD }}

      - name: Deploy files
        run: npx ssh-release deploy --json --progress
        env:
          SSH_RELEASE_HOST: ${{ secrets.SSH_RELEASE_HOST }}
          SSH_RELEASE_USER: ${{ secrets.SSH_RELEASE_USER }}
          SSH_RELEASE_PASSWORD: ${{ secrets.SSH_RELEASE_PASSWORD }}
```

发布成功时，最终 JSON 的 `result.verified` 应为 `true`，`result.verification` 会列出通过的远端校验项。

## 失败处理

- `doctor` 失败时，先按 JSON 中的检查项修复配置、本地命令、SSH 连接、远端目录、远端 hash、远端锁或 `tar` 环境。
- `deploy` 失败且提示远端锁存在时，先确认没有其他发布任务，再使用 `ssh-release unlock --confirm <lock-path>` 清理。
- `deploy` 失败且提示远端校验失败时，不要继续执行后续发布步骤，先检查 `current` 指向、版本目录和远端锁状态。
- 不要在 workflow 日志中打印真实密码、私钥或完整生产配置。
