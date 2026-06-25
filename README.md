# ssh-release

`ssh-release` 是一个通用 SSH 文件发布 CLI，目标是把本地文件或目录可靠发布到服务器。

它只负责文件发布和版本切换，不负责构建项目、重启服务、修改 Nginx、操作容器或执行自定义远程脚本。

## 当前状态

当前仓库已完成第一版 MVP。

已实现：

- `ssh-release init`：生成 `ssh-release.config.ts` 配置模板。
- `ssh-release doctor`：检查配置、本地源路径、SSH 连接、远程目录和远端 `tar`。
- `ssh-release deploy`：发布本地文件或目录。
- `ssh-release list`：查看远程版本和当前版本。
- `ssh-release rollback [version]`：回滚到上一个版本或指定版本。
- `release` 模式：上传压缩包、远端解压、切换 `current`、清理旧版本。
- `overwrite` 模式：直接覆盖发布到目标目录。
- 远端 `tar` 解压失败时回退逐文件上传。
- 配置字段归一化、危险远程路径拦截、版本号生成、旧版本保留计算和回滚目标选择。

## 安装依赖

```bash
npm install
```

## 全局安装

发布到 npm 后，可以在任意项目中全局安装：

```bash
npm install -g ssh-release
```

安装后在需要发布文件的项目目录中执行：

```bash
ssh-release init
```

查看帮助和版本：

```bash
ssh-release --help
ssh-release --version
```

## 本地开发

```bash
npm run dev -- init
npm run dev -- doctor
npm run dev -- deploy
npm run dev -- list
npm run dev -- rollback
```

构建 CLI：

```bash
npm run build
```

构建后可以直接运行：

```bash
node dist/cli.js init
```

## 配置初始化

在需要发布文件的项目目录中执行：

```bash
ssh-release init
```

当前开发阶段也可以用源码入口执行：

```bash
npm run dev -- init
```

生成的配置文件名为 `ssh-release.config.ts`。

需要使用自定义配置路径时，可以传入 `--config`：

```bash
ssh-release init --config deploy.config.ts
ssh-release doctor --config deploy.config.ts
ssh-release deploy --config deploy.config.ts
```

配置文件应使用 `export default` 导出配置对象。当前模板支持从环境变量读取服务器地址和用户名：

示例配置：

```ts
export default {
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
```

## 发布模型

默认发布模型是版本化发布：

```text
source files -> package -> upload -> release -> activate -> rollback
```

`release` 模式下，远程目录规划如下：

```text
/var/www/my-app/
├── current -> releases/20260625-153000
├── releases/
│   ├── 20260625-153000/
│   └── 20260625-150000/
└── .ssh-release-tmp/
```

规则：

- 每次发布创建一个新版本目录。
- 新版本完整上传和解压完成后，才切换 `current`。
- 回滚只切换 `current`，不删除版本目录。
- 清理旧版本时保留当前版本。

`overwrite` 模式用于不需要版本管理的目录，会直接发布到 `target.path`，不创建 `current` 和 `releases`。

## 发布命令

发布前先检查配置和远端环境：

```bash
ssh-release doctor
```

需要先查看发布计划但不修改服务器时：

```bash
ssh-release deploy --dry-run
```

执行发布：

```bash
ssh-release deploy
```

`release` 模式发布成功后会输出版本号、版本目录和 `current` 软链接路径。只有压缩包上传和解压完成后才切换 `current`。

远端 `tar` 不可用或解压失败时，如果 `deploy.fallbackToFileUpload` 为 `true`，工具会回退逐文件上传。`release` 模式只清理失败的新版本目录；`overwrite` 模式不会先删除整个目标目录。

查看版本：

```bash
ssh-release list
```

回滚到上一个版本：

```bash
ssh-release rollback
```

回滚到指定版本：

```bash
ssh-release rollback 20260625-150000
```

`overwrite` 模式没有版本列表，也不支持回滚。

## 安全边界

配置模板不包含真实 IP、密码或生产路径。

推荐通过环境变量提供服务器信息：

```bash
export SSH_RELEASE_HOST=example.com
export SSH_RELEASE_USER=deploy
export SSH_RELEASE_PASSWORD='your-password'
```

认证方式支持私钥和密码：

- 设置 `server.privateKeyPath` 时使用私钥登录。
- 设置 `server.password` 时使用密码登录，推荐写成 `process.env.SSH_RELEASE_PASSWORD`。
- 同时设置 `password` 和 `privateKeyPath` 时，优先使用密码登录。
- 密码不会作为命令行参数传给 `ssh` 或 `scp`，运行时通过 `SSHPASS` 环境变量交给 `sshpass -e`。
- 不要把真实密码写进 `ssh-release.config.ts` 或仓库文件。

以下远程目标路径会被默认拒绝：

- `/`
- `/home`
- `/root`
- `/var`
- `/usr`
- `/etc`
- `/opt`
- `/tmp`

这些路径下的子目录可以使用，例如 `/var/www/my-app`。

`target.currentSymlink`、`target.releasesDir` 和 `target.tempDir` 必须是简单相对名称，不能包含 `/`、`\`，也不能等于 `.` 或 `..`。

本地需要可用的系统命令：

- `tar`：本地打包发布内容。
- `ssh`：执行远端目录、解压、软链接、列表和检查命令。
- `scp`：上传压缩包和逐文件回退上传。
- `sshpass`：仅密码登录时需要；私钥登录不需要。

在 macOS 上打包时会禁用 AppleDouble 和扩展属性元数据，避免把 `._*` 文件发布到 Linux 服务器。

远端 `tar` 是可选能力，不可用时会按配置回退逐文件上传。

## 开发命令

```bash
npm run lint
npm test
npm run build
```

命令说明：

- `npm run lint`：运行 TypeScript 静态检查。
- `npm test`：运行 Node.js 测试。
- `npm run build`：编译 `dist/`。
- GitHub Actions 会在 `main` 推送和 Pull Request 上运行 `npm ci`、`lint`、`test` 和 `build`。

## 发布前检查

发布前先运行完整校验：

```bash
npm run prepublishOnly
npm publish --dry-run
```

需要验证 npm 安装后的真实命令入口时，可以使用本地 tarball 做烟测：

```bash
PACK_DIR=$(mktemp -d)
VERSION=$(node -p "JSON.parse(require('fs').readFileSync('package.json', 'utf8')).version")
npm pack --pack-destination "$PACK_DIR"
npm install -g "$PACK_DIR"/ssh-release-"$VERSION".tgz --prefix "$PACK_DIR/prefix"
"$PACK_DIR/prefix/bin/ssh-release"
"$PACK_DIR/prefix/bin/ssh-release" init
```

`npm publish` 会发布到 npm registry，只有确认版本号、包内容、登录账号和发布权限都正确后再执行。

完整发布步骤见 [docs/release-checklist.md](https://github.com/JackEngineer/ssh-release/blob/main/docs/release-checklist.md)。

版本变更见 [CHANGELOG.md](https://github.com/JackEngineer/ssh-release/blob/main/CHANGELOG.md)。

## 项目结构

```text
CHANGELOG.md
.github/
└── workflows/ci.yml
src/
├── cli.ts
├── config.ts
├── doctor.ts
├── list.ts
├── package.ts
├── process.ts
├── remote.ts
├── release.ts
├── rollback.ts
├── ssh.ts
├── types.ts
└── validate.ts

tests/
├── cli.test.ts
├── config-load.test.ts
├── config-template.test.ts
├── deploy.test.ts
├── e2e.test.ts
├── list-doctor.test.ts
├── package-json.test.ts
├── package.test.ts
├── release.test.ts
├── rollback.test.ts
├── ssh.test.ts
└── validate.test.ts

docs/
├── release-checklist.md
└── superpowers/specs/2026-06-25-ssh-release-design.md
```

## 测试重点

当前测试覆盖：

- 配置模板不泄露真实主机、密码和 IP。
- 配置文件加载和 `~` 路径展开。
- 配置默认值填充。
- 危险远程路径拒绝。
- 发布模式和压缩格式校验。
- CLI 命令分发。
- 本地 `.tgz` 打包和排除项。
- macOS AppleDouble 元数据排除。
- `release` 和 `overwrite` 发布流程。
- 远端 `tar` 失败后的逐文件上传回退。
- 远程版本列表读取和当前版本标记。
- `doctor` 检查结果。
- 通过临时 fake `ssh`/`scp` 进程执行端到端发布、列表、回滚和覆盖发布验收。
- 时间戳版本名生成。
- 旧版本清理选择。
- 回滚目标选择。

## 设计文档

完整设计见：

```text
docs/superpowers/specs/2026-06-25-ssh-release-design.md
```

## License

MIT
