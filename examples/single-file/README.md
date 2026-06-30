# 单文件发布示例

适用于把单个构建产物发布到服务器，例如压缩包、配置包、静态索引文件或下载文件。

## 使用方式

1. 把本目录中的 `ssh-release.config.ts` 复制到你的项目根目录。
2. 让构建流程产出 `./dist/app.tar.gz`，或把配置中的 `source.path` 改成你的文件路径。
3. 设置 SSH 环境变量。
4. 先预览计划，再执行发布。

```bash
export SSH_RELEASE_HOST=example.com
export SSH_RELEASE_USER=deploy
export SSH_RELEASE_PASSWORD='your-password'

npx ssh-release doctor
npx ssh-release deploy --plan
npx ssh-release deploy --json --progress
```

## 行为说明

`ssh-release` 会把单文件打包成发布包，上传到远端版本目录并切换 `current`。回滚时只切换 `current`，不会删除历史版本。

示例目标目录是 `/var/www/example-artifacts`。实际使用时改成你的目标目录。

不要把真实服务器地址、密码、私钥或生产路径提交到仓库。服务器信息应通过环境变量或 CI secrets 提供。
