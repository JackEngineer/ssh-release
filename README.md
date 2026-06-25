# ssh-release

`ssh-release` 是一个通用 SSH 文件发布 CLI，目标是把本地文件或目录可靠发布到服务器。

它只负责文件发布和版本切换，不负责构建项目、重启服务、修改 Nginx、操作容器或执行自定义远程脚本。

## 当前状态

当前仓库处于早期实现阶段。

已实现：

- `ssh-release init`：生成 `ssh-release.config.ts` 配置模板。
- 配置模板生成。
- 配置字段归一化和校验。
- 危险远程路径拦截。
- 版本号生成。
- 旧版本保留计算。
- 回滚目标选择。

已预留但尚未实现：

- `ssh-release deploy`
- `ssh-release rollback [version]`
- `ssh-release list`
- `ssh-release doctor`

执行这些预留命令时，CLI 当前会返回“命令尚未实现”。

## 安装依赖

```bash
npm install
```

## 本地开发

```bash
npm run dev -- init
```

构建 CLI：

```bash
npm run build
```

构建后可以直接运行：

```bash
node dist/cli.js init
```

## 配置初始化

在需要发布文件的项目目录中执行：

```bash
ssh-release init
```

当前开发阶段也可以用源码入口执行：

```bash
npm run dev -- init
```

生成的配置文件名为 `ssh-release.config.ts`。

示例配置：

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
};
```

## 发布模型

默认发布模型是版本化发布：

```text
source files -> package -> upload -> release -> activate -> rollback
```

`release` 模式下，远程目录规划如下：

```text
/var/www/my-app/
├── current -> releases/20260625-153000
├── releases/
│   ├── 20260625-153000/
│   └── 20260625-150000/
└── .ssh-release-tmp/
```

规则：

- 每次发布创建一个新版本目录。
- 新版本完整上传和解压完成后，才切换 `current`。
- 回滚只切换 `current`，不删除版本目录。
- 清理旧版本时保留当前版本。

`overwrite` 模式用于不需要版本管理的目录，后续实现后会直接发布到 `target.path`，不创建 `current` 和 `releases`。

## 安全边界

配置模板不包含真实 IP、密码或生产路径。

推荐通过环境变量提供服务器信息：

```bash
export SSH_RELEASE_HOST=example.com
export SSH_RELEASE_USER=deploy
```

以下远程目标路径会被默认拒绝：

- `/`
- `/home`
- `/root`
- `/var`
- `/usr`
- `/etc`
- `/opt`
- `/tmp`

这些路径下的子目录可以使用，例如 `/var/www/my-app`。

## 开发命令

```bash
npm run lint
npm test
npm run build
```

命令说明：

- `npm run lint`：运行 TypeScript 静态检查。
- `npm test`：运行 Node.js 测试。
- `npm run build`：编译 `dist/`。

## 项目结构

```text
src/
├── cli.ts
├── config.ts
├── release.ts
├── rollback.ts
├── types.ts
└── validate.ts

tests/
├── config-template.test.ts
├── release.test.ts
├── rollback.test.ts
└── validate.test.ts

docs/
└── superpowers/specs/2026-06-25-ssh-release-design.md
```

## 测试重点

当前测试覆盖：

- 配置模板不泄露真实主机、密码和 IP。
- 配置默认值填充。
- 危险远程路径拒绝。
- 发布模式和压缩格式校验。
- 时间戳版本名生成。
- 旧版本清理选择。
- 回滚目标选择。

## 设计文档

完整设计见：

```text
docs/superpowers/specs/2026-06-25-ssh-release-design.md
```

## License

MIT
