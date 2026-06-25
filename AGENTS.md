# 仓库指南

## 项目结构与模块组织

本仓库用于开发 `ssh-release`，一个通用 SSH 文件发布 CLI。当前设计文档位于 `docs/superpowers/specs/2026-06-25-ssh-release-design.md`。

源码按职责拆分：

- `src/cli.ts`：命令入口与参数解析。
- `src/config.ts`、`src/validate.ts`：配置加载、归一化和校验。
- `src/ssh.ts`、`src/package.ts`、`src/remote.ts`、`src/process.ts`：SSH、打包、远端命令和本地进程封装。
- `src/release.ts`、`src/rollback.ts`、`src/list.ts`、`src/doctor.ts`：发布、回滚、列表和检查流程模块。
- `tests/`：单元测试和集成测试。
- `docs/`：设计说明和贡献文档。

不要提交生成的压缩包、本地历史目录、构建产物或真实部署凭证。

## 构建、测试与开发命令

当前使用 npm 管理 TypeScript CLI。常用命令如下：

- `npm run dev`：本地运行 CLI。
- `npm run build`：编译发布产物。
- `npm test`：运行完整测试。
- `npm run lint`：检查格式和静态问题。
- `npm run prepublishOnly`：发布前运行 lint、test 和 build。
- `npm publish --dry-run`：检查 npm 发布包内容，不执行真实发布。

新增常用命令后，同步更新本文档。

## 代码风格与命名规范

源码使用 TypeScript。模块应保持职责单一，优先使用显式导出。缩进使用两个空格，语句保留分号，字符串使用单引号。

变量和函数使用 `camelCase`，类型和类使用 `PascalCase`。CLI 命令保持小写，必要时使用连字符，例如 `ssh-release deploy`。

## 测试规范

单元测试应覆盖配置加载、路径校验、危险远程路径拦截、版本号生成、版本保留计算和回滚目标选择。

集成测试应优先模拟本地打包和发布目录流转，不依赖真实 SSH 服务器。测试文件按模块或行为命名，例如 `validate.test.ts`、`rollback-target.test.ts`。

## 提交与 Pull Request 规范

沿用当前 conventional commit 风格：

- `docs(spec): 添加 ssh-release 设计文档`
- `chore(repo): 初始化项目提交`

格式为 `<type>(<scope>): <description>`。描述要简短、明确，直接说明做了什么。

Pull Request 应包含变更摘要、验证步骤和行为影响。有关联 issue 时需要链接。只有在说明 CLI 行为更清楚时才附截图或终端输出。

## 安全与配置提示

不要提交私钥、密码、真实服务器 IP 或生产路径。配置示例应使用 `SSH_RELEASE_HOST`、`SSH_RELEASE_USER`、`SSH_RELEASE_PASSWORD` 等环境变量。

保持第一版边界：本工具只发布文件并切换版本，不重启服务、不修改 Nginx、不执行自定义远程 hook。
