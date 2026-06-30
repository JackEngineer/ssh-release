# 1.0.0 稳定契约

本文档记录 `ssh-release` 1.0.0 的稳定行为边界。后续版本遵循 SemVer：兼容新增使用 minor，破坏性变更使用 major。

## CLI 命令契约

稳定命令：

- `ssh-release init [--template default|single-file|static-site] [--config <path>]`
- `ssh-release init --interactive [--config <path>]`
- `ssh-release doctor [--config <path>]`
- `ssh-release deploy [--config <path>]`
- `ssh-release deploy --dry-run [--config <path>]`
- `ssh-release deploy --plan [--config <path>]`
- `ssh-release deploy --json --progress [--config <path>]`
- `ssh-release list [--config <path>]`
- `ssh-release rollback [version] [--config <path>]`
- `ssh-release rollback [version] --dry-run [--config <path>]`
- `ssh-release rollback [version] --plan [--config <path>]`
- `ssh-release rollback [version] --json --progress [--config <path>]`
- `ssh-release unlock [--confirm <lock-path>] [--config <path>]`
- `ssh-release --help`
- `ssh-release --version`

稳定选项：

- `--config <path>`：使用自定义配置文件。
- `--template default|single-file|static-site`：仅用于 `init`，选择要生成的配置模板。
- `--interactive`：仅用于 `init`，按提示生成配置，可选择生成 GitHub Actions workflow；不能与 `--template` 或 `--json` 同时使用。
- `--json`：输出可机器解析的 JSON。
- `--progress`：用于 `deploy --json --progress` 和 `rollback --json --progress`，输出 NDJSON 阶段事件。
- `--dry-run`：生成计划预览，不执行发布或回滚修改。
- `--plan`：计划预览别名，行为等同 `--dry-run`。
- `--confirm <lock-path>`：显式确认要删除的远端锁路径。

## 退出码

- `0`：命令完成，或 `--help`、`--version` 正常返回。
- `1`：命令失败、参数错误、配置错误、远端检查失败、发布失败、回滚失败，或 `unlock` 发现锁但未删除。

`doctor` 中存在 `warn` 时仍可能返回 `0`，只要没有 `fail` 检查项。

## JSON 输出契约

成功结果：

```json
{"ok": true, "command": "deploy", "result": {"mode": "release", "verified": true}}
```

`init --json` 成功结果包含生成的配置路径和模板名：

```json
{"ok": true, "command": "init", "result": {"configPath": "ssh-release.config.ts", "template": "static-site"}}
```

失败结果：

```json
{"ok": false, "command": "deploy", "error": "错误信息"}
```

如果错误属于常见可恢复场景，失败结果还会包含 `hint`：

```json
{"ok": false, "command": "rollback", "error": "回滚目标不存在: 20260625-090000", "hint": "先运行 ssh-release list 查看当前版本和可用版本，再选择存在的版本回滚。"}
```

非零命令结果，例如发现锁但未删除：

```json
{"ok": false, "command": "unlock", "result": {"locked": true, "removed": false}}
```

`deploy --json --progress` 和 `rollback --json --progress` 使用 NDJSON。进度事件在最终结果前输出：

```json
{"ok": true, "command": "deploy", "event": "progress", "stage": "package", "status": "start"}
{"ok": true, "command": "deploy", "event": "progress", "stage": "package", "status": "success"}
{"ok": true, "command": "deploy", "result": {"mode": "release", "verified": true}}
```

稳定阶段：

`deploy`：

- `source`
- `lock`
- `package`
- `publish`
- `cleanup`

`rollback`：

- `lock`
- `switch`
- `cleanup`
- `verify`

稳定状态：

- `start`
- `success`
- `fail`

`deploy` 成功结果包含：

- `mode`
- `targetPath`
- `usedFallback`
- `manifest`
- `warnings`
- `verified`
- `verification`

`release` 模式还包含：

- `version`
- `currentSymlink`

`rollback` 成功结果包含：

- `version`
- `currentSymlink`
- `warnings`
- `verified`
- `verification`

`deploy --dry-run` 和 `deploy --plan` 结果包含：

- `upload`：将上传的来源、远端临时压缩包路径、远端清单路径、文件数和总字节数。
- `switch`：`release` 模式下将切换的 `current` 路径和目标。
- `cleanup`：远端锁路径、远端临时压缩包路径和版本保留策略。
- `verification`：发布后将执行的校验项。

`rollback --dry-run` 和 `rollback --plan` 会连接远端读取锁状态、版本列表和当前版本，但不会创建锁、不会切换 `current`、不会删除版本目录。结果包含：

- `currentVersion`：当前 `current` 指向的版本。
- `version`：计划回滚到的目标版本。
- `targetPath`：目标版本目录。
- `switch`：将切换的 `current` 路径、当前指向和目标指向。
- `cleanup`：远端锁路径，以及回滚不删除版本目录的说明。
- `verification`：实际回滚前需要满足的校验项。

## 配置契约

配置文件使用 `export default` 导出对象。

稳定字段：

- `source.path`
- `source.exclude`
- `server.host`
- `server.port`
- `server.username`
- `server.password`
- `server.privateKeyPath`
- `target.path`
- `target.currentSymlink`
- `target.releasesDir`
- `target.tempDir`
- `deploy.mode`
- `deploy.keepReleases`
- `deploy.compression`
- `deploy.preferTar`
- `deploy.fallbackToFileUpload`

推荐通过环境变量提供服务器信息：

```ts
server: {
  host: process.env.SSH_RELEASE_HOST,
  username: process.env.SSH_RELEASE_USER,
  password: process.env.SSH_RELEASE_PASSWORD,
}
```

不要把真实密码、私钥、访问令牌或生产路径写入配置文件。

## 发布后校验契约

`deploy` 和 `rollback` 返回成功前会执行远端状态校验。

`release` 模式校验：

- 版本目录存在。
- `current` 已指向新版本。
- `manifest.json` 已上传且远端 hash 与本地生成的清单 hash 一致。
- 远端锁已清理。

`overwrite` 模式校验：

- 目标目录存在。
- `manifest.json` 已上传且远端 hash 与本地生成的清单 hash 一致。
- 远端锁已清理。

`rollback` 校验：

- 目标版本目录存在。
- `current` 已指向目标版本。
- 远端锁已清理。

校验失败时命令返回失败，不会输出成功结果。

`deploy` 会在目标目录写入 `manifest.json`：

- `release` 模式写入版本目录。
- `overwrite` 模式写入目标目录。

清单记录本次发布版本、创建时间、配置中的本地来源路径、排除规则、文件相对路径、文件大小、文件 SHA-256、文件总数和总字节数。

## 安全边界

`ssh-release` 只负责文件发布和版本切换：

- 不重启服务。
- 不修改 Nginx。
- 不操作容器。
- 不会执行自定义远程 hook。
- 不在命令行参数中传递密码。
- 不允许危险顶层远端路径作为目标目录。

密码登录通过 `SSHPASS` 环境变量交给 `sshpass -e`。私钥登录使用本机 `ssh` 和 `scp`。
