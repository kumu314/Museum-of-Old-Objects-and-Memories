# 拾物馆

以旧物、故事和真实 3D 收藏柜为核心的纪念展产品，首版采用团队协助制作：客户提供素材，团队收录与整理，物主确认具体版本后发布并交付参观链接。

当前已有应用工程骨架（Next.js 16 + PostgreSQL）与类型、lint、测试、构建入口，产品功能尚未实现；G0 工程初始化进行中，契约、数据层与身份尚未落地。运行方式见[运行说明](docs/运行说明.md)。

## 实施文档

| 文档 | 用途 |
| --- | --- |
| [开发书 v0.6](docs/PROJECT_PLAN.md) | 产品范围、数据与接口约定、验收标准 |
| [后续功能想法](docs/PROJECT_PLAN.md#12-后续功能想法) | 公开与私密展馆、世界与好友、自传、共同作者、故事与共同记忆；收费方向见开发书第 11.1 节 |
| [AGENTS v1.0.4](AGENTS.md) | 编码助手的工程与授权规则 |
| [团队执行方案 v1.2](docs/TEAM_EXECUTION_PLAN.md) | A—E 职责、交付依赖与复核安排 |
| [提交手册 v1.2](docs/提交手册.md) | Git、环境隔离、检查与合入流程 |
| [赛事与提交说明](docs/COMPETITION_BRIEF.md) | 仓库记录的赛事要求、来源与待核对事项 |
| [历史技术调研](docs/09-技术调研.md) | 参考路线和素材线索，不作为当前实施决定 |

## 当前技术基线

数据库为 **PostgreSQL**（驱动 `pg`，手写 SQL）；应用为 Next.js 16 App Router + React 19.3 + TypeScript 5.9（`strict`、`noUncheckedIndexedAccess`、`exactOptionalPropertyTypes`）、Tailwind CSS 4、Zod 4；三维用 Three.js 0.185.1 + React Three Fiber 9.8.2 + Drei 10.7.9。版本一律精确固定，清单与升级理由见[运行说明](docs/运行说明.md)。

工具链为 Node.js 22.22.2（`.node-version`）与 pnpm 10.30.3（`packageManager`），CI 与本地使用同一基线，安装走 `pnpm install --frozen-lockfile`。

开发、测试与生产数据库隔离；`DATABASE_URL`、`TEST_DATABASE_URL` 等真实连接配置不进入 Git。数据库和素材在暂停写入的同一窗口内生成配套备份，恢复要求见开发书。

## 当前可运行的检查

```sh
# 克隆后安装一次本地提交钩子
bash scripts/install-hooks.sh

# 检查仓库文件与最近一条提交信息
bash scripts/check.sh

# 应用检查（需先 pnpm install --frozen-lockfile）
pnpm run check   # typecheck + lint + test
pnpm run build   # 生产构建
pnpm run test:db # 真实 PostgreSQL 连接、迁移与事务（先按运行说明启动隔离测试库）
```

`bash scripts/check.sh` 只覆盖仓库噪声与提交信息格式；类型检查、lint、单元测试和生产构建由 `pnpm run check` / `pnpm run build` 覆盖，两者都已接入 CI。新增 `test:db` 使用隔离 PostgreSQL 17，覆盖连接、迁移执行器和事务提交/回滚，并接入 CI；业务发布、快照隔离、备份恢复和部署验收仍需对应实现与证据。已移除固定的提交行数和文件体积限制，保留敏感文件、生成物、空壳代码与调试残留检查。

## 协作与资料清理

常规开发从 `main` 创建任务分支，通过 PR 交付；相关验证和复核完成后由 C 统筹 Squash 合入。工作方式以提交手册为准，不自行添加 AI 署名。本次文档清理与 PostgreSQL 基线更新由用户明确授权直接提交 `main`，不改变后续常规流程。

旧协作规范、通用排期和选题过程记录已移出当前文件树，原内容保留在 Git 历史的 `f11a50c` 提交中。赛事要求已提取到赛事说明，技术调研保留为参考；不再预留第二套产品定义或作战板。

## License

[MIT](LICENSE)
