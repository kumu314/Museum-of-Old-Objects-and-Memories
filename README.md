# 拾物馆

以旧物、故事和真实 3D 收藏柜为核心的纪念展产品。首版采用方案 A：团队收录与整理，物主确认具体版本后发布并交付参观链接。

本机统一工作目录为 `heikesong`，应用、三维预览、测试和文档共用同一套代码与锁文件。

当前正在实现 G0—G5，进度与未完成项见 [实施状态](docs/IMPLEMENTATION_STATUS.md)。已有三维原型由另一任务继续精修，G0 提供独立应用基础；页面可启动不代表登录、制作发布或最终验收已完成。

## 环境与启动

固定 Node.js **26.12.0**、pnpm **12.14.0**、PostgreSQL **18.6**（本地容器固定镜像摘要）。应用使用 Next.js 16.4.3 / React 19.3.1 / Tailwind 4.3.3 / Three.js 0.186.1，Fiber 9 与 React 19 兼容。全部依赖见 `package.json` 和 `pnpm-lock.yaml`，不全局安装应用依赖。

音频校验还需要系统提供 `ffmpeg` 和 `ffprobe`；CI 已显式安装，部署环境同样需要准备。

```sh
pnpm install --frozen-lockfile
pnpm db:local
pnpm db:migrate
pnpm db:migrate:test
pnpm dev
```

`db:local` 需要 Docker Compose；它创建本项目两套独立数据库与持久卷（127.0.0.1:15432 / 15433）、生成私密配置和 `.local/uploads`，保留已有 `.env.local`。已有配置时请自行核对端点，脚本不会覆盖。应用账号无超级用户、创建库或创建角色权限，测试凭据不能连接开发容器。不要运行 `docker compose down -v` 删除持久数据。

应用地址 `http://127.0.0.1:17682`，健康接口 `/api/health` 核对数据库迁移记录及上传目录可读写。三维原型使用同一仓库中的 `pnpm dev:scene` 启动，地址 `http://127.0.0.1:17681/`；G1 正式参观页接入仍需单独验收。

外置 PostgreSQL 时，参照 `.env.example` 手动创建 `.env.local`：两个数据库必须隔离，`UPLOAD_DIR` 必须为 `public` 之外的绝对路径，提前创建并赋予应用账号读写权限。`SESSION_PASSWORD` 至少 32 个随机字符。连接串、会话密钥、素材、数据库和输出报告都不得提交。

停止本任务本地数据库且保留数据：

```sh
docker compose -f compose.local.yml stop
```

## 团队制作账号

没有客户注册入口。管理员将 `TEAM_USERNAME` 和至少 12 字符的随机 `TEAM_PASSWORD` 放入私有 `.env.local`，运行 `pnpm team:create` 预置成员后移除明文密码配置。脚本不覆盖同名账号，不在输出中打印密码。所有团队成员具有相同制作权限。

登录会话使用 iron-session 加密 cookie 与服务端会话记录，8 小时过期；退出会撤销该会话。写请求校验 Origin，生产 cookie 仅经 HTTPS 发送。每账号五分钟最多十次登录尝试。

## 检查与迁移

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm test:db
pnpm test:scene
pnpm build:scene
APP_ORIGIN=https://museum.example.test pnpm build
# 仓库检查加应用检查；生产构建使用生产 HTTPS origin
APP_ORIGIN=https://museum.example.test bash scripts/check.sh
```

`test` 聚焦公共契约和服务端边界；`test:db` 使用 `TEST_DATABASE_URL` 的真实 PostgreSQL。`test:scene` 单独验证正在精修的场景模块，不以服务端检查替代浏览器视觉验收。没有数据库配置时测试明确失败。CI 运行工程、契约、隔离数据库和生产构建门禁；三维接入后加入对应正式页面的回归验证。

SQL 迁移从 `0001` 连续编号，迁移在事务和数据库锁中执行，并校验已应用文件的 SHA-256。已应用文件不再修改；重复执行无新迁移时不改数据。失败回滚，不能用清库或改校验和绕过错误。

## 部署边界

首版为单实例 Node + 独立 PostgreSQL + 持久私有上传目录。生产配置 `APP_ORIGIN` 使用实际 HTTPS 域名，反向代理终止 TLS；应用使用 `pnpm build` / `pnpm start`。会话、上传、AI 及发布实现后再交付完整部署说明与可运行备份恢复脚本。

生产部署、备份恢复、真实 AI、实际手机、简短演示视频仍未验收，不能把本地 G0 通过作为上线证明。AI API 当前未配置；失败路径不会返回假生成内容。

## 项目约定

- [运行说明](docs/运行说明.md)：统一目录、环境、备份与整合后的验证记录。
- [后续产品与收费方向](docs/PROJECT_PLAN.md#12-后续产品方向)：保留为后续规划，不自动纳入首版。
- [开发书 v0.6](docs/PROJECT_PLAN.md)：产品范围与全部验收要求。
- [工程规范 v1.0.4](AGENTS.md)：模块、类型、安全及授权边界。
- [团队执行方案](docs/TEAM_EXECUTION_PLAN.md)：G0—G5 定义；本轮由用户承担 A—E，关键变更记录单人自查。
- [提交手册](docs/提交手册.md)：按任务分支、明确暂存、检查与交付。用户已授权本地分批提交，推送及破坏性操作另行确认。
- [赛事说明](docs/COMPETITION_BRIEF.md)、[历史技术调研](docs/09-技术调研.md)。

[MIT](LICENSE)
