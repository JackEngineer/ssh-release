# 失败恢复指南

本文档用于处理 `ssh-release` 发布、回滚、检查和 CI/CD 中常见失败。不要把真实服务器 IP、密码、私钥、访问令牌或生产路径写进 issue、PR、日志和文档。

## 先收集证据

失败后先保留命令输出，再判断是否需要人工介入：

```bash
ssh-release doctor --json
ssh-release deploy --json --progress
ssh-release list --json
```

`--json --progress` 会输出每个发布阶段。最后一行如果是 `{ "ok": false }`，优先看 `error` 字段；如果发布成功，最终结果里的 `verified` 应为 `true`。

常见可恢复失败会额外给出下一步提示。普通命令输出显示 `下一步:`，JSON 输出使用 `hint` 字段。

## 远端锁存在

现象：

- `doctor` 显示远端锁为 `warn`。
- `deploy` 或 `rollback` 提示远端已有发布任务正在运行。

处理：

1. 确认没有仍在运行的发布或回滚任务。
2. 查看锁路径、pid 和创建时间。
3. 只在确认安全后删除锁。

```bash
ssh-release unlock --confirm /var/www/my-app/.ssh-release.lock
```

不要手动删除不确定来源的目录。`--confirm` 路径必须和工具提示的锁路径一致。

## 发布后校验失败

现象：

- `deploy` 上传或切换阶段完成，但最终返回失败。
- 错误信息包含 `current 未指向新版本`、`版本目录校验失败`、`目标目录校验失败` 或 `发布锁未清理`。

处理：

1. 运行 `ssh-release list --json` 查看当前版本。
2. 如果 `current` 没有指向新版本，先确认新版本目录是否完整。
3. 如果旧版本仍可用，优先回滚到旧版本。

```bash
ssh-release rollback
```

4. 重新运行 `ssh-release doctor --json`，确认远端锁和远端目录状态。
5. 修复远端目录权限、软链接或锁问题后重新发布。

校验失败时不要把 CI 标记为成功。发布命令返回失败就应停止后续流程。

## 远端 tar 失败

现象：

- 远端 `tar` 不存在或解压失败。
- 发布结果中的 `usedFallback` 为 `true`。

处理：

1. 如果 `deploy.fallbackToFileUpload` 为 `true`，工具会自动回退逐文件上传。
2. 如果不希望逐文件上传，安装远端 `tar` 或修复远端解压权限后重新发布。
3. 如果 `fallbackToFileUpload` 为 `false`，发布会失败；修复远端 `tar` 后再执行。

```bash
ssh-release doctor --json
ssh-release deploy --json --progress
```

## SSH 登录失败

现象：

- `doctor` 在 SSH 连接阶段失败。
- CI 日志显示认证失败、连接超时或主机不可达。

处理：

1. 确认 `SSH_RELEASE_HOST`、`SSH_RELEASE_USER`、`SSH_RELEASE_PASSWORD` 或私钥 secret 是否存在。
2. 确认服务器允许对应认证方式。
3. 使用受控环境手动运行 `ssh-release doctor --json`。
4. 不要在 CI 日志中打印密码、私钥或完整连接命令。

## 回滚失败

现象：

- `rollback` 提示没有可回滚版本。
- 指定版本不存在。
- 远端锁存在。

处理：

1. 运行 `ssh-release list --json` 查看版本列表和当前版本。
2. 如果没有旧版本，不能通过工具回滚；需要重新发布一个可用版本。
3. 如果指定版本不存在，换用列表中存在的版本。
4. 如果远端锁存在，按“远端锁存在”流程处理。

```bash
ssh-release rollback 20260625-150000
```

## CI/CD 失败

处理顺序：

1. Pull Request 中只跑 `ssh-release deploy --dry-run --json`。
2. 正式发布 job 使用 `environment: production` 和并发控制。
3. `doctor` 失败时不要继续执行 `deploy`。
4. `deploy` 返回非零退出码时不要继续执行回滚或其他自定义命令，先判断失败阶段。
5. 需要人工修复远端状态时，保留 JSON 输出作为证据。

GitHub Actions 示例见 [github-actions.md](./github-actions.md)。
