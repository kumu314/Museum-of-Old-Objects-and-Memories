# SQL 迁移

执行 `pnpm db:migrate`，配置从进程环境及 `.env.local` 读取。连接目标是 `DATABASE_URL`，不是测试库。

业务迁移由 C 按数据契约新增，文件命名为 `0001_description.sql`、`0002_description.sql`，从 0001 连续编号。已应用的 SQL 不再修改或删除；追加新迁移修正。文件只能包含事务内可执行的 SQL，不自行写 `BEGIN` / `COMMIT` / `ROLLBACK`，不使用 `CREATE INDEX CONCURRENTLY` 等事务外操作。

执行器使用 PostgreSQL 事务、事务级互斥锁与 `schema_migrations` 校验和账本；重复运行不重复应用，历史被修改时失败。所有待应用迁移及账本一起提交，失败一起回滚。不要手工修改账本或通过清库解决迁移冲突。

当前主线包含连续的 `0001`—`0005`：初始模型与会话、用户归属、登录/注册节流分区，以及个人唯一展馆、跨页格位和建模照片准备。保留原型已应用的 `0001_initial.sql` 与 `0002_auth.sql`，不重写其内容和校验和。开发库使用 `pnpm db:migrate`，测试库使用 `pnpm db:migrate:test`，统一要求 PostgreSQL 18。

`0005_personal_museum_pages.sql` 遇到同一账号已有多座有效展馆时明确失败，整批待应用迁移一起回滚；须先备份并由馆主决定内容处理，不能自动删馆、清库或修改账本。旧分支的分叉迁移历史另按 [迁移兼容说明](../docs/PERSONAL_MUSEUM_FLOW.md#迁移与兼容) 协调。

`/api/health` 核对当前源码要求的完整迁移序列、文件名与校验和，不执行或修复迁移。真实数据库集成测试使用 `tests/fixtures/migrations/` 的明确测试表，验证执行器、DDL 回滚与重复运行；这些夹具不是展馆业务模型。实际业务约束另由 `tests/db/` 的业务测试覆盖，完整发布验收仍按实施状态追踪。
