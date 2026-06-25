# Changelog

## 1.1.0 - 2026-06-26

### Added

- 增强 `deploy --dry-run` 并新增 `deploy --plan`，预览上传、manifest、切换、清理和校验计划。
- 增强 `rollback --dry-run` 并新增 `rollback --plan`，预览回滚目标、`current` 切换和校验项。
- 增加常见失败的下一步提示，覆盖远端锁、回滚目标、发布校验和 SSH 连接错误。
- 增加发布 manifest，发布时生成并上传 `manifest.json`，记录文件清单、大小和 SHA-256。
- 增强发布后校验，远端 `manifest.json` 会进行 hash 校验。

## 1.0.2 - 2026-06-26

### Changed

- 增强 npm 自动发布 workflow，发布后会验证 registry 版本和安装后的 CLI 入口。

## 1.0.1 - 2026-06-25

### Added

- 增加基于 npm Trusted Publishing 的 GitHub Actions 自动发布 workflow，推送版本标签后可通过 OIDC 发布 npm 包。

### Fixed

- 固定 GitHub Actions 测试时区，避免版本号测试在 UTC runner 中失败。

## 1.0.0 - 2026-06-25

### Added

- 发布 1.0.0 稳定版契约文档，明确 CLI 命令、JSON 输出、退出码、配置字段、发布后校验和安全边界的 SemVer 兼容规则。

## 0.9.0 - 2026-06-25

### Added

- 增加失败恢复指南，覆盖远端锁、发布后校验失败、远端 `tar` 失败、SSH 登录失败、回滚失败和 CI/CD 失败处理流程。

## 0.8.0 - 2026-06-25

### Added

- 增加 GitHub Actions 发布模板文档，覆盖 Pull Request 预检、生产发布、`--json --progress` 输出、环境保护和 Secrets 使用方式。

## 0.7.0 - 2026-06-25

### Added

- 增加发布后远端状态校验，`deploy` 成功后会确认目标目录、`current` 指向和远端锁清理状态，并在结果中输出 `verified` 与 `verification`。

## 0.6.0 - 2026-06-25

### Added

- 增加 `ssh-release deploy --json --progress`，发布时按 NDJSON 输出 `source`、`lock`、`package`、`publish`、`cleanup` 阶段状态，并在最后输出发布结果。

## 0.5.0 - 2026-06-25

### Added

- 增加全局 `--json` 输出，支持 `deploy`、`doctor`、`list`、`rollback`、`unlock` 等命令输出单行结构化结果，便于 CI/CD 解析。

## 0.4.0 - 2026-06-25

### Added

- 增加 `ssh-release unlock` 安全解锁流程，默认只查看远端锁，必须传入匹配的 `--confirm <lock-path>` 才会删除锁目录。

## 0.3.0 - 2026-06-25

### Added

- 增加 `ssh-release doctor` 远端锁状态检查，无锁时通过，有锁时提示锁路径、pid、创建时间和安全清理条件。

## 0.2.0 - 2026-06-25

### Added

- 增加 `--help` 和 `--version`，方便安装后确认 CLI 能力和版本。
- 增加 `--config <path>`，支持使用非默认配置文件。
- 增加 `ssh-release deploy --dry-run`，可在不连接远端、不修改服务器的情况下查看发布计划。
- 增加远端锁 `.ssh-release.lock`，避免同一目标目录并发发布或回滚。
- 增加 GitHub Actions CI，在 `main` 推送和 Pull Request 上运行安装、类型检查、测试和构建。

## 0.1.0 - 2026-06-25

首个 npm 版本。

### Added

- 提供 `ssh-release init` 生成配置模板。
- 提供 `ssh-release doctor` 检查配置、本地源路径、SSH 连接、远程目录和远端 `tar`。
- 提供 `ssh-release deploy` 发布本地文件或目录。
- 提供 `ssh-release list` 查看远程版本和当前版本。
- 提供 `ssh-release rollback [version]` 回滚到上一个版本或指定版本。
- 支持 `release` 模式：上传压缩包、远端解压、切换 `current`、清理旧版本。
- 支持 `overwrite` 模式：直接覆盖发布到目标目录。
- 支持远端 `tar` 失败后逐文件上传回退。
- 支持私钥登录和密码登录；密码通过 `SSHPASS` 环境变量交给 `sshpass -e`。
- 拦截危险远程目标路径和不安全的目标辅助目录名。
- macOS 打包时排除 AppleDouble 和扩展属性元数据。

### Verified

- 通过单元测试和 fake `ssh`/`scp` 端到端测试覆盖核心发布、列表、回滚和覆盖发布流程。
- 通过真实服务器验证密码登录、`doctor`、`deploy`、`list`、`rollback` 和 `overwrite` 流程。
- 通过 `npm publish --dry-run` 和本地 tarball 安装烟测验证 npm 包内容和 CLI 入口。
