# ssh-release

`ssh-release` 是一个通用 SSH 文件发布 CLI，目标是把本地文件或目录可靠发布到服务器。

它只负责文件发布和版本切换，不负责构建项目、重启服务、修改 Nginx、操作容器或执行自定义远程脚本。

## 3 分钟接入

如果你第一次使用，先选一个最接近的示例复制：

- [examples/static-site](https://github.com/JackEngineer/ssh-release/blob/main/examples/static-site)：发布 `./dist` 静态站点目录。
- [examples/single-file](https://github.com/JackEngineer/ssh-release/blob/main/examples/single-file)：发布单个构建产物文件。
- [examples/github-actions](https://github.com/JackEngineer/ssh-release/blob/main/examples/github-actions)：在 GitHub Actions 中发布到服务器。

最小接入流程：

```bash
npm install -g ssh-release
curl -fsSL https://raw.githubusercontent.com/JackEngineer/ssh-release/main/examples/static-site/ssh-release.config.ts -o ssh-release.config.ts
export SSH_RELEASE_HOST=example.com
export SSH_RELEASE_USER=deploy
export SSH_RELEASE_PASSWORD='your-password'
ssh-release doctor
ssh-release deploy --plan
ssh-release deploy --json --progress
```

`source.path` 指向已经构建好的文件或目录，`target.path` 指向远端目标目录。不要把真实服务器地址、密码、私钥或生产路径提交到仓库。

## 当前状态

当前版本已进入 1.0 稳定版，CLI 命令、JSON 输出、配置字段和安全边界见 [docs/contracts.md](https://github.com/JackEngineer/ssh-release/blob/main/docs/contracts.md)。

已实现：

- `ssh-release init`：生成 `ssh-release.config.ts` 配置模板。
- `ssh-release doctor`：检查配置、本地源路径、本地命令、SSH 连接、远程目录、远端 hash、远端锁和远端 `tar`。
- `ssh-release deploy`：发布本地文件或目录。
- `ssh-release list`：查看远程版本和当前版本。
- `ssh-release rollback [version]`：回滚到上一个版本或指定版本。
- `ssh-release unlock`：查看远端锁，并在显式确认锁路径后删除锁。
- `--json`：输出单行 JSON，便于 CI/CD 解析。
- `deploy --json --progress`：发布时输出 NDJSON 阶段进度，便于 CI/CD 展示实时状态。
- `rollback --json --progress`：回滚时输出 NDJSON 阶段进度，便于 CI/CD 展示实时状态。
- `deploy --plan`：不连接远端、不修改服务器，预览上传、切换、清理和校验计划。
- `rollback --plan`：连接远端读取版本状态，但不修改服务器，预览回滚切换计划。
- 失败下一步提示：常见锁、回滚目标、发布校验和 SSH 错误会提示下一步操作。
- 发布 manifest：每次发布生成 `manifest.json`，记录版本、发布时间、本地来源、文件清单、文件大小和 SHA-256。
- 发布后远端校验：确认版本目录或目标目录存在、`current` 已指向新版本、`manifest.json` hash 匹配、远端锁已清理。
- 回滚后远端校验：确认目标版本目录存在、`current` 已指向目标版本、远端锁已清理。
- `release` 模式：上传压缩包、远端解压、切换 `current`、清理旧版本。
- `overwrite` 模式：直接覆盖发布到目标目录。
- 远端 `tar` 解压失败时回退逐文件上传。
- 配置字段归一化、危险远程路径拦截、版本号生成、旧版本保留计算和回滚目标选择。

## 安装依赖

```bash
npm install
```

## 全局安装

已发布到 npm，可以在任意项目中全局安装：

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

首次接入步骤见 [docs/quick-start.md](https://github.com/JackEngineer/ssh-release/blob/main/docs/quick-start.md)。
本机和 CI 依赖见 [docs/platform-requirements.md](https://github.com/JackEngineer/ssh-release/blob/main/docs/platform-requirements.md)。

## 本地开发

```bash
npm run dev -- init
npm run dev -- doctor
npm run dev -- deploy
npm run dev -- list
npm run dev -- rollback
npm run dev -- unlock
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
├── .ssh-release.lock/
└── .ssh-release-tmp/
```

规则：

- 发布和回滚开始前会创建 `.ssh-release.lock`，避免同一目标目录并发修改。
- 发布或回滚结束后会自动删除 `.ssh-release.lock`。
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

`doctor` 会先检查本地 `tar`、`ssh`、`scp`，使用密码登录时还会检查 `sshpass`。本地检查失败时不会继续连接远端。

`doctor` 也会检查 `.ssh-release.lock`。没有锁时正常通过；如果发现锁，会以 `warn` 显示锁路径、pid、创建时间和安全清理提示。

需要先查看发布计划但不修改服务器时：

```bash
ssh-release deploy --dry-run
ssh-release deploy --plan
```

执行发布：

```bash
ssh-release deploy
```

`deploy --dry-run` 和 `deploy --plan` 都不会连接远端或修改服务器，会预览：

- 将上传的本地来源和远端临时压缩包路径。
- 将写入的远端 `manifest.json` 路径、文件数量和总字节数。
- `release` 模式下将切换的 `current` 目标。
- 将清理的远端临时压缩包，以及旧版本保留策略。
- 发布后会执行的远端校验项。

`release` 模式发布成功后会输出版本号、版本目录、`current` 软链接路径和远端 `manifest.json` 路径。只有压缩包上传、解压和发布清单上传完成后才切换 `current`。

发布命令返回成功前会执行远端状态校验。`release` 模式会确认新版本目录存在、`current` 已指向新版本、发布清单 hash 匹配、远端锁已清理；`overwrite` 模式会确认目标目录存在、发布清单 hash 匹配、远端锁已清理。校验失败时发布命令返回失败，不会把结果标记为成功。

`manifest.json` 会写入发布目标目录：

- `release` 模式：`<target.path>/<releasesDir>/<version>/manifest.json`
- `overwrite` 模式：`<target.path>/manifest.json`

清单内容包含：

- `version`：本次发布版本号。
- `createdAt`：发布时间。
- `source`：配置中的本地来源路径、来源类型和排除规则。
- `files`：每个文件的相对路径、字节数和 SHA-256。
- `totals`：文件数量和总字节数。

如果远端已有 `.ssh-release.lock`，说明同一目标目录可能正在发布或回滚，工具会停止在修改远端状态之前。

查看锁状态：

```bash
ssh-release unlock
```

确认没有发布或回滚任务运行后，可以显式确认锁路径并删除锁：

```bash
ssh-release unlock --confirm /var/www/my-app/.ssh-release.lock
```

`--confirm` 后的路径必须和当前配置计算出的锁路径完全一致，否则不会删除锁。

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

需要先查看回滚计划但不切换 `current` 时：

```bash
ssh-release rollback [version] --dry-run
ssh-release rollback [version] --plan
```

`rollback --dry-run` 和 `rollback --plan` 会连接远端读取锁状态、版本列表和当前版本，但不会创建锁、不会切换 `current`、不会删除任何版本目录。预览会显示：

- 当前版本和目标版本。
- 将切换的 `current` 路径和目标。
- 回滚不会删除版本目录。
- 实际回滚前需要满足的校验项。

`overwrite` 模式没有版本列表，也不支持回滚。

## JSON 输出

需要在自动化脚本中解析结果时，可以给命令增加 `--json`：

```bash
ssh-release deploy --dry-run --json
ssh-release deploy --plan --json
ssh-release deploy --json --progress
ssh-release doctor --json
ssh-release list --json
ssh-release rollback --json
ssh-release rollback --json --progress
ssh-release unlock --json
```

成功时输出单行 JSON：

```json
{"ok":true,"command":"deploy","result":{"mode":"release","version":"20260625-153000","manifest":{"remotePath":"/var/www/my-app/releases/20260625-153000/manifest.json","fileCount":12,"totalBytes":34567,"sha256":"..."},"verified":true}}
```

命令执行失败时输出：

```json
{"ok":false,"command":"deploy","error":"错误信息"}
```

发布或回滚时需要持续读取阶段状态，可以使用：

```bash
ssh-release deploy --json --progress
ssh-release rollback --json --progress
```

该模式会按行输出 NDJSON。进度事件先输出，最终结果最后输出：

```json
{"ok":true,"command":"deploy","event":"progress","stage":"package","status":"start"}
{"ok":true,"command":"deploy","event":"progress","stage":"package","status":"success"}
{"ok":true,"command":"deploy","result":{"mode":"release","version":"20260625-153000","verified":true}}
```

`deploy` 的 `stage` 可能是 `source`、`lock`、`package`、`publish`、`cleanup`。
`rollback` 的 `stage` 可能是 `lock`、`switch`、`cleanup`、`verify`。
`status` 可能是 `start`、`success`、`fail`。失败事件会包含 `error` 字段。

发布和回滚结果中的 `verification` 会列出已通过的远端校验项：

```json
{"verified":true,"verification":[{"name":"发布清单","status":"pass","message":"manifest.json 已上传并校验，文件数 12"}]}
```

`doctor` 检查失败、`unlock` 发现锁但未删除时会返回非零退出码，并在 JSON 的 `result` 中保留检查结果。

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

远端需要可运行 `sha256sum` 或 `shasum`，用于校验 `manifest.json` hash。

远端 `tar` 是可选能力，不可用时会按配置回退逐文件上传。

Windows、macOS、Linux 和 CI 的依赖差异见 [docs/platform-requirements.md](https://github.com/JackEngineer/ssh-release/blob/main/docs/platform-requirements.md)。

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
- 推送 `v*` 标签会触发 npm 自动发布 workflow。发布使用 npm Trusted Publishing，不需要长期 `NPM_TOKEN`。
- 发布 workflow 会在 `npm publish` 后验证 npm registry 的当前版本和 `latest`，并从 npm 重新安装当前版本做 CLI 烟测。

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
当前仓库正式发布由 `.github/workflows/publish.yml` 执行：推送版本标签后，GitHub Actions 会校验标签版本、运行发布门禁、检查包内容并调用 `npm publish`。

完整发布步骤见 [docs/release-checklist.md](https://github.com/JackEngineer/ssh-release/blob/main/docs/release-checklist.md)。

可复制示例见 [examples/](https://github.com/JackEngineer/ssh-release/tree/main/examples)。

真实服务器 dogfood 见 [docs/dogfood.md](https://github.com/JackEngineer/ssh-release/blob/main/docs/dogfood.md)。

GitHub Actions 发布模板见 [docs/github-actions.md](https://github.com/JackEngineer/ssh-release/blob/main/docs/github-actions.md)。

失败恢复指南见 [docs/recovery.md](https://github.com/JackEngineer/ssh-release/blob/main/docs/recovery.md)。

首次发布指南见 [docs/quick-start.md](https://github.com/JackEngineer/ssh-release/blob/main/docs/quick-start.md)。

平台依赖说明见 [docs/platform-requirements.md](https://github.com/JackEngineer/ssh-release/blob/main/docs/platform-requirements.md)。

版本变更见 [CHANGELOG.md](https://github.com/JackEngineer/ssh-release/blob/main/CHANGELOG.md)。

## 项目结构

```text
CHANGELOG.md
.github/
└── workflows/
    ├── ci.yml
    └── publish.yml
src/
├── cli.ts
├── config.ts
├── doctor.ts
├── lock.ts
├── list.ts
├── manifest.ts
├── package.ts
├── process.ts
├── remote.ts
├── release.ts
├── rollback.ts
├── ssh.ts
├── types.ts
├── unlock.ts
└── validate.ts

examples/
├── github-actions/
├── single-file/
└── static-site/

tests/
├── cli.test.ts
├── config-load.test.ts
├── config-template.test.ts
├── deploy.test.ts
├── docs.test.ts
├── dogfood-script.test.ts
├── e2e.test.ts
├── examples.test.ts
├── exclude.test.ts
├── list-doctor.test.ts
├── manifest.test.ts
├── package-json.test.ts
├── package.test.ts
├── process.test.ts
├── release.test.ts
├── rollback.test.ts
├── ssh.test.ts
├── unlock.test.ts
└── validate.test.ts

docs/
├── contracts.md
├── github-actions.md
├── platform-requirements.md
├── quick-start.md
├── recovery.md
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
- CLI JSON 输出。
- 本地 `.tgz` 打包和排除项。
- macOS AppleDouble 元数据排除。
- `release` 和 `overwrite` 发布流程。
- 发布和回滚锁获取、释放和锁冲突拦截。
- 发布 manifest 生成、上传和远端 hash 校验。
- `doctor` 远端锁状态检查和安全清理提示。
- `doctor` 本地命令和远端 hash 检查。
- `unlock` 显式确认路径后删除远端锁。
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
