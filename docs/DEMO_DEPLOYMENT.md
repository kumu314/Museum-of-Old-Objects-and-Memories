# IP + 端口 Demo 部署

2026-10-25，用户明确选择 HTTP Demo。入口为 `http://47.99.189.48:17682`。
本环境只用于测试账号和获准的演示素材，不代表完整方案 B 或正式生产验收。

## 目录与运行

- `/srv/shiwuguan/releases/<版本>/`：源码、冻结依赖及本机构建的 `.next`；不复制本机私有配置、数据库、上传目录和 `output/`。
- `/srv/shiwuguan/current`：当前发布目录的符号链接。
- `/srv/shiwuguan/shared/app.env`：服务器独立生成的数据库连接、会话密钥及运行配置，仅 root 和应用用户组可读。
- `/srv/shiwuguan/shared/uploads`：持久私有素材。
- `/srv/shiwuguan/shared/postgres`：独立 PostgreSQL 容器的数据目录。
- `/srv/shiwuguan/backups`：暂停写入期间生成的数据库与素材配套备份，仅 root 可读。
- `shiwuguan-demo.service`：systemd 应用服务，使用非特权 `shiwuguan` 用户。
- `shiwuguan-postgres`：独立 PostgreSQL 18 容器，仅绑定 `127.0.0.1:15432`。应用库和测试库使用不同角色，互不授予连接权限。
- Node.js 26.12.0 位于 `/opt/shiwuguan-runtime/node-v26.12.0-linux-x64`。依赖沿用 pnpm 12.14.0 锁文件；更新时先在本机隔离目录构建，服务器不承担构建。

HTTP Demo 必须显式设置 `DEMO_ALLOW_HTTP=true`，并将 `APP_ORIGIN` 设为实际入口。
未开启该设置时，生产模式仍拒绝 HTTP；HTTPS 入口始终使用 Secure Cookie。
同源检查、登录、归属、分享权限保持原规则。HTTP 不适合真实密码和私密素材。
AI 配置未随本机环境迁移，未配置时相关操作明确失败，不返回假生成内容。

## 操作与后续更新

```sh
systemctl status shiwuguan-demo --no-pager
journalctl -u shiwuguan-demo -n 50 --no-pager
curl -fsS http://127.0.0.1:17682/api/health
systemctl restart shiwuguan-demo
```

合并 PR 不会自动部署。后续先验证新版，在新的发布目录准备构建与依赖，
停止应用写入并配套备份数据库和 uploads，再使用该版本的 `scripts/migrate.ts` 执行迁移，
切换 `current` 并启动，检查健康接口、HTTP 登录、素材和重启持久化。
不要覆盖 shared，也不要执行 Docker 卷删除或清库。数据库有迁移时不能只回退代码冒充完整回滚；
先核对迁移兼容性，必要时在停止写入后恢复同一批数据库及素材备份。

SSH 仅允许管理出口 IP；热点或 Wi-Fi 出口变化后需更新安全组。TUN 可继续开启，
但服务器 IP 需走直连；查询代理出口不等于 SSH 的真实来源。
应用 TCP 17682 由用户在安全组开放，数据库端口不开放到公网。
现有 Komari 服务与监控链路保留。

## 验证记录

本次使用单人自查：配置回归测试、相关文件 lint、TypeScript 检查、隔离生产构建通过。
服务器 Node.js 下载哈希校验及 sharp/pg 原生加载通过。
首次 Demo 已部署，发布目录 `20261025-demo-1`，基于 `faa2fbd9591d60ca95522521eca6be345572c92c` 加本次未提交的 HTTP 配置修改。

已验证：公网健康接口 200；12 项迁移；注册、密码登录及 HTTP 会话；错误 Origin 拒绝；
未登录不能读取展馆和素材；合成图片上传、处理与私有读取；首页及 JS 静态资源；
浏览器实际首页和内置展柜加载。应用及数据库容器分别重启后，账号会话、展馆和图片仍可读取。
systemd 开机自启与容器 unless-stopped 策略已设置，未重启整台服务器。

配套备份：`/srv/shiwuguan/backups/backup-udWqWNu7`。
可用 `bash /srv/shiwuguan/backup.sh` 再次执行短暂停写备份，脚本结束自动恢复应用服务。
本轮在新建隔离数据库中实际恢复备份，核对 12 项迁移、1 座验收馆和 1 项素材，
并解包素材与原目录逐文件比较一致；随后仅删除本次恢复验证数据库，保留备份。
这验证数据库与素材可恢复，不等于整机灾难恢复或生成任务恢复验收。

保留一个带“部署验收馆（合成数据）”标识的私有验收账号与图片，不包含真实素材。
AI/真实建模、生成模型发布快照、真实手机、完整浏览器制作发布闭环和整机重启未验收。
现有 Komari 三项服务仍 active。未提交、推送或创建 PR。
