# ssh-release 设计文档

日期：2026-06-25

## 1. 项目定位

`ssh-release` 是一个通用 SSH 文件发布 CLI。它不绑定前端项目、不绑定 Node.js 项目、不绑定 Nginx，也不负责应用运行时管理。

第一版只解决一个问题：把本地文件或目录可靠地发布到服务器。

核心发布模型：

```text
source files -> package -> upload -> release -> activate -> rollback
```

第一版支持：

- 本地文件或目录发布
- 自动打包压缩
- SSH 上传
- 默认版本化发布
- `current` 软链接切换
- 旧版本保留
- 回滚
- 直接覆盖模式
- 远端优先 `tar` 解压，失败回退逐文件上传

第一版不支持：

- 构建项目
- 重启服务
- 健康检查
- Docker 或 Podman 操作
- Nginx 配置生成
- 用户自定义远程 hooks

这个边界保证工具是“更新包发布器”，不是应用运维平台。

## 2. 命令设计

第一版提供 5 个命令：

```bash
ssh-release init
ssh-release deploy
ssh-release rollback
ssh-release list
ssh-release doctor
```

命令职责：

- `init`：在当前项目生成 `ssh-release.config.ts` 配置模板。
- `deploy`：发布本地文件或目录。
- `rollback`：回滚到上一个版本，或回滚到指定版本。
- `list`：查看远程版本列表和当前版本。
- `doctor`：检查配置、本地源、SSH 连接、远程目录和远端 `tar` 可用性。

第一版不单独提供 `upload` 命令。上传是 `deploy` 流程的一部分。

直接覆盖模式通过配置控制：

```ts
deploy: {
  mode: 'release' // 或 'overwrite'
}
```

## 3. 配置设计

默认配置文件名为 `ssh-release.config.ts`。

示例：

```ts
export default {
  source: {
    path: './dist',
    exclude: ['.DS_Store', 'node_modules'],
  },

  server: {
    host: process.env.SSH_RELEASE_HOST,
    port: 22,
    username: process.env.SSH_RELEASE_USER,
    password: process.env.SSH_RELEASE_PASSWORD,
    privateKeyPath: '~/.ssh/id_rsa',
  },

  target: {
    path: '/var/www/my-app',
    currentSymlink: 'current',
    releasesDir: 'releases',
    tempDir: '.ssh-release-tmp',
  },

  deploy: {
    mode: 'release',
    keepReleases: 5,
    compression: 'tgz',
    preferTar: true,
    fallbackToFileUpload: true,
  },
}
```

字段含义：

- `source.path`：本地要发布的文件或目录。
- `source.exclude`：打包或逐文件上传时排除的文件名或目录名。
- `server.host`：目标服务器地址。
- `server.port`：SSH 端口，默认 `22`。
- `server.username`：SSH 用户名。
- `server.password`：SSH 密码，推荐只从 `SSH_RELEASE_PASSWORD` 环境变量读取。
- `server.privateKeyPath`：SSH 私钥路径，支持 `~` 展开。
- `target.path`：远程发布根目录。
- `target.currentSymlink`：当前版本软链接名。
- `target.releasesDir`：版本目录名。
- `target.tempDir`：远程临时目录名。
- `deploy.mode`：发布模式，支持 `release` 和 `overwrite`。
- `deploy.keepReleases`：保留最近多少个版本。
- `deploy.compression`：压缩格式，第一版固定为 `tgz`。
- `deploy.preferTar`：是否优先使用远端 `tar` 解压。
- `deploy.fallbackToFileUpload`：远端解压失败后是否回退逐文件上传。

## 4. 远程目录结构

默认 `release` 模式下，远程目录结构为：

```text
/var/www/my-app/
├── current -> releases/20260625-153000
├── releases/
│   ├── 20260625-153000/
│   └── 20260625-150000/
└── .ssh-release-tmp/
```

规则：

- 每次发布创建一个新的版本目录。
- 上传和解压完成前不切换 `current`。
- 只有新版本完整可用后，才把 `current` 指向新版本。
- `rollback` 只切换 `current`，不删除版本目录。
- 清理旧版本时不删除当前版本。

`overwrite` 模式下，不创建 `releases` 和 `current`，直接把内容发布到 `target.path`。

## 5. 发布流程

### 5.1 release 模式

`deploy` 默认使用 `release` 模式，流程如下：

1. 读取配置文件。
2. 校验配置字段。
3. 检查本地 `source.path` 是否存在。
4. 生成版本号，例如 `20260625-153000`。
5. 在本地把源文件或目录打成 `.tgz` 包。
6. 通过 SSH 连接服务器。
7. 创建远程基础目录、临时目录和目标版本目录。
8. 上传压缩包到远程临时目录。
9. 优先使用远端 `tar` 解压到 `releases/<version>`。
10. 如果 `tar` 不可用或解压失败，清理失败版本目录并回退逐文件上传。
11. 上传或解压完成后，切换 `current` 软链接到新版本。
12. 清理远程临时包。
13. 保留最近 `keepReleases` 个版本，清理更旧版本。
14. 输出版本号、远程路径和当前指向。

### 5.2 overwrite 模式

`overwrite` 模式流程如下：

1. 读取并校验配置。
2. 检查本地 `source.path`。
3. 本地打包。
4. 连接服务器。
5. 上传压缩包到远程临时目录。
6. 优先用远端 `tar` 解压到 `target.path`。
7. 如果解压失败，回退逐文件覆盖上传。
8. 清理远程临时包。
9. 输出发布结果。

`overwrite` 模式不支持回滚。

## 6. 回滚流程

`rollback` 只在 `release` 模式下可用。

默认回滚到上一个版本：

```bash
ssh-release rollback
```

指定版本回滚：

```bash
ssh-release rollback 20260625-150000
```

流程：

1. 连接服务器。
2. 读取 `releases` 目录。
3. 识别当前 `current` 指向。
4. 找到目标版本。
5. 校验目标版本目录存在。
6. 切换 `current` 到目标版本。
7. 输出当前版本。

回滚不删除任何版本目录。

## 7. list 流程

`list` 用于查看远程版本状态：

```bash
ssh-release list
```

输出内容：

- 远程发布根目录
- 当前版本
- 版本列表
- 每个版本的修改时间
- 被 `current` 指向的版本标记

如果是 `overwrite` 模式，`list` 只提示该模式没有版本列表。

## 8. doctor 流程

`doctor` 用于发布前检查：

```bash
ssh-release doctor
```

检查项：

- 配置文件是否存在。
- 配置字段是否完整。
- 本地 `source.path` 是否存在。
- 远程 SSH 是否可连接。
- 远程 `target.path` 是否可创建或可写。
- 远程 `tar` 是否可用。
- `target.path` 是否命中危险路径规则。

`tar` 不可用不视为失败，只提示将回退逐文件上传。

## 9. 错误处理

第一版错误处理规则：

- 配置缺失：中止，不连接服务器。
- 源路径不存在：中止，不连接服务器。
- SSH 认证失败：中止，不改远程目录。
- 远程 `tar` 不可用：自动回退逐文件上传。
- 压缩包上传失败：中止，不切 `current`。
- 解压失败：清理失败版本目录，再回退逐文件上传。
- 逐文件上传失败：中止，不切 `current`。
- `current` 切换失败：保留新版本目录，不清理旧版本，提示人工处理。
- 清理旧版本失败：发布仍算成功，但输出警告。
- 回滚目标不存在：中止，不切 `current`。

核心保证：只要 `current` 没切过去，线上版本就不变。

## 10. 安全边界

危险远程路径默认禁止：

- `/`
- `/home`
- `/root`
- `/var`
- `/usr`
- `/etc`
- `/opt`
- `/tmp`

允许这些路径下的子目录，例如 `/var/www/my-app`。

凭证规则：

- 默认推荐私钥登录。
- 支持从环境变量读取服务器地址、用户名等信息。
- 支持密码登录，但只推荐从 `SSH_RELEASE_PASSWORD` 环境变量读取。
- 配置模板不写入明文密码。
- 同时配置 `server.password` 和 `server.privateKeyPath` 时，优先使用密码登录。
- 密码登录依赖本地 `sshpass`，运行时通过 `SSHPASS` 环境变量传递密码，不把密码放入命令行参数。

远程命令边界：

- 工具只执行自身需要的目录、上传、解压、软链接、列表和清理命令。
- 第一版不执行用户自定义远程命令。
- 第一版不做服务重启、容器操作或健康检查。

## 11. 模块划分

建议第一版内部模块：

```text
src/
├── cli.ts
├── config.ts
├── validate.ts
├── ssh.ts
├── package.ts
├── upload.ts
├── release.ts
├── rollback.ts
├── list.ts
├── doctor.ts
└── output.ts
```

职责：

- `cli.ts`：命令入口和参数解析。
- `config.ts`：加载配置文件。
- `validate.ts`：配置校验和危险路径校验。
- `ssh.ts`：SSH 连接、命令执行、上传封装。
- `package.ts`：本地打包和临时文件清理。
- `upload.ts`：压缩包上传和逐文件上传。
- `release.ts`：版本发布、软链接切换、旧版本清理。
- `rollback.ts`：回滚逻辑。
- `list.ts`：版本列表读取。
- `doctor.ts`：发布前检查。
- `output.ts`：统一日志和结果输出。

## 12. 测试设计

第一版测试分三层。

单元测试：

- 配置解析。
- 路径校验。
- 危险路径拦截。
- 版本号生成。
- 保留版本计算。
- 回滚目标选择。

集成测试：

- 用本地临时目录模拟 source、package、release、cleanup。
- 不依赖真实 SSH。
- 验证 `release` 和 `overwrite` 的核心文件流转。

手工验收：

- 用一台测试服务器验证 `doctor`。
- 验证 `deploy` 默认版本发布。
- 验证 `list` 显示当前版本。
- 验证 `rollback` 切换版本。
- 验证 `overwrite` 模式。
- 验证远端 `tar` 不可用时回退逐文件上传。

第一版不强制自动启动真实 SSH 服务器。后续可以用 Docker 启动 OpenSSH 做端到端测试。

## 13. 第一版成功标准

第一版完成后，应满足：

- 用户可以在任意项目中执行 `ssh-release init` 生成配置。
- 用户配置本地目录和远程服务器后，可以执行 `ssh-release deploy` 发布文件。
- 默认发布不会破坏当前线上版本，只有完整发布成功后才切换 `current`。
- 用户可以执行 `ssh-release list` 查看版本。
- 用户可以执行 `ssh-release rollback` 回滚到上一个版本。
- 远端没有 `tar` 时，工具可以回退逐文件上传。
- 直接覆盖模式可用于不需要版本管理的目录发布。
- 示例配置不包含真实 IP、真实密码或业务专属信息。
