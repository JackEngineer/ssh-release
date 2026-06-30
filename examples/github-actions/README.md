# GitHub Actions 发布示例

适用于在业务仓库的 `main` 分支合并后自动发布文件到服务器。

## 文件

- `ssh-release.config.ts`：业务仓库中的发布配置。
- `deploy.yml`：可复制到 `.github/workflows/deploy.yml` 的发布 workflow。

## 使用方式

1. 把 `ssh-release.config.ts` 复制到业务仓库根目录。
2. 把 `deploy.yml` 复制到 `.github/workflows/deploy.yml`。
3. 在 GitHub Secrets 中配置：
   - `SSH_RELEASE_HOST`
   - `SSH_RELEASE_USER`
   - `SSH_RELEASE_PASSWORD`
4. 在 GitHub Environments 中创建 `production` 环境，并开启人工审批。

发布 job 会先运行：

```bash
npx ssh-release doctor --json
```

通过后再运行：

```bash
npx ssh-release deploy --json --progress
```

不要把真实服务器地址、密码、私钥或生产路径写进 workflow 文件。服务器信息应通过 GitHub Secrets 提供。
