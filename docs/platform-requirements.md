# 平台依赖说明

`ssh-release` 是 Node.js CLI，实际发布依赖本机系统命令。不要在文档、CI 日志或命令行中打印真实密码、私钥或生产路径。

## 基础要求

- Node.js 20 或更高版本。
- 本机可运行 `ssh`。
- 本机可运行 `scp`。
- 本机可运行 `tar`，用于打包本地发布内容。
- 本机可运行 `sha256sum` 或 `shasum`，用于发布后校验远端 `manifest.json`。
- 远端最好可运行 `tar`；如果远端 `tar` 不可用且 `deploy.fallbackToFileUpload` 为 `true`，会回退逐文件上传。

## macOS

macOS 默认通常已有 `ssh`、`scp`、`tar` 和 `shasum`。

使用密码登录时需要安装 `sshpass`：

```bash
brew install hudochenkov/sshpass/sshpass
```

如果不想安装 `sshpass`，改用私钥登录：

```ts
server: {
  host: process.env.SSH_RELEASE_HOST,
  username: process.env.SSH_RELEASE_USER,
  privateKeyPath: '~/.ssh/id_rsa',
}
```

## Ubuntu/Debian

安装基础命令：

```bash
sudo apt-get update
sudo apt-get install -y openssh-client tar coreutils
```

使用密码登录时安装 `sshpass`：

```bash
sudo apt-get install sshpass
```

CI 中更推荐私钥登录，避免额外依赖 `sshpass`。

## Windows

Windows 可以运行 Node.js 版本的 CLI，但发布依赖 `ssh`、`scp`、`tar` 和 hash 命令。建议在以下环境之一运行：

- GitHub Actions 的 `ubuntu-latest` runner。
- WSL2。
- Git Bash 或其他包含 OpenSSH、tar 和 hash 命令的环境。

Windows 本机密码登录不建议依赖 `sshpass`。优先使用私钥登录，或把发布步骤放到 Linux CI runner 中执行。

## 密码登录与私钥登录

密码登录会通过 `SSHPASS` 环境变量交给 `sshpass -e`，不会把密码写入 `ssh` 或 `scp` 命令行参数。

私钥登录使用系统 `ssh` 和 `scp` 的 `-i` 参数，并启用 batch mode。自动化环境中优先使用私钥登录。

## 依赖排查

先运行：

```bash
ssh-release doctor
```

如果提示 `sshpass` 不存在：

- macOS：运行 `brew install hudochenkov/sshpass/sshpass`。
- Ubuntu/Debian：运行 `sudo apt-get install sshpass`。
- Windows 或 CI：优先改用私钥登录。

如果 SSH 连接失败，先确认 `SSH_RELEASE_HOST`、`SSH_RELEASE_USER`、`SSH_RELEASE_PASSWORD` 或私钥路径，再检查服务器防火墙、端口和认证方式。
