# 真实业务场景：静态站点发布

这个示例模拟一个业务仓库：团队把公司官网、文档站或运营活动页构建到 `dist/`，合并到 `main` 后通过 GitHub Actions 发布到服务器。

示例保留真实发布链路，但不包含真实服务器信息：

- 本地产物：`./dist`
- 远端目录：`/var/www/acme-marketing-site`
- 发布模式：版本化发布，切换 `current` 指向最新版本
- 认证信息：全部来自环境变量或 GitHub Secrets

## 文件

- `package.json`：业务仓库中的构建、发布和回滚命令入口。
- `.env.example`：本地调试使用的 SSH 环境变量示例。
- `ssh-release.config.ts`：业务仓库根目录中的发布配置。
- `.github/workflows/deploy.yml`：业务仓库中的发布 workflow。
- `scripts/build.js`：示例构建脚本，把 `site/` 输出到 `dist/`。
- `site/`：示例静态站点源码。

## 本地首次接入

把 `ssh-release.config.ts` 放到业务仓库根目录后，先在本地验证配置和发布计划：

```bash
cp .env.example .env
# 编辑 .env，填入真实 SSH_RELEASE_HOST、SSH_RELEASE_USER 和认证信息。

set -a
source .env
set +a

npm run build

npm run release:doctor
npm run release:plan
```

确认计划无误后再执行真实发布：

```bash
npm run release:deploy
```

需要回滚时先预览，再执行：

```bash
npm run release:rollback:plan
npm run release:rollback
```

## CI 发布

把 `.github/workflows/deploy.yml` 放到业务仓库后，在 GitHub Secrets 中配置：

- `SSH_RELEASE_HOST`
- `SSH_RELEASE_USER`
- `SSH_RELEASE_PASSWORD`

建议在 GitHub Environments 中创建 `production` 环境并开启人工审批。workflow 会按这个顺序执行：

1. 安装依赖并构建 `dist/`。
2. 运行 `npm run release:doctor -- --json` 检查服务器和远端目录。
3. 运行 `npm run release:plan -- --json` 输出发布计划。
4. 运行 `npm run release:deploy` 执行发布。

## 远端结果

发布成功后，远端目录结构类似：

```text
/var/www/acme-marketing-site/
├── current -> releases/<version>
├── releases/
│   ├── 20260630-120000/
│   └── 20260630-121500/
└── .ssh-release-tmp/
```

Web 服务或 Nginx 应指向 `/var/www/acme-marketing-site/current`。`ssh-release` 只负责上传文件、切换版本和回滚，不负责修改 Nginx、不重启服务、不执行远端 hook。

不要把真实服务器地址、密码、私钥或生产路径提交到仓库。服务器信息应通过环境变量或 CI secrets 提供。
