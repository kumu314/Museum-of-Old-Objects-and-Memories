-- 非自传的 AI 展签整理按账号与 UTC 日期计数，用于限制文本 AI 调用费用。
-- 与自传 AI 用量分开记账：两者的预算来源与失败口径不同，互不占用。
CREATE TABLE ai_draft_daily_usage (
  owner_id uuid NOT NULL REFERENCES team_members(id) ON DELETE CASCADE,
  usage_date date NOT NULL,
  draft_count integer NOT NULL CHECK (draft_count > 0),
  PRIMARY KEY (owner_id, usage_date)
);

-- 回填升级当天已生成的草稿，升级不会把当日已用额度清零。
INSERT INTO ai_draft_daily_usage (owner_id, usage_date, draft_count)
SELECT m.created_by, (d.created_at AT TIME ZONE 'UTC')::date, count(*)::integer
FROM ai_drafts d JOIN museums m ON m.id = d.museum_id
GROUP BY m.created_by, (d.created_at AT TIME ZONE 'UTC')::date;
