-- Preserve all content: legacy accounts with multiple active museums need an
-- explicit content decision before the new owner constraint can be applied.
DO $$
BEGIN
  IF EXISTS (SELECT created_by FROM museums WHERE deleted_at IS NULL GROUP BY created_by HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'Multiple active museums exist for an account. Resolve ownership/content explicitly before applying 0004; no content was removed.';
  END IF;
END $$;
CREATE UNIQUE INDEX museums_one_active_owner ON museums(created_by) WHERE deleted_at IS NULL;
ALTER TABLE exhibits DROP CONSTRAINT exhibits_slot_index_check;
ALTER TABLE exhibits ALTER COLUMN slot_index TYPE integer;
ALTER TABLE exhibits ADD CONSTRAINT exhibits_slot_index_check CHECK (slot_index >= 0);
ALTER TABLE exhibits ADD COLUMN model_input jsonb NOT NULL DEFAULT '{"mode":"single","imageAssetId":null}'
  CHECK (jsonb_typeof(model_input) = 'object');
