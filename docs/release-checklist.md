# ssh-release 发布检查清单

本文档用于执行 npm 正式发布前后的检查。不要在仓库文件中写入真实服务器 IP、用户名、密码、私钥或生产路径。

## 发布前状态

发布前需要确认：

- `git status --short --branch` 显示工作区干净。
- `package.json` 的 `version` 是本次准备发布的版本。
- `package.json` 的 `files` 只包含 npm 包需要发布的文件。
- `package.json` 的 `bin.ssh-release` 指向 `dist/cli.js`。
- 当前 npm 包名可用，或当前账号有对应包的发布权限。
- npm 包已配置 Trusted Publisher，发布方为 GitHub Actions，仓库为 `JackEngineer/ssh-release`，workflow 文件为 `publish.yml`。
- 不再使用长期 npm 发布 token；不要在 GitHub Secrets 中配置 `NPM_TOKEN` 用于发布。

## 本地门禁

发布前运行：

```bash
npm run prepublishOnly
npm publish --dry-run
```

`npm run prepublishOnly` 必须通过 lint、test 和 build。

`npm publish --dry-run` 必须满足：

- 命令退出码为 `0`。
- 没有 `npm auto-corrected` 之类的自动修正警告。
- tarball 内容只包含 `LICENSE`、`README.md`、`CHANGELOG.md`、`package.json` 和 `dist/`。
- `package.json`、`README.md`、`CHANGELOG.md` 和 `dist/cli.js` 出现在 tarball 内容中。

## 本地安装烟测

用本地 tarball 验证 npm 安装后的真实命令入口：

```bash
PACK_DIR=$(mktemp -d)
VERSION=$(node -p "JSON.parse(require('fs').readFileSync('package.json', 'utf8')).version")
npm pack --pack-destination "$PACK_DIR"
npm install -g "$PACK_DIR"/ssh-release-"$VERSION".tgz --prefix "$PACK_DIR/prefix"
mkdir -p "$PACK_DIR/work"
cd "$PACK_DIR/work"
"$PACK_DIR/prefix/bin/ssh-release"
"$PACK_DIR/prefix/bin/ssh-release" init
test -f ssh-release.config.ts
```

预期结果：

- 无参数执行 `ssh-release` 会输出用法。
- `ssh-release init` 会创建 `ssh-release.config.ts`。
- 生成的配置模板只引用环境变量，不包含真实凭证。

## 凭证和敏感信息检查

发布前检查仓库中没有真实服务器信息或凭证：

```bash
rg -n "<真实服务器 IP>|<真实密码>|<真实私钥>|<生产路径>" .
```

如果命中真实敏感信息，先删除并重新提交。不要把命中内容复制到 issue、PR、提交信息或发布说明中。

## npm 外部状态检查

检查包名或当前线上版本：

```bash
npm view ssh-release name version --json
```

首次发布时，如果 registry 返回 `E404 Not Found`，表示当前查询时包名尚未被占用。

正式发布由 GitHub Actions 通过 npm Trusted Publishing 完成。该发布流程使用 OIDC 短期身份，不依赖本机 npm 登录状态，也不需要 `NPM_TOKEN`。

## Git 发布步骤

确认本地验证通过后再执行：

```bash
git status --short --branch
git log --oneline --decorate -5
```

如果需要同步远端：

```bash
git push origin main
```

创建并推送版本标签：

```bash
VERSION=$(node -p "JSON.parse(require('fs').readFileSync('package.json', 'utf8')).version")
git tag -a "v$VERSION" -m "v$VERSION"
git push origin "v$VERSION"
```

标签只应在确认版本号、提交范围和发布权限后创建。推送 `v*` 标签会触发 `.github/workflows/publish.yml`，workflow 会先校验标签版本和 `package.json` 版本一致，再执行 npm 发布。

## 自动 npm 发布

发布 workflow 必须满足：

- `permissions.id-token` 为 `write`，让 npm 通过 GitHub Actions OIDC 验证发布身份。
- `actions/setup-node` 配置 `registry-url: https://registry.npmjs.org`。
- 发布 job 使用 GitHub 托管 runner，不使用 self-hosted runner。
- 发布命令为 `npm publish`，不设置 `NODE_AUTH_TOKEN`、`NPM_TOKEN` 或其他长期发布 token。
- 发布完成后必须执行发布后 registry 验证，确认 `ssh-release@<version>` 可查询且 `latest` 指向当前版本。
- 发布完成后必须执行安装烟测，从 npm 安装当前版本并运行 `ssh-release --version --json` 和 `ssh-release --help`。

发布完成后验证：

```bash
npm view ssh-release version
PACK_DIR=$(mktemp -d)
VERSION=$(node -p "JSON.parse(require('fs').readFileSync('package.json', 'utf8')).version")
npm install -g "ssh-release@$VERSION" --prefix "$PACK_DIR/prefix"
"$PACK_DIR/prefix/bin/ssh-release"
```

如果发布后发现问题，优先发布修复版本。只有在 npm 规则允许且影响范围明确时，才考虑撤销发布。
