-- 不重写已可能应用的 0006；保留原任务并补充幂等与纹理提交记录。
ALTER TABLE model_generation_jobs
  ADD COLUMN request_id uuid,
  ADD COLUMN texture_submission_started boolean NOT NULL DEFAULT false,
  ADD COLUMN texture_external_job_id text;
CREATE UNIQUE INDEX model_generation_jobs_request ON model_generation_jobs(exhibit_id, request_id);
-- 历史任务可能已经提交纹理；升级后先查询上游，不自动再次付费。
UPDATE model_generation_jobs SET texture_submission_started=true WHERE external_job_id IS NOT NULL;
-- 旧版本将提交结果未知标成 FAIL；升级后恢复不可重提的状态。
UPDATE model_generation_jobs SET status='SUBMITTING', error_code='SUBMIT_UNKNOWN',
  error_message='提交结果未知，请由管理员核对上游任务后处理，当前不会再次提交。'
WHERE status='FAIL' AND external_job_id IS NULL AND
  (error_code IS NULL OR error_code !~ '^[0-9]{1,12}$') AND
  (error_code IS NULL OR error_code NOT IN ('CONFIG_INVALID','INPUT_INVALID'));
