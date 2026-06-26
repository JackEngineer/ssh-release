# 首次发布指南

本文档用于第一次把项目接入 `ssh-release`。不要把真实服务器 IP、用户名、密码、私钥或生产路径写进仓库。

## 1. 安装并初始化

在需要发布文件的项目目录中执行：

```bash
npm install -g ssh-release
ssh-release init
```

这会生成 `ssh-release.config.ts`。如果项目需要自定义文件名：

```bash
ssh-release init --config deploy.config.ts
```

## 2. 填写配置

先确认本地发布来源：

```ts
source: {
  path: './dist',
  exclude: ['node_modules', '.DS_Store'],
}
```

`source.path` 应指向已经构建好的文件或目录。`ssh-release` 不负责构建项目。

再确认远端目标：

```ts
target: {
  path: '/var/www/my-app',
}
```

`target.path` 必须是远端绝对路径。不要使用 `/`、`/home`、`/root`、`/var`、`/usr`、`/etc`、`/opt` 或 `/tmp` 作为目标目录；可以使用它们下面的子目录，例如 `/var/www/my-app`。

## 3. 配置认证

推荐通过环境变量传入服务器信息：

```bash
export SSH_RELEASE_HOST=example.com
export SSH_RELEASE_USER=deploy
export SSH_RELEASE_PASSWORD='your-password'
```

配置文件中读取环境变量：

```ts
server: {
  host: process.env.SSH_RELEASE_HOST,
  username: process.env.SSH_RELEASE_USER,
  password: process.env.SSH_RELEASE_PASSWORD,
}
```

使用私钥登录时：

```ts
server: {
  host: process.env.SSH_RELEASE_HOST,
  username: process.env.SSH_RELEASE_USER,
  privateKeyPath: '~/.ssh/id_rsa',
}
```

不要把真实密码或私钥内容写入 `ssh-release.config.ts`。

## 4. 发布前检查

先检查配置、本地源路径、本地命令、SSH 连接、远端目录、远端 hash、远端锁和远端 `tar`：

```bash
ssh-release doctor
```

只预览发布计划，不连接远端、不修改服务器：

```bash
ssh-release deploy --plan
```

计划确认后再发布：

```bash
ssh-release deploy --json --progress
```

发布成功后查看版本：

```bash
ssh-release list
```

需要回滚前先预览：

```bash
ssh-release rollback --plan
```

确认目标版本正确后再执行：

```bash
ssh-release rollback --json --progress
```

## 5. CI/CD 接入顺序

Pull Request 中只运行：

```bash
ssh-release deploy --plan --json
```

生产发布 job 中按顺序运行：

```bash
ssh-release doctor --json
ssh-release deploy --json --progress
```

`doctor` 失败时不要继续执行 `deploy`。`deploy` 返回非零退出码时不要把流水线标记为成功。
