# ssh-release 发布检查清单

本文档用于执行 npm 正式发布前后的检查。不要在仓库文件中写入真实服务器 IP、用户名、密码、私钥或生产路径。

## 发布前状态

发布前需要确认：

- `git status --short --branch` 显示工作区干净。
- `package.json` 的 `version` 是本次准备发布的版本。
- `package.json` 的 `files` 只包含 npm 包需要发布的文件。
- `package.json` 的 `bin.ssh-release` 指向 `dist/cli.js`。
- 当前 npm 包名可用，或当前账号有对应包的发布权限。
- 当前 npm 账号已登录，并且 registry 指向 `https://registry.npmjs.org/`。

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
- tarball 内容只包含 `LICENSE`、`README.md`、`package.json` 和 `dist/`。
- `package.json`、`README.md` 和 `dist/cli.js` 出现在 tarball 内容中。

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

检查当前 npm 登录账号：

```bash
npm whoami --registry=https://registry.npmjs.org/
```

如果返回 `E401 Unauthorized`，先执行 `npm login`，再重新检查。

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

标签只应在确认版本号、提交范围和发布权限后创建。

## 正式 npm 发布

确认 npm 登录、包名权限、dry-run 和本地烟测都通过后执行：

```bash
npm publish
```

发布完成后验证：

```bash
npm view ssh-release version
PACK_DIR=$(mktemp -d)
VERSION=$(node -p "JSON.parse(require('fs').readFileSync('package.json', 'utf8')).version")
npm install -g "ssh-release@$VERSION" --prefix "$PACK_DIR/prefix"
"$PACK_DIR/prefix/bin/ssh-release"
```

如果发布后发现问题，优先发布修复版本。只有在 npm 规则允许且影响范围明确时，才考虑撤销发布。
