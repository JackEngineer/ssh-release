# 静态站点发布示例

适用于把已经构建好的静态站点目录发布到服务器，例如 Vite、Vue、React、Astro 或任意生成 `dist/` 的项目。

## 使用方式

1. 把本目录中的 `ssh-release.config.ts` 复制到你的项目根目录。
2. 确认构建命令会生成 `./dist`。
3. 设置 SSH 环境变量。
4. 先预览计划，再执行发布。

```bash
export SSH_RELEASE_HOST=example.com
export SSH_RELEASE_USER=deploy
export SSH_RELEASE_PASSWORD='your-password'

npm run build
npx ssh-release doctor
npx ssh-release deploy --plan
npx ssh-release deploy --json --progress
```

## 远端目录

示例目标目录是 `/var/www/example-static-site`。实际使用时改成你的站点目录，例如 `/var/www/my-site`。

发布成功后，远端目录会采用版本化结构：

```text
/var/www/example-static-site/
├── current -> releases/<version>
├── releases/
└── .ssh-release-tmp/
```

不要把真实服务器地址、密码、私钥或生产路径提交到仓库。服务器信息应通过环境变量或 CI secrets 提供。
