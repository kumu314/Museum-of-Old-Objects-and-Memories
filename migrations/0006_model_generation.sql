-- 照片生成 3D：任务持久化与生成结果（模型资产）。
-- 任务独立于展品版本演进：source_version 记录提交时的展品版本快照，
-- 采纳（写入展品并使旧确认失效）由后续联动实现。
CREATE TABLE model_generation_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  museum_id uuid NOT NULL,
  exhibit_id uuid NOT NULL,
  source_version integer NOT NULL CHECK (source_version > 0),
  mode text NOT NULL CHECK (mode IN ('single')),
  input_asset_id uuid NOT NULL REFERENCES assets(id),
  provider text NOT NULL,
  external_job_id text,
  status text NOT NULL CHECK (status IN ('SUBMITTING', 'WAIT', 'RUN', 'FAIL', 'DONE')),
  error_code text,
  error_message text CHECK (error_message IS NULL OR length(error_message) BETWEEN 1 AND 240),
  model_asset_id uuid,
  created_by uuid NOT NULL REFERENCES team_members(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (exhibit_id, museum_id) REFERENCES exhibits(id, museum_id),
  CHECK ((status = 'DONE') = (model_asset_id IS NOT NULL))
);
CREATE INDEX model_generation_jobs_exhibit ON model_generation_jobs(exhibit_id, created_at DESC);

CREATE TABLE model_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  museum_id uuid NOT NULL REFERENCES museums(id),
  job_id uuid NOT NULL REFERENCES model_generation_jobs(id),
  byte_size integer NOT NULL CHECK (byte_size > 0),
  storage_key text NOT NULL UNIQUE,
  sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  stats jsonb NOT NULL CHECK (jsonb_typeof(stats) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE model_generation_jobs
  ADD CONSTRAINT model_generation_jobs_result FOREIGN KEY (model_asset_id) REFERENCES model_assets(id);
