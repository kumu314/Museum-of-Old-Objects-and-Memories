-- 方向二 · 共同作者与多人讲述（第四块落库）。
--
-- 三条不可协商的产品规则由表结构托住，不靠界面自觉：
-- 1. 邀请粒度是**单件展品**：邀请挂在 (exhibit_id, museum_id) 上，不是展馆级。
--    馆主邀请某人讲这只搪瓷缸，不等于把整馆的编辑权交出去。
-- 2. **未接受邀请不产生署名权**：只有 status='accepted' 算数。declined 与 cancelled
--    分开保留，因为动作主体不同（对方拒绝 / 馆主收回），合并就丢了"谁拒的"这一事实。
-- 3. **每位作者分别同意自己的内容公开**：publish_consent 是逐份的列，
--    不是账号级设置——一个人点了同意，不代表另一个人的讲述可以公开。
--
-- 本表落地不等于公开版本已经包含多人讲述：发布快照仍然只含展品本身，
-- 参观页要等快照格式支持多人讲述后才会出现这些内容，这一点不得对外含糊。
CREATE TABLE contribution_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  museum_id uuid NOT NULL,
  exhibit_id uuid NOT NULL,
  invitee_id uuid NOT NULL REFERENCES team_members(id),
  invited_by uuid NOT NULL REFERENCES team_members(id),
  -- 发出邀请时的展示名快照：对方改名不应改写历史邀请上的当时语义。
  invitee_name text NOT NULL CHECK (length(invitee_name) BETWEEN 1 AND 60),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled')),
  invited_at timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz,
  FOREIGN KEY (exhibit_id, museum_id) REFERENCES exhibits(id, museum_id),
  -- 待回应与回应时间必须同时成立：让"已回应却没时间"这种既无法审计也无法展示
  -- 的状态根本写不进来。
  CONSTRAINT contribution_invitations_response_time CHECK ((status = 'pending') = (responded_at IS NULL))
);

-- 同一展品对同一个人只允许一条"还在生效"的邀请（待回应或已接受）。
-- 被拒绝、被收回的不受限：换个时机重新邀请是正常动作；但重复的 pending
-- 会让对方收件箱出现两条一模一样的邀请，且分不清该回应哪一条。
CREATE UNIQUE INDEX contribution_invitations_live ON contribution_invitations(exhibit_id, invitee_id)
  WHERE status IN ('pending', 'accepted');
-- 收件箱按被邀请人查：对方登录后要立刻看到"有哪些展品邀请我讲"。
CREATE INDEX contribution_invitations_invitee ON contribution_invitations(invitee_id, status);

CREATE TABLE contributions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  museum_id uuid NOT NULL,
  exhibit_id uuid NOT NULL,
  author_id uuid NOT NULL REFERENCES team_members(id),
  -- owner 是展馆归属人（museums.created_by），不需要邀请；coauthor 必须有已接受的邀请。
  -- 该判定跨表，CHECK 表达不了，由服务端在写入与读取两处各校验一次。
  author_role text NOT NULL CHECK (author_role IN ('owner', 'coauthor')),
  -- 署名快照，理由同邀请上的 invitee_name。
  author_name text NOT NULL CHECK (length(author_name) BETWEEN 1 AND 60),
  story text NOT NULL CHECK (length(story) BETWEEN 1 AND 4000),
  -- 来源必填：缺来源的转述无法核验，而多人讲述的价值就在来源。
  source_note text NOT NULL CHECK (length(source_note) BETWEEN 1 AND 200),
  publish_consent boolean NOT NULL DEFAULT false,
  -- 撤回不是删除：行留着，新公开版本据此移除。谁讲过、何时讲的仍然可查。
  withdrawn_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (exhibit_id, museum_id) REFERENCES exhibits(id, museum_id)
);

-- 展示按展品取全部讲述，再按创建时间稳定排序；同一作者的多份内容也要能一次查全。
CREATE INDEX contributions_exhibit ON contributions(exhibit_id, created_at);
CREATE INDEX contributions_author ON contributions(author_id, created_at);
