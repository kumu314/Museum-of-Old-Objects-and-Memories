-- 单图生成任务的账号日额度：按 UTC 日期累计已提交任务数，用于成本上限。
CREATE TABLE model_generation_usage (
  owner_id uuid NOT NULL REFERENCES team_members(id) ON DELETE CASCADE,
  usage_date date NOT NULL,
  task_count integer NOT NULL CHECK (task_count > 0),
  PRIMARY KEY (owner_id, usage_date)
);

-- 回填既有任务的当日计数，升级当天不会把已用额度清零。
INSERT INTO model_generation_usage (owner_id, usage_date, task_count)
SELECT created_by, (created_at AT TIME ZONE 'UTC')::date, count(*)::integer
FROM model_generation_jobs
GROUP BY created_by, (created_at AT TIME ZONE 'UTC')::date;
