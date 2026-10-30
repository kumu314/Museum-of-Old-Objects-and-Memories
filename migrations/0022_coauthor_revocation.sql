-- 馆主停止已接受的共写关系（缺陷台账 LIM-07）。
-- 不新增状态值：status 转为 'cancelled'，revoked_at 记录"这条邀请是馆主撤销的"，
-- 与"发出后未被回应就收回"（revoked_at 为空）区分开。
-- 已公开的讲述属于作者本人，不随撤销移除；撤销只让对方不能再新增。
ALTER TABLE contribution_invitations ADD COLUMN revoked_at timestamptz;

ALTER TABLE contribution_invitations ADD CONSTRAINT contribution_invitations_revoked
  CHECK (revoked_at IS NULL OR (status = 'cancelled' AND responded_at IS NOT NULL));
