# Changelog

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
