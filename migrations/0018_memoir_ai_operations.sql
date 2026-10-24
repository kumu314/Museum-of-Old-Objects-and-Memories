CREATE TABLE memoir_ai_operations (
  id uuid PRIMARY KEY,
  memoir_id uuid NOT NULL REFERENCES memoirs(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('chapter','followup')),
  target_id uuid NOT NULL,
  request_hash text NOT NULL,
  source_version integer NOT NULL CHECK (source_version > 0),
  state text NOT NULL CHECK (state IN ('sending','succeeded','failed','unknown','superseded')),
  generation text NOT NULL DEFAULT 'provider' CHECK (generation='provider'),
  provider_request_id text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX memoir_ai_by_book ON memoir_ai_operations(memoir_id,id);
CREATE UNIQUE INDEX memoir_ai_pending_target ON memoir_ai_operations(memoir_id,kind,target_id)
  WHERE state IN ('sending','unknown');
