# 真实服务器 dogfood

本文档用于在一次性远端目录中验证 `ssh-release` 的真实 SSH 发布链路。不要把真实服务器 IP、用户名、密码、私钥或生产路径写进仓库、issue、PR、日志和发布说明。

## 适用场景

发布前需要确认真实 SSH 环境可用时运行：

```bash
npm run build
scripts/dogfood-real.sh
```

脚本会创建本地临时项目，并只把文件发布到远端 `/tmp/ssh-release-dogfood-*`。不要使用生产路径，也不要把业务目录作为 dogfood 目标。

## 环境变量

必须提供：

```bash
export SSH_RELEASE_HOST=example.com
export SSH_RELEASE_USER=deploy
```

认证方式二选一：

```bash
export SSH_RELEASE_PASSWORD='your-password'
```

或：

```bash
export SSH_RELEASE_PRIVATE_KEY_PATH="$HOME/.ssh/id_rsa"
```

可选：

```bash
export SSH_RELEASE_PORT=22
export SSH_RELEASE_CLI=/absolute/path/to/dist/cli.js
export SSH_RELEASE_STRICT_HOST_KEY_CHECKING=no
export SSH_RELEASE_KEEP_LOCAL_ON_FAILURE=1
```

使用密码登录时，本机需要安装 `sshpass`。私钥登录不需要 `sshpass`。`SSH_RELEASE_KEEP_LOCAL_ON_FAILURE` 默认为 `1`，失败时保留本地临时日志；设置为 `0` 可在失败后也删除本地日志。

CLI 遇到传输类 SSH/SCP 错误会自动重试；脚本自身的清理连接也使用连接超时和保活参数，避免远端清理因为连接抖动长时间挂住。

## 验证内容

`scripts/dogfood-real.sh` 会按顺序执行：

1. `ssh-release --version --json`
2. `ssh-release doctor --json`
3. 第一次 `ssh-release deploy --json --progress`
4. 修改本地文件后第二次 `ssh-release deploy --json --progress`
5. `ssh-release rollback --json --progress`
6. `ssh-release list --json`

脚本会校验：

- `doctor` 成功。
- 两次 `deploy` 都返回 `verified=true`。
- `rollback --json --progress` 输出 `lock`、`switch`、`cleanup`、`verify` 阶段。
- 回滚结果返回 `verified=true`。
- 回滚后 `current` 回到第一版。
- 回滚校验项包含目标版本、当前版本和远端锁。
- 远端临时目录已清理，并输出 `remote_cleanup=ok`。

成功时会输出类似：

```json
{
  "dogfood": "ok",
  "target": "/tmp/ssh-release-dogfood-20260627-120000",
  "rollbackVerified": true,
  "currentAfterRollback": "20260627-120003"
}
```

## 安全边界

- 目标目录固定为 `/tmp/ssh-release-dogfood-*`。
- 清理逻辑只会删除匹配 `/tmp/ssh-release-dogfood-*` 的远端目录。
- 脚本不会重启服务、修改 Nginx、操作容器或执行业务 hook。
- 脚本不会把密码写入配置文件；配置只读取环境变量。
- 脚本退出时会尝试清理本次远端目标；如果进程被强制杀掉，可以手工删除确认属于本次测试的 `/tmp/ssh-release-dogfood-*` 目录。

## 失败处理

先保留脚本输出，再看最后的失败 JSON：

- `doctor ok` 失败：先运行 `ssh-release doctor --json` 排查 SSH、远端目录、远端 `tar` 和 hash 命令。
- `deploy verified` 失败：检查远端 `current`、版本目录、`manifest.json` 和锁状态。
- `rollback progress` 失败：确认当前 CLI 版本支持 `rollback --json --progress`。
- `remote_cleanup=ok` 未出现：只删除确认属于本次测试的 `/tmp/ssh-release-dogfood-*` 目录。

脚本失败时默认保留本地临时日志，并输出 `local logs retained` 路径。排查完成后可以删除该本地目录，或在下次运行前设置 `SSH_RELEASE_KEEP_LOCAL_ON_FAILURE=0`。
